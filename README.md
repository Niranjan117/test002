# Bloom NeoTracker (Flutter + ESP32)

Bloom NeoTracker is a hybrid BLE + cloud child-tracker platform.
This repository contains:
- Flutter mobile app (control, diagnostics, maps, geofence, mode center)
- ESP32 firmware (GPS/SIM/motion logic, cloud polling, AT command API)
- HTTP bridge server (`bridge/`) for ESP32 HTTP-to-Firestore sync
- Firebase integration artifacts and helper scripts

Latest user feature:
- App can send a phone number to firmware, and SIM800L sends an SMS containing live location + cell identity from the inserted device SIM.
- Dashboard includes Cloud Terminal that queues firmware AT commands in Firestore for cloud execution.
- ESP32 auto-registers itself on boot through HTTP bridge, so app-side manual registration is optional fallback only.
- App is cloud-only for link/control; BLE link controls are removed from dashboard.
- Firmware transport is now standalone SIM800 GPRS HTTP (no Wi-Fi dependency).
- GPS status chip in app turns active only when fresh ESP32 cloud heartbeat is detected.

## 1) Repository Layout

- App source: `lib/`
- Firmware source: `firmware/esp32_tracker_firmware/esp32_tracker_firmware.ino`
- HTTP bridge source: `bridge/src/server.js`
- Flutter tests: `test/`
- Android host project: `android/`
- iOS host project: `ios/`
- Web host project: `web/`
- Windows helper scripts:
  - `build_release.bat`
  - `build_all_sizes.bat`

## 2) Prerequisites

### App
- Flutter SDK 3.x
- Dart SDK (bundled with Flutter)
- Android SDK + platform tools (for Android builds)

### Firmware
- Arduino IDE 2.x or `arduino-cli`
- ESP32 board package (`esp32:esp32`)
- Library: `TinyGPSPlus`
- USB driver for your ESP32 board

## 3) App: Setup, Run, Validate

Install dependencies:
```bash
flutter pub get
```

Run on connected device/emulator:
```bash
flutter run
```

Run static checks and tests:
```bash
flutter analyze
flutter test
```

Targeted analyzer (frequently touched files):
```bash
dart analyze lib/screens/tracker_control_panel_screen.dart lib/screens/firmware_settings_screen.dart lib/screens/mode_control_center_screen.dart
```

## 4) App: Build Artifacts

Single release APK:
```bash
flutter build apk --release
```

Split-per-ABI release APKs:
```bash
flutter build apk --split-per-abi --release
```

Play Store app bundle:
```bash
flutter build appbundle --release
```

Windows batch helpers:
- `build_release.bat`: clean -> pub get -> icons -> split APK build
- `build_all_sizes.bat`: universal APK + split APKs + AAB size comparison

Output locations:
- APKs: `build/app/outputs/flutter-apk/`
- AAB: `build/app/outputs/bundle/release/app-release.aab`

## 5) Firmware: Build and Flash

Firmware file:
- `firmware/esp32_tracker_firmware/esp32_tracker_firmware.ino`

### Arduino IDE path
1. Open the `.ino` file.
2. Select board: ESP32 Dev Module (or your exact variant).
3. Set flash/upload options appropriate to your board.
4. Install `TinyGPSPlus` from Library Manager.
5. Verify and Upload.
6. Open serial monitor at `115200`.

### Arduino CLI path (example)
Install/update core and library:
```bash
arduino-cli core update-index
arduino-cli core install esp32:esp32
arduino-cli lib install TinyGPSPlus
```

Compile:
```bash
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/esp32_tracker_firmware
```

Upload (replace COM port):
```bash
arduino-cli upload -p COM5 --fqbn esp32:esp32:esp32 firmware/esp32_tracker_firmware
```

## 6) Firmware Hardware Notes

Current pin map (from firmware):
- SIM UART: RX GPIO14, TX GPIO13
- GPS UART: RX GPIO16, TX GPIO17
- SIM MOSFET gate: GPIO25
- GPS MOSFET gate: GPIO26
- Accelerometer: GPIO34, GPIO35, GPIO32
- Battery ADC: GPIO33
- W25Q32 SPI: CS5, MISO19, MOSI23, SCK18

Power sequencing safety is implemented in firmware:
- SIM off first on down transitions
- GPS pre-bias before SIM on up transitions
- Settling delays around rail transitions

## 7) Cloud + Mode Control Contract

### Firestore document used by mode authority
- Collection: `test001`
- Document: `MyFirstDevice` (default)

Top-level fields consumed by firmware:
- `mode_id` (1..25)
- `custom_delay_sec`
- `stationary_trigger_sec`
- `stationary_timeout_sec`
- `stationary_permission`
- `home_ble_permission`
- `home_ble_timeout_sec`
- `home_ble_mac`
- `office_ssid`
- `theft_lock`

## 7.1) Firestore Queue Collections (App Terminal + Mode Tests)

The app now writes command and test jobs to Firestore through REST API:

- `tracker_devices`:
  - firmware heartbeat/registration records
  - used by app for auto-registration (most recent online device)
- `tracker_commands`:
  - dashboard terminal AT command queue
  - fields: `deviceId`, `command`, `status`, `createdAt`, `source`
- `mode_test_runs`:
  - full mode test jobs from Safety page
  - fields: `deviceId`, `modeName`, `parameters`, `status`, `createdAt`

## 7.2) ESP32 HTTP Bridge Contract (No HTTPS on Device)

ESP32 firmware in this repo uses HTTP endpoints (not HTTPS) for compatibility,
and reaches them over SIM800 GPRS data:

- `POST /v1/device/register`
- `POST /v1/device/heartbeat`
- `GET /v1/device/commands?deviceId=<id>&token=<token>`
- `POST /v1/device/ack`

Recommended architecture:

1. ESP32 talks HTTP over cellular data to your publicly reachable bridge.
2. Bridge handles Firestore HTTPS operations.
3. Flutter app writes commands/tests directly to Firestore REST.
4. Bridge serves queued commands to ESP32 and writes ACK/results.

Standalone firmware setup reminders:
- Set `SIM_APN`, optional APN username/password, and `AUTH_TOKEN` in firmware.
- Set `BRIDGE_BASE_URL` to a public host/IP reachable from cellular network (not localhost/LAN-only).

Status written back by firmware telemetry payload:
- `mode_id`
- `current_state` (for example: `mode_applied:3`)

## 8) Sleep and Mode Behavior Notes

Key behavior in current firmware:
- Cloud `mode_id` is authoritative for operational policy.
- Stationary GPS sleep supports trigger/sleep timers with min guardrails.
- Timed SIM cycle (`AT+SIM_PWR_CYCLE`) forces temporary SIM-off then auto-restore.
- New SMS dispatch (`AT+SEND_LOC_SMS=<number>`) sends GPS and cell data (Cell ID/LAC/MCC/MNC) through SIM800L.

Recent safety fix included:
- `CM_FLIGHT_MODE` and `CM_REMOTE_LOCKDOWN` now enforce hard radio-off behavior and can no longer be accidentally re-enabled by OP_SLEEP heartbeat pulses.

## 9) Important AT Commands (Firmware)

Identity/cloud:
- `AT+AUTH=<token>`
- `AT+CLOUD=<project>,<apikey>,<deviceDoc>,<apn>[,<commandBridgeUrl>]`

Status/config:
- `AT+STATUS?`
- `AT+CFG?`
- `AT+MOTION_SENS=<float>`
- `AT+SLEEP_IDLE_MS=<ms>`
- `AT+SIM_WAKE_MS=<ms>`
- `AT+TELEM_MS=<ms>`
- `AT+POLL_MS=<ms>`

Power/mode controls:
- `AT+GPS_PWR=0|1`
- `AT+SIM_PWR=0|1`
- `AT+SIM_PWR_CYCLE=<sec>`
- `AT+ALL_PWR=0|1`
- `AT+SEND_LOC_SMS=<phone_number>`
- `AT+APP_CTRL=0|1`
- `AT+APPROVE_MODE=<0..6>`
- `AT+DENY_MODE`
- `AT+TINYML=0|1`
- `AT+STATIONARY_GPS=<trigger_ms>,<sleep_ms>`

SMS command notes:
- Number format: optional leading `+` and digits only (`7..16` digits after optional `+`).
- Firmware returns `EVENT,sms,location_sent,<number>` on success.
- Firmware returns `ERR,BAD_PHONE`, `ERR,SIM_OFF`, or `ERR,SMS_SEND_FAILED` on failure.

Geo/cell:
- `AT+CELL?`
- `AT+SAFE_CELL_ADD=<cellId>`
- `AT+SAFE_CELL_CLR`
- `AT+ZONE=<...>`
- `AT+ZONE_CLR`

Maintenance:
- `AT+SYNC_NOW`
- `AT+PING_LOC`
- `AT+RESTART`

## 10) Copilot/Contributor Handoff Rules

- Keep cloud-first + mode-authoritative behavior intact.
- If you add or rename mode fields, update both:
  - writer side in `lib/screens/mode_control_center_screen.dart`
  - reader side in `firmware/esp32_tracker_firmware/esp32_tracker_firmware.ino`
- Do not remove SIM/GPS power sequencing safeguards.
- Keep telemetry backward-compatible where possible (existing keys consumed by app).
- Validate with targeted analyzer before finalizing app-side edits.

## 11) Troubleshooting

App build failures:
```bash
flutter clean
flutter pub get
flutter analyze
```

If Android build fails due signing or Gradle issues:
- Check `android/local.properties`
- Check SDK path and Java/Gradle compatibility

If firmware does not respond after flash:
- Confirm serial baud `115200`
- Verify board/port selection
- Verify SIM power supply headroom (SIM800 bursts can require high peak current)
- Check boot logs for `WARN,SIM_NOT_RESPONSIVE_AT_BOOT`

If cloud mode changes are not applied:
- Verify Firestore project key/doc fields are correct
- Confirm APN and cellular registration (`AT+CELL?` / status lines)
- Ensure `mode_id` is top-level in the target document

## 12) Minimum Future-Use Checklist

Before release:
1. Run `flutter analyze` and `flutter test`.
2. Build release APK or AAB.
3. Smoke-test tracker control panel, mode center, and maps.
4. Verify firmware cloud polling and telemetry patch paths.
5. Confirm flight/lockdown mode radio-off behavior on device.

## 13) Final Cleanup Notes

Repository cleanup completed:
- Removed one-off hardware reference dumps and scratch files (`all codes.txt`, `cellidcode.txt`, and legacy `refrencecode/` content).
- Kept core implementation docs and build scripts.

Branding consistency (restored to Bloom):
- Android app label: `Bloom`
- iOS display name: `Bloom`
- Web manifest name/short name: `Bloom`
- Desktop metadata:
  - Windows product/file description updated to `Bloom`
  - Windows/Linux binary name updated to `Bloom`


# ESP32 Intelligent Child Tracker Firmware

Firmware file: `esp32_tracker_firmware.ino`

## What This Firmware Implements
- GPS + SIM800 + accelerometer integrated runtime
- TinyML-style movement inference scaffold (`stationary`, `walking`, `running`, `transport`, `abnormal`, `loss`)
- 50-state dynamic operational state machine
- Cellular-aware power management with learned trusted cell IDs
- School and safe-zone geofence logic (circle + polygon)
- External W25Q32 flash persistence for:
  - tracker configuration
  - safe cell history
  - geofence zone definitions
  - model metadata
- Telemetry payload generation and Firestore REST POST over SIM HTTP
- Remote command polling hook over SIM HTTP (line-based AT command bridge)

## Default Behavior
- Idle timeout: 30 seconds
- SIM wake heartbeat in sleep/school/safe mode: 2 minutes
- GPS turns off in trusted known cell regions while SIM remains active
- GPS/SIM enter low-power states based on mode and movement
- Anomaly or loss-risk forces high tracking mode
- Testing-first startup: GPS + SIM + all power domains forced ON at boot
- Firebase is the primary telemetry transport (`firestore.googleapis.com` over SIM HTTP)
- BLE telemetry stream is disabled by default (`AT+BLE_TELEM=1` to enable)

## Wiring Summary
- SIM UART: TX=14, RX=13
- GPS UART: TX=16, RX=17
- SIM MOSFET gate: 25
- GPS MOSFET gate: 26
- Accelerometer ADC: X=34, Y=35, Z=32
- Battery ADC: 33
- W25Q32 SPI: CS=5, MISO=19, MOSI=23, SCK=18

## Core AT Commands
- `AT+STATUS?` / `AT+HEALTH?`
- `AT+CELL?`
- `AT+TOWER?` (query and emit current connected tower/cell details)
- `AT+MODES?` (emit supported mode map and current state)
- `AT+TRANSPORT?` (shows active telemetry transport)
- `AT+CFG?`
- `AT+MOTION_SENS=<float>`
- `AT+SLEEP_IDLE_MS=<ms>`
- `AT+SIM_WAKE_MS=<ms>`
- `AT+TELEM_MS=<ms>`
- `AT+POLL_MS=<ms>`
- `AT+SCHOOL_HOURS=08:00-15:00`
- `AT+GPS_WAKE=0|1`
- `AT+SAFE_MODE=0|1`
- `AT+GPS_PWR=0|1` (force)
- `AT+SIM_PWR=0|1` (force)
- `AT+ALL_PWR=0|1` (force)
- `AT+BLE_TELEM=0|1` (emit periodic TELEM lines over BLE)
- `AT+BLE_STATUS=0|1` (emit STATUS/CELL/MODE/ACTION over BLE)
- `AT+SAFE_CELL_ADD=<cellId>`
- `AT+SAFE_CELL_CLR`
- `AT+ZONE=<id>|<kind>|<type>|<label>|<geometry>`
- `AT+ZONE_CLR`
- `AT+PING_LOC`
- `AT+SYNC_NOW`
- `AT+RESTART`

## Zone Command Format
`AT+ZONE=id|kind|type|label|geometry`

- `kind`: `SCHOOL` | `SAFE` | `CUSTOM`
- `type`: `CIRCLE` | `POLYGON`
- Circle geometry: `circle:<lat>:<lng>:<radiusMeters>`
- Polygon geometry: `poly:<lat>:<lng>;<lat>:<lng>;<lat>:<lng>...`

Examples:
- `AT+ZONE=0|SCHOOL|CIRCLE|Greenwood|circle:12.9611:77.6387:180`
- `AT+ZONE=1|SAFE|POLYGON|HomePoly|poly:12.9600:77.6370;12.9610:77.6390;12.9590:77.6400`

## Cloud Setup Command
`AT+CLOUD=<project>,<apiKey>,<deviceDoc>,<apn>,<optionalCommandBridgeUrl>`

Example:
`AT+CLOUD=my-project,AIza...,MyFirstDevice,internet,https://example.com/device-cmd.txt`

- Telemetry Firestore path used:
  `projects/<project>/databases/(default)/documents/test001_telemetry`
- Command bridge should return newline-separated AT commands.

## Important Notes
- SIM HTTP command flow depends on carrier APN and network registration.
- TinyML predictor is scaffold logic now; replace `TinyMlEngine::predict()` with TensorFlow Lite Micro if desired.
- For strict UTC timestamps, integrate GNSS date+time to Unix conversion or RTC sync.
- Firmware emits action audit lines (`ACTION,count=<n>,event=<name>`) whenever it changes mode/state or applies power policy transitions, to support app-side testing visibility.


Battery (+) connects to ESP32 VIN and also to IRFZ44N #1 Source, Battery (-) connects to ESP32 GND as common ground. SIM800L VCC connects to IRFZ44N #1 Drain, SIM800L GND to Battery (-), SIM800L TX to GPIO 14, SIM800L RX to GPIO 13, with two 1000uF capacitors in parallel across SIM800L VCC and GND. IRFZ44N #1 Gate connects to GPIO 25 via 1K resistor. NEO-M8N VCC to ESP32 3.3V, GND to IRFZ44N #2 Drain, TX to GPIO 16, RX to GPIO 17, IRFZ44N #2 Source to GND, Gate to GPIO 26 via 1K resistor. GY-61 VCC to 3.3V, GND to GND, X to GPIO 34, Y to GPIO 35, Z to GPIO 32. W25Q32 VCC to 3.3V, GND to GND, CS to GPIO 5, MISO to GPIO 19, MOSI to GPIO 23, CLK to GPIO 18.

# ESP32 Intelligent Child Tracker Firmware

Firmware file: `esp32_tracker_firmware.ino`

## What This Firmware Implements
- GPS + SIM800 + accelerometer integrated runtime
- TinyML-style movement inference scaffold (`stationary`, `walking`, `running`, `transport`, `abnormal`, `loss`)
- 50-state dynamic operational state machine
- Cellular-aware power management with learned trusted cell IDs
- School and safe-zone geofence logic (circle + polygon)
- External W25Q32 flash persistence for:
  - tracker configuration
  - safe cell history
  - geofence zone definitions
  - model metadata
- Telemetry payload generation and Firestore REST POST over SIM HTTP
- Remote command polling hook over SIM HTTP (line-based AT command bridge)

## Default Behavior
- Idle timeout: 30 seconds
- SIM wake heartbeat in sleep/school/safe mode: 2 minutes
- GPS turns off in trusted known cell regions while SIM remains active
- GPS/SIM enter low-power states based on mode and movement
- Anomaly or loss-risk forces high tracking mode
- Testing-first startup: GPS + SIM + all power domains forced ON at boot
- Firebase is the primary telemetry transport (`firestore.googleapis.com` over SIM HTTP)
- BLE telemetry stream is disabled by default (`AT+BLE_TELEM=1` to enable)

## Wiring Summary
- SIM UART: TX=14, RX=13
- GPS UART: TX=16, RX=17
- SIM MOSFET gate: 25
- GPS MOSFET gate: 26
- Accelerometer ADC: X=34, Y=35, Z=32
- Battery ADC: 33
- W25Q32 SPI: CS=5, MISO=19, MOSI=23, SCK=18

## Core AT Commands
- `AT+STATUS?` / `AT+HEALTH?`
- `AT+CELL?`
- `AT+TOWER?` (query and emit current connected tower/cell details)
- `AT+MODES?` (emit supported mode map and current state)
- `AT+TRANSPORT?` (shows active telemetry transport)
- `AT+CFG?`
- `AT+MOTION_SENS=<float>`
- `AT+SLEEP_IDLE_MS=<ms>`
- `AT+SIM_WAKE_MS=<ms>`
- `AT+TELEM_MS=<ms>`
- `AT+POLL_MS=<ms>`
- `AT+SCHOOL_HOURS=08:00-15:00`
- `AT+GPS_WAKE=0|1`
- `AT+SAFE_MODE=0|1`
- `AT+GPS_PWR=0|1` (force)
- `AT+SIM_PWR=0|1` (force)
- `AT+ALL_PWR=0|1` (force)
- `AT+BLE_TELEM=0|1` (emit periodic TELEM lines over BLE)
- `AT+BLE_STATUS=0|1` (emit STATUS/CELL/MODE/ACTION over BLE)
- `AT+SAFE_CELL_ADD=<cellId>`
- `AT+SAFE_CELL_CLR`
- `AT+ZONE=<id>|<kind>|<type>|<label>|<geometry>`
- `AT+ZONE_CLR`
- `AT+PING_LOC`
- `AT+SYNC_NOW`
- `AT+RESTART`

## Zone Command Format
`AT+ZONE=id|kind|type|label|geometry`

- `kind`: `SCHOOL` | `SAFE` | `CUSTOM`
- `type`: `CIRCLE` | `POLYGON`
- Circle geometry: `circle:<lat>:<lng>:<radiusMeters>`
- Polygon geometry: `poly:<lat>:<lng>;<lat>:<lng>;<lat>:<lng>...`

Examples:
- `AT+ZONE=0|SCHOOL|CIRCLE|Greenwood|circle:12.9611:77.6387:180`
- `AT+ZONE=1|SAFE|POLYGON|HomePoly|poly:12.9600:77.6370;12.9610:77.6390;12.9590:77.6400`

## Cloud Setup Command
`AT+CLOUD=<project>,<apiKey>,<deviceDoc>,<apn>,<optionalCommandBridgeUrl>`

Example:
`AT+CLOUD=my-project,AIza...,MyFirstDevice,internet,https://example.com/device-cmd.txt`

- Telemetry Firestore path used:
  `projects/<project>/databases/(default)/documents/test001_telemetry`
- Command bridge should return newline-separated AT commands.

## Important Notes
- SIM HTTP command flow depends on carrier APN and network registration.
- TinyML predictor is scaffold logic now; replace `TinyMlEngine::predict()` with TensorFlow Lite Micro if desired.
- For strict UTC timestamps, integrate GNSS date+time to Unix conversion or RTC sync.
- Firmware emits action audit lines (`ACTION,count=<n>,event=<name>`) whenever it changes mode/state or applies power policy transitions, to support app-side testing visibility.
#   t e s t 0 0 2  
 
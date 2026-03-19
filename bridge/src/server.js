import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import admin from 'firebase-admin';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const port = Number(process.env.PORT || 8080);
const projectId = process.env.FIREBASE_PROJECT_ID || '';
const deviceToken = process.env.DEVICE_TOKEN || '';
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
const serviceAccountB64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64 || '';

function resolveServiceAccountFromEnv() {
  if (serviceAccountJson) {
    return JSON.parse(serviceAccountJson);
  }
  if (serviceAccountB64) {
    const decoded = Buffer.from(serviceAccountB64, 'base64').toString('utf8');
    return JSON.parse(decoded);
  }
  return null;
}

if (!admin.apps.length) {
  const serviceAccount = resolveServiceAccountFromEnv();
  if (serviceAccount) {
    const resolvedProjectId = projectId || serviceAccount.project_id;
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: resolvedProjectId || undefined,
    });
  } else {
    admin.initializeApp({ projectId: projectId || undefined });
  }
}

const db = admin.firestore();
const devicesCollection = db.collection('tracker_devices');
const commandsCollection = db.collection('tracker_commands');
const modeTestsCollection = db.collection('mode_test_runs');

function validateToken(token) {
  return !!deviceToken && token === deviceToken;
}

function nowTs() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function normalizeModeToCommand(modeName, parameters = {}) {
  switch (modeName) {
    case 'GEOFENCE_VALIDATE':
      return 'AT+MODES?';
    case 'PATH_DEVIATION_VALIDATE':
      return 'AT+PING_LOC';
    case 'INACTIVITY_VALIDATE': {
      const w = String(parameters.window || '10m');
      const ms = w === '5m' ? 300000 : w === '10m' ? 600000 : w === '15m' ? 900000 : 1800000;
      return `AT+STATIONARY_GPS=60000,${ms}`;
    }
    case 'SOS_VALIDATE':
      return 'AT+STATUS?';
    case 'CELL_FALLBACK_VALIDATE':
      return 'AT+CELL?';
    default:
      return 'AT+STATUS?';
  }
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'bloom-http-bridge' });
});

app.post('/v1/device/register', async (req, res) => {
  try {
    const { deviceId, studentName, transport, authToken, firmwareVersion, ip } = req.body || {};
    if (!deviceId || !authToken) {
      return res.status(400).json({ error: 'deviceId and authToken are required' });
    }
    if (!validateToken(authToken)) {
      return res.status(401).json({ error: 'invalid token' });
    }

    await devicesCollection.doc(String(deviceId)).set(
      {
        deviceId: String(deviceId),
        studentName: String(studentName || ''),
        transport: String(transport || 'wifi_http_bridge'),
        firmwareVersion: String(firmwareVersion || ''),
        ip: String(ip || ''),
        online: true,
        lastSeen: nowTs(),
        lastPacketAt: nowTs(),
      },
      { merge: true },
    );

    return res.json({ ok: true, registered: true });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post('/v1/device/heartbeat', async (req, res) => {
  try {
    const { deviceId, authToken, online, mode, state, telemetry, transport } = req.body || {};
    if (!deviceId || !authToken) {
      return res.status(400).json({ error: 'deviceId and authToken are required' });
    }
    if (!validateToken(authToken)) {
      return res.status(401).json({ error: 'invalid token' });
    }

    const trackerLat = telemetry?.lat ?? null;
    const trackerLng = telemetry?.lng ?? null;

    await devicesCollection.doc(String(deviceId)).set(
      {
        deviceId: String(deviceId),
        online: online !== false,
        currentMode: String(mode || ''),
        currentState: String(state || ''),
        transport: String(transport || 'wifi_http_bridge'),
        trackerLat,
        trackerLng,
        speedKph: telemetry?.speedKph ?? null,
        batteryPct: telemetry?.batteryPct ?? null,
        cellId: telemetry?.cellId ?? null,
        rssi: telemetry?.rssi ?? null,
        lastSeen: nowTs(),
        lastPacketAt: nowTs(),
      },
      { merge: true },
    );

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.get('/v1/device/commands', async (req, res) => {
  try {
    const { deviceId, token } = req.query;
    if (!deviceId || !token) {
      return res.status(400).json({ error: 'deviceId and token are required' });
    }
    if (!validateToken(String(token))) {
      return res.status(401).json({ error: 'invalid token' });
    }

    const queuedCommands = await commandsCollection
      .where('deviceId', '==', String(deviceId))
      .where('status', '==', 'queued')
      .orderBy('createdAt', 'asc')
      .limit(20)
      .get();

    const queuedModeTests = await modeTestsCollection
      .where('deviceId', '==', String(deviceId))
      .where('status', '==', 'queued')
      .orderBy('createdAt', 'asc')
      .limit(20)
      .get();

    const commands = [];
    const batch = db.batch();

    for (const doc of queuedCommands.docs) {
      const data = doc.data();
      commands.push({
        id: doc.id,
        command: String(data.command || ''),
        source: String(data.source || 'dashboard'),
      });
      batch.update(doc.ref, {
        status: 'dispatched',
        dispatchedAt: nowTs(),
      });
    }

    for (const doc of queuedModeTests.docs) {
      const data = doc.data();
      const modeName = String(data.modeName || 'UNKNOWN');
      const params = (() => {
        try {
          const raw = data.parameters;
          if (!raw) return {};
          if (typeof raw === 'string') {
            return JSON.parse(raw);
          }
          return raw;
        } catch {
          return {};
        }
      })();

      const command = normalizeModeToCommand(modeName, params);
      commands.push({
        id: `mode_${doc.id}`,
        command,
        source: `mode_test:${modeName}`,
      });
      batch.update(doc.ref, {
        status: 'dispatched',
        dispatchedAt: nowTs(),
        dispatchedCommand: command,
      });
    }

    if (!queuedCommands.empty || !queuedModeTests.empty) {
      await batch.commit();
    }

    return res.json({ ok: true, commands });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post('/v1/device/ack', async (req, res) => {
  try {
    const { deviceId, commandId, status, output, authToken } = req.body || {};
    if (!deviceId || !commandId || !authToken) {
      return res.status(400).json({ error: 'deviceId, commandId and authToken are required' });
    }
    if (!validateToken(authToken)) {
      return res.status(401).json({ error: 'invalid token' });
    }

    const isModeAck = String(commandId).startsWith('mode_');
    if (isModeAck) {
      const modeDocId = String(commandId).replace(/^mode_/, '');
      await modeTestsCollection.doc(modeDocId).set(
        {
          status: status === 'ok' ? 'passed' : status === 'error' ? 'failed' : String(status || 'unknown'),
          resultMessage: String(output || ''),
          ackAt: nowTs(),
        },
        { merge: true },
      );
      return res.json({ ok: true, modeAck: true });
    }

    await commandsCollection.doc(String(commandId)).set(
      {
        status: status === 'ok' ? 'ack' : status === 'error' ? 'failed' : String(status || 'unknown'),
        output: String(output || ''),
        ackAt: nowTs(),
      },
      { merge: true },
    );

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.listen(port, () => {
  console.log(`Bloom HTTP bridge listening on port ${port}`);
});

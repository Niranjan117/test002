const express = require('express');
const app = express();
app.use(express.json());

let data = {};

// SIM800L sends data here
app.put('/update', (req, res) => {
  data = { ...req.body, last_updated: new Date().toISOString() };
  console.log('Updated:', data);
  res.json({ status: 200 });
});

// Flutter reads from here
app.get('/data', (req, res) => {
  res.json(data);
});

app.get('/', (req, res) => res.send('Server OK'));

app.listen(process.env.PORT || 3000, () => console.log('Running'));

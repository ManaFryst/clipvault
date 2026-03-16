const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_EXPIRY_MS = parseInt(process.env.EXPIRY_MS) || 60_000;
const MAX_PAYLOAD_BYTES = 10 * 1024;

const store = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (now >= entry.expires_at) store.delete(id);
  }
}, 10_000);

app.use(express.json({ limit: '12kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 60_000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' }
});
app.use('/send', limiter);

// POST /send — receives ciphertext+salt+iv, never passphrase
app.post('/send', (req, res) => {
  const { ciphertext, iv, salt, expiry } = req.body;
  if (!ciphertext || !iv || !salt)
    return res.status(400).json({ error: 'Missing required fields.' });

  const raw = JSON.stringify({ ciphertext, iv, salt });
  if (Buffer.byteLength(raw, 'utf8') > MAX_PAYLOAD_BYTES)
    return res.status(413).json({ error: 'Payload too large (max 10KB).' });

  const expireMs = Math.min(Math.max(parseInt(expiry) || DEFAULT_EXPIRY_MS, 10_000), 300_000);
  const id = crypto.randomInt(100000, 999999).toString();
  const now = Date.now();
  store.set(id, { ciphertext, iv, salt, created_at: now, expires_at: now + expireMs });
  return res.json({ id, expires_in: expireMs });
});

app.get('/status', (req, res) => {
  res.json({ active_secrets: store.size, uptime: process.uptime() });
});

// GET /:id — validate manually, content-negotiate HTML vs JSON
app.get('/:id', (req, res) => {
  const { id } = req.params;
  if (!/^\d{6}$/.test(id)) return res.status(404).send('Not found');

  const accept = req.headers['accept'] || '';
  const isApi = accept.includes('application/json') || !!req.headers['x-requested-with'];

  if (!isApi && accept.includes('text/html'))
    return res.sendFile(path.join(__dirname, 'public', 'retrieve.html'));

  const entry = store.get(id);
  if (!entry) return res.status(404).json({ error: 'Secret not found or already retrieved.' });
  if (Date.now() >= entry.expires_at) {
    store.delete(id);
    return res.status(410).json({ error: 'Secret has expired.' });
  }
  store.delete(id);
  return res.json({ ciphertext: entry.ciphertext, iv: entry.iv, salt: entry.salt });
});

app.listen(PORT, () => {
  console.log(`ClipVault running on http://localhost:${PORT}`);
  console.log(`Default expiry: ${DEFAULT_EXPIRY_MS / 1000}s`);
});

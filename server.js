const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_EXPIRY_MS = parseInt(process.env.EXPIRY_MS) || 60_000; // 60 seconds
const MAX_PAYLOAD_BYTES = 10 * 1024; // 10KB

// In-memory store: id -> { ciphertext, iv, salt, created_at, expires_at }
const store = new Map();

// Cleanup expired secrets every 10 seconds
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (now >= entry.expires_at) {
      store.delete(id);
    }
  }
}, 10_000);

// Middleware
app.use(express.json({ limit: '12kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' }
});
app.use('/send', limiter);
app.use('/get', limiter);

// POST /send — store encrypted payload
app.post('/send', (req, res) => {
  const { ciphertext, iv, salt, expiry } = req.body;

  if (!ciphertext || !iv || !salt) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const raw = JSON.stringify({ ciphertext, iv, salt });
  if (Buffer.byteLength(raw, 'utf8') > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ error: 'Payload too large (max 10KB).' });
  }

  const expireMs = Math.min(
    Math.max(parseInt(expiry) || DEFAULT_EXPIRY_MS, 10_000),
    300_000 // max 5 minutes
  );

  const id = crypto.randomInt(10000, 99999).toString();
  const now = Date.now();

  store.set(id, {
    ciphertext,
    iv,
    salt,
    created_at: now,
    expires_at: now + expireMs
  });

  return res.json({ id, expires_in: expireMs });
});

// GET /get/:id — browser navigation serves HTML; fetch() gets JSON API
app.get('/get/:id', (req, res) => {
  const accept = req.headers['accept'] || '';
  const isApiRequest = accept.includes('application/json') || req.headers['x-requested-with'];

  if (!isApiRequest && accept.includes('text/html')) {
    // Browser navigation — serve the retrieve UI
    return res.sendFile(path.join(__dirname, 'public', 'retrieve.html'));
  }

  // API fetch from retrieve page JS
  const { id } = req.params;

  if (!/^\d{5}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid ID format.' });
  }

  const entry = store.get(id);

  if (!entry) {
    return res.status(404).json({ error: 'Secret not found or already retrieved.' });
  }

  if (Date.now() >= entry.expires_at) {
    store.delete(id);
    return res.status(410).json({ error: 'Secret has expired.' });
  }

  // Delete immediately — one-time read
  store.delete(id);

  return res.json({
    ciphertext: entry.ciphertext,
    iv: entry.iv,
    salt: entry.salt
  });
});

// GET /status — basic health info (no secret data)
app.get('/status', (req, res) => {
  res.json({ active_secrets: store.size, uptime: process.uptime() });
});



app.listen(PORT, () => {
  console.log(`ClipVault running on http://localhost:${PORT}`);
  console.log(`Default expiry: ${DEFAULT_EXPIRY_MS / 1000}s`);
});

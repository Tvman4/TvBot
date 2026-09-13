import express from 'express';
import crypto from 'node:crypto';

const app = express();
app.use(express.json({ limit: '16kb' }));

const PORT = Number(process.env.PORT || 3000);
const API_SECRET = process.env.OTP_API_SECRET;
const OTP_TTL_MS = 5 * 60 * 1000;
const REQUEST_TTL_MS = 10 * 60 * 1000;

if (!API_SECRET) throw new Error('Missing OTP_API_SECRET.');

// Short-lived in-memory requests. Nothing here is a password, cookie, MFA code, or session token.
const pending = new Map();
const issued = new Map();

function auth(req, res, next) {
  const expected = `Bearer ${API_SECRET}`;
  const actual = req.get('authorization') || '';
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function clean(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

app.get('/', (_req, res) => res.json({ ok: true, service: 'TvBot OTP API' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// TvPatcher calls this to start a verification request.
app.post('/api/otp/request', (req, res) => {
  const headset = clean(req.body?.headset, 200);
  if (!headset) return res.status(400).json({ error: 'headset is required' });

  const requestCode = crypto.randomBytes(12).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS).toISOString();
  pending.set(requestCode, { headset, expiresAtMs: Date.now() + REQUEST_TTL_MS });

  res.json({ ok: true, requestCode, expiresAt, message: 'Request created. Use /verify in Discord.' });
});

// Discord bot calls this after an authorized /verify command.
app.post('/api/otp/issue', auth, (req, res) => {
  const requestCode = clean(req.body?.requestCode, 100).toUpperCase();
  const headset = clean(req.body?.headset, 200);
  const discordUserId = clean(req.body?.discordUserId, 40);
  const record = pending.get(requestCode);

  if (!record || record.expiresAtMs < Date.now()) {
    pending.delete(requestCode);
    return res.status(400).json({ error: 'Request code is invalid or expired' });
  }
  if (!headset || record.headset !== headset) {
    return res.status(400).json({ error: 'Headset does not match the request' });
  }
  if (!discordUserId) return res.status(400).json({ error: 'discordUserId is required' });

  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  issued.set(otp, { requestCode, headset, discordUserId, expiresAtMs: Date.now() + OTP_TTL_MS });
  pending.delete(requestCode); // one-time request

  res.json({ otp, expiresAt });
});

// Optional endpoint for TvPatcher to check an OTP.
app.post('/api/otp/check', (req, res) => {
  const otp = clean(req.body?.otp, 20);
  const headset = clean(req.body?.headset, 200);
  const record = issued.get(otp);
  if (!record || record.expiresAtMs < Date.now() || record.headset !== headset) {
    issued.delete(otp);
    return res.status(401).json({ ok: false, error: 'Invalid or expired OTP' });
  }
  issued.delete(otp); // OTP is one-time
  res.json({ ok: true });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of pending) if (r.expiresAtMs < now) pending.delete(code);
  for (const [otp, r] of issued) if (r.expiresAtMs < now) issued.delete(otp);
}, 60_000).unref();

app.listen(PORT, '0.0.0.0', () => console.log(`TvBot OTP API listening on ${PORT}`));

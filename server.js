import express from "express";
import crypto from "node:crypto";

const app = express();

app.use(express.json({ limit: "16kb" }));

const PORT = Number(process.env.PORT || 3000);

// IMPORTANT:
// Set OTP_API_SECRET in Render.
// TvBot's API_SECRET must have the SAME value.
const API_SECRET = process.env.OTP_API_SECRET;

const REQUEST_TTL_MS = 10 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;

if (!API_SECRET) {
  throw new Error("Missing OTP_API_SECRET.");
}

// Pending TvPatcher requests.
// requestCode -> request information
const pending = new Map();

// Issued OTPs.
// otp -> OTP information
const issued = new Map();

function clean(value, max = 256) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function secureEqual(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);

  if (aBuf.length !== bBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuf, bBuf);
}

// API authentication used by Discord/TvBot.
function auth(req, res, next) {
  const authorization = req.get("authorization") || "";
  const expected = `Bearer ${API_SECRET}`;

  if (!secureEqual(authorization, expected)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  next();
}

// ----------------------------------------
// Health
// ----------------------------------------

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "TvBot OTP API",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
  });
});

// ----------------------------------------
// TvPatcher creates a request
// ----------------------------------------

app.post("/api/otp/request", (req, res) => {
  const headset = clean(req.body?.headset, 200);

  if (!headset) {
    return res.status(400).json({
      ok: false,
      error: "headset is required",
    });
  }

  // Long random request code.
  // Example:
  // 8F0A3D9B4C2E7A1F...
  const requestCode = crypto
    .randomBytes(24)
    .toString("hex")
    .toUpperCase();

  const expiresAtMs = Date.now() + REQUEST_TTL_MS;

  pending.set(requestCode, {
    headset,
    expiresAtMs,
  });

  return res.json({
    ok: true,
    requestCode,
    expiresAt: new Date(expiresAtMs).toISOString(),
    message: "Request created. Use /verify in Discord.",
  });
});

// ----------------------------------------
// Discord /verify
//
// Accepts the LONG request code from
// TvPatcher.
//
// Example:
//
// /verify ABCDEF1234567890...
//
// Then creates a 6-digit OTP.
// ----------------------------------------

app.post("/api/otp/issue", auth, (req, res) => {
  const requestCode = clean(req.body?.requestCode, 256).toUpperCase();

  const discordUserId = clean(
    req.body?.discordUserId,
    40
  );

  const discordUsername = clean(
    req.body?.discordUsername,
    100
  );

  if (!requestCode) {
    return res.status(400).json({
      ok: false,
      error: "requestCode is required",
    });
  }

  if (!discordUserId) {
    return res.status(400).json({
      ok: false,
      error: "discordUserId is required",
    });
  }

  const record = pending.get(requestCode);

  if (!record) {
    return res.status(400).json({
      ok: false,
      error: "Request code is invalid or expired",
    });
  }

  if (record.expiresAtMs < Date.now()) {
    pending.delete(requestCode);

    return res.status(400).json({
      ok: false,
      error: "Request code is expired",
    });
  }

  // One request code can only be used once.
  pending.delete(requestCode);

  // Generate the actual short OTP.
  const otp = String(
    crypto.randomInt(0, 1_000_000)
  ).padStart(6, "0");

  const expiresAtMs = Date.now() + OTP_TTL_MS;

  issued.set(otp, {
    requestCode,
    headset: record.headset,
    discordUserId,
    discordUsername,
    expiresAtMs,
  });

  console.log(
    `OTP issued for Discord user ${discordUserId}`
  );

  return res.json({
    ok: true,
    otp,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
});

// ----------------------------------------
// TvPatcher checks the 6-digit OTP
// ----------------------------------------

app.post("/api/otp/check", (req, res) => {
  const otp = clean(req.body?.otp, 20);
  const headset = clean(req.body?.headset, 200);

  if (!/^[0-9]{6}$/.test(otp)) {
    return res.status(400).json({
      ok: false,
      error: "OTP must be 6 digits",
    });
  }

  const record = issued.get(otp);

  if (!record) {
    return res.status(401).json({
      ok: false,
      error: "Invalid or expired OTP",
    });
  }

  if (record.expiresAtMs < Date.now()) {
    issued.delete(otp);

    return res.status(401).json({
      ok: false,
      error: "Invalid or expired OTP",
    });
  }

  if (record.headset !== headset) {
    return res.status(401).json({
      ok: false,
      error: "Headset does not match",
    });
  }

  // OTP is one-time.
  issued.delete(otp);

  return res.json({
    ok: true,
    verified: true,
  });
});

// ----------------------------------------
// Optional compatibility endpoint.
//
// This allows clients that call
// /api/otp/verify to work too.
// ----------------------------------------

app.post("/api/otp/verify", auth, (req, res) => {
  const requestCode = clean(
    req.body?.requestCode || req.body?.otp,
    256
  ).toUpperCase();

  const discordUserId = clean(
    req.body?.discordUserId,
    40
  );

  if (!requestCode) {
    return res.status(400).json({
      ok: false,
      error: "requestCode is required",
    });
  }

  if (!discordUserId) {
    return res.status(400).json({
      ok: false,
      error: "discordUserId is required",
    });
  }

  const record = pending.get(requestCode);

  if (!record) {
    return res.status(400).json({
      ok: false,
      error: "Request code is invalid or expired",
    });
  }

  if (record.expiresAtMs < Date.now()) {
    pending.delete(requestCode);

    return res.status(400).json({
      ok: false,
      error: "Request code is expired",
    });
  }

  pending.delete(requestCode);

  const otp = String(
    crypto.randomInt(0, 1_000_000)
  ).padStart(6, "0");

  const expiresAtMs = Date.now() + OTP_TTL_MS;

  issued.set(otp, {
    requestCode,
    headset: record.headset,
    discordUserId,
    expiresAtMs,
  });

  return res.json({
    ok: true,
    otp,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
});

// ----------------------------------------
// Cleanup expired requests/OTPs
// ----------------------------------------

setInterval(() => {
  const now = Date.now();

  for (const [requestCode, record] of pending) {
    if (record.expiresAtMs < now) {
      pending.delete(requestCode);
    }
  }

  for (const [otp, record] of issued) {
    if (record.expiresAtMs < now) {
      issued.delete(otp);
    }
  }
}, 60_000).unref();

// ----------------------------------------
// Start server
// ----------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `TvBot OTP API listening on port ${PORT}`
  );
});

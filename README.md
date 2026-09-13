# TvBot OTP Server + Discord Bot

This runs the HTTPS OTP API and Discord verification bot in one Render service.

## Render environment variables
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `OTP_API_URL=https://tvbot-pvr5.onrender.com`
- `OTP_API_SECRET` — same secret used by the API and bot
- `ALLOWED_ROLE_IDS=1538971045325963396,1545213919625478184`
- `PORT` — Render supplies this automatically; do not hard-code it in production.

## API
- `POST /api/otp/request` with `{ "headset": "..." }` -> returns `requestCode`.
- Discord `/verify code:<requestCode> headset:<headset>` calls `/api/otp/issue`.
- `POST /api/otp/check` with `{ "otp": "...", "headset": "..." }` consumes the OTP once.

The server stores only short-lived request/OTP records in memory. A restart clears them.

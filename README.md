# TvPatcher Verification Bot

Companion Discord bot + HTTPS API for the TvPatcher OTP screen.

## Important security behavior

- The Discord bot token is read only from `DISCORD_TOKEN` and is never embedded in the APK.
- TvPatcher opens Meta's official login page in the device's external browser. The app does not request, read, proxy, or store a Meta password or OAuth token.
- `/verify` verifies the Discord-side challenge and headset claim. It does **not** prove physical headset ownership by itself; add a trusted headset verification provider if you need that stronger check.

## Environment variables

Set these as deployment secrets/environment variables:

- `DISCORD_TOKEN` — Discord bot token
- `DISCORD_CLIENT_ID` — Discord application ID
- `DISCORD_GUILD_ID` — optional guild ID for fast command registration during testing
- `PORT` — usually supplied by the host

## Flow

1. TvPatcher POSTs `/api/request` with a random challenge.
2. User runs `/verify challenge:<challenge> headset:<headset>` in Discord.
3. The bot creates a six-digit OTP.
4. TvPatcher polls `/api/status` and displays the OTP when verified.
5. The OTP unlocks the PATCHING tab in the APK.

## Deploying

Deploy this directory as a Node/Docker web service. Copy the service's HTTPS URL into `API_BASE_URL` in the Android app before building.

For GitHub Actions, store `DISCORD_TOKEN` in repository **Settings → Secrets and variables → Actions**. Never commit the token to source control.

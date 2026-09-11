import crypto from 'node:crypto';
import express from 'express';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const PORT = Number(process.env.PORT || 3000);
const OTP_TTL_MS = 10 * 60 * 1000;

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID');
  process.exit(1);
}

const pending = new Map();

function newOtp() { return String(crypto.randomInt(100000, 1000000)); }
function newId() { return crypto.randomBytes(18).toString('hex'); }
function cleanup() {
  const now = Date.now();
  for (const [key, value] of pending) if (value.expiresAt < now) pending.delete(key);
}
setInterval(cleanup, 30_000).unref();

const app = express();
app.use(express.json({ limit: '16kb' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'TvPatcher verification API' }));

app.post('/api/request', (req, res) => {
  const challenge = String(req.body?.challenge || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(challenge)) return res.status(400).json({ error: 'invalid challenge' });
  pending.set(challenge, { challenge, createdAt: Date.now(), expiresAt: Date.now() + OTP_TTL_MS, verified: false });
  res.json({ challenge, status: 'waiting', expiresIn: OTP_TTL_MS / 1000 });
});

app.get('/api/status', (req, res) => {
  const challenge = String(req.query.challenge || '').trim().toUpperCase();
  const item = pending.get(challenge);
  if (!item || item.expiresAt < Date.now()) return res.json({ verified: false, expired: true });
  res.json({ verified: item.verified, otp: item.verified ? item.otp : undefined });
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify a TvPatcher purchase/headset challenge and issue a one-time OTP.')
  .addStringOption(o => o.setName('challenge').setDescription('Challenge shown by TvPatcher').setRequired(true))
  .addStringOption(o => o.setName('headset').setDescription('Headset/model identifier you are verifying').setRequired(true));

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [verifyCommand.toJSON()] });
    else await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [verifyCommand.toJSON()] });
    console.log('Slash command registered.');
  } catch (err) { console.error('Slash registration failed:', err); }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'verify') return;
  const challenge = interaction.options.getString('challenge', true).trim().toUpperCase();
  const headset = interaction.options.getString('headset', true).trim().slice(0, 80);
  const item = pending.get(challenge);
  if (!item || item.expiresAt < Date.now()) {
    await interaction.reply({ content: 'That challenge is missing or expired. Request a new OTP in TvPatcher.', ephemeral: true });
    return;
  }
  // This confirms the Discord-side verification claim. It does not collect Meta credentials.
  item.verified = true;
  item.otp = newOtp();
  item.discordUserId = interaction.user.id;
  item.headset = headset;
  item.verifiedAt = Date.now();
  await interaction.reply({ content: `Verified challenge **${challenge}** for headset **${headset}**. The OTP is now available in TvPatcher.`, ephemeral: true });
});

client.on('error', console.error);
app.listen(PORT, () => console.log(`Verification API listening on :${PORT}`));
client.login(TOKEN);

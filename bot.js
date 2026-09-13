import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const apiUrl = (process.env.OTP_API_URL || '').replace(/\/$/, '');
const apiSecret = process.env.OTP_API_SECRET;
const allowedRoles = new Set((process.env.ALLOWED_ROLE_IDS || '1538971045325963396,1545213919625478184').split(',').map(x => x.trim()).filter(Boolean));

if (!token || !clientId || !guildId || !apiUrl || !apiSecret) throw new Error('Missing required environment variables.');

const commands = [new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify a TvPatcher request and issue a one-time OTP.')
  .addStringOption(o => o.setName('code').setDescription('The request code shown by TvPatcher').setRequired(true))
  .addStringOption(o => o.setName('headset').setDescription('The headset identifier shown by TvPatcher').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);
await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'verify') return;
  const roles = interaction.member?.roles?.cache;
  const permitted = roles?.some(role => allowedRoles.has(role.id));
  if (!permitted) return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  try {
    const response = await fetch(`${apiUrl}/api/otp/issue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiSecret}` },
      body: JSON.stringify({
        requestCode: interaction.options.getString('code'),
        headset: interaction.options.getString('headset'),
        discordUserId: interaction.user.id
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Backend returned ${response.status}`);
    await interaction.editReply(`Verified. OTP: **${data.otp}**\nExpires: ${data.expiresAt || 'soon'}`);
  } catch (err) {
    console.error(err);
    await interaction.editReply(`Verification failed: ${err.message}`);
  }
});

client.login(token);

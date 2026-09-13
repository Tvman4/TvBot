// bot.js
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;
const apiUrl = process.env.API_URL;
const apiSecret = process.env.API_SECRET;

if (!token || !clientId || !guildId || !apiUrl || !apiSecret) {
  console.error("Missing required environment variables:");

  console.error({
    DISCORD_TOKEN: Boolean(token),
    CLIENT_ID: Boolean(clientId),
    GUILD_ID: Boolean(guildId),
    API_URL: Boolean(apiUrl),
    API_SECRET: Boolean(apiSecret),
  });

  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Slash commands
const commands = [
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verify a TvPatcher OTP")
    .addStringOption((option) =>
      option
        .setName("otp")
        .setDescription("The OTP shown in TvPatcher")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check whether the TvBot API is online"),
].map((command) => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(token);

  console.log("Registering Discord slash commands...");

  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    {
      body: commands,
    }
  );

  console.log("Slash commands registered.");
}

async function apiRequest(path, options = {}) {
  const url = `${apiUrl.replace(/\/$/, "")}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiSecret}`,
      "X-API-Secret": apiSecret,
      ...(options.headers || {}),
    },
  });

  let data;

  try {
    data = await response.json();
  } catch {
    data = {
      success: response.ok,
      message: await response.text(),
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

client.once("ready", async () => {
  console.log(`TvBot logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }

  console.log(`API URL: ${apiUrl}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // /status
  if (interaction.commandName === "status") {
    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await apiRequest("/");

      if (result.ok) {
        await interaction.editReply(
          `🟢 TvBot API is online.\nHTTP status: ${result.status}`
        );
      } else {
        await interaction.editReply(
          `🟠 TvBot API responded with HTTP ${result.status}.`
        );
      }
    } catch (error) {
      console.error("Status request failed:", error);

      await interaction.editReply(
        "🔴 Could not connect to the TvBot API."
      );
    }

    return;
  }

  // /verify
  if (interaction.commandName === "verify") {
    const otp = interaction.options.getString("otp", true).trim();

    await interaction.deferReply({ ephemeral: true });

    if (!/^[0-9]{4,12}$/.test(otp)) {
      await interaction.editReply(
        "❌ Invalid OTP format."
      );
      return;
    }

    try {
      const result = await apiRequest("/api/otp/verify", {
        method: "POST",
        body: JSON.stringify({
          otp,
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
          guildId: interaction.guildId,
        }),
      });

      console.log(
        `OTP verification for ${interaction.user.tag}: HTTP ${result.status}`
      );

      if (result.ok && result.data?.success !== false) {
        await interaction.editReply(
          "✅ OTP verified successfully. TvPatcher access has been verified."
        );
      } else {
        const message =
          result.data?.message ||
          result.data?.error ||
          "The OTP could not be verified.";

        await interaction.editReply(`❌ ${message}`);
      }
    } catch (error) {
      console.error("OTP verification failed:", error);

      await interaction.editReply(
        "❌ Could not connect to the TvBot API."
      );
    }
  }
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

client.login(token);

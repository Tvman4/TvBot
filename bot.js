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

// ----------------------------------------
// Slash commands
// ----------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verify a TvPatcher request code")
    .addStringOption((option) =>
      option
        .setName("otp")
        .setDescription("Paste the full request code from TvPatcher")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check whether the TvBot API is online"),
].map((command) => command.toJSON());

// ----------------------------------------
// Register Discord commands
// ----------------------------------------

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

// ----------------------------------------
// API request helper
// ----------------------------------------

async function apiRequest(path, options = {}) {
  const url = `${apiUrl.replace(/\/$/, "")}${path}`;

  console.log(`API request: ${options.method || "GET"} ${url}`);

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

  console.log(`API response: HTTP ${response.status}`);

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

// ----------------------------------------
// Bot ready
// ----------------------------------------

client.once("ready", async () => {
  console.log(`TvBot logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }

  console.log(`API URL: ${apiUrl}`);
});

// ----------------------------------------
// Commands
// ----------------------------------------

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ======================================
  // /status
  // ======================================

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

  // ======================================
  // /verify
  // ======================================

  if (interaction.commandName === "verify") {
    const requestCode = interaction.options
      .getString("otp", true)
      .trim();

    await interaction.deferReply({ ephemeral: true });

    // TvPatcher generates a long hexadecimal
    // request code.
    if (
      requestCode.length < 8 ||
      requestCode.length > 256 ||
      !/^[A-Fa-f0-9]+$/.test(requestCode)
    ) {
      await interaction.editReply(
        "❌ Invalid request code format.\n\nPaste the entire long request code from TvPatcher."
      );
      return;
    }

    try {
      const result = await apiRequest("/api/otp/issue", {
        method: "POST",
        body: JSON.stringify({
          requestCode,
          discordUserId: interaction.user.id,
          discordUsername: interaction.user.username,
        }),
      });

      console.log(
        `Verification for ${interaction.user.tag}: HTTP ${result.status}`
      );

      // ------------------------------------
      // Successful request
      // ------------------------------------

      if (result.ok && result.data?.otp) {
        const otp = String(result.data.otp);

        await interaction.editReply(
          `✅ Request approved!\n\n` +
          `🔐 **Your OTP code is:** \`${otp}\`\n\n` +
          `Enter this 6-digit code in TvPatcher.\n\n` +
          `⏱️ The code expires in 5 minutes.`
        );

        return;
      }

      // ------------------------------------
      // API returned an error
      // ------------------------------------

      const message =
        result.data?.message ||
        result.data?.error ||
        "The request code could not be verified.";

      await interaction.editReply(`❌ ${message}`);
    } catch (error) {
      console.error("OTP verification failed:", error);

      await interaction.editReply(
        "❌ Could not connect to the TvBot API."
      );
    }
  }
});

// ----------------------------------------
// Discord errors
// ----------------------------------------

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

// ----------------------------------------
// Login
// ----------------------------------------

client.login(token);

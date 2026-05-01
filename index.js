// ============================================================
//  RBX-BOT — Integrado (Bot 1: Roblox Updates + Bot 2: Redux)
// ============================================================
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  Collection,
  PermissionsBitField,
  AttachmentBuilder,
  ChannelType,
} = require("discord.js");

const fs        = require("fs");
const fsPromise = require("fs").promises;
const path      = require("path");
const express   = require("express");
const nodeFetch = require("node-fetch").default;
const cheerio   = require("cheerio");

// ===================== ENV / CONFIG =====================
const TOKEN      = process.env.TOKEN_BOT;
const CLIENT_ID  = process.env.Application_ID;
const GUILD_ID   = process.env.GUILD_ID;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.FREETHEAI_API_KEY;
const AI_PROVIDER = process.env.GEMINI_API_KEY ? "gemini" : (process.env.FREETHEAI_API_KEY ? "freetheai" : null);

if (!TOKEN)     { console.error("❌ TOKEN_BOT não encontrado no .env"); process.exit(1); }
if (!CLIENT_ID) { console.error("❌ Application_ID não encontrado no .env"); process.exit(1); }
if (!GUILD_ID)  { console.error("❌ GUILD_ID não encontrado no .env"); process.exit(1); }
if (!AI_PROVIDER) { console.warn("⚠️  API key não encontrada no .env — IA no PV desativada."); }

// Histórico de conversa por usuário no PV (mantido em memória)
const dmConversations = new Map(); // userId -> [{ role, content }]
const DM_MAX_HISTORY  = 20;

const collectorMap = new Map();
const pollMap = new Map();

// ===================== CONSTANTES =====================
// — Roblox Update Checker
const CONFIG_FILE      = "./config.json";
const CHECK_INTERVAL   = 60 * 1000; // 1 minuto
const ROBLOX_LOGO      =
  "https://cdn.discordapp.com/attachments/1213128047361007648/1471894577521754226/ChatGPT_Image_13_de_fev._de_2026_11_53_49.png?ex=69909825&is=698f46a5&hm=17868cc54d0d4c4154a9b68add4b2e81014b0563ace388fb43d92ec1c27fa6a5";

// — Redux Studio
const APLICATION_CHANNEL_ID = "1447198166762917978";
const STAFF_FORM_LINK        = "https://forms.gle/TMSgaHFym3StdHQv8";
const DEV_FORM_LINK          = "https://forms.gle/TMSgaHFym3StdHQv8";
const EXECUTORS_ROLE_ID      = "1441797234105647195";
const STATUS_FILE            = "./status_all.json";
const XP_FILE                = "./xp_data.json";
const LEVEL_UP_CHANNEL_ID    = "1441398739322409071";
const LOGO_URL               =
  "https://cdn.discordapp.com/attachments/1441185117279223858/1460852638680744163/Redux_Studios.png";
const STATUS_MESSAGE_ID_FILE = "./status_message_id.txt";
const REDUX_CHANNEL_ID       = process.env.RBX_STATUS_EXECUTOR || "1497005005922635836"; // canal status executores
const ROBLOX_UPDATE_CHANNEL  = process.env.RBX_STATUS_ROBLOX   || "1470096336303947878"; // canal updates Roblox

// ===================== ROBLOX CONFIG (persistente) =====================
let rbxConfig = fs.existsSync(CONFIG_FILE)
  ? JSON.parse(fs.readFileSync(CONFIG_FILE))
  : {};

function saveRbxConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(rbxConfig, null, 2));
}

function getGuildConfig(guildId) {
  if (!rbxConfig[guildId]) {
    rbxConfig[guildId] = {
      updateChannel:      ROBLOX_UPDATE_CHANNEL,
      platformsDisabled:  [],
      roles:              [],
      futureUpdate:       false,
      lastVersions:       {},
      lastFutureVersions: {},
    };
    saveRbxConfig();
  }
  return rbxConfig[guildId];
}

// ===================== CLIENT =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageTyping,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.commands = new Collection();

// ===================== XP HELPERS =====================
async function loadXP() {
  try { return JSON.parse(await fsPromise.readFile(XP_FILE, "utf-8")); }
  catch { return {}; }
}
async function saveXP(data) {
  await fsPromise.writeFile(XP_FILE, JSON.stringify(data, null, 4), "utf-8");
}
function xpNeeded(level) { return level <= 1 ? 20 : 20 + (level - 1) * 5; }

// ===================== STATUS HELPERS =====================
async function loadStatus() {
  try { return JSON.parse(await fsPromise.readFile(STATUS_FILE, "utf-8")); }
  catch { return {}; }
}

// ===================== ROBLOX FETCH HELPERS =====================
function getDownloadLink(platform, version) {
  if (platform === "Windows")
    return `https://rdd.latte.to/?channel=${version}&binaryType=WindowsPlayer&version=${version}`;
  if (platform === "Mac")
    return `https://rdd.latte.to/?channel=${version}&binaryType=MacPlayer&version=${version}`;
  if (platform === "Android")
    return "https://play.google.com/store/apps/details?id=com.roblox.client";
  if (platform === "iOS")
    return "https://apps.apple.com/app/roblox/id431946152";
  return null;
}

async function fetchDesktopVersions(future = false) {
  const url = future
    ? "https://weao.xyz/api/versions/future"
    : "https://weao.xyz/api/versions/current";
  try {
    const res = await nodeFetch(url, { headers: { "User-Agent": "WEAO-3PService" } });
    if (!res.ok) { console.error(`WEAO API error: ${res.status}`); return null; }
    return await res.json();
  } catch (err) { console.error(`WEAO fetch error: ${err.message}`); return null; }
}

async function fetchIOSVersion() {
  try {
    const res = await nodeFetch(
      "https://itunes.apple.com/lookup?id=431946152&country=US",
      { headers: { "Cache-Control": "no-cache" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.results?.[0]?.version ?? null;
  } catch (err) { console.error("iOS fetch error:", err.message); return null; }
}

async function fetchAndroidVersion() {
  try {
    const res = await nodeFetch(
      "https://play.google.com/store/apps/details?id=com.roblox.client&hl=en_US&gl=US",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    if (!res.ok) return null;
    const $ = cheerio.load(await res.text());
    let version = null;
    $("script").each((_, el) => {
      const t = $(el).html();
      if (t?.includes("AF_initDataCallback")) {
        const m = t.match(/\[\[\["(\d+\.\d+\.\d+)"\]/);
        if (m?.[1]) { version = m[1]; return false; }
      }
    });
    return version;
  } catch (err) { console.error("Android fetch error:", err.message); return null; }
}

// ===================== DADOS ESTÁTICOS (Redux) =====================
const EXECUTORS_LINKS = {
  "Ronix":          { link: "https://ronixstudios.io/",                              tipo: "free"  },
  "Xeno":           { link: "https://getxeno.site/",                                 tipo: "free"  },
  "Solara":         { link: "https://api.getsolara.gg/",                             tipo: "free"  },
  "Bunni":          { link: "https://discord.com/invite/9DPW2G22cF",                 tipo: "free"  },
  "Velocity":       { link: "https://getvelocity.lol/",                              tipo: "free"  },
  "Swift":          { link: "https://getswift.vip/",                                 tipo: "free"  },
  "Nihon":          { link: "Manutenção",                                             tipo: "free"  },
  "Volcano":        { link: "https://volcano.wtf/",                                  tipo: "paid"  },
  "Redux":          { link: "Manutenção",                                             tipo: "paid"  },
  "Valex":          { link: "https://valex.io/",                                     tipo: "paid"  },
  "Wave":           { link: "https://getwave.gg/",                                   tipo: "paid"  },
  "Seliware":       { link: "https://seliware.com/",                                 tipo: "paid"  },
  "Potassiun":      { link: "https://www.potassium.pro/",                            tipo: "paid"  },
  "SirHurt":        { link: "https://sirhurt.net/",                                  tipo: "paid"  },
  "RonixPremium":   { link: "https://ronixstudios.io/",                              tipo: "paid"  },
  "Volt":           { link: "https://volt.bz/",                                      tipo: "paid"  },
  "ValexExternal":  { link: "https://valex.io/",                                     tipo: "free"  },
  "DriftEXT":       { link: "https://wearedevs.net/d/Drift",                         tipo: "free"  },
  "Matcha":         { link: "https://buymatcha.xyz/",                                tipo: "paid"  },
  "Ronin":          { link: "https://getronin.xyz/",                                 tipo: "paid"  },
  "Serotonin":      { link: "https://discord.com/invite/serotonin",                  tipo: "paid"  },
  "Matrix":         { link: "https://matrixhubs.shop/",                              tipo: "paid"  },
  "DX9WARE":        { link: "https://cultofintellect.com/",                          tipo: "paid"  },
  "Hydrogen":       { link: "https://www.hydrogen.lat/",                             tipo: "free"  },
  "Macsploit":      { link: "https://www.raptor.fun/",                               tipo: "free"  },
  "1°Delta":        { link: "https://deltaexploits.gg/",                             tipo: "free"  },
  "2°Cryptic":      { link: "https://reapstore.mysellauth.com/product/cryptic-mobile-premium", tipo: "free" },
  "3°Codex":        { link: "Manutenção",                                             tipo: "free"  },
  "4°ArceusX":      { link: "Manutenção",                                             tipo: "free"  },
  "5°Ronix":        { link: "https://ronixstudios.io",                               tipo: "free"  },
  "3°Ronix":        { link: "https://ronixstudios.io",                               tipo: "free"  },
  "1°RonixPremiun": { link: "https://ronixstudios.io",                               tipo: "paid"  },
};

const PLATAFORMAS = {
  Windows: ["Windows Free", "Windows Paid", "Windows External Free", "Windows External Paid"],
  MacOS:   ["MacOS"],
  Android: ["Android"],
  iOS:     ["iOS Free", "iOS Paid"],
};

const EXECUTORS_BY_CATEGORY = {
  "Windows Free":          ["Ronix","Xeno","Solara","Volcano","Bunni","Velocity","Swift","Nihon"],
  "Windows Paid":          ["Redux","Valex","Wave","Seliware","Potassiun","SirHurt","RonixPremium","Volt"],
  "Windows External Free": ["ValexExternal","DriftEXT"],
  "Windows External Paid": ["Matcha","Ronin","Serotonin","Matrix","DX9WARE"],
  "MacOS":                 ["Hydrogen","Bunni","Macsploit","Ronix"],
  "Android":               ["1°Delta","2°Cryptic","3°Codex","4°ArceusX","5°Ronix"],
  "iOS Free":              ["1°Delta","2°Cryptic","3°Ronix"],
  "iOS Paid":              ["1°RonixPremiun"],
};

// ===================== SLASH COMMANDS =====================
const commandDefs = [
  // ── Roblox ──
  new SlashCommandBuilder()
    .setName("manage-notification")
    .setDescription("Gerenciar notificações do Roblox"),

  new SlashCommandBuilder()
    .setName("current-version")
    .setDescription("Ver versões atuais do Roblox"),

  new SlashCommandBuilder()
    .setName("update-roblox")
    .setDescription("Enviar update manual do Roblox")
    .addStringOption(o =>
      o.setName("platform").setRequired(true).setDescription("Plataforma")
       .addChoices(
         { name: "Windows", value: "Windows" },
         { name: "MacOS",   value: "Mac"     },
         { name: "Android", value: "Android" },
         { name: "iOS",     value: "iOS"     }
       )
    )
    .addStringOption(o =>
      o.setName("type").setRequired(false).setDescription("Tipo de update")
       .addChoices(
         { name: "Original Update", value: "current" },
         { name: "Future Build",    value: "future"  }
       )
    )
    .addStringOption(o =>
      o.setName("version").setRequired(false).setDescription("Versão específica (opcional)")
    ),

  // ── Redux ──
  new SlashCommandBuilder().setName("reset").setDescription("Reseta mensagem com executores"),

  new SlashCommandBuilder().setName("dashboard").setDescription("Abre o mini painel de executores"),

  new SlashCommandBuilder().setName("addxp").setDescription("Adiciona XP a um usuário")
    .addUserOption(o => o.setName("user").setDescription("O usuário").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Quantidade de XP").setRequired(true)),

  new SlashCommandBuilder().setName("setlevel").setDescription("Define o nível de um usuário")
    .addUserOption(o => o.setName("user").setDescription("O usuário").setRequired(true))
    .addIntegerOption(o => o.setName("level").setDescription("Novo nível").setRequired(true)),

  new SlashCommandBuilder().setName("removexp").setDescription("Remove XP de um usuário")
    .addUserOption(o => o.setName("user").setDescription("O usuário").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Quantidade de XP").setRequired(true)),

  new SlashCommandBuilder().setName("sync").setDescription("Sincroniza comandos (Admin)"),

  new SlashCommandBuilder().setName("execdownload").setDescription("Baixa o executor escolhido")
    .addStringOption(o => o.setName("nome").setDescription("Nome do executor").setRequired(true)),

  new SlashCommandBuilder().setName("info").setDescription("Mostra informações sobre o servidor REDUX"),

  new SlashCommandBuilder().setName("status").setDescription("Mostra o status dos executores REDUX"),

  new SlashCommandBuilder().setName("status-redux").setDescription("Mostra o status dos sistemas REDUX"),

  new SlashCommandBuilder().setName("rules").setDescription("Mostra as regras do servidor REDUX"),

  new SlashCommandBuilder().setName("cleaner").setDescription("Apaga mensagens do canal atual")
    .addIntegerOption(o => o.setName("quantidade").setDescription("Quantidade de mensagens").setRequired(false)),

  new SlashCommandBuilder().setName("reduxstatesexecutor").setDescription("Regera mensagem de status dos executores"),

  new SlashCommandBuilder()
    .setName("logapp")
    .setDescription("Publica logs de Utility ou Annunciaments")
    .addStringOption(o =>
      o.setName("tipo").setDescription("Escolha Utility ou Annunciaments").setRequired(true)
       .addChoices({ name: "Utility", value: "utility" }, { name: "Annunciaments", value: "annunciaments" })
    )
    .addStringOption(o => o.setName("titulo").setDescription("Título principal do log").setRequired(true))
    .addStringOption(o => o.setName("log").setDescription("Texto do log (use | para linhas)").setRequired(true))
    .addStringOption(o => o.setName("utility").setDescription("Nome do Utility").setRequired(false))
    .addStringOption(o => o.setName("emojisituation").setDescription("Emoji para o situation").setRequired(false))
    .addStringOption(o => o.setName("situation").setDescription("Texto do situation").setRequired(false))
    .addStringOption(o => o.setName("subtitle").setDescription("Subtítulo").setRequired(false))
    .addChannelOption(o => o.setName("channelmention").setDescription("Canal para mencionar").setRequired(false))
    .addStringOption(o => o.setName("downloadmessage").setDescription("Texto do link de download").setRequired(false))
    .addStringOption(o => o.setName("downloadlink").setDescription("URL do download").setRequired(false))
    .addAttachmentOption(o => o.setName("image").setDescription("Imagem opcional").setRequired(false)),

  new SlashCommandBuilder()
    .setName("update")
    .setDescription("Publica um log de update de executor")
    .addStringOption(o => o.setName("name").setDescription("Nome do utilitário").setRequired(true))
    .addStringOption(o => o.setName("version").setDescription("Nova versão").setRequired(true))
    .addStringOption(o => o.setName("subtitle").setDescription("Subtítulo").setRequired(true))
    .addStringOption(o => o.setName("log").setDescription("Log de update (| = quebra 1 linha, |-| = quebra 2 linhas)").setRequired(true))
    .addStringOption(o => o.setName("downloadtext").setDescription("Texto do botão de download").setRequired(true))
    .addStringOption(o => o.setName("downloadlink").setDescription("Link de download").setRequired(true))
    .addStringOption(o => o.setName("downloadversionrbxtext").setDescription("Texto do download da versão RBX").setRequired(true))
    .addStringOption(o => o.setName("downloadversionrbxlink").setDescription("Link do download da versão RBX").setRequired(true))
    .addChannelOption(o => o.setName("fixer").setDescription("Canal do fixer").setRequired(true))
    .addStringOption(o => o.setName("notes").setDescription("Notas adicionais (opcional)").setRequired(false)),

new SlashCommandBuilder()
    .setName("annunciament")
    .setDescription("Envia um anuncio")
    .addStringOption(o => o.setName("annunciamentlog").setDescription("Texto do anuncio (| = 1 linha, |-| = 2 linhas)").setRequired(false))
    .addAttachmentOption(o => o.setName("image").setDescription("Imagem (jpg, png, gif)").setRequired(false))
    .addAttachmentOption(o => o.setName("video").setDescription("Video (mp4, mov)").setRequired(false))
    .addAttachmentOption(o => o.setName("file").setDescription("Arquivo (zip, pdf, etc)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("creategiveaway")
    .setDescription("Cria um giveaway")
    .addStringOption(o => o.setName("prize").setDescription("Premio oferecido (ex: 1 mes Premium)").setRequired(true))
    .addStringOption(o => o.setName("description").setDescription("Descricao adicional").setRequired(false))
    .addIntegerOption(o => o.setName("winners").setDescription("Numero de vencedores").setRequired(false))
    .addIntegerOption(o => o.setName("duration").setDescription("Duracao em minutos").setRequired(false))
    .addAttachmentOption(o => o.setName("image").setDescription("Imagem do premio").setRequired(false))
    .addAttachmentOption(o => o.setName("file").setDescription("Arquivo do premio").setRequired(false)),

  new SlashCommandBuilder()
    .setName("serverstats")
    .setDescription("Mostra estatisticas do servidor"),

  new SlashCommandBuilder()
    .setName("pin")
    .setDescription("Pin uma mensagem no canal")
    .addStringOption(o => o.setName("mensagem").setDescription("Mensagem para fixar").setRequired(false))
    .addAttachmentOption(o => o.setName("imagem").setDescription("Imagem para fixar").setRequired(false)),

  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Cria auto-role por reaction")
    .addStringOption(o => o.setName("cargo").setDescription("Nome do cargo").setRequired(true))
    .addStringOption(o => o.setName("emoji").setDescription("Emoji para reagir").setRequired(true))
    .addStringOption(o => o.setName("mensagem").setDescription("Mensagem explicativa").setRequired(false)),

  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Cria uma enquete")
    .addStringOption(o => o.setName("pergunta").setDescription("Pergunta da enquete").setRequired(true))
    .addStringOption(o => o.setName("opcoes").setDescription("Opcoes separadas por virgula").setRequired(true))
    .addIntegerOption(o => o.setName("tempo").setDescription("Tempo em minutos").setRequired(false)),

  new SlashCommandBuilder()
    .setName("test")
    .setDescription("Testa o /update e /annunciament com dados de exemplo"),

  new SlashCommandBuilder().setName("help").setDescription("Mostra os comandos do bot"),

  new SlashCommandBuilder().setName("xp").setDescription("Mostra seu XP e Level"),

  new SlashCommandBuilder().setName("xp_add").setDescription("Adiciona levels a um usuário")
    .addUserOption(o => o.setName("user").setDescription("Usuário").setRequired(true))
    .addIntegerOption(o => o.setName("value").setDescription("Quantidade de levels").setRequired(true)),

  new SlashCommandBuilder().setName("xp_set").setDescription("Define o level exato de um usuário")
    .addUserOption(o => o.setName("user").setDescription("Usuário").setRequired(true))
    .addIntegerOption(o => o.setName("value").setDescription("Level exato").setRequired(true)),

  new SlashCommandBuilder().setName("xp_remove").setDescription("Remove levels de um usuário")
    .addUserOption(o => o.setName("user").setDescription("Usuário").setRequired(true))
    .addIntegerOption(o => o.setName("value").setDescription("Quantidade de levels").setRequired(true)),
].map(c => c.toJSON());

// Registrar comandos (limpa os antigos e registra os novos)
const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  try {
    // 1) Limpa todos os comandos globais antigos
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log("🧹 Comandos globais antigos removidos.");
    // 2) Registra os comandos novos no servidor
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commandDefs });
    console.log("✅ Comandos registrados com sucesso.");
  } catch (err) {
    console.error("❌ Erro ao registrar comandos:", err);
  }
})();

// ===================== READY =====================
const LOG_CHANNEL_ID = "1490914288297050213";
const LOG_ROLE_ID = "1109671454116687872";

client.once("ready", async () => {
  console.log(`🤖 Online como ${client.user.tag}`);

  // Enviar mensagem de online
  const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (logChannel) {
    const embed = new EmbedBuilder()
      .setTitle("🤖 RBX-BOT Online")
      .setDescription("O bot esta 🟢 Online e funcionando!")
      .setColor(0x00FF00)
      .setTimestamp();
    await logChannel.send({ content: `<@&${LOG_ROLE_ID}>`, embeds: [embed], allowedMentions: { roles: [LOG_ROLE_ID] } });
  }

  // Carregar mensagem de status Redux existente
  const statusChannel = await client.channels.fetch(REDUX_CHANNEL_ID).catch(() => null);
  if (statusChannel) {
    try {
      const msgId = await fsPromise.readFile(STATUS_MESSAGE_ID_FILE, "utf-8").then(id => id.trim()).catch(() => null);
      if (msgId) {
        const msg = await statusChannel.messages.fetch(msgId).catch(() => null);
        if (msg) client.statusMessage = msg;
      }
    } catch {}
  }

  startRobloxUpdateChecker();
  await startReduxStatusWatcher();
});

// ===================== XP POR MENSAGEM + IA NO PV =====================
client.on("messageCreate", async (message) => {
  console.log(`[MSG RAW] guild=${message.guildId ?? "DM"} | autor=${message.author?.tag} | bot=${message.author?.bot} | partial=${message.partial}`);

  if (message.partial) {
    try { await message.fetch(); } catch { return; }
  }

  if (message.author.bot) return;

  // ── IA no PV ──
  if (!message.guild) {
    console.log(`[DM] Mensagem recebida de ${message.author.tag}: ${message.content}`);
if (!AI_PROVIDER) {
        console.warn("[DM] API key não definida — ignorando.");
        return;
      }

      const userId    = message.author.id;
      const userInput = message.content.trim();
      if (!userInput) return;

      await message.channel.sendTyping();

      if (!dmConversations.has(userId)) dmConversations.set(userId, []);
      const history = dmConversations.get(userId);

      // Limpar history para formato correto
      const cleanHistory = history.length === 0 
        ? [] 
        : history.filter(m => m.role && m.parts && m.parts[0] && m.parts[0].text);

      cleanHistory.push({ role: "user", parts: [{ text: userInput }] });
      while (cleanHistory.length > DM_MAX_HISTORY) cleanHistory.shift();

      const systemPrompt = `Você é o assistente oficial do RBX-BOT, um bot do Discord focado em executores do Roblox e novidades da plataforma Roblox.
Responda sempre em português do Brasil, de forma amigável, direta e útil.
Você conhece sobre executores como Xeno, Solara, Wave, Ronix, Delta (mobile), e sobre updates do Roblox para Windows, Mac, Android e iOS.
Se o usuário perguntar algo fora do contexto de Roblox, responda normalmente como um assistente geral.
Nunca diga que é uma IA — diga apenas que é o assistente do RBX-BOT.`;

      try {
        let res, data, reply;

        if (AI_PROVIDER === "gemini") {
          // Usar Gemini
          res = await nodeFetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: cleanHistory,
              }),
            }
          );
          data = await res.json();
          reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        } else {
          // Usar FreeTheAi
          const FREETHEAI_API_KEY = process.env.FREETHEAI_API_KEY;
          res = await nodeFetch(
            "https://api.freetheai.xyz/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${FREETHEAI_API_KEY}`,
              },
              body: JSON.stringify({
                model: "google/gemini-2.0-flash",
                messages: [
                  { role: "system", content: systemPrompt },
                  ...cleanHistory.map(m => ({ role: m.role, content: m.parts[0].text }))
                ],
              }),
            }
          );
          data = await res.json();
          reply = data.choices?.[0]?.message?.content;
        }

        if (!res.ok) {
          const err = await res.text();
          console.error("[IA DM ERROR]", err);
          return message.reply("❌ Erro ao processar sua mensagem. Tente novamente mais tarde.");
        }

        if (!reply) {
          return message.reply("❌ Não consegui gerar uma resposta.");
        }

        // Salva resposta no histórico
        history.push({ role: "model", parts: [{ text: reply }] });
        while (history.length > DM_MAX_HISTORY) history.shift();

        if (reply.length <= 2000) {
          await message.reply(reply);
        } else {
          const chunks = reply.match(/.{1,2000}/gs) || [];
          for (const chunk of chunks) await message.channel.send(chunk);
        }
      } catch (err) {
        console.error("[IA DM FETCH ERROR]", err);
        await message.reply("❌ Ocorreu um erro interno. Tente novamente.");
      }
      return;
    }

  // ── XP em servidor ──
  const data = await loadXP();
  const uid  = message.author.id;
  if (!data[uid]) data[uid] = { xp: 0, level: 0 };
  data[uid].xp += 1;
  const { xp, level } = data[uid];
  if (xp >= xpNeeded(level)) {
    data[uid].level += 1;
    data[uid].xp = 0;
    const ch = message.guild.channels.cache.get(LEVEL_UP_CHANNEL_ID);
    if (ch) await ch.send(`🎉 ${message.author} subiu para o **Level ${data[uid].level}**!`);
  }
  await saveXP(data);
});

// ===================== INTERACTION HANDLER =====================
client.on("interactionCreate", async (interaction) => {

  // ── CHAT COMMANDS ──
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    // Ignorar interações fora de servidores (DMs causam crash aqui)
    if (!interaction.guild) {
      return interaction.reply({ content: "❌ Este comando só funciona em servidores.", ephemeral: true });
    }

    const guildCfg = getGuildConfig(interaction.guild.id);

    // ─── manage-notification ───
    if (commandName === "manage-notification") {
      const MANAGE_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(MANAGE_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });

      const cfg = guildCfg;
      const embed = new EmbedBuilder()
        .setTitle("Gerenciar Notificações do Roblox")
        .addFields(
          { name: "Canal de Updates",         value: cfg.updateChannel ? `<#${cfg.updateChannel}>` : "Não configurado" },
          { name: "Plataformas Desativadas",   value: cfg.platformsDisabled.length ? cfg.platformsDisabled.join(", ") : "Nenhuma" },
          { name: "Cargos para Mencionar",     value: cfg.roles.length ? cfg.roles.map(r => `<@&${r}>`).join(" ") : "Nenhum" },
          { name: "Future Updates",            value: cfg.futureUpdate ? "Ativado" : "Desativado" }
        )
        .setColor(0x5865F2);

      const components = [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId("update_channel")
            .setPlaceholder("Selecione o canal de updates")
            .addChannelTypes(ChannelType.GuildText)
        ),
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("disabled_platforms")
            .setPlaceholder("Selecione plataformas para desativar")
            .setMinValues(0).setMaxValues(4)
            .addOptions(
              { label: "Windows", value: "Windows" },
              { label: "Mac",     value: "Mac"     },
              { label: "Android", value: "Android" },
              { label: "iOS",     value: "iOS"     }
            )
        ),
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId("mention_roles")
            .setPlaceholder("Selecione cargos para mencionar")
            .setMinValues(0).setMaxValues(25)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("toggle_future")
            .setLabel(cfg.futureUpdate ? "Desativar Future Updates" : "Ativar Future Updates")
            .setStyle(ButtonStyle.Primary)
        ),
      ];

      await interaction.reply({ embeds: [embed], components, flags: 64 });
      const message = await interaction.fetchReply();
      const collector = message.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 600000,
      });

      collector.on("collect", async i => {
        if (i.customId === "update_channel")    cfg.updateChannel      = i.values[0];
        else if (i.customId === "disabled_platforms") cfg.platformsDisabled = i.values;
        else if (i.customId === "mention_roles")      cfg.roles              = i.values;
        else if (i.customId === "toggle_future")      cfg.futureUpdate       = !cfg.futureUpdate;
        saveRbxConfig();

        const newEmbed = new EmbedBuilder()
          .setTitle("Gerenciar Notificações do Roblox")
          .addFields(
            { name: "Canal de Updates",       value: cfg.updateChannel ? `<#${cfg.updateChannel}>` : "Não configurado" },
            { name: "Plataformas Desativadas", value: cfg.platformsDisabled.length ? cfg.platformsDisabled.join(", ") : "Nenhuma" },
            { name: "Cargos para Mencionar",   value: cfg.roles.length ? cfg.roles.map(r => `<@&${r}>`).join(" ") : "Nenhum" },
            { name: "Future Updates",          value: cfg.futureUpdate ? "Ativado" : "Desativado" }
          )
          .setColor(0x5865F2);

        const newComponents = components.map(row => {
          const nr = ActionRowBuilder.from(row);
          if (nr.components[0].data?.custom_id === "toggle_future")
            nr.components[0].setLabel(cfg.futureUpdate ? "Desativar Future Updates" : "Ativar Future Updates");
          return nr;
        });

        await i.update({ embeds: [newEmbed], components: newComponents });
      });
      return;
    }

    // ─── current-version ───
    if (commandName === "current-version") {
      await interaction.deferReply({ ephemeral: true });
      const desktop = await fetchDesktopVersions(false);
      const ios     = await fetchIOSVersion();
      const android = await fetchAndroidVersion();
      const embed = new EmbedBuilder()
        .setTitle("📊 Roblox Versions")
        .addFields(
          { name: "🪟 Windows", value: desktop?.Windows ? `\`\`\`${desktop.Windows}\`\`\`` : "N/A" },
          { name: "🍎 Mac",     value: desktop?.Mac     ? `\`\`\`${desktop.Mac}\`\`\``     : "N/A" },
          { name: "🤖 Android", value: android           ? `\`\`\`${android}\`\`\``         : "N/A" },
          { name: "📱 iOS",     value: ios               ? `\`\`\`${ios}\`\`\``             : "N/A" }
        )
        .setColor(0x5865F2);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ─── update-roblox ───
    if (commandName === "update-roblox") {
      const UPDRBX_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(UPDRBX_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });

      await interaction.deferReply();
      const platform     = interaction.options.getString("platform");
      const type         = interaction.options.getString("type") || "current";
      const future       = ["Windows","Mac"].includes(platform) && type === "future";
      let   version      = interaction.options.getString("version");

      if (!version) {
        if (["Windows","Mac"].includes(platform)) {
          if (future) {
            const [futureData, currentData] = await Promise.all([
              fetchDesktopVersions(true), fetchDesktopVersions(false),
            ]);
            const fv = futureData?.[platform];
            const cv = currentData?.[platform];
            if (!fv || fv === cv)
              return interaction.editReply(`❌ Não há future update para "${platform}".`);
            version = fv;
          } else {
            const data = await fetchDesktopVersions(false);
            if (!data) return interaction.editReply("❌ Erro ao buscar versão desktop.");
            version = data[platform];
          }
        } else if (platform === "iOS")     version = await fetchIOSVersion();
        else if (platform === "Android")   version = await fetchAndroidVersion();
      }

      if (!version) return interaction.editReply("❌ Não foi possível encontrar a versão.");

      if (future) guildCfg.lastFutureVersions[platform] = version;
      else        guildCfg.lastVersions[platform]        = version;
      saveRbxConfig();

      const link = getDownloadLink(platform, version);
      const mention = guildCfg.roles.length ? guildCfg.roles.map(r => `<@&${r}>`).join(" ") : "@everyone";

      const embed = new EmbedBuilder()
        .setTitle(future ? `New Roblox ${platform} Build Detected!` : `Roblox ${platform} Updated!`)
        .setDescription(future
          ? "THIS IS NOT A ROBLOX UPDATE\nRoblox has just built a new version. This may be the next update."
          : "This version is now released and is being used by players!")
        .addFields(
          { name: "Version",  value: `\`\`\`${version}\`\`\``, inline: false },
          { name: "Platform", value: platform,                   inline: true  },
          { name: "Download", value: `[Download Here](${link})`, inline: true  }
        )
        .setColor(future ? 0xF1C40F : 0x2B2D31)
        .setThumbnail(ROBLOX_LOGO)
        .setTimestamp();

      try {
        await interaction.channel.send({
          content: mention,
          embeds: [embed],
          allowedMentions: { parse: ["everyone", "roles"] },
        });
        return interaction.editReply({ content: "✅ Update enviado!" });
      } catch (err) {
        console.error("[/update-roblox ERROR]", err);
        return interaction.editReply({ content: `❌ Erro ao enviar update: \`${err.message}\`` });
      }
    }

    // ─── reset ───
    if (commandName === "reset") {
      const RESET_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(RESET_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      try {
        const texto = [
          `<@&${EXECUTORS_ROLE_ID}>\n\nWindows EXECUTORS STATES (free)\n\`\`\`\n[>] Xeno(ONLINE🟢)(UNDETECTED🟢)\n[>] Solara(ONLINE🟢)(UNDETECTED🟢)\n\`\`\``,
          "Windows EXTERNAL STATES (free)\n```\n[>] DriftEXT(ONLINE🟢)(UNDETECTED🟢)\n```",
          "MacOS / Android / iOS\n```\n[>] 1°Delta(ONLINE🟢)(UNDETECTED🟢)\n[>] Hydrogen(ONLINE🟢)(UNDETECTED🟢)\n```",
        ];
        for (const t of texto) await interaction.channel.send(t);
        return interaction.editReply({ content: "✅ Reset enviado." });
      } catch (err) {
        console.error("[/reset ERROR]", err);
        return interaction.editReply({ content: `❌ Erro ao enviar reset: \`${err.message}\`` });
      }
    }

    // ─── dashboard ───
    if (commandName === "dashboard") {
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("platform_select")
          .setPlaceholder("Escolha uma plataforma")
          .addOptions([
            { label: "Windows", value: "Windows", emoji: "🖥️" },
            { label: "MacOS",   value: "MacOS",   emoji: "🍏" },
            { label: "Android", value: "Android", emoji: "🤖" },
            { label: "iOS",     value: "iOS",     emoji: "📱" },
            { label: "External",value: "External",emoji: "💠" },
          ])
      );
      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("back").setLabel("Voltar").setStyle(ButtonStyle.Secondary).setDisabled(true)
      );
      await interaction.reply({ content: "Escolha uma plataforma:", components: [row, backRow] });
      return;
    }

    // ─── XP commands ───
    if (commandName === "addxp") {
      const ADDXP_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(ADDXP_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
      const user = interaction.options.getUser("user");
      const amt  = interaction.options.getInteger("amount");
      const data = await loadXP();
      const uid  = user.id;
      if (!data[uid]) data[uid] = { xp: 0, level: 0 };
      data[uid].xp += amt;
      await saveXP(data);
      return interaction.reply({ content: `✅ Adicionado ${amt} XP para ${user}.` });
    }

    if (commandName === "setlevel") {
      const SETLEVEL_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(SETLEVEL_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
      const user  = interaction.options.getUser("user");
      const level = interaction.options.getInteger("level");
      const data  = await loadXP();
      data[user.id] = { xp: 0, level };
      await saveXP(data);
      return interaction.reply({ content: `✅ Nível de ${user} definido para ${level}.` });
    }

    if (commandName === "removexp") {
      const REMOVEXP_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(REMOVEXP_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
      const user = interaction.options.getUser("user");
      const amt  = interaction.options.getInteger("amount");
      const data = await loadXP();
      if (!data[user.id]) return interaction.reply({ content: "❌ Usuário sem XP.", ephemeral: true });
      data[user.id].xp = Math.max(0, data[user.id].xp - amt);
      await saveXP(data);
      return interaction.reply({ content: `✅ Removido ${amt} XP de ${user}.` });
    }

    if (commandName === "xp") {
      const data  = await loadXP();
      const uid   = interaction.user.id;
      if (!data[uid]) return interaction.reply({ content: "Você ainda não tem XP.", ephemeral: true });
      const { xp, level } = data[uid];
      const embed = new EmbedBuilder()
        .setTitle("📊 Seu Progresso").setColor(0x0000FF)
        .addFields(
          { name: "⭐ Level", value: level.toString(), inline: true },
          { name: "📈 XP",    value: `${xp}/${xpNeeded(level + 1)}`, inline: true }
        )
        .setFooter({ text: "Sistema de XP • Redux Studios" });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === "xp_add") {
      const XP_ADD_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(XP_ADD_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
      const user  = interaction.options.getUser("user");
      const value = interaction.options.getInteger("value");
      if (value <= 0) return interaction.reply({ content: "❌ Valor inválido.", ephemeral: true });
      const data = await loadXP();
      const uid  = user.id;
      if (!data[uid]) data[uid] = { xp: 0, level: 0 };
      data[uid].level += value; data[uid].xp = 0;
      await saveXP(data);
      return interaction.reply({ content: `✅ ${user} recebeu **+${value} levels** (Level atual: ${data[uid].level}).` });
    }

    if (commandName === "xp_set") {
      const XP_SET_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(XP_SET_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
      const user  = interaction.options.getUser("user");
      const value = interaction.options.getInteger("value");
      if (value < 0) return interaction.reply({ content: "❌ Level não pode ser negativo.", ephemeral: true });
      const data = await loadXP();
      data[user.id] = { level: value, xp: 0 };
      await saveXP(data);
      return interaction.reply({ content: `✅ Level de ${user} definido para **${value}**.` });
    }

    if (commandName === "xp_remove") {
      const XP_REM_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(XP_REM_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
      const user  = interaction.options.getUser("user");
      const value = interaction.options.getInteger("value");
      if (value <= 0) return interaction.reply({ content: "❌ Valor inválido.", ephemeral: true });
      const data = await loadXP();
      if (!data[user.id]) return interaction.reply({ content: "❌ Usuário não tem XP.", ephemeral: true });
      data[user.id].level = Math.max(0, data[user.id].level - value); data[user.id].xp = 0;
      await saveXP(data);
      return interaction.reply({ content: `✅ ${value} levels removidos de ${user}. Level atual: **${data[user.id].level}**.` });
    }

    // ─── sync ───
    if (commandName === "sync") {
      const SYNC_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(SYNC_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
      try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commandDefs });
        return interaction.reply({ content: "✅ Comandos sincronizados!", ephemeral: true });
      } catch (err) {
        return interaction.reply({ content: `❌ Erro: ${err.message}`, ephemeral: true });
      }
    }

    // ─── execdownload ───
    if (commandName === "execdownload") {
      const nome = interaction.options.getString("nome").trim();
      const exec = EXECUTORS_LINKS[nome];
      if (exec)
        return interaction.reply({ content: `🖥️ **${nome}** (${exec.tipo.toUpperCase()}): ${exec.link}` });
      return interaction.reply({ content: `❌ Executor **${nome}** não encontrado!`, ephemeral: true });
    }

    // ─── info ───
    if (commandName === "info") {
      const embed = new EmbedBuilder()
        .setTitle("ℹ️ Informações do Servidor REDUX")
        .setDescription(
          ":red_square: **DESCRIÇÕES DAS CATEGORIAS REDUX**\n\n" +
          "「 ✦ REDUX BOTS LOGS ✦ 」:robot: Central de bots.\n" +
          "「 ✦ REDUX STATES ✦ 」:bar_chart: Monitoramento em tempo real.\n" +
          "「 ✦ REDUX MODERATIONS ✦ 」:shield: Controle e segurança.\n" +
          "「 ✦ REDUX UTILITIES ✦ 」:gear: Ferramentas essenciais.\n" +
          "「 ✦ REDUX HUB ✦ 」:house: Área principal.\n" +
          "「 ✦ REDUX SUPPORT ✦ 」:loudspeaker: Suporte via ticket.\n" +
          "「 ✦ REDUX GAMES ✦ 」:video_game: Espaço gamer.\n" +
          "「 ✦ REDUX MUSIC ✦ 」:musical_note: Área musical."
        )
        .setColor(0xFFA500);
      return interaction.reply({ embeds: [embed] });
    }

    // ─── status ───
    if (commandName === "status") {
      await interaction.deferReply({ ephemeral: true });
      const data  = await loadStatus();
      const embed = new EmbedBuilder().setTitle("Status dos Executores REDUX").setColor(0x0000FF);
      let fieldCount = 0;
      for (const [categoria, executores] of Object.entries(data)) {
        if (fieldCount >= 25) break; // Discord limita 25 fields por embed
        if (typeof executores === "object" && executores !== null) {
          const texto = Object.entries(executores).map(([n, s]) => `• ${n}: ${s}`).join("\n") || "Nenhum";
          embed.addFields({ name: categoria, value: texto.length > 1024 ? texto.substring(0, 1020) + "..." : texto, inline: false });
        } else {
          embed.addFields({ name: categoria, value: String(executores), inline: false });
        }
        fieldCount++;
      }
      if (fieldCount === 0) embed.setDescription("Nenhum status disponível.");
      return interaction.editReply({ embeds: [embed] });
    }

    // ─── status-redux ───
    if (commandName === "status-redux") {
      await interaction.deferReply({ ephemeral: true });
      const data  = await loadStatus();
      const embed = new EmbedBuilder().setTitle("Status dos Sistemas REDUX").setColor(0xFFA500);
      if (!Object.keys(data).length) {
        embed.setDescription("Nenhum status carregado ainda.");
      } else {
        let fieldCount = 0;
        for (const [sistema, sts] of Object.entries(data)) {
          if (fieldCount >= 25) break;
          const stsStr = typeof sts === "object" ? JSON.stringify(sts) : String(sts);
          const emoji = stsStr.toUpperCase().includes("ON") ? "🟢" : "🔴";
          const value = stsStr.length > 1024 ? stsStr.substring(0, 1020) + "..." : stsStr;
          embed.addFields({ name: sistema, value: `${value} ${emoji}`, inline: false });
          fieldCount++;
        }
      }
      return interaction.editReply({ embeds: [embed] });
    }

    // ─── rules ───
    if (commandName === "rules") {
      const embed = new EmbedBuilder()
        .setTitle("Regras do Servidor REDUX").setColor(0xFF0000)
        .setDescription("Leia atentamente antes de participar.")
        .addFields(
          { name: "1️⃣ Respeito",     value: "Trate todos com respeito.",            inline: false },
          { name: "2️⃣ Spam",         value: "Não faça spam.",                        inline: false },
          { name: "3️⃣ Aplicações",   value: "Preencha os formulários corretamente.", inline: false },
          { name: "4️⃣ Segurança",    value: "Não compartilhe informações pessoais.", inline: false }
        );
      return interaction.reply({ embeds: [embed] });
    }

    // ─── cleaner ───
    if (commandName === "cleaner") {
      const CLEANER_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(CLEANER_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
      const qty = Math.min(Math.max(interaction.options.getInteger("quantidade") || 100, 1), 1000);
      await interaction.deferReply({ ephemeral: true });
      try {
        const msgs  = await interaction.channel.bulkDelete(qty, true);
        try { await interaction.user.send(`🧹 **Limpeza concluída!** Canal: **#${interaction.channel.name}** — ${msgs.size} mensagens apagadas.`); } catch {}
        return interaction.editReply({ content: `✅ ${msgs.size} mensagens apagadas.` });
      } catch (e) {
        console.error("[/cleaner ERROR]", e);
        return interaction.editReply({ content: `❌ Erro: \`${e}\`` });
      }
    }

    // ─── reduxstatesexecutor ───
    if (commandName === "reduxstatesexecutor") {
      const REDUX_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(REDUX_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      try {
        client.statusMessage = null;
        await updateReduxStatusEmbed();
        return interaction.editReply({ content: "✅ Mensagem de status gerada." });
      } catch (e) {
        console.error("[/reduxstatesexecutor ERROR]", e);
        return interaction.editReply({ content: `❌ Erro: \`${e}\`` });
      }
    }

    // ─── logapp ───
    if (commandName === "logapp") {
      const LOGAPP_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(LOGAPP_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      try {
        const tipo           = interaction.options.getString("tipo");
        const titulo         = interaction.options.getString("titulo");
        let   utility        = (interaction.options.getString("utility") || "").replace(/-/g, " ");
        const emojiSituation = interaction.options.getString("emojisituation") || "📰";
        const situation      = interaction.options.getString("situation");
        const log            = interaction.options.getString("log");
        const subtitle       = interaction.options.getString("subtitle");
        const channelMention = interaction.options.getChannel("channelmention");
        const downloadMsg    = interaction.options.getString("downloadmessage");
        const downloadLink   = interaction.options.getString("downloadlink");
        const image          = interaction.options.getAttachment("image");

        const partes   = log.split("|").map(p => p.trim()).filter(p => p.length > 0);
        let textoLog   = partes.map(p => p === "-" ? "\n" : `🔹 ${p}`).join("\n").trimEnd();
        const situationTitle = tipo === "utility" ? (situation || "Changelog") : (situation || "Situação");

        const embed = new EmbedBuilder()
          .setTitle(`📢 Redux ${tipo === "utility" ? "Utility" : "Annunciaments"} Log`)
          .setColor(0x0000FF)
          .setDescription(`**${emojiSituation} ${situationTitle}**\n\n${textoLog}`)
          .addFields({ name: `🔄️ ${titulo}`, value: utility || "\u200b", inline: false });

        if (subtitle) {
          let sv = `# ${subtitle}`;
          if (channelMention) sv += `\n📢 ${channelMention}`;
          embed.addFields({ name: "📌 Destaque", value: sv, inline: false });
        }
        if (downloadMsg && downloadLink)
          embed.addFields({ name: "⬇️ Download", value: `[${downloadMsg}](${downloadLink})`, inline: false });

        embed.setImage(LOGO_URL)
             .setFooter({ text: "Redux Studios | Estamos A disposição" })
             .setTimestamp();

        await interaction.channel.send({
          content: `<@&${EXECUTORS_ROLE_ID}>`,
          embeds: [embed],
          allowedMentions: { roles: [EXECUTORS_ROLE_ID] },
        });
        if (image) await interaction.channel.send({ files: [new AttachmentBuilder(image.url)] });
        return interaction.editReply({ content: "✅ Log enviado com sucesso." });
      } catch (err) {
        console.error("[/logapp ERROR]", err);
        return interaction.editReply({ content: `❌ Erro ao enviar log: \`${err.message}\`` });
      }
    }

    // ─── update ───
    if (commandName === "update") {
      const UPDATE_ALLOWED_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(UPDATE_ALLOWED_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });

      // Deferir IMEDIATAMENTE para evitar timeout de 3s do Discord
      await interaction.deferReply({ flags: 64 });

      try {
        const name                  = interaction.options.getString("name");
        const version               = interaction.options.getString("version");
        const subtitle              = interaction.options.getString("subtitle");
        const logRaw                = interaction.options.getString("log");
        const downloadText          = interaction.options.getString("downloadtext");
        const downloadLink          = interaction.options.getString("downloadlink");
        const downloadVersionRBXText = interaction.options.getString("downloadversionrbxtext");
        const downloadVersionRBXLink = interaction.options.getString("downloadversionrbxlink");
        const notes                 = interaction.options.getString("notes");
        const fixerChannel          = interaction.options.getChannel("fixer");

        // Converte | em quebra de linha simples e |-| em quebra dupla
        const parseLog = (raw) =>
          raw
            .split("|-|").join("\n\n")
            .split("|").join("\n");

        const logText = parseLog(logRaw);
        const subtitleText = parseLog(subtitle);

        const changelogBlock =
          `\`\`\`ini\n` +
          `[${name}] [>]:Update/Fixed/Improved\n` +
          `[+]:Add\n` +
          `[-]:Removed\n` +
          `[*]:Trade\n` +
          `[/]:Reveted\n\n` +
          `${logText}\n` +
          `\`\`\``;

        const embed = new EmbedBuilder()
          .setTitle(`${name} — Update to Version ${version}`)
          .setColor(0x5865F2)
          .setDescription(
            `\`\`\`\n${subtitleText}\n\`\`\`\n\n` +
            `**Changelog**\n${changelogBlock}\n\n` +
            `**Download👇** [${downloadText}](${downloadLink})\n` +
            `**Download Version👇** [${downloadVersionRBXText}](${downloadVersionRBXLink})\n` +
            (notes ? `\n**Notes:** ${parseLog(notes)}\n` : "") +
            `\nPra quem ja tem instalado (Reabra o RBXLauncher para o Update) For those who already have it installed (Reopen RBXLauncher for the Update)\n` +
            `**Fixer:** ${fixerChannel}`
          )
          .setFooter({ text: "RBX EXPLOIT Update Log" })
          .setTimestamp();

        await interaction.channel.send({
          content: `@everyone`,
          embeds: [embed],
          allowedMentions: { parse: ["everyone"] },
        });
        return interaction.editReply({ content: "✅ Update publicado!" });
      } catch (err) {
        console.error("[/update ERROR]", err);
        return interaction.editReply({ content: `❌ Erro ao publicar o update: \`${err.message}\`` });
      }
    }

    // ─── annunciament ───
    if (commandName === "annunciament") {
      const ANNUNCIAMENT_ROLE_ID = "1109671454473203738";
      const guild = interaction.guild;
      const isOwner = guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(ANNUNCIAMENT_ROLE_ID);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });

      await interaction.deferReply({ flags: 64 });

      try {
        const annLogRaw = interaction.options.getString("annunciamentlog");
        const image = interaction.options.getAttachment("image");
        const video = interaction.options.getAttachment("video");
        const file = interaction.options.getAttachment("file");

        if (!annLogRaw && !image && !video && !file) {
          return interaction.editReply({ content: "❌ Adicione pelo menos um conteúdo (texto, imagem, vídeo ou arquivo)." });
        }

        const parseLog = (raw) =>
          raw
            .split("|-|").join("\n\n")
            .split("|").join("\n");

        const annText = annLogRaw ? parseLog(annLogRaw) : "📢 Novo Anuncio!";

        const embed = new EmbedBuilder()
          .setTitle("📢 Annunciament")
          .setColor(0x5865F2)
          .setDescription(annText)
          .setFooter({ text: `— ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
          .setTimestamp();

        if (image) embed.setImage(image.url);

        if (video || file) {
          const files = [];
          if (video) {
            const vData = await nodeFetch(video.url).then(r => r.buffer());
            files.push(new AttachmentBuilder(vData, { name: video.name }));
          }
          if (file) {
            const fData = await nodeFetch(file.url).then(r => r.buffer());
            files.push(new AttachmentBuilder(fData, { name: file.name }));
          }
          await interaction.channel.send({
            content: "@everyone",
            embeds: [embed],
            files: files,
            allowedMentions: { parse: ["everyone"] },
          });
        } else {
          await interaction.channel.send({
            content: "@everyone",
            embeds: [embed],
            allowedMentions: { parse: ["everyone"] },
          });
        }
        return interaction.editReply({ content: "✅ Anuncio enviado!" });
      } catch (err) {
        console.error("[/annunciament ERROR]", err);
        return interaction.editReply({ content: `❌ Erro ao enviar anuncio: \`${err.message}\`` });
      }
    }

    // ─── creategiveaway ───
    if (commandName === "creategiveaway") {
      const GIVEAWAY_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(GIVEAWAY_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissao.", ephemeral: true });

      await interaction.deferReply({ flags: 64 });

      try {
        const prize = interaction.options.getString("prize");
        const description = interaction.options.getString("description");
        const winners = interaction.options.getInteger("winners") || 1;
        const duration = interaction.options.getInteger("duration") || 60;
        const image = interaction.options.getAttachment("image");
        const file = interaction.options.getAttachment("file");

        const participantes = new Set();
        const endTime = Date.now() + duration * 60 * 1000;

        const embed = new EmbedBuilder()
          .setTitle("🎉 GIVEAWAY")
          .setDescription(`**Premio:** ${prize}`)
          .addFields(
            { name: "Descricao", value: description || "Sem descricao", inline: false },
            { name: "Vencedores", value: winners.toString(), inline: true },
            { name: "Participantes", value: "0", inline: true },
            { name: "Termina em", value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true }
          )
          .setColor(0xFFD700)
          .setFooter({ text: `Criado por ${interaction.user.tag}` })
          .setTimestamp();

        if (image) embed.setImage(image.url);

        const msg = await interaction.channel.send({
          content: "🎉 **GIVEAWAY!** Reaja com ✅ para participar!",
          embeds: [embed],
        });

        await msg.react("✅");

        const filter = (reaction, user) => reaction.emoji.name === "✅" && !user.bot;
        const collector = msg.createReactionCollector({ filter, time: duration * 60 * 1000 });

        collector.on("collect", (reaction, user) => {
          if (!participantes.has(user.id)) {
            participantes.add(user.id);
            embed.spliceFields(2, 1, { name: "Participantes", value: participantes.size.toString(), inline: true });
            msg.edit({ embeds: [embed] });
          }
        });

        collector.on("end", async () => {
          if (participantes.size === 0) {
            embed.setDescription(`**Premio:** ${prize}\n\n❌ Sem participantes!`);
            embed.setColor(0xFF0000);
            await msg.edit({ embeds: [embed], content: "❌ Giveaway encerrado sem participantes." });
            return;
          }

          const winnersList = [];
          const partieArray = Array.from(participantes);
          for (let i = 0; i < Math.min(winners, partieArray.length); i++) {
            const randomIndex = Math.floor(Math.random() * partieArray.length);
            winnersList.push(partieArray[randomIndex]);
            partieArray.splice(randomIndex, 1);
          }

          const winnerMentions = winnersList.map(id => `<@${id}>`).join(", ");
          embed.setDescription(`**Premio:** ${prize}\n\n🎉 **Vencedor(es):** ${winnerMentions}`);
          embed.setColor(0x00FF00);
          embed.spliceFields(3, 1, { name: "Terminado", value: "Encerrado!", inline: true });

          if (file) {
            const fData = await nodeFetch(file.url).then(r => r.buffer());
            await interaction.channel.send({ content: `🎉 Parabens ${winnerMentions}! voce(s) ganhou(ram) ${prize}!`, files: [new AttachmentBuilder(fData, { name: file.name })] });
          } else {
            await interaction.channel.send({ content: `🎉 Parabens ${winnerMentions}! voce(s) ganhou(ram) ${prize}!` });
          }
          await msg.edit({ embeds: [embed] });
        });

        return interaction.editReply({ content: "✅ Giveaway criado!" });
      } catch (err) {
        console.error("[/creategiveaway ERROR]", err);
        return interaction.editReply({ content: `❌ Erro ao criar giveaway: \`${err.message}\`` });
      }
    }

    // ─── serverstats ───
    if (commandName === "serverstats") {
      const guild = interaction.guild;
      if (!guild) return interaction.reply({ content: "Este comando so funciona em servidores.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });

      const members = await guild.members.fetch();
      const channels = await guild.channels.fetch();
      const roles = await guild.roles.fetch();
      const bots = members.filter(m => m.user.bot).size;
      const humans = members.size - bots;
      const textChannels = channels.filter(c => c.type === 0).size;
      const voiceChannels = channels.filter(c => c.type === 2).size;
      const categories = channels.filter(c => c.type === 4).size;

      const embed = new EmbedBuilder()
        .setTitle(`📊 ${guild.name}`)
        .setColor(0x5865F2)
        .addFields(
          { name: "👥 Membros", value: `Total: ${members.size}\nHumanos: ${humans}\nBots: ${bots}`, inline: true },
          { name: "📢 Canais", value: `Texto: ${textChannels}\nVoz: ${voiceChannels}\nCategorias: ${categories}`, inline: true },
          { name: "🎭 Cargos", value: roles.size.toString(), inline: true },
          { name: "🆔 Server ID", value: guild.id, inline: true },
          { name: "📅 Criado em", value: guild.createdAt.toLocaleDateString("pt-BR"), inline: true }
        )
        .setThumbnail(guild.iconURL())
        .setFooter({ text: `Dono: ${(await guild.fetchOwner()).user.tag}` });

      return interaction.editReply({ embeds: [embed] });
    }

    // ─── pin ───
    if (commandName === "pin") {
      const PIN_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(PIN_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissao.", ephemeral: true });

      const messageText = interaction.options.getString("mensagem");
      const image = interaction.options.getAttachment("imagem");

      if (!messageText && !image)
        return interaction.reply({ content: "❌ Adicione uma mensagem ou imagem.", ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle("📌 Mensagem Fixada")
        .setColor(0xFFD700)
        .setDescription(messageText || " ")
        .setFooter({ text: `Fixado por ${interaction.user.tag}` })
        .setTimestamp();

      if (image) embed.setImage(image.url);

      await interaction.channel.send({ embeds: [embed] });
      return interaction.reply({ content: "✅ Mensagem fixada!", ephemeral: true });
    }

    // ─── autorole ───
    if (commandName === "autorole") {
      const AUTO_ROLE = "1109671454473203738";
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const hasRole = interaction.member.roles.cache.has(AUTO_ROLE);
      if (!isOwner && !hasRole)
        return interaction.reply({ content: "❌ Sem permissao.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });

      const roleName = interaction.options.getString("cargo");
      const emoji = interaction.options.getString("emoji");
      const description = interaction.options.getString("mensagem") || "Reaja para obter o cargo";

      const role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase())
        || interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes(roleName.toLowerCase()));

      if (!role)
        return interaction.editReply({ content: `❌ Cargo "${roleName}" nao encontrado.`, embeds: [] });

      const embed = new EmbedBuilder()
        .setTitle("🎭 Auto-Role")
        .setDescription(`${description}\n\n${emoji} = ${role}`)
        .setColor(0x5865F2);

      const msg = await interaction.channel.send({ embeds: [embed] });
      await msg.react(emoji);

      collectorMap.set(msg.id, { roleId: role.id, emoji });

      return interaction.editReply({ content: "✅ Auto-role criado!", embeds: [] });
    }

    // ─── poll ───
    if (commandName === "poll") {
      await interaction.deferReply({ ephemeral: true });

      const question = interaction.options.getString("pergunta");
      const options = interaction.options.getString("opcoes").split(",").map(o => o.trim());
      const duration = interaction.options.getInteger("tempo") || 60;

      if (options.length < 2)
        return interaction.editReply({ content: "❌ Adicione pelo menos 2 opcoes!", embeds: [] });

      if (options.length > 10)
        return interaction.editReply({ content: "❌ Maximo de 10 opcoes!", embeds: [] });

      const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
      const optionText = options.map((opt, i) => `${emojis[i]} ${opt}`).join("\n");

      const embed = new EmbedBuilder()
        .setTitle("📊 Enquete")
        .setDescription(`**${question}**\n\n${optionText}`)
        .addFields({ name: "Tempo", value: `<t:${Math.floor((Date.now() + duration * 60000) / 1000)}:R>`, inline: true })
        .setColor(0x5865F2)
        .setFooter({ text: `Votos: 0` });

      const msg = await interaction.channel.send({ embeds: [embed] });

      for (let i = 0; i < options.length; i++) {
        await msg.react(emojis[i]);
      }

      pollMap.set(msg.id, { question, options, votes: options.map(() => 0), voters: new Map(), duration, endTime: Date.now() + duration * 60000 });

      setTimeout(async () => {
        const poll = pollMap.get(msg.id);
        if (!poll) return;

        const votes = poll.votes;
        const maxVotes = Math.max(...votes);
        const winners = poll.options.filter((_, i) => votes[i] === maxVotes);
        const winnerText = winners.length === 1 ? winners[0] : winners.join(" | ");

        embed.setDescription(`**${poll.question}**\n\n${poll.options.map((opt, i) => `${emojis[i]} ${opt}: ${votes[i]} votos`).join("\n")}`);
        embed.setColor(0xFFD700);
        embed.spliceFields(0, 1, { name: "Resultado", value: winnerText, inline: true });

        await msg.edit({ embeds: [embed] });
        await msg.reply({ content: `📊 **Enquete encerrada!** Vencedor: **${winnerText}**` });

        pollMap.delete(msg.id);
      }, duration * 60000);

      return interaction.editReply({ content: "✅ Enquete criada!", embeds: [] });
    }

    // ─── help ───
    if (commandName === "help") {
      const embed = new EmbedBuilder()
        .setTitle("📖 Ajuda — RBX-BOT")
        .setDescription("Lista de comandos disponíveis")
        .setColor(0x5865F2)
        .addFields(
          { name: "🎮 Roblox",    value: "`/manage-notification` `/current-version` `/update-roblox`", inline: false },
          { name: "📢 Logs & Anuncios", value: "`/update` `/annunciament` `/logapp` `/creategiveaway`", inline: false },
          { name: "⚙️ Utilidades", value: "`/serverstats` `/status` `/status-redux` `/dashboard` `/execdownload`", inline: false },
          { name: "🎭 Interativos", value: "`/poll` `/autorole`", inline: false },
          { name: "🛠️ Moderação", value: "`/pin` `/cleaner` `/reduxstatesexecutor` `/sync`", inline: false },
          { name: "📊 XP",        value: "`/xp` `/xp_add` `/xp_set` `/xp_remove` `/addxp` `/setlevel` `/removexp`", inline: false },
          { name: "ℹ️ Info",       value: "`/info` `/rules`", inline: false }
        )
        .setFooter({ text: "Redux Studios" })
        .setImage(LOGO_URL);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  // ── SELECT MENUS ──
  else if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "platform_select") {
      const plataforma = interaction.values[0];
      const categorias = PLATAFORMAS[plataforma] || [];
      const tipoSelect = new StringSelectMenuBuilder()
        .setCustomId("tipo_select")
        .setPlaceholder("Escolha o tipo de executor")
        .addOptions(categorias.map(cat => ({
          label: cat,
          description: cat.includes("Free") ? "Free" : "Paid",
          emoji: cat.includes("Free") ? "🟢" : "🔴",
          value: cat,
        })));
      const row     = new ActionRowBuilder().addComponents(tipoSelect);
      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("back").setLabel("Voltar").setStyle(ButtonStyle.Secondary)
      );
      return interaction.update({ content: `Plataforma: **${plataforma}**`, components: [row, backRow] });
    }

    if (interaction.customId === "tipo_select") {
      const categoria = interaction.values[0];
      const executores = EXECUTORS_BY_CATEGORY[categoria] || [];
      const embed = new EmbedBuilder()
        .setTitle(`Executores - ${categoria}`).setColor(0x0000FF)
        .setDescription(executores.length ? executores.map(e => `• ${e}`).join("\n") : "Nenhum executor.");
      const dlText = executores
        .map(e => EXECUTORS_LINKS[e]?.link ? `🖥️ **${e}** → [Download](${EXECUTORS_LINKS[e].link})` : null)
        .filter(Boolean).join("\n");
      if (dlText) {
        try { await interaction.user.send(`Links para **${categoria}**:\n${dlText}`); }
        catch { await interaction.followUp({ content: "❌ Não consegui enviar DM.", ephemeral: true }); }
      }
      return interaction.update({ embeds: [embed], components: interaction.message.components });
    }
  }

  // ── BUTTONS ──
  else if (interaction.isButton()) {
    if (interaction.customId === "back") {
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("platform_select").setPlaceholder("Escolha uma plataforma")
          .addOptions([
            { label: "Windows", value: "Windows", emoji: "🖥️" },
            { label: "MacOS",   value: "MacOS",   emoji: "🍏" },
            { label: "Android", value: "Android", emoji: "🤖" },
            { label: "iOS",     value: "iOS",     emoji: "📱" },
            { label: "External",value: "External",emoji: "💠" },
          ])
      );
      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("back").setLabel("Voltar").setStyle(ButtonStyle.Secondary).setDisabled(true)
      );
      return interaction.update({ content: "Escolha uma plataforma:", embeds: [], components: [row, backRow] });
    }
  }

  // ── REACTION COLLECTOR ──
  else if (interaction.isMessageReactionAdd()) {
    const message = interaction.message;
    const user = interaction.user;

    const autoRole = collectorMap.get(message.id);
    if (autoRole) {
      const role = message.guild.roles.cache.get(autoRole.roleId);
      if (role) {
        const member = await message.guild.members.fetch(user.id);
        await member.roles.add(role);
      }
    }

    const poll = pollMap.get(message.id);
    if (poll) {
      const emoji = interaction._emoji.name;
      const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
      const index = emojis.indexOf(emoji);
      if (index !== -1 && index < poll.options.length) {
        if (poll.voters.has(user.id)) {
          const oldIndex = poll.voters.get(user.id);
          poll.votes[oldIndex]--;
        }
        poll.votes[index]++;
        poll.voters.set(user.id, index);

        const optionText = poll.options.map((opt, i) => `${emojis[i]} ${opt}: ${poll.votes[i]} votos`).join("\n");
        const embed = new EmbedBuilder(message.embeds[0].data)
          .setDescription(`**${poll.question}**\n\n${optionText}`)
          .setFooter({ text: `Votos: ${poll.voters.size}` });
        await message.edit({ embeds: [embed] });
      }
    }
  }
});

// ===================== ROBLOX UPDATE CHECKER =====================
function startRobloxUpdateChecker() {
  setInterval(async () => {
    try {
      const [desktopCurrent, desktopFuture, iosVersion, androidVersion] = await Promise.all([
        fetchDesktopVersions(false),
        fetchDesktopVersions(true),
        fetchIOSVersion(),
        fetchAndroidVersion(),
      ]);

      for (const guildId of Object.keys(rbxConfig)) {
        const cfg = getGuildConfig(guildId);
        if (!cfg.updateChannel) continue;
        const channel = client.channels.cache.get(cfg.updateChannel);
        if (!channel) continue;
        const mention = cfg.roles.length ? cfg.roles.map(r => `<@&${r}>`).join(" ") : "@everyone";

        for (const platform of ["Windows","Mac","Android","iOS"]) {
          if (cfg.platformsDisabled.includes(platform)) continue;

          // Current
          let currentVersion =
            platform === "Windows" || platform === "Mac" ? desktopCurrent?.[platform]
            : platform === "iOS"     ? iosVersion
            : androidVersion;

          if (currentVersion && typeof currentVersion === "string" && currentVersion.includes(".")) {
            const last = cfg.lastVersions[platform];
            if (!last) { cfg.lastVersions[platform] = currentVersion; saveRbxConfig(); continue; }
            if (last === currentVersion) continue;
            cfg.lastVersions[platform] = currentVersion;
            saveRbxConfig();
            const link  = getDownloadLink(platform, currentVersion);
            const embed = new EmbedBuilder()
              .setTitle(`Roblox ${platform} Updated!`)
              .setDescription(platform === "iOS" || platform === "Android"
                ? "A new mobile version has been released on the app store."
                : "A new desktop version has been released.")
              .addFields(
                { name: "Version",  value: `\`\`\`${currentVersion}\`\`\``, inline: false },
                { name: "Platform", value: platform,                          inline: true  },
                { name: "Download", value: `[Download Here](${link})`,        inline: true  }
              )
              .setColor(0x2B2D31).setThumbnail(ROBLOX_LOGO)
              .setFooter({ text: `RBX-BOT Update Log | ${new Date().toISOString().replace("T"," ").split(".")[0]} UTC` })
              .setTimestamp();
            await channel.send({ content: mention, embeds: [embed], allowedMentions: { parse: ["everyone", "roles"] } });
          }

          // Future
          if (!cfg.futureUpdate) continue;
          if (platform !== "Windows" && platform !== "Mac") continue;
          const futureVersion = desktopFuture?.[platform];
          if (!futureVersion) continue;
          const lastF = cfg.lastFutureVersions[platform];
          if (!lastF) { cfg.lastFutureVersions[platform] = futureVersion; saveRbxConfig(); continue; }
          if (lastF === futureVersion) continue;
          cfg.lastFutureVersions[platform] = futureVersion;
          saveRbxConfig();
          const link  = getDownloadLink(platform, futureVersion);
          const embed = new EmbedBuilder()
            .setTitle(`New Roblox ${platform} Build Detected!`)
            .setDescription("THIS IS NOT A ROBLOX UPDATE\nRoblox has just built a new version. This may be the next update.")
            .addFields(
              { name: "Version",  value: `\`\`\`${futureVersion}\`\`\``, inline: false },
              { name: "Platform", value: platform,                         inline: true  },
              { name: "Download", value: `[Download Here](${link})`,       inline: true  }
            )
            .setColor(0xF1C40F).setThumbnail(ROBLOX_LOGO)
            .setFooter({ text: `RBX-BOT Update Log | ${new Date().toISOString().replace("T"," ").split(".")[0]} UTC` })
            .setTimestamp();
          await channel.send({ content: mention, embeds: [embed], allowedMentions: { parse: ["everyone", "roles"] } });
        }
      }
    } catch (err) { console.error("Roblox update checker error:", err); }
  }, CHECK_INTERVAL);
}

// ===================== REDUX STATUS WATCHER =====================
const STATUS_ROLE_ID = "1109671454116687872";
let lastStatusHash = null;

function computeHash(raw) {
  return raw.split("").reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
}

async function updateReduxStatusEmbed() {
  const canal = client.channels.cache.get(REDUX_CHANNEL_ID);
  if (!canal) return;
  try {
    const data  = await loadStatus();

    // Data/hora gerada AGORA (a cada chamada, nunca fica estática)
    const agora  = new Date();
    const dataEN = agora.toLocaleDateString("en-US", { timeZone: "America/Sao_Paulo" });
    const horaEN = agora.toLocaleTimeString("en-US", { timeZone: "America/Sao_Paulo" });
    const dataPT = agora.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const horaPT = agora.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });

    const embed = new EmbedBuilder()
      .setTitle("📊 Status Executors")
      .setDescription(
        `🇺🇸 **Update:** ${dataEN}, ${horaEN} BRT\n` +
        `🇧🇷 **Atualizado:** ${dataPT}, ${horaPT} BRT`
      )
      .setColor(0x2C2F33);

    const categoriasPermitidas = [
      "Windows Free","Windows Paid","External Free","External Paid",
      "MacOS","Android","iOS Free","iOS Paid","Sistemas REDUX",
    ];
    const icones = {
      "Windows Free":"🖥️","Windows Paid":"🖥️💵","External Free":"📰",
      "External Paid":"📰💵","MacOS":"🍏","Android":"🤖",
      "iOS Free":"📱","iOS Paid":"📱💵","Sistemas REDUX":"🔴",
    };

    for (const cat of categoriasPermitidas) {
      const executores = data[cat];
      if (!executores) continue;
      let texto = Object.entries(executores).map(([n, s]) => `• ${n} → ${s}`).join("\n");
      if (texto.length > 1024) texto = texto.substring(0, 1020) + "...";
      embed.addFields({ name: `${icones[cat] || ""} ${cat}`, value: texto || "Nenhum executor", inline: false });
    }

    if (!embed.data.fields?.length) embed.setDescription("Nenhuma categoria encontrada.");

    // Se ja existe mensagem, apenas edita (sem mencionar cargo)
    if (client.statusMessage) {
      try {
        await client.statusMessage.edit({ embeds: [embed], allowedMentions: { parse: [] } });
        return;
      } catch {
        client.statusMessage = null;
      }
    }

    // So envia nova mensagem quando nao existe nenhuma ainda
    client.statusMessage = await canal.send({
      content: "@everyone",
      embeds: [embed],
      allowedMentions: { parse: ["everyone"] },
    });
    await fsPromise.writeFile(STATUS_MESSAGE_ID_FILE, client.statusMessage.id);
  } catch (e) { console.error("[REDUX STATUS ERROR]", e); }
}

async function startReduxStatusWatcher() {
  // 1) Envia ou edita o embed imediatamente ao ligar o bot
  await updateReduxStatusEmbed();

  // 2) Salva o hash atual para o watcher so disparar quando o JSON mudar de verdade
  try {
    const raw = await fsPromise.readFile(STATUS_FILE, "utf-8");
    lastStatusHash = computeHash(raw);
  } catch { lastStatusHash = 0; }

  // 3) Observa mudancas no arquivo a cada 1 segundo
  setInterval(async () => {
    try {
      const raw  = await fsPromise.readFile(STATUS_FILE, "utf-8");
      const hash = computeHash(raw);
      if (hash !== lastStatusHash) {
        lastStatusHash = hash;
        await updateReduxStatusEmbed();
      }
    } catch (e) { console.error("[WATCHER ERROR]", e); }
  }, 1000);
}

// ===================== KEEP ALIVE =====================
const app = express();
app.get("/", (_, res) => res.send("🤖 RBX-BOT online"));
app.listen(3000, () => console.log("✅ Keep-alive rodando na porta 3000"));

// ===================== LOGIN =====================
client.login(TOKEN);
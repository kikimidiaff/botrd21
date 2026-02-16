import fs from "fs";
import dotenv from 'dotenv';
import express from "express";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  downloadContentFromMessage
} from "@whiskeysockets/baileys";
// Carrega discloud.config
dotenv.config({ path: './discloud.config' });
// Agora você consegue acessar as variáveis
console.log(process.env.NAME);    // RD21
console.log(process.env.AVATAR);  // URL do avatar

const prefix = "!";
const DB_FILE = "./database.json";
let database = {};

const app = express();
app.get("/", (req, res) => res.send("Bot Online"));
app.listen(3000, () => console.log("Servidor online"));

/* ================= BANCO ================= */
function carregarBanco() {
  try {
    if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "{}");
    const data = fs.readFileSync(DB_FILE, "utf8");
    database = data.trim() ? JSON.parse(data) : {};
  } catch {
    database = {};
    salvarBanco();
  }
}

function salvarBanco() {
  fs.writeFileSync(DB_FILE, JSON.stringify(database, null, 2));
}
setInterval(salvarBanco, 30000);

function registrarMensagem(sender, grupo) {
  if (!database[sender])
    database[sender] = {
      interacoes: 0,
      ultimaMensagem: Date.now(),
      ultimoGrupo: grupo
    };

  database[sender].interacoes += 1;
  database[sender].ultimaMensagem = Date.now();
  database[sender].ultimoGrupo = grupo;
}

function rankingInteracoesGrupo(participantesGrupo) {
  return Object.entries(database)
    .filter(([user]) => participantesGrupo.includes(user))
    .sort((a, b) => b[1].interacoes - a[1].interacoes)
    .slice(0, 10);
}

/* ================= BOT ================= */
async function startBot() {
  carregarBanco();

  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    syncFullHistory: true,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        startBot();
      }
    }

    if (connection === "open") {
      console.log("Bot conectado ao WhatsApp!");
    }
  });

  async function isAdmin(groupId, sender) {
    try {
      const metadata = await sock.groupMetadata(groupId);
      const admins = metadata.participants
        .filter(p => p.admin !== null)
        .map(p => p.id);

      return admins.includes(sender);
    } catch {
      return false;
    }
  }
  /* ================= BAN AUTOMÁTICO +3 DIAS ================= */

  async function verificarInatividade(groupId) {
    try {
      const metadata = await sock.groupMetadata(groupId);
      const agora = Date.now();
      const limite = 3 * 24 * 60 * 60 * 1000; // 3 dias

      for (const participante of metadata.participants) {

        const id = participante.id;

        if (participante.admin) continue; // ignora admins
        if (!database[id]) continue;

        const ultima = database[id].ultimaMensagem;

        if (agora - ultima > limite) {

          await sock.groupParticipantsUpdate(groupId, [id], "remove");

          await sock.sendMessage(groupId, {
            text: `⏳ @${id.split("@")[0]} removido por inatividade (+3 dias).`,
            mentions: [id]
          });

          delete database[id];
          salvarBanco();
        }
      }
    } catch (err) {
      console.log("Erro ao verificar inatividade:", err);
    }
  }
  
  // Verifica inatividade a cada 6 horas
  setInterval(async () => {
    try {
      const grupos = new Set();

      for (const userId in database) {
        if (database[userId].ultimoGrupo)
          grupos.add(database[userId].ultimoGrupo);
      }

      for (const grupo of grupos) {
        await verificarInatividade(grupo);
      }

    } catch (e) {
      console.log("Erro no intervalo:", e);
    }
  }, 6 * 60 * 60 * 1000);

  /* ================= BOAS-VINDAS ================= */
  sock.ev.on("group-participants.update", async (update) => {

    console.log("Evento:", update.action);

    if (!["add", "invite"].includes(update.action)) return;

    for (const participant of update.participants) {

      // Compatível com string ou objeto
      const userId =
        typeof participant === "string"
          ? participant
          : participant.id;

      const numero = userId.split("@")[0];

      await sock.sendMessage(update.id, {
        text: `🎉 *SEJA BEM-VINDO(A)!* 🎉

  @${numero}

  🚨REGRAS!!!🚨
  1- RESPEITAR ADMS E MEMBROS DA GUILDA
  2- PROIBIDO PORNOGRAFIA OU LINKS ILEGAIS
  3- USAR TAG DA GUILDA (3 semanas)
  4- OBRIGATÓRIO JOGAR GUERRA DE GUILDA
  5- MÁXIMO DE 2 DIAS OFF SEM AVISO
  6- PROIBIDO HACKS OU FAKE LEG
  7- PONTUAÇÃO GG 180 (OBRIGATÓRIO)
  8- CONFLITOS RESOLVIDOS SOMENTE COM LIDERANÇA

  🏆 PREMIAÇÕES — GUERRA DE GUILDA 🏆
  🥇 TOP 1 – R$70 (+R$25 se >700 pts) Total: R$95
  🥈 TOP 2 – R$25 (+R$20 se >600 pts) Total: R$45
  🥉 TOP 3 – R$15 (+R$10 se >500 pts) Total: R$25
  🏅 TOP 4 ao 10 – Passe de Elite

  📩 Dúvidas? Chama no direct.
  💸 RESGATE SUA PREMIAÇÃO NA TERÇA-FEIRA 💸`,
        mentions: [userId]
      });

    }

  });

  /* ================= MENSAGENS ================= */
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const from = msg.key.remoteJid;
      const sender = msg.key.participant || msg.key.remoteJid;

      // Só processa mensagens em grupos
      if (!from.endsWith("@g.us")) continue;

      // Desenrolar ephemeralMessage se houver
      let message = msg.message.ephemeralMessage?.message || msg.message;

      // Detectar ViewOnce
      const isViewOnce =
        message?.viewOnceMessage ||
        message?.viewOnceMessageV2 ||
        message?.viewOnceMessageV2Extension;

      if (isViewOnce) {
        try {
          // Envia alerta no grupo mencionando o remetente
          await sock.sendMessage(from, {
            text: `⚠️ @${sender.split("@")[0]} tentou enviar uma mensagem de visualização única!`,
            mentions: [sender]
          });

          console.log(`ViewOnce detectada de ${sender} no grupo ${from}`);

          // Opcional: registrar conteúdo no console (não envia para o grupo)
          const type = Object.keys(message.viewOnceMessage?.message || {})[0];
          const content = message.viewOnceMessage?.message?.[type];
          if (content) console.log("Conteúdo ViewOnce capturado (não enviado):", content);
        } catch (err) {
          console.log("Erro ao enviar alerta ViewOnce:", err);
        }

        continue; // não processa mais nada dessa mensagem
        }

      const ehAdmin = from.endsWith("@g.us")
        ? await isAdmin(from, sender)
        : false;

      registrarMensagem(sender, from);

      const body =
        typeof msg.message?.conversation === "string"
          ? msg.message.conversation
          : typeof msg.message?.extendedTextMessage?.text === "string"
          ? msg.message.extendedTextMessage.text
          : "";

      /* ================= COMANDOS ================= */
      if (body.startsWith(prefix)) {

        const comando = body.slice(1).split(" ")[0].toLowerCase();

        const comandos = [
          { cmd: "ping", desc: "Verifica se o bot está online", admin: false },
          { cmd: "ranking", desc: "Top 10 usuários mais ativos", admin: false },
          { cmd: "menu", desc: "Mostra esta lista de comandos", admin: false },
          { cmd: "marcar", desc: "Marca todos do grupo com sua mensagem", admin: true },
          { cmd: "ban", desc: "Banir usuário marcado", admin: true },
          { cmd: "abrir", desc: "Abrir grupo (permitir mensagens)", admin: true },
          { cmd: "fechar", desc: "Fechar grupo (somente admins podem mandar)", admin: true },
          { cmd: "inativo", desc: "Inativos com + de 24 horas (somente admins podem mandar)", admin: true },
        ];
          // INATIVOS
          if (comando === "inativo") {
            if (!from.endsWith("@g.us"))
              return sock.sendMessage(from, { text: "❌ Apenas em grupos." });

            const metadata = await sock.groupMetadata(from);
            const agora = Date.now();
            const limite24h = 24 * 60 * 60 * 1000; // 24 horas

            const participantesInativos = metadata.participants
              .filter(p => !p.admin) // ignora admins
              .map(p => p.id)
              .filter(id => database[id] && agora - database[id].ultimaMensagem > limite24h);

            if (!participantesInativos.length)
              return sock.sendMessage(from, { text: "✅ - Todos estão ativos nas últimas 24h." });

            let texto = "⏳ Usuários inativos há mais de 24h:\n";
            participantesInativos.forEach((id, i) => {
              const ultimo = new Date(database[id].ultimaMensagem).toLocaleString();
              texto += `${i + 1}° @${id.split("@")[0]} - última mensagem: ${ultimo}\n`;
            });

            await sock.sendMessage(from, {
              text: texto,
              mentions: participantesInativos
            });
          }
        // MENU
        if (comando === "menu") {
          const lista = comandos
            .filter(c => !c.admin || ehAdmin)
            .map(c => `• ${prefix}${c.cmd} → ${c.desc}`)
            .join("\n");

          await sock.sendMessage(from, {
            text: `📋 *Comandos disponíveis:*\n\n${lista}`
          });
        }

        // PING
        if (comando === "ping") {
          await sock.sendMessage(from, { text: "🏓 Pong!" });
        }

        // RANKING
        if (comando === "ranking") {
          if (!from.endsWith("@g.us"))
            return sock.sendMessage(from, { text: "❌ Apenas em grupos." });

          const metadata = await sock.groupMetadata(from);
          const participantesGrupo = metadata.participants.map(p => p.id);

          const ranking = rankingInteracoesGrupo(participantesGrupo);

          if (!ranking.length)
            return sock.sendMessage(from, { text: "Sem dados ainda." });

          let texto = "🏆 Top 10 mais ativos neste grupo:\n";
          ranking.forEach((u, i) => {
            texto += `${i + 1}° @${u[0].split("@")[0]} - ${u[1].interacoes} mensagens\n`;
          });

          await sock.sendMessage(from, {
            text: texto,
            mentions: ranking.map(u => u[0])
          });
        }

        // MARCAR 
        if (body.startsWith(prefix + "marcar")) {
          if (!from.endsWith("@g.us"))
            return sock.sendMessage(from, { text: "❌ Esse comando só funciona em grupos." });

          if (!ehAdmin)
            return sock.sendMessage(from, { text: "🚫 Apenas admins podem usar esse comando." });

          let text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            "";

          if (!text) text = "";

          text = text.replace(new RegExp(`^\\${prefix}marcar\\s*`, "i"), "").trim();

          if (!text)
            return sock.sendMessage(from, {
              text: `Uso: ${prefix}marcar sua mensagem aqui (pode ter várias linhas)`
            });

          const metadata = await sock.groupMetadata(from);
          const participants = metadata.participants
            .map(p => p.id)
            .filter(id => id !== sock.user.id);

          await sock.sendMessage(from, { text, mentions: participants });
        }
        // BAN
        if (comando === "ban") {

          if (!from.endsWith("@g.us"))
            return sock.sendMessage(from, { text: "❌ Apenas em grupos." });

          if (!ehAdmin)
            return sock.sendMessage(from, { text: "🚫 Apenas admins podem usar." });

          const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;

          if (!mentioned || mentioned.length === 0)
            return sock.sendMessage(from, { text: "❌ Marque o usuário para banir." });

          const textoCompleto =
            typeof msg.message?.conversation === "string"
              ? msg.message.conversation
              : typeof msg.message?.extendedTextMessage?.text === "string"
              ? msg.message.extendedTextMessage.text
              : "";

          const partes = textoCompleto.split("-");
          const motivo = partes[1]?.trim() || "Sem motivo informado";

          const userBanido = mentioned[0];

          await sock.groupParticipantsUpdate(from, [userBanido], "remove");

          await sock.sendMessage(from, {
            text: `🚫 Usuário removido\n👤 @${userBanido.split("@")[0]}\n📌 Motivo: ${motivo}`,
            mentions: [userBanido]
          });
        }
        // ABRIR / FECHAR
        if (comando === "abrir" || comando === "fechar") {

          if (!from.endsWith("@g.us"))
            return sock.sendMessage(from, { text: "❌ Esse comando só funciona em grupos." });

          if (!ehAdmin)
            return sock.sendMessage(from, { text: "❌ Apenas admins podem usar este comando." });

          await sock.groupSettingUpdate(
            from,
            comando === "abrir" ? "not_announcement" : "announcement"
          );

          await sock.sendMessage(from, {
            text: comando === "abrir"
              ? "🔓 Grupo aberto!"
              : "🔒 Grupo fechado!"
          });
        }
      }      

      /* ================= REGRAS ================= */
      if (!ehAdmin && from.endsWith("@g.us")) {
        const badWords = [
          "porra",
          "caralho",
          "puta",
          "fdp",
          "merda",
          "vsf"
        ];

        // ANTI-PALAVRÃO
        const textoMsg =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          "";

        const textoLower = textoMsg.toLowerCase();

        const contemPalavrao = badWords.some(p =>
          textoLower.includes(p)
        );

        if (contemPalavrao) {
          await sock.sendMessage(from, {
            delete: {
              remoteJid: from,
              fromMe: false,
              id: msg.key.id,
              participant: sender
            }
          }).catch(() => {});

          await sock.sendMessage(from, {
            text: `⚠️ @${sender.split("@")[0]} evite palavrões no grupo!`,
            mentions: [sender]
          });

          return; // importante pra não continuar processando
        }
        // ANTI-FIGURINHA
        if (msg.message?.stickerMessage) {
          await sock.sendMessage(from, {
            delete: {
              remoteJid: from,
              fromMe: false,
              id: msg.key.id,
              participant: sender
            }
          }).catch(() => {});
        }

        // ANTI-LINK
        const textMsg =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          "";

        const linkRegex = /(https?:\/\/|www\.)[^\s]+/gi;

        if (linkRegex.test(textMsg)) {
          await sock.sendMessage(from, {
            delete: {
              remoteJid: from,
              fromMe: false,
              id: msg.key.id,
              participant: sender
            }
          }).catch(() => {});
        }
      }
    }
  });

  /* ================= ANTI-APAGAR ================= */
  sock.ev.on("messages.update", async (updates) => {
    for (const update of updates) {
      if (update.update?.message === null) {
        const from = update.key.remoteJid;
        const sender = update.key.participant;

        if (sender) {
          await sock.sendMessage(from, {
            text: `🚨 @${sender.split("@")[0]} apagou uma mensagem!`,
            mentions: [sender]
          });
        }
      }
    }
  });

}

startBot();

import TelegramBot from "node-telegram-bot-api";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const bot = new TelegramBot(BOT_TOKEN, { webHook: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ================= HELPERS ================= */

async function isMod(id) {
  const { data } = await supabase.from("mods").select("id").eq("id", id).single();
  return !!data;
}

async function isBlocked(id) {
  const { data } = await supabase.from("blocklist").select("id").eq("id", id).single();
  return !!data;
}

async function isUserAdmin(chatId, userId) {
  try {
    const m = await bot.getChatMember(chatId, userId);
    return m.status === "administrator" || m.status === "creator";
  } catch {
    return false;
  }
}

function gen(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function extractStartapp(val) {
  if (val.includes("startapp=")) {
    return val.split("startapp=")[1];
  }
  return val;
}

/* ================= COMMANDS ================= */

async function cmdStart(msg) {
  if (!(await isMod(msg.from.id))) return;

  await bot.sendMessage(
    msg.chat.id,
`📌 Commands

/final <entity_id | channel_link>

/first <entity_id | channel_link | final | webapp_link> <short_link>

/delete <entity_id | final | first | link>

Admin only`
  );
}

/* ---------- FINAL ---------- */

async function cmdFinal(msg, args) {
  if (!(await isMod(msg.from.id))) return;

  const input = args[0];
  if (!input) {
    return bot.sendMessage(msg.chat.id, "❌ Usage: /final <entity_id | channel_link>");
  }

  const final = gen("final");

  let entity_id = null;
  let direct_link = null;

  if (/^-100/.test(input)) {
    entity_id = Number(input);
    if (!(await isUserAdmin(entity_id, msg.from.id))) {
      return bot.sendMessage(msg.chat.id, "❌ You must be admin in that entity");
    }
  } else {
    direct_link = input;
  }

  await supabase.from("my_links").insert({
    final,
    entity_id,
    direct_link,
    owner_id: msg.from.id,
  });

  const url = `https://t.me/${BOT_USERNAME}/app?startapp=${final}`;
  await bot.sendMessage(msg.chat.id, `✅ Final created\n${url}`);
}

/* ---------- FIRST ---------- */

async function cmdFirst(msg, args) {
  if (!(await isMod(msg.from.id))) return;

  const target = args[0];
  const short_link = args[1];

  if (!target || !short_link) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ Usage: /first <entity | final | link> <short_link>"
    );
  }

  let row = null;

  // Resolve FINAL
  if (target.includes("startapp=") || target.startsWith("final_")) {
    const final = extractStartapp(target);
    const { data } = await supabase.from("my_links").select("*").eq("final", final).single();
    row = data;
  } else if (/^-100/.test(target)) {
    const { data } = await supabase.from("my_links").select("*").eq("entity_id", Number(target)).single();
    row = data;
  } else {
    const { data } = await supabase.from("my_links").select("*").eq("direct_link", target).single();
    row = data;
  }

  if (!row) {
    return bot.sendMessage(msg.chat.id, "❌ Final not found");
  }

  if (row.first) {
    return bot.sendMessage(msg.chat.id, "❌ First already exists");
  }

  const first = gen("first");

  await supabase
    .from("my_links")
    .update({ first, short_link })
    .eq("final", row.final);

  const url = `https://t.me/${BOT_USERNAME}/app?startapp=${first}`;
  await bot.sendMessage(msg.chat.id, `✅ First created\n${url}`);
}

/* ---------- DELETE ---------- */

async function cmdDelete(msg, args) {
  if (!(await isMod(msg.from.id))) return;

  const val = extractStartapp(args[0]);
  if (!val) {
    return bot.sendMessage(msg.chat.id, "❌ Usage: /delete <value>");
  }

  const { error } = await supabase
    .from("my_links")
    .delete()
    .or(
      `entity_id.eq.${val},final.eq.${val},first.eq.${val},direct_link.eq.${val}`
    );

  if (error) {
    return bot.sendMessage(msg.chat.id, "❌ Not found");
  }

  await bot.sendMessage(msg.chat.id, "✅ Deleted");
}

/* ---------- BLOCK / UNBLOCK / LIST ---------- */

async function cmdBlock(msg, args) {
  if (!(await isMod(msg.from.id))) return;
  const userId = Number(args[0]);
  if (!userId) return;

  await supabase.from("blocklist").upsert({ id: userId }, { onConflict: "id" });
  await bot.sendMessage(msg.chat.id, `🚫 Blocked ${userId}`);
}

async function cmdUnblock(msg, args) {
  if (!(await isMod(msg.from.id))) return;
  const userId = Number(args[0]);
  if (!userId) return;

  await supabase.from("blocklist").delete().eq("id", userId);
  await bot.sendMessage(msg.chat.id, `✅ Unblocked ${userId}`);
}

async function cmdBlocklist(msg) {
  if (!(await isMod(msg.from.id))) return;

  const { data } = await supabase.from("blocklist").select("id");
  if (!data.length) return bot.sendMessage(msg.chat.id, "📭 Blocklist empty");

  await bot.sendMessage(msg.chat.id, data.map(x => x.id).join("\n"));
}

/* ================= ROUTER ================= */

async function route(msg) {
  if (!msg.text) return;
  if (await isBlocked(msg.from.id)) return;

  const [cmd, ...args] = msg.text.split(" ");

  switch (cmd) {
    case "/start": return cmdStart(msg);
    case "/final": return cmdFinal(msg, args);
    case "/first": return cmdFirst(msg, args);
    case "/delete": return cmdDelete(msg, args);
    case "/block": return cmdBlock(msg, args);
    case "/unblock": return cmdUnblock(msg, args);
    case "/blocklist": return cmdBlocklist(msg);
  }
}

/* ================= WEBHOOK ================= */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).end();

  try {
    if (req.body.message?.text) await route(req.body.message);
    if (req.body.edited_message?.text) await route(req.body.edited_message);
  } catch (e) {
    console.error("Webhook error:", e);
  }

  res.status(200).end();
}

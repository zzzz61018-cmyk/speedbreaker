import TelegramBot from "node-telegram-bot-api";
import { createClient } from "@supabase/supabase-js";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const bot = new TelegramBot(BOT_TOKEN, { webHook: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ================= HELPERS ================= */

async function isMod(id) {
  const { data } = await supabase
    .from("mods")
    .select("id")
    .eq("id", id)
    .single();
  return !!data;
}

async function isBlocked(id) {
  const { data } = await supabase
    .from("blocklist")
    .select("id")
    .eq("id", id)
    .single();
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
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}
/* ================= COMMANDS ================= */

async function cmdStart(msg) {
  if (!(await isMod(msg.from.id))) return;

  await bot.sendMessage(
    msg.chat.id,
`📌 Commands

/final <entity_id>
/first <entity_id> <link>

/delete <entity_id | final | first | link>

Admin only`
  );
}


/* ---------- ADD ---------- */

async function cmdFinal(msg, args) {
  if (!(await isMod(msg.from.id))) return;

  const entityId = parseInt(args[0]);
  if (!entityId) {
    return bot.sendMessage(msg.chat.id, "❌ Usage: /final <entity_id>");
  }

  if (!(await isUserAdmin(entityId, msg.from.id))) {
    return bot.sendMessage(msg.chat.id, "❌ You must be admin in that entity");
  }

  const final = gen("final");

  await supabase.from("my_links").upsert({
    entity_id: entityId,
    final,
    owner_id: msg.from.id,
  });

  const url = `https://t.me/${BOT_USERNAME}/app?startapp=${final}`;
  await bot.sendMessage(msg.chat.id, `✅ Final created\n${url}`);
}
async function cmdFirst(msg, args) {
  if (!(await isMod(msg.from.id))) return;

  const entityId = parseInt(args[0]);
  const link = args[1];

  if (!entityId || !link) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ Usage: /first <entity_id> <link>"
    );
  }

  if (!(await isUserAdmin(entityId, msg.from.id))) {
    return bot.sendMessage(msg.chat.id, "❌ You must be admin in that entity");
  }

  const { data } = await supabase
    .from("my_links")
    .select("*")
    .eq("entity_id", entityId)
    .single();

  if (!data) {
    return bot.sendMessage(msg.chat.id, "❌ Final not created yet");
  }

  if (data.first) {
    return bot.sendMessage(msg.chat.id, "❌ First already exists");
  }

  const first = gen("first");

  await supabase
    .from("my_links")
    .update({ first, link })
    .eq("entity_id", entityId);

  const url = `https://t.me/${BOT_USERNAME}/app?startapp=${first}`;
  await bot.sendMessage(msg.chat.id, `✅ First created\n${url}`);
}

/* ---------- DELETE ---------- */

async function cmdDelete(msg, args) {
  if (!(await isMod(msg.from.id))) return;

  const val = args[0];
  if (!val) {
    return bot.sendMessage(msg.chat.id, "❌ Usage: /delete <value>");
  }

  const { error } = await supabase
    .from("my_links")
    .delete()
    .or(
      `entity_id.eq.${val},final.eq.${val},first.eq.${val},link.eq.${val}`
    );

  if (error) {
    return bot.sendMessage(msg.chat.id, "❌ Not found");
  }

  await bot.sendMessage(msg.chat.id, "✅ Deleted");
}

/* ---------- BLOCK ---------- */

async function cmdBlock(msg, args) {
  if (!(await isMod(msg.from.id))) return;

  const userId = parseInt(args[0]);
  if (!userId) return;

  await supabase.from("blocklist").upsert(
    { id: userId },
    { onConflict: "id" }
  );

  await bot.sendMessage(msg.chat.id, `🚫 Blocked ${userId}`);
}

/* ---------- UNBLOCK ---------- */

async function cmdUnblock(msg, args) {
  if (!(await isMod(msg.from.id))) return;

  const userId = parseInt(args[0]);
  if (!userId) return;

  await supabase.from("blocklist").delete().eq("id", userId);
  await bot.sendMessage(msg.chat.id, `✅ Unblocked ${userId}`);
}

/* ---------- BLOCKLIST ---------- */

async function cmdBlocklist(msg) {
  if (!(await isMod(msg.from.id))) return;

  const { data } = await supabase.from("blocklist").select("id");

  if (!data.length) {
    return bot.sendMessage(msg.chat.id, "📭 Blocklist empty");
  }

  const list = data.map(u => u.id).join("\n");
  await bot.sendMessage(msg.chat.id, `🚫 *Blocked Users*\n\n${list}`, {
    parse_mode: "Markdown",
  });
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

/* ================== WEBHOOK ================== */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).end();
  }

  const update = req.body;

  try {
    // PRIVATE / GROUP MESSAGES
    if (update.message?.text) {
      await route(update.message); // ✅ THIS WAS MISSING
    }

    // OPTIONAL: allow edited messages
    if (update.edited_message?.text) {
      await route(update.edited_message);
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  res.status(200).end();
}

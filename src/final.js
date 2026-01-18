import crypto from "crypto";
import TelegramBot from "node-telegram-bot-api";
import { createClient } from "@supabase/supabase-js";

const bot = new TelegramBot(process.env.BOT_TOKEN);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ================= VERIFY INIT DATA ================= */

function verifyInitData(initData) {
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get("hash");
  urlParams.delete("hash");
  urlParams.sort();

  let dataCheckString = "";
  for (const [key, value] of urlParams.entries()) {
    dataCheckString += `${key}=${value}\n`;
  }
  dataCheckString = dataCheckString.slice(0, -1);

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  return calculatedHash === hash;
}

/* ================= HELPERS ================= */

function hashIP(ip) {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

async function isBlocked(id) {
  const { data } = await supabase
    .from("blocklist")
    .select("id")
    .eq("id", id)
    .single();
  return !!data;
}

async function isMod(id) {
  const { data } = await supabase
    .from("mods")
    .select("id")
    .eq("id", id)
    .single();
  return !!data;
}

async function addBlock(id) {
  if (await isMod(id)) return;
  await supabase.from("blocklist").upsert({ id });
}

async function createOneTimeInvite(entityId) {
  const expire = Math.floor(Date.now() / 1000) + 300;
  const invite = await bot.createChatInviteLink(entityId, {
    member_limit: 1,
    expire_date: expire,
  });
  return invite.invite_link;
}

/* ================= HANDLER ================= */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).end();

  const { initData } = req.body;
  if (!verifyInitData(initData)) {
    return res.json({ ok: false, error: "Invalid data" });
  }

  const params = new URLSearchParams(initData);
  const startapp = params.get("start_param");
  const chat_type = params.get("chat_type");
  const chat_instance = params.get("chat_instance");
  const userJson = params.get("user");

  if (!userJson || !startapp || !startapp.startsWith("final_")) {
    return res.json({ ok: false, error: "Invalid request" });
  }

  const user = JSON.parse(userJson);
  const userId = user.id;
  console.log(" user ID:", userId," chat type:", chat_type, " chat_instance:", chat_instance);

  if (chat_type !== "sender") {
    return res.json({ ok: false, error: "This is warning,you will be blocked in future for violation" });
  }

  if (await isBlocked(userId)) {
    return res.json({ ok: false, error:"You are blocked contact using below link" });
  }

  /* ================= FETCH FINAL ================= */

  const { data: row } = await supabase
    .from("my_links")
    .select("*")
    .eq("final", startapp)
    .single();

  if (!row) {
    return res.json({ ok: false, error: "Invalid Link" });
  }

  /* ================= DIRECT FINAL ================= */

  if (!row.first) {
    if (row.direct_link) {
      return res.json({ ok: true, link: row.direct_link });
    }

    if (row.entity_id) {
      try {
        const invite = await createOneTimeInvite(row.entity_id);
        return res.json({ ok: true, link: invite });
      } catch {
        return res.json({ ok: false, error: "Bot permission error" });
      }
    }

    return res.json({ ok: false, error: "Invalid final configuration" });
  }

  /* ================= FIRST → FINAL ================= */

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "0.0.0.0";

  const ipHash = hashIP(ip);

  const { data: temp } = await supabase
    .from("temp_access")
    .select("*")
    .eq("ip_hash", ipHash)
    .single();

  if (!temp || temp.startapp !== row.first || temp.user_id !== userId) {
    return res.json({ ok: false, error: "This is warning,you will be blocked in future for violation" });
  }

  // clean temp
  await supabase.from("temp_access").delete().eq("ip_hash", ipHash);

  /* ================= FINAL RESOLUTION ================= */

  if (row.direct_link) {
    return res.json({ ok: true, link: row.direct_link });
  }

  if (row.entity_id) {
    try {
      const invite = await createOneTimeInvite(row.entity_id);
      return res.json({ ok: true, link: invite });
    } catch {
      return res.json({ ok: false, error: "Bot permission error" });
    }
  }

  return res.json({ ok: false, error: "Invalid final configuration" });
}

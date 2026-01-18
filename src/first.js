import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ================= VERIFY ================= */

function verifyTelegram(initData) {
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

function hashIP(ip) {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

/* ================= DB ================= */

async function getShortLinkByFirst(first) {
  const { data } = await supabase
    .from("my_links")
    .select("short_link")
    .eq("first", first)
    .single();

  return data?.short_link;
}

/* ================= HANDLER ================= */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).end();
  }

  const { initData } = req.body;
  if (!verifyTelegram(initData)) {
    return res.status(400).json({ ok: false, error: "Invalid init data" });
  }

  const params = new URLSearchParams(initData);
  const startapp = params.get("start_param");
  const userJson = params.get("user");

  if (!startapp || !userJson) {
    return res.status(400).json({ ok: false, error: "Invalid Telegram data" });
  }

  // Safety: first-only endpoint
  if (!startapp.startsWith("first_")) {
    return res.status(400).json({ ok: false, error: "Invalid startapp" });
  }

  const user = JSON.parse(userJson);
  const userId = user.id;

  // IP (Vercel-safe)
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "0.0.0.0";

  const ipHash = hashIP(ip);

  // Remove old attempt from same IP
  await supabase
    .from("temp_access")
    .delete()
    .eq("ip_hash", ipHash);

  // Store new attempt
  await supabase.from("temp_access").insert({
    ip_hash: ipHash,
    user_id: userId,
    startapp, // this is FIRST
    verified: false,
  });

  // Resolve third-party short link
  const short_link = await getShortLinkByFirst(startapp);

  if (!short_link) {
    return res.status(404).json({
      ok: false,
      error: "Invalid or inactive link",
    });
  }

  // Frontend will redirect
  return res.json({
    ok: true,
    link: short_link,
  });
}

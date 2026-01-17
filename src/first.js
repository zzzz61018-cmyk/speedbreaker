import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
async function getFirstLink(first) {
  const { data } = await supabase
    .from("my_links")
    .select("link")
    .eq("first", first)
    .single();

  return data?.link;
}
/* ================== HANDLER ================== */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { initData } = req.body;

  if (!verifyTelegram(initData)) {
    return res.status(400).json({ error: "Invalid Telegram data" });
  }

  const params = new URLSearchParams(initData);
  const startapp = params.get("start_param");
  const userJson = params.get("user");

  if (!startapp || !userJson) {
    return res.status(400).json({ error: "Invalid Telegram data" });
  }

  // you already enforce this, keeping safety
  if (!startapp.startsWith("first_")) {
    return res.status(400).json({ error: "Invalid startapp" });
  }

  const user = JSON.parse(userJson);
  const userId = user.id;

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "0.0.0.0";

  const ipHash = hashIP(ip);

  // clean previous attempt from same IP
  await supabase
    .from("temp_access")
    .delete()
    .eq("ip_hash", ipHash);

  // store attempt
  await supabase.from("temp_access").insert({
    ip_hash: ipHash,
    user_id: userId,
    startapp,
    verified: false,
  });

  // fetch THIRD-PARTY LINK
  const link = await getFirstLink(startapp);

  if (!link) {
    return res.status(404).json({ error: "Invalid or inactive link" });
  }

  // ONLY return external link
  return res.json({
    status: "ok",
    link,
  });
}
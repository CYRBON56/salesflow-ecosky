// api/sms-devis-click.js
// Envoie un SMS à Cyrille dès qu'un visiteur clique sur un bouton "Demander
// mon devis" sur le site vitrine (ecosky.fr) — avant même qu'il ait rempli
// le formulaire d'estimation. Signal précoce, indépendant de la provenance
// pub/organique.

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_TO_NUMBER = process.env.TWILIO_TO_NUMBER;

function getGeoFromRequest(req) {
  const h = req.headers || {};
  return {
    country: h["x-vercel-ip-country"] || null,
    region: h["x-vercel-ip-region"] || null,
    city: h["x-vercel-ip-city"] ? decodeURIComponent(h["x-vercel-ip-city"]) : null,
  };
}

async function sendSms(to, body) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !to) return false;
  try {
    const params = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) console.error("Twilio SMS error (sms-devis-click):", await res.text());
    return res.ok;
  } catch (err) {
    console.error("sendSms (sms-devis-click) error:", err.message);
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { page } = req.body || {};
    const geo = getGeoFromRequest(req);
    const localisation = [geo.city, geo.region, geo.country].filter(Boolean).join(", ");

    const message =
      `🖊️ Un visiteur a cliqué sur "Demander mon devis" (site vitrine) !\n` +
      (localisation ? `Provenance: ${localisation}\n` : "") +
      (page ? `Page: ${page}` : "");

    const sent = await sendSms(TWILIO_TO_NUMBER, message);
    return res.status(200).json({ sent });
  } catch (err) {
    console.error("sms-devis-click error:", err.message);
    return res.status(200).json({ sent: false });
  }
}

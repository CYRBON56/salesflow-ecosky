// api/sms-catalogue-download.js
// SMS "téléchargement catalogue" DÉSACTIVÉ (demande Cyrille, 19/08/2026) —
// trop de faux positifs / pas assez qualifiant. L'endpoint reste en place et
// répond normalement pour ne pas casser le bouton côté front, mais n'envoie
// plus de SMS ni ne log dans _sms-log. Pour réactiver : décommenter le bloc
// ci-dessous.
import { logSms } from "./_sms-log.js";
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
    if (!res.ok) console.error("Twilio SMS error (sms-catalogue-download):", await res.text());
    return res.ok;
  } catch (err) {
    console.error("sendSms (sms-catalogue-download) error:", err.message);
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
    // SMS désactivé — l'endpoint répond simplement "sent: false" sans rien
    // envoyer ni logger, pour que le bouton catalogue côté front continue de
    // fonctionner sans erreur.
    return res.status(200).json({ sent: false });

    /* --- Bloc original, à décommenter pour réactiver le SMS ---
    const { utm_campaign, source } = req.body || {};
    const geo = getGeoFromRequest(req);
    const localisation = [geo.city, geo.region, geo.country].filter(Boolean).join(", ");
    const message =
      `📄 Un visiteur a téléchargé le catalogue !\n` +
      (source ? `Source: ${source}\n` : "") +
      (utm_campaign ? `Campagne: ${utm_campaign}\n` : "") +
      (localisation ? `Provenance: ${localisation}` : "");
    const sent = await sendSms(TWILIO_TO_NUMBER, message);
    await logSms({
      sms_type: "catalogue_telecharge",
      destinataire: TWILIO_TO_NUMBER,
      source,
      utm_campaign,
      geo_city: geo.city,
      geo_region: geo.region,
      geo_country: geo.country,
      message_body: message,
      twilio_success: sent,
    });
    return res.status(200).json({ sent });
    --- fin du bloc original --- */
  } catch (err) {
    console.error("sms-catalogue-download error:", err.message);
    return res.status(200).json({ sent: false });
  }
}

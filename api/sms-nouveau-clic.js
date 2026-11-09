// api/sms-nouveau-clic.js
// Envoie un SMS immédiat à Cyrille dès qu'un visiteur arrive sur la page
// du formulaire en venant d'une publicité Meta (fbclid) ou Google Ads (gclid).
// Ne remplace pas les autres SMS (devis complété, rappel demandé) — c'est
// un signal précoce en plus, avant même que le visiteur remplisse quoi que ce soit.
//
// Structure calquée sur api/request-callback.js (qui fonctionne) pour
// éviter toute différence subtile dans l'appel Twilio.

import { logSms } from "./_sms-log.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_TO_NUMBER = process.env.TWILIO_TO_NUMBER;

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
    if (!res.ok) console.error("Twilio SMS error (sms-nouveau-clic):", await res.text());
    return res.ok;
  } catch (err) {
    console.error("sendSms (sms-nouveau-clic) error:", err.message);
    return false;
  }
}

// Détecte si ce visiteur (même session_id) était déjà venu via une pub
// précédemment, en comparant sur fbclid OU gclid selon la source actuelle.
async function checkVisitorAlreadySeen(sessionId, currentClickId) {
  if (!sessionId || !currentClickId || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) return false;
  try {
    const filter = `or=(fbclid.neq.${encodeURIComponent(currentClickId)},gclid.neq.${encodeURIComponent(currentClickId)})`;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/web_clicks?session_id=eq.${encodeURIComponent(sessionId)}&${filter}&select=id&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.error("checkVisitorAlreadySeen error:", err.message);
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
    const { fbclid, gclid, utm_source, utm_campaign, page, session_id } = req.body || {};

    if (!fbclid && !gclid) {
      return res.status(200).json({ skipped: true, reason: "no fbclid or gclid" });
    }

    const source = gclid && !fbclid ? "Google Ads" : "Meta";
    const clickId = fbclid || gclid;

    const city = req.headers["x-vercel-ip-city"]
      ? decodeURIComponent(req.headers["x-vercel-ip-city"])
      : null;
    const region = req.headers["x-vercel-ip-country-region"] || null;
    const country = req.headers["x-vercel-ip-country"] || null;
    const locationParts = [city, region, country].filter(Boolean);
    const locationStr = locationParts.length > 0 ? locationParts.join(", ") : "localisation inconnue";

    const alreadySeen = await checkVisitorAlreadySeen(session_id, clickId);
    const visitorStatus = alreadySeen ? "🔁 Déjà venu(e) via une pub précédemment" : "🆕 Nouveau visiteur";

    const message =
      `🔔 Nouveau clic pub EcoSky (${source}) !\n` +
      `${visitorStatus}\n` +
      `📍 ${locationStr}\n` +
      `Pub${utm_campaign ? ` : ${utm_campaign}` : ""}\n` +
      `Page : ${page || "estimation.html"}`;

    const sent = await sendSms(TWILIO_TO_NUMBER, message);
    await logSms({
      sms_type: "nouveau_clic",
      destinataire: TWILIO_TO_NUMBER,
      source,
      utm_campaign,
      geo_city: city,
      geo_region: region,
      geo_country: country,
      message_body: message,
      twilio_success: sent,
    });

    return res.status(200).json({ sent });
  } catch (err) {
    console.error("sms-nouveau-clic error:", err.message);
    return res.status(200).json({ sent: false, error: err.message });
  }
}

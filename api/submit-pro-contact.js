// api/submit-pro-contact.js
// Enregistre une demande de contact venant de la page Espace Pro
// (public/espace-pro.html) et notifie Cyrille par SMS.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TWILIO_TO_NUMBER = process.env.TWILIO_TO_NUMBER;

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=minimal",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function sendSms(body) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !TWILIO_TO_NUMBER) {
    console.error("submit-pro-contact SMS skipped: variables Twilio manquantes");
    return;
  }
  const params = new URLSearchParams({
    To: TWILIO_TO_NUMBER,
    From: TWILIO_FROM_NUMBER,
    Body: body,
  });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  );
  if (!res.ok) {
    console.error("Twilio error (submit-pro-contact):", await res.text());
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const {
      entreprise,
      contact_nom,
      telephone,
      email,
      type_pro,
      modele_interesse,
      secteur,
      message,
    } = req.body || {};

    await supabaseRequest("leads_pro", {
      method: "POST",
      body: JSON.stringify({
        entreprise: entreprise || null,
        contact_nom: contact_nom || null,
        telephone: telephone || null,
        email: email || null,
        type_pro: type_pro || null,
        modele_interesse: modele_interesse || null,
        secteur: secteur || null,
        message: message || null,
      }),
    });

    const smsBody =
      `🤝 Nouveau contact Espace Pro !\n` +
      `${entreprise || "?"} (${type_pro || "?"})\n` +
      `Contact : ${contact_nom || "?"} — ${telephone || "?"}\n` +
      `Modèle : ${modele_interesse || "?"}` +
      (secteur ? `\nSecteur : ${secteur}` : "");

    try {
      await sendSms(smsBody);
    } catch (smsErr) {
      console.error("submit-pro-contact SMS error:", smsErr.message);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("submit-pro-contact error:", err.message);
    return res.status(200).json({ success: false });
  }
}

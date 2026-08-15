// api/submit-details-projet.js
// Reçoit nom/prénom/adresse exacte + photos (facultatives, déjà compressées
// côté navigateur en base64) depuis public/details-projet.html — le
// formulaire léger envoyé par SMS après l'appel téléphonique de RDV. Met à
// jour le lead correspondant et prévient RMS EcoSky par SMS.

import { logSms } from "./_sms-log.js";

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

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
    if (!res.ok) console.error("Twilio SMS error (submit-details-projet):", await res.text());
    return res.ok;
  } catch (err) {
    console.error("sendSms (submit-details-projet) error:", err.message);
    return false;
  }
}

async function uploadPhoto(dataUrl, leadId, index) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Format de photo invalide");
  const [, mimeType, base64Data] = match;
  const ext = mimeType.split("/")[1] || "jpg";
  const filename = `${leadId}/${Date.now()}-${index}.${ext}`;
  const bytes = Buffer.from(base64Data, "base64");

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/media/projets/${filename}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": mimeType,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Supabase storage upload error ${res.status}: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/media/projets/${filename}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { lead_id, nom, prenom, adresse, photos } = req.body || {};
    if (!lead_id) return res.status(400).json({ success: false, error: "lead_id requis" });
    if (!nom || !adresse) {
      return res.status(400).json({ success: false, error: "Nom et adresse requis" });
    }

    const photoList = Array.isArray(photos) ? photos.slice(0, 6) : [];
    const photoUrls = [];
    for (let i = 0; i < photoList.length; i++) {
      try {
        const url = await uploadPhoto(photoList[i], lead_id, i);
        photoUrls.push(url);
      } catch (photoErr) {
        console.error("Erreur upload photo:", photoErr.message);
        // On continue avec les autres photos plutôt que de tout bloquer
      }
    }

    const updatePayload = {
      nom,
      prenom: prenom || null,
      adresse_projet: adresse,
    };
    if (photoUrls.length > 0) updatePayload.photos_projet = photoUrls;

    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead_id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(updatePayload),
    });
    if (!r.ok) throw new Error(`Supabase error ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: "Lead introuvable" });
    }
    const lead = rows[0];

    const nomComplet = [prenom, nom].filter(Boolean).join(" ");
    const ownerMessage =
      `📋 Dossier complété par ${nomComplet}\n` +
      `Adresse : ${adresse}\n` +
      (photoUrls.length > 0
        ? `${photoUrls.length} photo(s) :\n${photoUrls.join("\n")}`
        : "Pas de photo envoyée.");
    const sent = await sendSms(TWILIO_TO_NUMBER, ownerMessage);

    await logSms({
      sms_type: "details_projet_completes",
      destinataire: TWILIO_TO_NUMBER,
      source: nomComplet,
      message_body: ownerMessage,
      twilio_success: sent,
    });

    return res.status(200).json({ success: true, lead_id: lead.id, photos: photoUrls });
  } catch (err) {
    console.error("submit-details-projet error:", err.message);
    return res.status(500).json({ success: false, error: "Erreur technique, merci de réessayer." });
  }
}

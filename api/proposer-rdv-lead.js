// api/proposer-rdv-lead.js
// Envoie un SMS, dans les 24h suivant un formulaire complété, proposant un
// rendez-vous téléphonique et renvoyant directement vers l'écran de prise
// de rendez-vous (estimation.html?lead_id=X&rdv=1), sans repasser par le
// formulaire. Déclenché manuellement depuis /sms-recus.html.

import { logSms } from "./_sms-log.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

async function sendSms(to, body) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !to) return false;
  const params = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) console.error("Twilio SMS error (proposer-rdv-lead):", await res.text());
  return res.ok;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { lead_id } = req.body || {};
    if (!lead_id) return res.status(400).json({ ok: false, error: "lead_id requis" });

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${lead_id}&select=id,nom,telephone`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!r.ok) throw new Error(`Supabase error ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    const lead = rows[0];
    if (!lead) return res.status(404).json({ ok: false, error: "Lead introuvable" });
    if (!lead.telephone) return res.status(400).json({ ok: false, error: "Ce lead n'a pas de téléphone" });

    const nom = lead.nom || "";
    const lien = `https://salesflow-ecosky.vercel.app/estimation.html?lead_id=${lead.id}&rdv=1`;

    const message =
      `Bonjour Mme ou M. ${nom}, RMS EcoSky ici 👋 Merci pour votre demande d'estimation ! ` +
      `On aimerait vous appeler pour affiner ça ensemble et répondre à vos questions. ` +
      `Choisissez le créneau qui vous arrange, ça prend 30 secondes : ${lien}`;

    const sent = await sendSms(lead.telephone, message);

    await logSms({
      sms_type: "proposition_rdv",
      destinataire: lead.telephone,
      source: nom,
      message_body: message,
      twilio_success: sent,
    });

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error("proposer-rdv-lead error:", err.message);
    return res.status(500).json({ ok: false, error: "Erreur lors de l'envoi" });
  }
}

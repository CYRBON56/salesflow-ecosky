// api/renvoyer-sms-lead.js
// Envoie un SMS de relance à un lead dont le formulaire d'estimation est
// incomplet, avec un lien pour reprendre là où il s'était arrêté
// (préremplit nom/téléphone via lead_id). Déclenché manuellement depuis le
// bouton "Renvoyer SMS" de la page /sms-recus.html (onglet Demandes
// d'estimation).

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
  if (!res.ok) console.error("Twilio SMS error (renvoyer-sms-lead):", await res.text());
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
      `${SUPABASE_URL}/rest/v1/leads?id=eq.${lead_id}&select=id,nom,prenom,telephone,email,code_postal,adresse_projet`,
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
    const lien = `https://salesflow-ecosky.vercel.app/estimation.html?lead_id=${lead.id}`;
    const manqueEmail = !lead.email;
    const manqueCodePostal = !lead.code_postal && !lead.adresse_projet;

    let manques = [];
    if (manqueCodePostal) manques.push("le code postal et la ville");
    if (manqueEmail) manques.push("l'adresse email");

    let raison = "";
    if (manqueCodePostal && manqueEmail) {
      raison =
        `Il nous manque ${manques[0]} et ${manques[1]} pour finaliser votre dossier : ` +
        `le code postal et la ville nous servent à vérifier qu'on intervient bien dans votre secteur, ` +
        `et l'email nous permet de vous envoyer votre estimation en PDF.`;
    } else if (manqueCodePostal) {
      raison =
        `Il nous manque ${manques[0]} : ça nous permet de vérifier qu'on intervient bien dans votre secteur ` +
        `avant de finaliser votre devis.`;
    } else if (manqueEmail) {
      raison = `Il nous manque ${manques[0]} pour pouvoir vous envoyer votre estimation en PDF.`;
    } else {
      raison = `Votre dossier est presque complet, il ne reste que quelques infos à valider.`;
    }

    const message =
      `Bonjour Mme ou M. ${nom}, RMS EcoSky ici 👋 Pas de souci si le formulaire vous a semblé long, ` +
      `beaucoup de monde s'arrête en cours de route ! ${raison} ` +
      `Vous pouvez reprendre exactement où vous en étiez, en 30 secondes, ici : ${lien}`;

    const sent = await sendSms(lead.telephone, message);

    await logSms({
      sms_type: "relance_formulaire_incomplet",
      destinataire: lead.telephone,
      source: [lead.prenom, lead.nom].filter(Boolean).join(" "),
      message_body: message,
      twilio_success: sent,
    });

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error("renvoyer-sms-lead error:", err.message);
    return res.status(500).json({ ok: false, error: "Erreur lors de l'envoi" });
  }
}

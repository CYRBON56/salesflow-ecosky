// api/ingest-lead.js
// Porte d'entrée unique pour faire arriver dans SalesFlow (table leads) une
// demande venant d'un AUTRE site/formulaire (ex. skyeco.fr/devis-portails.html,
// hébergé sur le projet Vercel PUB-SKYECO). Protégé par SYNC_SECRET.
//
// POST JSON : { key, nom, prenom, telephone, email, code_postal, adresse_projet,
//   type_projet, canal ("Meta" | "Google Ads" | "Site"), click_id, utm_campaign,
//   source (texte libre, ex. "Formulaire portails skyeco.fr"), notes,
//   estimation_texte, notifier (true = SMS à Cyrille) }

import { logSms } from "./_sms-log.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SYNC_SECRET = process.env.SYNC_SECRET;

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

function toE164(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("33")) return "+" + d;
  if (d.startsWith("0")) return "+33" + d.slice(1);
  return "+" + d;
}

async function smsCyrille(body) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM_NUMBER: from, TWILIO_TO_NUMBER: to } = process.env;
  if (!sid || !tok || !from || !to) return false;
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const b = req.body || {};
  if (!SYNC_SECRET || b.key !== SYNC_SECRET) return res.status(401).json({ ok: false, error: "clé invalide" });
  if (!b.nom && !b.telephone && !b.email) return res.status(400).json({ ok: false, error: "nom, téléphone ou email requis" });

  try {
    const tel = toE164(b.telephone);
    const canal = b.canal || "Site";
    const payload = {
      nom: b.nom || "Prospect",
      prenom: b.prenom || null,
      email: b.email || null,
      code_postal: b.code_postal || null,
      adresse_projet: b.adresse_projet || null,
      type_projet: b.type_projet || null,
      source: b.source || "Formulaire externe",
      notes: b.notes || "",
      estimation_texte: b.estimation_texte || null,
      formulaire_complete: true,
    };

    let existant = null;
    if (tel) {
      const r = await sb(`leads?telephone=eq.${encodeURIComponent(tel)}&select=id,canal`);
      existant = r && r[0];
    }
    if (canal !== "Site" || !(existant && existant.canal)) {
      Object.assign(payload, { canal, click_id: b.click_id || null, utm_campaign: b.utm_campaign || null });
    }

    let lead;
    if (existant) {
      lead = await sb(`leads?id=eq.${existant.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      lead = await sb("leads", { method: "POST", body: JSON.stringify({ ...payload, telephone: tel, statut: "nouveau" }) });
    }

    if (b.notifier) {
      const msg = `🔔 Nouvelle demande ${canal} (${payload.source})\n${[b.prenom, b.nom].filter(Boolean).join(" ")}\n${b.telephone || ""}\nVoir : salesflow-ecosky.vercel.app/sms-recus.html`;
      const ok = await smsCyrille(msg);
      await logSms({ sms_type: "nouvelle_demande_externe", destinataire: process.env.TWILIO_TO_NUMBER, source: canal, utm_campaign: b.utm_campaign || null, message_body: msg, twilio_success: ok });
    }
    return res.status(200).json({ ok: true, lead_id: lead?.[0]?.id || null });
  } catch (e) {
    console.error("ingest-lead:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

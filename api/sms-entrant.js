// api/sms-entrant.js (25/11/2026)
// Webhook Twilio « A message comes in » du numéro SMS du système.
// Quand un client répond à un de nos SMS (photos + adresse + catalogue…) :
//   1. la réponse est enregistrée (table sms_entrants) et sur la fiche du
//      client (leads.reponses_sms, badge « 💬 a répondu » dans Skyeco Admin) ;
//   2. Cyrille reçoit une notification par SMS sur son portable ;
//   3. si le client envoie une photo par MMS, on lui renvoie le lien photos.
import crypto from "crypto";
import { sendSms } from "./_sms.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_TO_NUMBER = process.env.TWILIO_TO_NUMBER; // portable de Cyrille
const URL_WEBHOOK = "https://salesflow-ecosky.vercel.app/api/sms-entrant";
const BASE_URL = "https://salesflow-ecosky.vercel.app";

async function sb(path, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json", Prefer: options.prefer || "return=representation",
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// Vérifie que l'appel vient bien de Twilio (signature HMAC-SHA1)
function signatureValide(req, params) {
  const sig = req.headers["x-twilio-signature"];
  if (!sig || !TWILIO_AUTH_TOKEN) return false;
  const data = URL_WEBHOOK + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const attendu = crypto.createHmac("sha1", TWILIO_AUTH_TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(attendu)); } catch { return false; }
}

const xml = (res, inner = "") => {
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function lisible(tel) {
  const d = String(tel || "").replace(/\D/g, "");
  if (d.startsWith("33") && d.length === 11) return ("0" + d.slice(2)).replace(/(\d{2})(?=\d)/g, "$1 ");
  return tel;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("POST uniquement");
  const p = typeof req.body === "string" ? Object.fromEntries(new URLSearchParams(req.body)) : req.body || {};
  if (!signatureValide(req, p)) return res.status(403).send("signature invalide");

  const de = p.From || "";
  const message = (p.Body || "").trim();
  const nbMedias = parseInt(p.NumMedia || "0", 10) || 0;
  const fin = de.replace(/\D/g, "").slice(-9);

  // Les réponses de Cyrille lui-même ne sont pas traitées
  if (TWILIO_TO_NUMBER && fin && TWILIO_TO_NUMBER.replace(/\D/g, "").endsWith(fin)) return xml(res);

  let lead = null;
  try {
    if (fin.length === 9) {
      const r = await sb(`leads?telephone=ilike.*${fin}&select=id,nom,prenom,reponses_sms&order=created_at.desc&limit=1`);
      lead = r && r[0];
    }
    await sb("sms_entrants", {
      method: "POST", prefer: "return=minimal",
      body: JSON.stringify({ de, message, nb_medias: nbMedias, lead_id: lead ? lead.id : null, twilio_sid: p.MessageSid || null }),
    });
    if (lead) {
      const hist = Array.isArray(lead.reponses_sms) ? lead.reponses_sms : [];
      hist.push({ le: new Date().toISOString(), message: message || (nbMedias ? `(${nbMedias} photo(s) par MMS)` : "") });
      await sb(`leads?id=eq.${lead.id}`, {
        method: "PATCH", prefer: "return=minimal",
        body: JSON.stringify({ reponses_sms: hist.slice(-30), derniere_reponse_sms_at: new Date().toISOString() }),
      });
    }
  } catch (e) {
    console.error("sms-entrant (enregistrement):", e.message);
  }

  // Notification à Cyrille
  try {
    const qui = lead ? `${lead.prenom || ""} ${lead.nom || ""}`.trim() : "Inconnu";
    const txt = message ? message.slice(0, 300) : nbMedias ? `(a envoyé ${nbMedias} photo(s) par MMS)` : "(message vide)";
    await sendSms(TWILIO_TO_NUMBER, `💬 Réponse SMS de ${qui} (${lisible(de)}) :\n${txt}\nVoir : ${BASE_URL}/mobile`);
  } catch (e) {
    console.error("sms-entrant (notification):", e.message);
  }

  // MMS : on renvoie le lien pour déposer les photos
  if (nbMedias > 0 && lead) {
    return xml(res, `<Message>${esc(`Merci ! Les photos envoyées par SMS ne nous parviennent pas toujours. Merci de les déposer ici (avec l'adresse du chantier) : ${BASE_URL}/photos.html?lead_id=${lead.id} - EcoSky by RMS`)}</Message>`);
  }
  return xml(res);
}

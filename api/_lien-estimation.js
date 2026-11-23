// api/_lien-estimation.js
// Envoi, à un prospect venu d'un formulaire Meta, d'un SMS + d'un email
// contenant son lien personnel vers le bon formulaire d'estimation
// (résine → estimation.html, portails → skyeco.fr/devis-portails.html).
// Le lien passe par /api/l?i=<id> : on sait ainsi s'il a cliqué.
// Les statuts (SMS livré, email ouvert…) sont rafraîchis par
// rafraichirStatutsLiens(), appelé à chaque passage de sync-meta-leads.

import { LOGO_ECOSKY_BASE64 } from "./_logo-ecosky-base64.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
const { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOK, TWILIO_FROM_NUMBER: FROM } = process.env;

const BASE = "https://salesflow-ecosky.vercel.app";

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

const twilioAuth = () => "Basic " + Buffer.from(`${SID}:${TOK}`).toString("base64");

export function estPortail(lead) {
  return lead.type_projet === "portail";
}

export function textes(lead) {
  const prenom = lead.prenom ? ` ${lead.prenom}` : "";
  const lien = `${BASE}/api/l?i=${lead.id}`;
  if (estPortail(lead)) {
    return {
      lien,
      sms: `Bonjour${prenom}, merci pour votre demande de portail Portal Echo via Facebook. Obtenez votre prix exact (pose incluse) en 2 minutes, sans engagement : ${lien}\nCyrille - EcoSky by RMS - 06 45 68 83 94`,
      sujet: "Votre estimation de portail Portal Echo",
      intro: "Merci pour votre demande de portail sur Facebook. Pour vous donner un prix exact, il nous manque quelques détails : modèle, dimensions précises et options.",
      bouton: "Obtenir mon prix de portail",
    };
  }
  return {
    lien,
    sms: `Bonjour${prenom}, merci pour votre demande résine EcoSky'Gum via Facebook. Recevez votre estimation détaillée en 2 minutes, sans engagement : ${lien}\nCyrille - EcoSky by RMS - 06 45 68 83 94`,
    sujet: "Votre estimation résine EcoSky'Gum",
    intro: "Merci pour votre demande de revêtement résine sur Facebook. Pour vous envoyer une estimation chiffrée, il nous manque quelques détails : surface exacte, état du support et couleur souhaitée.",
    bouton: "Recevoir mon estimation",
  };
}

function htmlEmail(lead, t) {
  const prenom = lead.prenom ? ` ${lead.prenom}` : "";
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#14312a;font-size:15px;line-height:1.5">
    <p>Bonjour${prenom},</p>
    <p>${t.intro}</p>
    <p>Cela prend 2 minutes, et vous recevez aussitôt votre estimation par mail, sans engagement.</p>
    <p style="text-align:center;margin:28px 0">
      <a href="${t.lien}" style="background:#1e6f4c;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold">${t.bouton}</a>
    </p>
    <p>Vous préférez en parler de vive voix ? Appelez-moi au 06 45 68 83 94.</p>
    <table cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #e2e0d5;padding-top:14px">
      <tr>
        <td style="padding-right:14px;vertical-align:top"><img src="cid:logo-ecosky" alt="EcoSky by RMS" width="90" style="display:block"></td>
        <td style="font-size:13px;color:#14312a;vertical-align:top">
          <strong>Cyrille Bon</strong><br>Dirigeant – EcoSky by RMS<br>
          06 45 68 83 94 · <a href="mailto:infos@ecosky.fr" style="color:#1e6f4c">infos@ecosky.fr</a><br>
          <a href="https://www.ecoskybyrms.fr" style="color:#1e6f4c">www.ecoskybyrms.fr</a><br>
          23 route de Corn er Hoet, 56400 Brech
        </td>
      </tr>
    </table>
  </div>`;
}

// Envoie SMS + email et enregistre la trace dans le lead. Retourne un résumé.
export async function envoyerLien(lead) {
  const t = textes(lead);
  const maj = { lien_envoye_at: new Date().toISOString() };

  if (lead.telephone && SID && TOK && FROM) {
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
        method: "POST",
        headers: { Authorization: twilioAuth(), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: lead.telephone, From: FROM, Body: t.sms }).toString(),
      });
      const d = await r.json();
      maj.lien_sms_sid = d.sid || null;
      maj.lien_sms_statut = r.ok ? d.status || "envoyé" : `échec : ${d.message || r.status}`;
    } catch (e) {
      maj.lien_sms_statut = `échec : ${e.message}`;
    }
  } else maj.lien_sms_statut = "pas de téléphone";

  if (lead.email && RESEND_API_KEY) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: RESEND_FROM_EMAIL,
          to: [lead.email],
          reply_to: "infos@ecosky.fr",
          subject: t.sujet,
          html: htmlEmail(lead, t),
          attachments: [{ filename: "logo-ecosky.jpg", content: LOGO_ECOSKY_BASE64, content_id: "logo-ecosky" }],
        }),
      });
      const d = await r.json();
      maj.lien_email_id = d.id || null;
      maj.lien_email_statut = r.ok ? "envoyé" : `échec : ${d.message || r.status}`;
    } catch (e) {
      maj.lien_email_statut = `échec : ${e.message}`;
    }
  } else maj.lien_email_statut = "pas d'email";

  await sb(`leads?id=eq.${lead.id}`, { method: "PATCH", body: JSON.stringify(maj) });
  return { id: lead.id, nom: `${lead.prenom || ""} ${lead.nom || ""}`.trim(), sms: maj.lien_sms_statut, email: maj.lien_email_statut };
}

// Traduit les statuts Twilio / Resend en français simple
const FR_SMS = { queued: "en file", accepted: "en file", sending: "en cours", sent: "envoyé", delivered: "reçu ✅", undelivered: "non reçu ❌", failed: "échec ❌" };
const FR_MAIL = { sent: "envoyé", delivered: "reçu ✅", opened: "ouvert 👀", clicked: "cliqué 👆", bounced: "adresse invalide ❌", complained: "signalé spam ❌", delivery_delayed: "retardé" };

export async function rafraichirStatutsLiens() {
  const depuis = new Date(Date.now() - 3 * 86400000).toISOString();
  const leads = await sb(`leads?lien_envoye_at=gte.${depuis}&select=id,lien_sms_sid,lien_email_id`);
  for (const l of leads || []) {
    const maj = {};
    if (l.lien_sms_sid && SID && TOK) {
      try {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages/${l.lien_sms_sid}.json`, { headers: { Authorization: twilioAuth() } });
        const d = await r.json();
        if (d.status) maj.lien_sms_statut = FR_SMS[d.status] || d.status;
      } catch (e) {}
    }
    if (l.lien_email_id && RESEND_API_KEY) {
      try {
        const r = await fetch(`https://api.resend.com/emails/${l.lien_email_id}`, { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } });
        const d = await r.json();
        if (d.last_event) maj.lien_email_statut = FR_MAIL[d.last_event] || d.last_event;
      } catch (e) {}
    }
    if (Object.keys(maj).length) await sb(`leads?id=eq.${l.id}`, { method: "PATCH", body: JSON.stringify(maj) });
  }
}

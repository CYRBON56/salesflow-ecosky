// Endpoint exécuté automatiquement une fois par jour (via Vercel Cron, voir vercel.json).
// Parcourt les conversations WhatsApp et envoie une relance "projet toujours d'actualité ?"
// à 24h, 3 jours puis 7 jours si le lead n'a plus donné signe de vie depuis le début
// de la conversation. Une seule relance par palier, jamais plus de 3 au total.
//
// Envoie AUSSI (par SMS) une relance aux visiteurs qui ont commencé le formulaire
// d'estimation détaillée (donné leur téléphone) mais ne l'ont jamais terminé.

import { logSms } from "./_sms-log.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const CRON_SECRET = process.env.CRON_SECRET; // optionnel, pour sécuriser l'accès
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

const ESTIMATION_FORM_URL = "https://salesflow-ecosky.vercel.app/estimation.html";

const TEMPLATE_NAME = "relance_projet";
const TEMPLATE_LANGUAGE = "fr";

const STAGES = [
  { key: "24h", hoursSince: 24, next: "3j" },
  { key: "3j", hoursSince: 72, next: "7j" },
  { key: "7j", hoursSince: 168, next: null },
];

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
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

async function sendRelanceTemplate(to, firstName) {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: TEMPLATE_NAME,
          language: { code: TEMPLATE_LANGUAGE },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: firstName }],
            },
          ],
        },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`WhatsApp relance send error: ${JSON.stringify(data)}`);
  }
  return data;
}

function hoursSince(dateStr) {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return (now - then) / (1000 * 60 * 60);
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
    if (!res.ok) console.error("Twilio SMS error (relance estimation):", await res.text());
    return res.ok;
  } catch (err) {
    console.error("sendSms (relance estimation) error:", err.message);
    return false;
  }
}

// Relance les formulaires d'estimation commencés (téléphone donné) mais jamais
// terminés, entre 2h et 7 jours après le début (au-delà, on considère que ça
// ne sert plus à grand-chose de relancer).
async function relancerFormulairesAbandonnes() {
  const results = [];
  try {
    const leads = await supabaseRequest(
      "leads?formulaire_complete=eq.false&relance_estimation_envoyee=eq.false&source=eq.Formulaire%20estimation%20d%C3%A9taill%C3%A9e&select=id,nom,prenom,telephone,created_at"
    );

    for (const lead of leads || []) {
      const elapsed = hoursSince(lead.created_at);
      if (elapsed < 2 || elapsed > 168) continue; // entre 2h et 7 jours seulement

      const firstName = lead.prenom || (lead.nom || "").split(" ")[0] || "";
      const message = `Bonjour ${firstName}, vous avez commencé une demande d'estimation sur RMS ECOSKY sans la terminer. Ça ne prend que 2 minutes de plus : ${ESTIMATION_FORM_URL} 🎁 N'oubliez pas la remise en cours jusqu'à -15% !`;

      const sent = await sendSms(lead.telephone, message);
      if (sent) {
        await supabaseRequest(`leads?id=eq.${lead.id}`, {
          method: "PATCH",
          body: JSON.stringify({ relance_estimation_envoyee: true }),
          prefer: "return=minimal",
        });
      }
      results.push({ telephone: lead.telephone, success: sent });
    }
  } catch (err) {
    console.error("relancerFormulairesAbandonnes error:", err.message);
  }
  return results;
}

// Propose un rendez-vous téléphonique par SMS aux leads dont le formulaire
// est complet depuis environ 24h (une seule fois, jamais renvoyé ensuite).
async function proposerRdvFormulairesComplets() {
  const results = [];
  try {
    const leads = await supabaseRequest(
      "leads?formulaire_complete=eq.true&rdv_sms_envoye=eq.false&select=id,nom,telephone,code_postal,adresse_projet,created_at"
    );

    for (const lead of leads || []) {
      if (!lead.telephone) continue;
      const elapsed = hoursSince(lead.created_at);
      if (elapsed < 20 || elapsed > 72) continue; // fenêtre ~24h (marge pour le cron quotidien)

      const nom = lead.nom || "";
      const lieu = [lead.adresse_projet, lead.code_postal].filter(Boolean).join(", ");
      const lien = `https://salesflow-ecosky.vercel.app/estimation.html?lead_id=${lead.id}&rdv=1`;
      const message =
        `Bonjour Mme ou M. ${nom}, ici RMS EcoSky, spécialiste des sols souples en résine EPDM 👋 ` +
        `Vous nous avez contactés pour une estimation de sol souple` +
        (lieu ? ` (${lieu})` : ``) +
        `, merci ! On aimerait vous appeler pour affiner ça ensemble et répondre à vos questions. ` +
        `Choisissez le créneau qui vous arrange, ça prend 30 secondes : ${lien}`;

      const sent = await sendSms(lead.telephone, message);
      if (sent) {
        await supabaseRequest(`leads?id=eq.${lead.id}`, {
          method: "PATCH",
          body: JSON.stringify({ rdv_sms_envoye: true }),
          prefer: "return=minimal",
        });
      }
      await logSms({
        sms_type: "proposition_rdv",
        destinataire: lead.telephone,
        source: nom,
        message_body: message,
        twilio_success: sent,
      });
      results.push({ telephone: lead.telephone, success: sent });
    }
  } catch (err) {
    console.error("proposerRdvFormulairesComplets error:", err.message);
  }
  return results;
}

export default async function handler(req, res) {
  // Sécurité simple : Vercel Cron envoie ce header automatiquement.
  if (CRON_SECRET) {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const conversations = await supabaseRequest(
      "wa_conversations?select=phone,nom,created_at,last_message_at,relance_stage"
    );

    const results = [];

    for (const convo of conversations || []) {
      // On ne relance pas une conversation active récemment (le client vient d'écrire)
      if (convo.last_message_at && hoursSince(convo.last_message_at) < 24) {
        continue;
      }

      const currentStage = convo.relance_stage; // null, "24h", "3j", ou "7j"
      const elapsed = hoursSince(convo.created_at);

      // Trouve le prochain palier à envoyer, dans l'ordre
      const nextStage = STAGES.find((s) => {
        const alreadyPassedThisStage =
          currentStage === s.key ||
          STAGES.findIndex((x) => x.key === currentStage) >=
            STAGES.findIndex((x) => x.key === s.key);
        return !alreadyPassedThisStage && elapsed >= s.hoursSince;
      });

      if (!nextStage) continue;

      const firstName = (convo.nom || "").split(" ")[0] || "là";

      try {
        await sendRelanceTemplate(convo.phone, firstName);
        await supabaseRequest(`wa_conversations?phone=eq.${convo.phone}`, {
          method: "PATCH",
          body: JSON.stringify({ relance_stage: nextStage.key }),
          prefer: "return=minimal",
        });
        results.push({ phone: convo.phone, stage: nextStage.key, success: true });
      } catch (err) {
        console.error(`Relance error for ${convo.phone}:`, err.message);
        results.push({ phone: convo.phone, stage: nextStage.key, success: false, error: err.message });
      }
    }

    const estimationResults = await relancerFormulairesAbandonnes();
    const rdvResults = await proposerRdvFormulairesComplets();

    return res.status(200).json({
      processed: results.length,
      results,
      estimation_relances: estimationResults.length,
      estimation_results: estimationResults,
      rdv_proposes: rdvResults.length,
      rdv_results: rdvResults,
    });
  } catch (err) {
    console.error("send-relances error:", err);
    return res.status(500).json({ error: err.message });
  }
}

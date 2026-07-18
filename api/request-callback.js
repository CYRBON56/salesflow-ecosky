// api/request-callback.js
// Bouton "Être rappelé" du formulaire d'estimation détaillée. Contrairement
// à la prise de rendez-vous Calendly (créneau précis), ici le client demande
// juste à être rappelé rapidement — RMS ECOSKY reçoit immédiatement un SMS
// et rappelle manuellement, pas d'automatisation d'appel.

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
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
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
    if (!res.ok) console.error("Twilio SMS error (request-callback):", await res.text());
    return res.ok;
  } catch (err) {
    console.error("sendSms (request-callback) error:", err.message);
    return false;
  }
}

function toE164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("33")) return "+" + digits;
  if (digits.startsWith("0")) return "+33" + digits.slice(1);
  return "+" + digits;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { lead_id, nom, prenom, telephone, code_postal, estimation_texte } = req.body || {};
    if (!telephone) {
      return res.status(400).json({ success: false, error: "Téléphone requis." });
    }

    const phoneE164 = toE164(telephone);

    if (lead_id) {
      const patch = { statut: "contacté", notes: "Demande de rappel rapide via formulaire estimation" };
      if (code_postal) patch.code_postal = code_postal;
      await supabaseRequest(`leads?id=eq.${lead_id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
        prefer: "return=minimal",
      });
    } else {
      // Aucun dossier existant (le visiteur a utilisé le bouton "Être rappelé"
      // du bas de page sans avoir rempli le formulaire) : on en crée un, ou on
      // met à jour un dossier existant pour ce même numéro le cas échéant, pour
      // que cette demande apparaisse bien dans SalesFlow System.
      const existing = await supabaseRequest(`leads?telephone=eq.${encodeURIComponent(phoneE164)}`);
      if (existing && existing.length > 0) {
        const patch = { statut: "contacté", notes: "Demande de rappel rapide via formulaire estimation" };
        if (code_postal) patch.code_postal = code_postal;
        await supabaseRequest(`leads?telephone=eq.${encodeURIComponent(phoneE164)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
          prefer: "return=minimal",
        });
      } else {
        await supabaseRequest("leads", {
          method: "POST",
          body: JSON.stringify({
            nom: nom || "Visiteur formulaire",
            prenom: prenom || null,
            telephone: phoneE164,
            code_postal: code_postal || null,
            source: "Formulaire estimation détaillée",
            statut: "nouveau",
            notes: "Demande de rappel rapide via formulaire estimation (bas de page)",
          }),
          prefer: "return=minimal",
        });
      }
    }

    const fullName = `${prenom || ""} ${nom || ""}`.trim() || "Un client";
    const ownerMessage =
      `📞 Demande de rappel rapide !\n${fullName} — ${telephone}\n` +
      (estimation_texte ? `${estimation_texte}` : "") +
      `\nÀ rappeler dès que possible.`;
    const sent = await sendSms(TWILIO_TO_NUMBER, ownerMessage);

    return res.status(200).json({ success: true, notified: sent });
  } catch (err) {
    console.error("request-callback error:", err.message);
    return res.status(200).json({
      success: false,
      error: "La demande n'a pas pu être envoyée. Merci de nous appeler directement.",
    });
  }
}

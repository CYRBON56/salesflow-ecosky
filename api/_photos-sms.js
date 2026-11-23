// api/_photos-sms.js
// Demande de photos + adresse exacte au client, par SMS, pour transformer
// son estimation en devis précis. Utilisé :
//   - manuellement depuis le tableau de bord (api/request-photos.js)
//   - automatiquement par le cron quotidien (api/send-relances.js)
// Le message est adapté au type de projet (portail → poteaux/piliers,
// résine → terrasse/support, autre → zone du chantier).

import { sendSms } from "./_sms.js";
import { logSms } from "./_sms-log.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BASE_URL = "https://salesflow-ecosky.vercel.app";

export function categorieProjet(typeProjet) {
  const t = (typeProjet || "").toLowerCase();
  if (t.includes("portail")) return "portail";
  if (t.includes("assainissement") || t.includes("anc")) return "assainissement";
  if (!t || t.includes("resine") || t.includes("résine") || t.includes("pieton") || t.includes("carrossable")) return "resine";
  return "autre";
}

export function messageDemandePhotos(lead) {
  const prenom = (lead.prenom || "").trim();
  const bonjour = prenom ? `Bonjour ${prenom}` : "Bonjour";
  const lien = `${BASE_URL}/photos.html?lead_id=${lead.id}`;
  const cat = categorieProjet(lead.type_projet);

  const quoi =
    cat === "portail" ? "vos poteaux/piliers" : cat === "resine" ? "votre terrasse" : "la zone du chantier";

  return (
    `${bonjour}, suite à votre demande : transformez votre estimation en devis précis ! ` +
    `Envoyez-nous quelques photos de ${quoi} + l'adresse exacte (2 min) : ${lien} - EcoSky by RMS`
  );
}

export async function envoyerDemandePhotos(lead, origine = "manuel") {
  if (!lead?.telephone) return false;
  const message = messageDemandePhotos(lead);
  const sent = await sendSms(lead.telephone, message);

  if (sent) {
    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ demande_photos_envoyee: true }),
    });
  }

  try {
    await logSms({
      sms_type: origine === "auto" ? "demande_photos_auto" : "demande_photos",
      destinataire: lead.telephone,
      source: `${lead.prenom || ""} ${lead.nom || ""}`.trim(),
      message_body: message,
      twilio_success: sent,
    });
  } catch (e) {
    console.error("logSms demande photos:", e.message);
  }
  return sent;
}

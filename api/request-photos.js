// api/request-photos.js
// Déclenché manuellement depuis le tableau de bord (bouton "Adresse & photos"
// sur une ligne de lead). Envoie un SMS au client reprenant son nom/prénom,
// son adresse déjà connue si disponible, et un lien vers la page
// photos.html pour confirmer/compléter l'adresse et envoyer des photos.

import { envoyerDemandePhotos } from "./_photos-sms.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { lead_id } = req.body || {};
    if (!lead_id) {
      return res.status(400).json({ success: false, error: "lead_id requis." });
    }

    const rows = await supabaseRequest(
      `leads?id=eq.${lead_id}&select=id,nom,prenom,telephone,adresse_projet,code_postal,type_projet`
    );
    const lead = rows?.[0];
    if (!lead) {
      return res.status(404).json({ success: false, error: "Lead introuvable." });
    }
    if (!lead.telephone) {
      return res.status(400).json({ success: false, error: "Ce lead n'a pas de numéro de téléphone." });
    }

    const sent = await envoyerDemandePhotos(lead, "manuel");

    return res.status(200).json({ success: sent });
  } catch (err) {
    console.error("request-photos error:", err.message);
    return res.status(200).json({ success: false, error: "Une erreur technique est survenue." });
  }
}

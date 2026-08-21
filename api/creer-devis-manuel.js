// api/creer-devis-manuel.js
// Utilisé uniquement par public/devis-manuel.html, pour un client qui n'a pas
// encore de fiche dans la base. Crée une fiche lead minimale (source: "devis_manuel"),
// upload le PDF du devis, crée la ligne devis avec un token de signature, puis
// réutilise /api/send-devis pour l'envoi (email/SMS) — pas de duplication de logique.
//
// ⚠️ [VÉRIFIER] colonnes leads (prenom, nom, email, telephone) et devis
// (numero, montant, type_projet, pdf_url, message_perso, token_signature, statut)
// doivent correspondre à ton schéma réel.

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const SITE_URL = "https://salesflow-ecosky.vercel.app";

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }
  try {
    const {
      prenom, nom, email, telephone,
      numero, montant, type_projet, message,
      channels, pdf_base64, pdf_filename
    } = req.body || {};

    if (!prenom || !nom || !pdf_base64) {
      return res.status(400).json({ error: "Champs manquants (prénom, nom, PDF)" });
    }
    if (!email && !telephone) {
      return res.status(400).json({ error: "Il faut au moins un email ou un téléphone" });
    }

    // 1. Fiche lead minimale
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .insert({ prenom, nom, email: email || null, telephone: telephone || null, source: "devis_manuel" })
      .select()
      .single();
    if (leadError) throw leadError;

    // 2. Upload du PDF
    const pdfBuffer = Buffer.from(pdf_base64, "base64");
    const path = `devis-manuels/${Date.now()}-${(pdf_filename || "devis.pdf").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: uploadError } = await supabase.storage
      .from("media") // [VÉRIFIER] nom du bucket
      .upload(path, pdfBuffer, { contentType: "application/pdf" });
    if (uploadError) throw uploadError;
    const { data: publicUrlData } = supabase.storage.from("media").getPublicUrl(path);
    const pdf_url = publicUrlData?.publicUrl;

    // 3. Ligne devis, avec token de signature déjà généré
    const token_signature = crypto.randomUUID();
    const montantNumerique = montant
      ? parseFloat(String(montant).replace(/[^\d,.-]/g, "").replace(",", "."))
      : null;
    const { data: devis, error: devisError } = await supabase
      .from("devis")
      .insert({
        lead_id: lead.id,
        numero: numero || null,
        nom_client: `${prenom} ${nom}`.trim(),
        montant_ttc: Number.isFinite(montantNumerique) ? montantNumerique : null,
        type_projet: type_projet || null,
        pdf_url,
        message_perso: message || null,
        token_signature,
        statut: "en_attente"
      })
      .select()
      .single();
    if (devisError) throw devisError;

    // 4. Envoi via l'endpoint existant (évite de dupliquer la logique email/SMS)
    let sendResult = null;
    if (Array.isArray(channels) && channels.length > 0) {
      const sendRes = await fetch(`${SITE_URL}/api/send-devis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devis_id: devis.id, channels, message })
      });
      sendResult = await sendRes.json();
    }

    return res.status(200).json({ ok: true, lead_id: lead.id, devis_id: devis.id, send: sendResult });
  } catch (err) {
    console.error("Erreur creer-devis-manuel:", err);
    return res.status(500).json({ error: err.message || "Erreur serveur" });
  }
}

import { createClient } from "@supabase/supabase-js";
import pdfParse from "pdf-parse";
import Anthropic from "@anthropic-ai/sdk";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Lit le texte du PDF et demande à Claude d'en extraire le numéro de devis,
// le montant TTC et une phrase d'ouverture prête à l'emploi pour l'email/SMS.
// Ne bloque jamais l'upload : en cas d'échec, on retombe sur des valeurs vides.
async function extraireInfosDevis(buffer, filename) {
  try {
    const { text } = await pdfParse(buffer);
    const extrait = text.slice(0, 6000); // largement suffisant pour un devis de quelques pages

    const prompt = `Voici le texte extrait d'un devis PDF (RMS EcoSky, résine de sol / VRD). Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour, avec exactement ces clés :
{
  "numero": "le numéro de devis tel qu'écrit dans le document (ex: D-2026-08-134), ou null si absent",
  "nom_client": "le nom du ou des clients avec civilité (ex: Monsieur Guglielmi et Madame Porcu), ou null si absent",
  "montant_ttc": "le montant total TTC avec le symbole €, tel qu'écrit (ex: 7 840,80 €), ou null si absent",
  "type_projet": "une courte description des travaux, 5-10 mots (ex: tapis de gomme pour terrasse, tapis résine carrossable), ou null si absent",
  "phrase_ouverture": "une phrase complète en français, ton professionnel et chaleureux, au format : Bonjour [civilité + nom], suite à notre passage, veuillez recevoir votre devis n°[numéro] pour la réalisation d'[description des travaux], d'un montant de [montant] TTC. Si une information manque, formule la phrase sans elle plutôt que d'inventer."
}

Texte du devis :
"""
${extrait}
"""`;

    const reponse = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const texteReponse = reponse.content[0].text.trim().replace(/^```json\s*|```$/g, "");
    const infos = JSON.parse(texteReponse);
    return infos;
  } catch (err) {
    console.error("Extraction devis échouée, on continue sans:", err);
    return { numero: null, nom_client: null, montant_ttc: null, type_projet: null, phrase_ouverture: null };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const { lead_id, pdf_base64, filename } = req.body;

    if (!lead_id || !pdf_base64 || !filename) {
      return res.status(400).json({ error: "Champs manquants (lead_id, pdf_base64, filename requis)" });
    }

    const buffer = Buffer.from(pdf_base64, "base64");

    const infos = await extraireInfosDevis(buffer, filename);
    const nomSansExtension = filename.replace(/\.pdf$/i, "");
    const numero = infos.numero || nomSansExtension || `devis-${Date.now()}`;

    const horodatage = Date.now();
    const storagePath = `devis/${horodatage}_${filename.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;

    const { error: uploadError } = await supabase.storage
      .from("media")
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("Erreur upload storage:", uploadError);
      return res.status(500).json({ error: "Échec de l'upload du PDF" });
    }

    const { data: publicUrlData } = supabase.storage.from("media").getPublicUrl(storagePath);
    const pdf_url = publicUrlData.publicUrl;

    // Montant TTC : on garde le texte tel quel (ex: "7 840,80 €") plutôt que de le reconvertir en nombre,
    // pour ne pas se tromper sur le format et rester fidèle à ce qui est écrit dans le PDF.
    const { data: devisRow, error: insertError } = await supabase
      .from("devis")
      .insert({
        lead_id,
        numero,
        pdf_url,
        nom_client: infos.nom_client || null,
        type_projet: infos.type_projet || null,
        message_perso: infos.phrase_ouverture || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Erreur insertion devis:", insertError);
      return res.status(500).json({ error: "Échec de l'enregistrement du devis" });
    }

    return res.status(200).json({
      devis_id: devisRow.id,
      pdf_url,
      numero,
      nom_client: infos.nom_client,
      montant_ttc: infos.montant_ttc,
      type_projet: infos.type_projet,
      message_perso: infos.phrase_ouverture,
    });
  } catch (err) {
    console.error("Erreur upload-devis:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}

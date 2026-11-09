// api/extraire-devis-manuel.js
// Reçoit un PDF en base64, extrait le texte (pdf-parse) puis demande à Claude
// de renvoyer les champs clés en JSON strict. Utilisé par public/devis-manuel.html
// pour pré-remplir le formulaire avant complétion manuelle.
//
// Dépendances déjà présentes dans le repo (utilisées pour l'extraction ANC) :
// pdf-parse, @anthropic-ai/sdk. Nécessite ANTHROPIC_API_KEY sur Vercel (déjà configuré).

import pdfParse from "pdf-parse";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }
  try {
    const { pdf_base64 } = req.body || {};
    if (!pdf_base64) return res.status(400).json({ error: "PDF manquant" });

    const buffer = Buffer.from(pdf_base64, "base64");
    const { text } = await pdfParse(buffer);
    const texteTronque = text.slice(0, 6000); // suffisant pour un devis, évite un prompt trop long

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `Voici le texte extrait d'un devis PDF (BTP/résine). Renvoie UNIQUEMENT un objet JSON strict, sans texte autour, sans balises markdown, avec ces clés :
{"numero": "...ou null", "nom_client": "...ou null", "montant": "...ou null (avec le symbole €, ex: '3 200 €')", "type_projet": "...ou null (courte description, ex: 'terrasse résine EPDM')"}

Texte du devis :
${texteTronque}`
      }]
    });

    const raw = message.content?.[0]?.text?.trim() || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const extrait = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

    return res.status(200).json(extrait);
  } catch (err) {
    console.error("Erreur extraire-devis-manuel:", err);
    // On ne bloque jamais l'utilisateur : en cas d'échec, il complète tout à la main
    return res.status(200).json({ numero: null, nom_client: null, montant: null, type_projet: null });
  }
}

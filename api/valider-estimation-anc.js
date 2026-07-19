/**
 * api/valider-estimation-anc.js
 *
 * Marque une demande ANC comme validée par un technicien et envoie le devis
 * définitif au client par email. Appelé depuis public/valider-anc.html.
 *
 * Le montant final peut être ajusté par le technicien avant validation
 * (montantFinalHT dans le body) — utile notamment pour les cas "hors grille"
 * (EH élevé, filière non chiffrée) où estimation_totale_ht était null.
 *
 * Variables d'environnement utilisées (déjà en place) :
 *   - SUPABASE_ANC_URL / SUPABASE_ANC_SERVICE_ROLE_KEY
 *   - RESEND_API_KEY / RESEND_FROM_EMAIL
 */

import { createClient } from "@supabase/supabase-js";

const supabaseAnc = createClient(
  process.env.SUPABASE_ANC_URL,
  process.env.SUPABASE_ANC_SERVICE_ROLE_KEY
);

async function envoyerEmail({ to, subject, html }) {
  const reponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to,
      subject,
      html,
    }),
  });
  if (!reponse.ok) {
    const detail = await reponse.text();
    throw new Error(`Resend a refusé l'envoi (${reponse.status}) : ${detail}`);
  }
}

function emailDevisDefinitif({ prenom, filiereLabel, ehRetenu, lignes, montantFinalHT }) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #222; max-width: 560px;">
      <h2 style="color:#1F4E78;">Bonjour ${prenom || ""},</h2>
      <p>Votre estimation pour votre projet d'assainissement non collectif a été vérifiée par notre technicien.</p>
      <div style="background:#f4f6f8; border-radius:10px; padding:16px 18px; margin:20px 0;">
        <p style="margin:0 0 8px; font-weight:bold; color:#1F4E78;">${filiereLabel} — logement de ${ehRetenu} EH</p>
        <table style="width:100%; border-collapse:collapse; margin:10px 0;">
          ${(lignes || []).map((l) => `
            <tr>
              <td style="padding:4px 0; font-size:0.92rem;">${l.label}</td>
              <td style="padding:4px 0; font-size:0.92rem; text-align:right; white-space:nowrap;">${Number(l.montant).toLocaleString("fr-FR")} € HT</td>
            </tr>
          `).join("")}
        </table>
        <p style="font-size:1.3rem; font-weight:bold; color:#2e7d32; margin-top:12px; border-top:2px solid #ddd; padding-top:10px;">
          Total : ${Number(montantFinalHT).toLocaleString("fr-FR")} € HT
        </p>
      </div>
      <p>Ce montant est confirmé — n'hésitez pas à nous contacter pour toute question ou pour organiser la suite de votre projet.</p>
      <p style="margin-top:24px;">RMS EcoSky<br>23 Route de Corn Er Hoët, 56400 Brech</p>
    </div>
  `;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  try {
    const {
      leadId,
      lignes,
      prenom,
      telephone,
      email,
      adresseProjet,
      eh,
      filiereIndicative,
    } = req.body;

    if (!leadId) {
      res.status(400).json({ error: "leadId manquant" });
      return;
    }
    if (!Array.isArray(lignes) || lignes.length === 0) {
      res.status(400).json({ error: "Aucune ligne de devis fournie" });
      return;
    }

    const { data: lead, error: erreurLecture } = await supabaseAnc
      .from("leads_anc")
      .select("*")
      .eq("id", leadId)
      .single();

    if (erreurLecture || !lead) {
      res.status(404).json({ error: "Demande introuvable" });
      return;
    }

    const montantTotal = lignes.reduce((somme, l) => somme + (Number(l.montant) || 0), 0);
    if (!montantTotal || montantTotal <= 0) {
      res.status(400).json({ error: "Le total du devis doit être supérieur à 0" });
      return;
    }

    // Les champs texte ne sont mis à jour que s'ils sont fournis et non vides —
    // permet au technicien de corriger une coquille d'extraction avant l'envoi.
    const misAJour = {
      estimation_validee: true,
      statut: "validee",
      estimation_totale_ht: montantTotal,
      estimation_detail: {
        ...(lead.estimation_detail || {}),
        lignesFinales: lignes,
      },
      validated_at: new Date().toISOString(),
    };
    if (prenom) misAJour.prenom = prenom;
    if (telephone) misAJour.telephone = telephone;
    if (email) misAJour.email = email;
    if (adresseProjet) misAJour.adresse_projet = adresseProjet;
    if (eh) misAJour.eh = Number(eh);
    if (filiereIndicative) misAJour.filiere_indicative = filiereIndicative;

    const { error: erreurMaj } = await supabaseAnc
      .from("leads_anc")
      .update(misAJour)
      .eq("id", leadId);

    if (erreurMaj) throw erreurMaj;

    const detail = lead.estimation_detail || {};
    await envoyerEmail({
      to: misAJour.email || lead.email,
      subject: "Votre devis assainissement confirmé — RMS EcoSky",
      html: emailDevisDefinitif({
        prenom: misAJour.prenom || lead.prenom,
        filiereLabel: detail.filiere || "Votre installation",
        ehRetenu: misAJour.eh || lead.eh,
        lignes,
        montantFinalHT: montantTotal,
      }),
    });

    res.status(200).json({ ok: true, montantFinalHT: montantTotal });
  } catch (err) {
    console.error("valider-estimation-anc error:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
}

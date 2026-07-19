/**
 * api/submit-estimation-anc.js
 *
 * Reçoit les données du formulaire public/estimation-anc.html, calcule
 * l'estimation à partir de pricing-config-anc.js, enregistre le lead
 * dans un projet Supabase DÉDIÉ à l'ANC (table leads_anc), puis envoie :
 *   - un email de confirmation (indicatif) au client
 *   - un email de notification interne à OWNER_EMAIL pour validation
 *
 * Différence clé avec api/submit-estimation.js (résine) :
 *   - la résine envoie automatiquement le DEVIS DÉFINITIF (PDF/SMS/email) au client
 *   - l'ANC envoie seulement un email de confirmation "en attente de validation"
 *     au client : le devis définitif est envoyé plus tard par
 *     api/valider-estimation-anc.js, déclenché manuellement par Cyrille/Fanny
 *     depuis le dashboard une fois l'estimation vérifiée.
 *
 * Variables d'environnement Vercel utilisées (déjà en place pour le flux résine,
 * réutilisées ici sans duplication car même projet Vercel) :
 *   - SUPABASE_ANC_URL / SUPABASE_ANC_SERVICE_ROLE_KEY (projet Supabase ANC dédié)
 *   - RESEND_API_KEY / RESEND_FROM_EMAIL (envoi d'emails)
 *   - OWNER_EMAIL (destinataire de la notification interne)
 *
 * Note : la grille de prix est chargée depuis anc-pricing-config-server.js
 * (et NON pricing-config-anc.js) — nom volontairement différent de la copie
 * publique dans public/ pour éviter toute confusion lors des uploads GitHub.
 */

const { createClient } = require("@supabase/supabase-js");
const PRICING_CONFIG_ANC = require("./anc-pricing-config-server.js");

const supabaseAnc = createClient(
  process.env.SUPABASE_ANC_URL,
  process.env.SUPABASE_ANC_SERVICE_ROLE_KEY
);

/**
 * Envoi d'un email via l'API Resend (mêmes variables d'environnement que le
 * flux résine : RESEND_API_KEY, RESEND_FROM_EMAIL). Reste autonome (pas de
 * module partagé) : un échec d'envoi ne doit jamais empêcher l'enregistrement
 * du lead, géré par l'appelant via try/catch.
 */
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

function emailConfirmationClient({ prenom, filiereLabel, ehRetenu }) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #222; max-width: 560px;">
      <h2 style="color:#1F4E78;">Bonjour ${prenom || ""},</h2>
      <p>Nous avons bien reçu votre demande d'estimation pour votre projet d'assainissement non collectif (${filiereLabel}, logement de ${ehRetenu} EH).</p>
      <p>Un technicien RMS EcoSky va vérifier votre estimation à partir de votre étude de sol et vous la confirmera par email <strong>sous 24h</strong>.</p>
      <p style="color:#666; font-size: 0.9rem;">Cette première estimation est indicative — le montant définitif vous sera transmis après validation technicien.</p>
      <p style="margin-top:24px;">RMS EcoSky<br>23 Route de Corn Er Hoët, 56400 Brech</p>
    </div>
  `;
}

function emailNotificationOwner({ prenom, telephone, email, adresseProjet, filiereLabel, ehRetenu, estimationTotaleHT, etudePdfUrl }) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #222; max-width: 560px;">
      <h2 style="color:#1F4E78;">Nouvelle demande ANC à valider</h2>
      <ul>
        <li><strong>Nom :</strong> ${prenom || "—"}</li>
        <li><strong>Téléphone :</strong> ${telephone || "—"}</li>
        <li><strong>Email :</strong> ${email || "—"}</li>
        <li><strong>Adresse du projet :</strong> ${adresseProjet || "—"}</li>
        <li><strong>Filière indicative :</strong> ${filiereLabel} (${ehRetenu} EH)</li>
        <li><strong>Estimation indicative :</strong> ${estimationTotaleHT != null ? estimationTotaleHT.toLocaleString("fr-FR") + " € HT" : "à confirmer (hors grille)"}</li>
        ${etudePdfUrl ? `<li><strong>Étude de sol :</strong> <a href="${etudePdfUrl}">${etudePdfUrl}</a></li>` : ""}
      </ul>
      <p>À valider dans le dashboard avant envoi du devis définitif au client.</p>
    </div>
  `;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  try {
    const {
      prenom,
      telephone,
      email,
      adresseProjet,
      piecesPrincipales,
      eh,
      etudeSolFournie,
      etudePdfUrl,
      roche,
      longueurRaccordement,
      ventilation,
      posteRelevage,
      filiereIndicative,
    } = req.body;

    if (!prenom || !telephone || !email || !adresseProjet) {
      res.status(400).json({ error: "Champs obligatoires manquants" });
      return;
    }

    // --- Recalcul serveur de l'estimation (ne jamais faire confiance au calcul client) ---
    const ehRetenu = Math.min(19, Math.max(4, Number(eh) || 4));
    const filiere = PRICING_CONFIG_ANC.filieres[filiereIndicative] || PRICING_CONFIG_ANC.filieres.filtreCompact;
    const prixBaseHT = filiere.prixParEH[ehRetenu]; // peut être null tant que non configuré

    const options = PRICING_CONFIG_ANC.optionsComplementaires;
    let complementsHT = 0;
    const detailComplements = [];

    if (ventilation === "oui") {
      complementsHT += options.ventilationToiture.prixHT;
      detailComplements.push({ poste: "ventilationToiture", montantHT: options.ventilationToiture.prixHT });
    }
    if (longueurRaccordement > 0) {
      const montant = Number(longueurRaccordement) * options.terrassementRaccordement.prixHT;
      complementsHT += montant;
      detailComplements.push({ poste: "terrassementRaccordement", metresLineaires: longueurRaccordement, montantHT: montant });
    }
    if (roche === "oui") {
      detailComplements.push({ poste: "briseRocheHydraulique", prixIndicatifHT: options.briseRocheHydraulique.prixHT, note: "optionnel, si roche rencontrée" });
    }
    if (posteRelevage === true) {
      detailComplements.push({ poste: "posteDeRelevage", note: "confirmé par l'étude de sol ou le client — à intégrer au devis technicien" });
    }
    detailComplements.push({ poste: "evacuationDeblais", prixIndicatifHT: options.evacuationDeblais.prixHT });

    const estimationTotaleHT = typeof prixBaseHT === "number" ? prixBaseHT + complementsHT : null;

    const enregistrementLead = {
      type_projet: "anc",
      prenom,
      telephone,
      email,
      adresse_projet: adresseProjet,
      pieces_principales: piecesPrincipales || null,
      eh: ehRetenu,
      etude_sol_fournie: !!etudeSolFournie,
      etude_sol_pdf_url: etudePdfUrl || null,
      contraintes_terrain: { roche, longueurRaccordement, ventilation, posteRelevage },
      filiere_indicative: filiereIndicative,
      estimation_detail: {
        filiere: filiere.label,
        composantsInclus: filiere.composantsInclus,
        prixBaseHT,
        complements: detailComplements,
      },
      estimation_totale_ht: estimationTotaleHT,
      estimation_validee: false, // <-- clé : attend une action manuelle avant envoi du devis définitif
      statut: "en_attente_validation",
    };

    // Upsert par téléphone (table leads_anc, cf. sql-creation-leads-anc.sql)
    // — même logique que submit-estimation.js côté résine : évite de planter
    // sur la contrainte unique si le client resoumet le formulaire.
    const { data: leadEnregistre, error: erreurSupabase } = await supabaseAnc
      .from("leads_anc")
      .upsert(enregistrementLead, { onConflict: "telephone" })
      .select()
      .single();

    if (erreurSupabase) throw erreurSupabase;

    // --- Emails : confirmation client + notification interne ---
    // Un échec d'envoi ne doit jamais faire échouer la soumission du formulaire :
    // le lead est déjà enregistré, c'est le plus important.
    const contexteEmail = {
      prenom,
      telephone,
      email,
      adresseProjet,
      filiereLabel: filiere.label,
      ehRetenu,
      estimationTotaleHT,
      etudePdfUrl,
    };

    try {
      await envoyerEmail({
        to: email,
        subject: "Votre demande d'estimation assainissement — RMS EcoSky",
        html: emailConfirmationClient(contexteEmail),
      });
    } catch (erreurEmailClient) {
      console.error("Échec envoi email confirmation client :", erreurEmailClient);
    }

    try {
      await envoyerEmail({
        to: process.env.OWNER_EMAIL,
        subject: `Nouvelle demande ANC à valider — ${prenom}`,
        html: emailNotificationOwner(contexteEmail),
      });
    } catch (erreurEmailOwner) {
      console.error("Échec envoi email notification owner :", erreurEmailOwner);
    }

    res.status(200).json({
      ok: true,
      leadId: leadEnregistre.id,
      estimationTotaleHT,
      message: "Demande enregistrée, en attente de validation technicien.",
    });
  } catch (err) {
    console.error("submit-estimation-anc error:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

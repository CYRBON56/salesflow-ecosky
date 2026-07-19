/**
 * api/submit-estimation-anc.js
 *
 * Reçoit les données du formulaire public/estimation-anc.html, calcule
 * l'estimation à partir de anc-pricing-config-server.js, et enregistre le
 * lead dans un projet Supabase DÉDIÉ à l'ANC (table leads_anc), séparé du
 * Supabase résine (wklddwumirkdjkbxvzyj).
 *
 * Différence clé avec api/submit-estimation.js (résine) :
 *   - la résine envoie automatiquement le PDF/SMS/email au client dès la soumission
 *   - l'ANC N'ENVOIE RIEN au client à ce stade : le lead est marqué en attente,
 *     et c'est un futur api/valider-estimation-anc.js (déclenché depuis le
 *     dashboard par Cyrille ou Fanny) qui génère le PDF définitif et l'envoie
 *     une fois vérifié.
 *
 * Variables d'environnement Vercel à créer pour CE projet (nouveau Supabase,
 * distinct de SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY utilisées pour la résine) :
 *   - SUPABASE_ANC_URL
 *   - SUPABASE_ANC_SERVICE_ROLE_KEY   (jamais exposée côté navigateur)
 *
 * Reste en TODO :
 *   - notification interne (SMS/email à OWNER) pour prévenir qu'une estimation
 *     ANC attend validation
 */

import { createClient } from "@supabase/supabase-js";
import PRICING_CONFIG_ANC from "./anc-pricing-config-server.js";

const supabaseAnc = createClient(
  process.env.SUPABASE_ANC_URL,
  process.env.SUPABASE_ANC_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
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
      estimation_validee: false, // <-- clé : attend une action manuelle avant envoi client
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

    // TODO : notification interne (SMS/email à OWNER_EMAIL / TWILIO_TO_NUMBER)
    // pour signaler qu'une estimation ANC attend validation dans le dashboard.

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
}

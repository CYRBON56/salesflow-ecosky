/**
 * Grille de prix — Estimateur Assainissement Non Collectif (ANC)
 * RMS EcoSky
 *
 * Fichier UMD, DUPLIQUÉ depuis public/pricing-config-anc.js (même contenu),
 * renommé ici en anc-pricing-config-server.js pour éviter toute confusion
 * avec la version publique lors des uploads GitHub (2 fichiers identiques
 * portant le même nom dans 2 dossiers différents = source d'erreur).
 * La version publique (public/pricing-config-anc.js) est utilisable côté
 * navigateur via <script src="pricing-config-anc.js"> (expose
 * window.PRICING_CONFIG_ANC). CE fichier-ci (api/anc-pricing-config-server.js)
 * est utilisé côté serveur via require('./anc-pricing-config-server.js').
 *
 * ⚠️ Si tu modifies les prix, pense à répercuter le changement dans LES DEUX
 * fichiers (public/pricing-config-anc.js ET api/anc-pricing-config-server.js) —
 * ce sont deux copies indépendantes, pas un fichier partagé.
 *
 * Les valeurs prixParEH sont à null : à compléter par Cyrille (cf.
 * Grille_filieres_EH.xlsx). Tant qu'un prix est null pour l'EH demandé, le
 * formulaire affiche « estimation à confirmer par un technicien » au lieu d'un
 * montant chiffré.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PRICING_CONFIG_ANC = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {

  function grillePrixVide() {
    return {
      4: null, 5: null, 6: null, 7: null, 8: null, 9: null, 10: null,
      11: null, 12: null, 13: null, 14: null, 15: null, 16: null, 17: null, 18: null, 19: null,
    };
  }

  return {

    filieres: {

      filtreSableDraineEtanche: {
        label: "Filtre à sable vertical drainé (étanché par géomembrane)",
        composantsInclus: [
          "Terrassement pour la pose de la fosse toutes eaux 3000 L",
          "Fourniture et pose de la fosse toutes eaux 3000 L",
          "Terrassement de la zone destinée à accueillir le filtre à sable",
          "Fourniture et pose de la géomembrane d'étanchéité (1 mm)",
          "Fourniture et pose des tuyaux de répartition",
          "Fourniture et pose du regard de collecte",
          "Fourniture et pose du regard de répartition",
          "Fourniture et pose du regard de bouclage",
          "Fourniture et pose du gravier",
          "Fourniture et pose du filet de séparation gravier / sable siliceux",
          "Fourniture et pose du sable siliceux",
          "Fourniture et pose des tuyaux CR4 épandrain",
          "Fourniture et pose des coudes",
          "Fourniture et pose du géotextile de recouvrement",
        ],
        prixParEH: grillePrixVide(),
      },

      filtreSableDraineNonEtanche: {
        label: "Filtre à sable vertical drainé non étanche",
        composantsInclus: [
          "Terrassement pour la pose de la fosse toutes eaux 3000 L",
          "Fourniture et pose de la fosse toutes eaux 3000 L",
          "Terrassement de la zone destinée à accueillir le filtre à sable",
          "Fourniture et pose des tuyaux de répartition",
          "Fourniture et pose du regard de collecte",
          "Fourniture et pose du regard de répartition",
          "Fourniture et pose du regard de bouclage",
          "Fourniture et pose du gravier",
          "Fourniture et pose du filet de séparation gravier / sable siliceux",
          "Fourniture et pose du sable siliceux",
          "Fourniture et pose des tuyaux CR4 épandrain",
          "Fourniture et pose des coudes",
          "Fourniture et pose du géotextile de recouvrement",
        ],
        prixParEH: grillePrixVide(),
      },

      tranchesEpandage: {
        label: "Tranchées d'épandage (sol en place)",
        composantsInclus: [
          "Terrassement pour la pose de la fosse toutes eaux 3000 L",
          "Fourniture et pose de la fosse toutes eaux 3000 L",
          "Terrassement de la zone destinée à accueillir les tranchées",
          "Fourniture et pose du gravier",
          "Fourniture et pose des tuyaux épandrain",
          "Fourniture et pose du regard de répartition",
          "Fourniture et pose du regard de bouclage",
          "Fourniture et pose du géotextile de recouvrement",
        ],
        prixParEH: grillePrixVide(),
      },

      filtreCompact: {
        label: "Filière compacte (média filtrant)",
        composantsInclus: [
          "Fourniture et pose du filtre compact",
          "Terrassement",
          "Remblaiement",
        ],
        prixParEH: grillePrixVide(),
      },

      microstation: {
        label: "Microstation",
        composantsInclus: [
          "Fourniture et pose de la microstation",
          "Terrassement",
          "Remblaiement",
        ],
        prixParEH: grillePrixVide(),
      },

    },

    // Postes complémentaires, communs à toutes les filières, ajoutés selon les
    // contraintes du terrain (roche, longueur de raccordement, exutoire, etc.)
    optionsComplementaires: {

      briseRocheHydraulique: {
        label: "Utilisation du brise-roche hydraulique (en cas de roche)",
        unite: "forfait / jour",
        prixHT: 1250,
      },

      ventilationToiture: {
        label: "Pose de la ventilation en toiture",
        unite: "forfait",
        prixHT: 400,
        note: "à partir de",
      },

      terrassementRaccordement: {
        label: "Terrassement de raccordement (maison → cuve, fosse → filtre, filtre → fossé, cuve/microstation/filtre compact → fossé)",
        unite: "€ HT / mètre linéaire",
        prixHT: 20,
        note: "longueur à définir au cas par cas selon le plan de masse",
      },

      litInfiltration: {
        label: "Fourniture et pose d'un lit d'infiltration",
        unite: "€ HT / m²",
        prixHT: 100,
      },

      evacuationDeblais: {
        label: "Évacuation des déblais terrigènes (terrassement fosse/cuve/filtres)",
        unite: "€ HT / tonne, transport inclus",
        prixHT: 100,
        note: "à partir de",
      },

    },

  };

}));

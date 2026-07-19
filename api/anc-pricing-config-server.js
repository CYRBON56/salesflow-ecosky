
/**
 * Grille de prix — Estimateur Assainissement Non Collectif (ANC)
 * RMS EcoSky
 *
 * Copie PUBLIQUE (navigateur) : chargée par public/estimation-anc.html via
 * <script src="pricing-config-anc.js"> (expose window.PRICING_CONFIG_ANC).
 *
 * ⚠️ Une copie identique existe côté serveur sous le nom
 * api/anc-pricing-config-server.js (nom différent volontairement, pour éviter
 * toute confusion lors des uploads GitHub). Si tu modifies les prix, pense à
 * répercuter le changement dans LES DEUX fichiers — ce sont deux copies
 * indépendantes, pas un fichier partagé.
 *
 * Filtre à sable (étanche et non étanche) et tranchées d'épandage : chiffrés
 * jusqu'à 8 EH. Filtre compact et microstation : chiffrés jusqu'à 10 EH.
 * Au-delà, prixParEH reste null → le formulaire affiche « estimation à
 * confirmer par un technicien ».
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PRICING_CONFIG_ANC = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {

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
        prixParEH: {
          4: 7500, 5: 8500, 6: 9500, 7: 10500, 8: 11500,
          9: null, 10: null, 11: null, 12: null, 13: null,
          14: null, 15: null, 16: null, 17: null, 18: null, 19: null,
        },
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
        prixParEH: {
          4: 6500, 5: 7500, 6: 8500, 7: 9500, 8: 10500,
          9: null, 10: null, 11: null, 12: null, 13: null,
          14: null, 15: null, 16: null, 17: null, 18: null, 19: null,
        },
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
        prixParEH: {
          4: 6500, 5: 7500, 6: 8500, 7: 9500, 8: 10500,
          9: null, 10: null, 11: null, 12: null, 13: null,
          14: null, 15: null, 16: null, 17: null, 18: null, 19: null,
        },
      },

      filtreCompact: {
        label: "Filière compacte (média filtrant)",
        composantsInclus: [
          "Fourniture et pose du filtre compact",
          "Terrassement",
          "Remblaiement",
        ],
        prixParEH: {
          4: 9000, 5: 10000, 6: 11000, 7: 12000, 8: 13000, 9: 14000, 10: 15000,
          11: null, 12: null, 13: null, 14: null, 15: null, 16: null, 17: null, 18: null, 19: null,
        },
      },

      microstation: {
        label: "Microstation",
        composantsInclus: [
          "Fourniture et pose de la microstation",
          "Terrassement",
          "Remblaiement",
        ],
        prixParEH: {
          4: 8000, 5: 9000, 6: 10000, 7: 11000, 8: 12000, 9: 13000, 10: 14000,
          11: null, 12: null, 13: null, 14: null, 15: null, 16: null, 17: null, 18: null, 19: null,
        },
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

      pompeRelevageAmont: {
        label: "Pompe de relevage en amont de la fosse",
        unite: "forfait",
        prixHT: 1350,
      },

      pompeRelevageAval: {
        label: "Pompe de relevage en aval de la fosse",
        unite: "forfait",
        prixHT: 2300,
      },

    },

  };

}));

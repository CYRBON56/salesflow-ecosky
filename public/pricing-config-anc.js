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
 *
 * optionsComplementaires : prixHT à null → poste « sur devis / à confirmer
 * par un technicien », même convention que prixParEH.
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
    // Regroupés par catégorie (même découpage que le chiffrage Excel de référence).
    optionsComplementaires: {

      // --- Terrassement / conditions de sol ---------------------------------

      terrassementClassique: {
        label: "Terrassement classique (fouilles collecte, fosse, épandage)",
        unite: "forfait",
        prixHT: 1500,
      },

      briseRocheHydraulique: {
        label: "Utilisation du brise-roche hydraulique",
        unite: "forfait / jour",
        prixHT: 1250,
      },

      reamenagementTerrainPente: {
        label: "Réaménagement / nivellement terrain en pente",
        unite: "forfait",
        prixHT: 500,
      },

      protectionZoneChantier: {
        label: "Protection de la zone d'ouvrage pendant travaux (interdiction circulation/stockage)",
        unite: "forfait",
        prixHT: 300,
      },

      // --- Prétraitement ------------------------------------------------------
      // (fosse déjà incluse dans composantsInclus/prixParEH de chaque filière —
      // ces lignes servent uniquement en cas de besoin d'un volume supérieur)

      fosseToutesEaux3000_4000L: {
        label: "Fosse toutes eaux béton 3000-4000 L (remplacement/surdimensionnement)",
        unite: "unité",
        prixHT: 2290,
      },

      fosseToutesEaux5000_6000L: {
        label: "Fosse toutes eaux béton 5000-6000 L",
        unite: "unité",
        prixHT: 3990,
      },

      fosseToutesEaux8000LPlus: {
        label: "Fosse toutes eaux béton 8000 L et plus",
        unite: "unité",
        prixHT: 6500,
      },

      prefiltreSeparate: {
        label: "Préfiltre (fourniture + pose, si non intégré à la fosse)",
        unite: "unité",
        prixHT: null,
        note: "à définir",
      },

      bacDegraisseur200L: {
        label: "Bac dégraisseur 200 L (sortie cuisine à plus de 10 m de la fosse)",
        unite: "unité",
        prixHT: 700,
      },

      bacDegraisseur500L: {
        label: "Bac dégraisseur 500 L (eaux usées + cuisine mutualisées)",
        unite: "unité",
        prixHT: 1100,
      },

      // --- Relevage -------------------------------------------------------

      pompeRelevageAmont: {
        label: "Poste de relevage en amont de la fosse — fourniture et pose",
        unite: "forfait",
        prixHT: 1550,
      },

      pompeRelevageAval: {
        label: "Poste de relevage en aval de la fosse — fourniture et pose",
        unite: "forfait",
        prixHT: 2300,
      },

      pompeRelevageEauxClaires: {
        label: "Poste de relevage eaux claires (sortie filière compacte)",
        unite: "unité",
        prixHT: 850,
      },

      pompeCanneTelescopique: {
        label: "Pompe + canne télescopique (accessoire de relevage)",
        unite: "unité",
        prixHT: 250,
      },

      alarmeRelevage: {
        label: "Alarme de fonctionnement (poste de relevage)",
        unite: "unité",
        prixHT: 250,
      },

      disjoncteurDifferentiel: {
        label: "Disjoncteur différentiel séparé 16A/30mA (option)",
        unite: "unité",
        prixHT: 150,
      },

      branchementElectrique: {
        label: "Branchement électrique par électricien agréé",
        unite: "forfait",
        prixHT: 350,
      },

      // --- Ventilation ------------------------------------------------------

      ventilationPrimaire: {
        label: "Ventilation primaire (remontée toiture, Ø100mm)",
        unite: "unité",
        prixHT: null,
        note: "option, à définir",
      },

      ventilationToiture: {
        label: "Ventilation secondaire en toiture",
        unite: "forfait",
        prixHT: 400,
        note: "à partir de",
      },

      extracteurStatiqueEolien: {
        label: "Extracteur statique / éolien",
        unite: "unité",
        prixHT: 80,
      },

      // --- Collecte -----------------------------------------------------

      teControleVisite: {
        label: "Té de contrôle / té de visite par sortie EU",
        unite: "unité",
        prixHT: 25,
      },

      regardRepartition: {
        label: "Regard de répartition",
        unite: "unité",
        prixHT: 100,
      },

      regardBouclage: {
        label: "Regard de bouclage",
        unite: "unité",
        prixHT: 100,
      },

      canalisationRenforceeVoirie: {
        label: "Canalisation renforcée sous voirie/passage véhicule (CR4/CR8)",
        unite: "€ HT / mètre linéaire",
        prixHT: 45,
      },

      dalleRepriseDeCharge: {
        label: "Dalle de reprise de charge béton armé (passage véhicule)",
        unite: "€ HT / m²",
        prixHT: 100,
      },

      briseJet: {
        label: "Brise-jet en amont de la zone d'infiltration",
        unite: "unité",
        prixHT: 35,
      },

      trancheeTechniqueEvacuation: {
        label: "Tranchée technique pour la pose des tuyaux d'évacuation",
        unite: "€ HT / mètre linéaire",
        prixHT: 25,
      },

      terrassementRaccordement: {
        label: "Terrassement de raccordement (maison → cuve, fosse → filtre, filtre → fossé, cuve/microstation/filtre compact → fossé)",
        unite: "€ HT / mètre linéaire",
        prixHT: 20,
        note: "longueur à définir au cas par cas selon le plan de masse",
      },

      // --- Traitement secondaire (compléments hors base filière) -----------

      trancheeEpandageSupplementaire: {
        label: "Tranchée d'épandage supplémentaire (au-delà du linéaire de base inclus dans la filière)",
        unite: "€ HT / mètre linéaire",
        prixHT: 100,
      },

      litInfiltration: {
        label: "Fourniture et pose d'un lit d'infiltration / filtre tertiaire",
        unite: "€ HT / m²",
        prixHT: 100,
      },

      // --- Remblai --------------------------------------------------------

      apportTerreVegetale: {
        label: "Apport de terre végétale de recouvrement",
        unite: "€ HT / m³",
        prixHT: 70,
      },

      geotextileRecouvrement: {
        label: "Géotextile de recouvrement",
        unite: "€ HT / m²",
        prixHT: 15,
      },

      // --- Divers ---------------------------------------------------------

      evacuationDeblais: {
        label: "Évacuation des déblais terrigènes (terrassement fosse/cuve/filtres)",
        unite: "€ HT / tonne, transport inclus",
        prixHT: 100,
        note: "à partir de",
      },

      neutralisationAncienDispositif: {
        label: "Neutralisation d'un ancien dispositif d'assainissement (vidange + comblement)",
        unite: "forfait",
        prixHT: 350,
      },

      vidangeEntrepriseAgreee: {
        label: "Vidange par une entreprise agréée",
        unite: "forfait",
        prixHT: 350,
      },

      abattageArbresDebroussaillage: {
        label: "Abattage d'arbres / débroussaillage préalable",
        unite: "forfait",
        prixHT: 500,
      },

      securisationOuvragesResiduels: {
        label: "Sécurisation / nettoyage des ouvrages résiduels",
        unite: "forfait",
        prixHT: null,
        note: "à définir",
      },

    },

  };

}));

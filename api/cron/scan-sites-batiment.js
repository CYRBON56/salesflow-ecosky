// api/cron/scan-sites-batiment.js
//
// Tâche planifiée (Vercel Cron) pour la nouvelle campagne "refonte_batiment" :
// repère les entreprises du bâtiment avec un site obsolète ou inexistant,
// vérifie qu'elles existent toujours (registre officiel), les score, et les
// range dans la table prospection_sites_obsoletes.
//
// Ce script NE fait PAS la maquette "avant/après" ni l'envoi d'email : c'est
// volontairement une étape séparée, pour ne jamais démarcher une entreprise
// sans validation humaine de la maquette au préalable.
//
// -----------------------------------------------------------------------
// DÉPLOIEMENT
// -----------------------------------------------------------------------
// 1) Placer ce fichier dans  api/cron/scan-sites-batiment.js  de ton projet
//    Vercel (même projet que SalesFlow).
//
// 2) Ajouter dans vercel.json (créer la section "crons" si elle n'existe pas) :
//      {
//        "crons": [
//          { "path": "/api/cron/scan-sites-batiment", "schedule": "0 6 * * *" }
//        ]
//      }
//    (tous les jours à 6h du matin — ajuste la fréquence si besoin)
//
// 3) Variables d'environnement nécessaires (déjà présentes dans le projet
//    Vercel "salesflow-ecosky") :
//      SUPABASE_URL
//      SUPABASE_SERVICE_KEY
//    Optionnelle :
//      SCAN_BATCH_SIZE   (nombre d'entreprises traitées par exécution, défaut 25)
//      CRON_SECRET       (déjà présente, protège les crons existants)
//
// -----------------------------------------------------------------------
// D'OÙ VIENNENT LES CANDIDATS
// -----------------------------------------------------------------------
// La table prospects_construction (206 558 lignes) contient déjà les
// entreprises du bâtiment collectées pour Contact Chantier. Parmi elles,
// environ 16 000 ont un site connu (colonne site_web ou, à défaut, ml_site
// qui vient de votre outil d'enrichissement existant). C'est ce sous-
// ensemble que ce script traite. Les ~190 000 restantes n'ont pas de site
// identifié : il faudra une étape de "recherche de site" séparée (API de
// recherche web) avant de pouvoir les scorer — volontairement pas incluse
// ici pour ne pas dépendre d'une clé d'API supplémentaire sans validation
// de ta part au préalable.
//
// -----------------------------------------------------------------------
// LOGIQUE DE SCORE (0 = site récent/soigné, 100 = très obsolète)
// -----------------------------------------------------------------------
// +20  pas de HTTPS
// +25  pas de balise <meta viewport> (site non responsive)
// +20  millésime de copyright trouvé, vieux de 5 ans ou plus
// +5   aucun millésime trouvé du tout dans le pied de page
// +30  traces très datées (frames, marquee, blink, FrontPage, Dreamweaver)
// +25  contenu Flash détecté (<object>/.swf)
// +15  doctype HTML4/XHTML ancien
// +10  pas de doctype HTML5 standard
// +15  jQuery très ancien (< version 2)
//
// Seuils : score >= 50 -> "qualifie" (bon candidat à démarcher)
//          score <= 20 -> "rejete"   (site correct, pas une cible)
//          entre les deux -> "a_analyser" (zone grise, revue manuelle)
//          entreprise fermée au registre -> toujours "rejete", quel que soit le score
//
// C'est une heuristique de départ. Affine les seuils/poids après avoir vu
// quelques dizaines de résultats réels.

import { createClient } from '@supabase/supabase-js';

const BATCH_SIZE = Number(process.env.SCAN_BATCH_SIZE || 60);
const PARALLELE = 5; // sites analysés en même temps

export const config = { maxDuration: 300 };
const USER_AGENT = 'Mozilla/5.0 (compatible; EcoSkyBot/1.0; +https://skyeco.fr/a-propos-bot)';
const CAMPAGNE = 'refonte_batiment';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // Protection basique si la "Cron secret" de Vercel est configurée
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const resultats = { traites: 0, qualifies: 0, rejetes: 0, a_verifier: 0, erreurs: 0 };

  try {
    // 1) Exclure les siren déjà présents dans prospection_sites_obsoletes
    const { data: deja, error: errDeja } = await supabase
      .from('prospection_sites_obsoletes')
      .select('siren')
      .eq('campagne', CAMPAGNE);
    if (errDeja) throw errDeja;
    const sirensDejaTraites = new Set((deja || []).map((r) => r.siren));
    // On reprend là où le dernier passage s'est arrêté (ordre des siren)
    const dernierSiren = [...sirensDejaTraites].sort().pop() || '';

    // 2) Candidats suivants ayant un site connu (site_web, sinon ml_site)
    let req2 = supabase
      .from('prospects_construction')
      .select('siren, nom, ville, departement, categorie, site_web, ml_site, email, ml_emails')
      .or('site_web.not.is.null,ml_site.not.is.null')
      .order('siren', { ascending: true })
      .limit(BATCH_SIZE * 2);
    if (dernierSiren) req2 = req2.gt('siren', dernierSiren);
    const { data: candidatsBruts, error: errCandidats } = await req2;
    if (errCandidats) throw errCandidats;

    const aTraiter = (candidatsBruts || [])
      .map((c) => ({ ...c, site_web: premierSite(c.site_web, c.ml_site) }))
      .filter((c) => c.site_web && !sirensDejaTraites.has(c.siren))
      .slice(0, BATCH_SIZE);

    // 3) Traitement par petits groupes de 5 en parallèle
    const traiter = async (candidat) => {
      try {
        const verif = await verifierEntrepriseActive(candidat.siren);
        const analyse = await analyserSite(candidat.site_web);
        const statut = determinerStatut(analyse.score, verif.active);

        const { error: errInsert } = await supabase
          .from('prospection_sites_obsoletes')
          .upsert({
            siren: candidat.siren,
            nom: candidat.nom,
            ville: candidat.ville,
            departement: candidat.departement,
            categorie: candidat.categorie,
            site_web: candidat.site_web,
            email_contact: candidat.email || premierEmail(candidat.ml_emails),
            score_obsolescence: analyse.score,
            signaux: analyse.signaux,
            entreprise_active: verif.active,
            date_creation_entreprise: verif.dateCreation,
            verifie_le: new Date().toISOString(),
            statut,
            campagne: CAMPAGNE,
            notes: analyse.notes,
          }, { onConflict: 'siren,campagne' });
        if (errInsert) throw errInsert;

        resultats.traites++;
        if (statut === 'qualifie') resultats.qualifies++;
        else if (statut === 'rejete') resultats.rejetes++;
        else resultats.a_verifier++;
      } catch (e) {
        console.error(`Erreur sur ${candidat.siren} (${candidat.nom}) :`, e.message);
        resultats.erreurs++;
      }
    };

    for (let i = 0; i < aTraiter.length; i += PARALLELE) {
      await Promise.all(aTraiter.slice(i, i + PARALLELE).map(traiter));
    }

    return res.status(200).json(resultats);
  } catch (e) {
    console.error('Erreur scan-sites-batiment :', e);
    return res.status(500).json({ error: e.message, ...resultats });
  }
}

// --- Choisit un site exploitable parmi site_web / ml_site (qui peuvent contenir
//     plusieurs valeurs séparées par ; ou ,) ---
function premierSite(siteWeb, mlSite) {
  const brut = (siteWeb && siteWeb.trim()) || (mlSite && mlSite.trim());
  if (!brut) return null;
  const premier = brut.split(/[;,]/)[0].trim();
  return premier || null;
}

function premierEmail(mlEmails) {
  if (!mlEmails) return null;
  return mlEmails.split(/[;,]/)[0]?.trim() || null;
}

// --- Vérifie si l'entreprise est toujours active au registre officiel
//     (API gratuite recherche-entreprises.api.gouv.fr, sans clé) ---
async function verifierEntrepriseActive(siren) {
  try {
    const r = await fetch(
      `https://recherche-entreprises.api.gouv.fr/search?q=${siren}&page=1&per_page=1`,
      { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) return { active: null, dateCreation: null };
    const data = await r.json();
    const entreprise = data.results?.[0];
    if (!entreprise) return { active: null, dateCreation: null };
    return {
      active: entreprise.etat_administratif === 'A',
      dateCreation: entreprise.date_creation || null,
    };
  } catch {
    // On ne bloque jamais le scoring si l'API gouv est momentanément indisponible ;
    // entreprise_active reste "null" = à revérifier manuellement avant contact.
    return { active: null, dateCreation: null };
  }
}

// --- Récupère le site et calcule un score d'obsolescence ---
async function analyserSite(siteWebBrut) {
  const url = siteWebBrut.startsWith('http') ? siteWebBrut : `https://${siteWebBrut}`;
  const signaux = [];
  let score = 0;
  let html = '';
  let https_ok = false;

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    https_ok = r.url.startsWith('https://');
    html = await r.text();
  } catch (e) {
    try {
      const url2 = url.replace('https://', 'http://');
      const r2 = await fetch(url2, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15000),
      });
      html = await r2.text();
      https_ok = false;
    } catch (e2) {
      return {
        score: 70,
        signaux: ['site injoignable (aucune réponse HTTP)'],
        notes: `Impossible de charger ${url} : ${e2.message}. A vérifier manuellement (le domaine existe peut-être mais bloque les robots, ou le site est bien hors service).`,
      };
    }
  }

  if (!https_ok) {
    score += 20;
    signaux.push('pas de HTTPS');
  }

  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    score += 25;
    signaux.push('pas de balise viewport (probablement non responsive)');
  }

  const anneeMatch = html.match(/(?:©|copyright)[^\d]{0,15}(19|20)\d{2}/i);
  if (anneeMatch) {
    const annee = parseInt(anneeMatch[0].match(/(19|20)\d{2}/)[0], 10);
    const anneeActuelle = new Date().getFullYear();
    if (anneeActuelle - annee >= 5) {
      score += 20;
      signaux.push(`copyright daté de ${annee} (${anneeActuelle - annee} ans)`);
    }
  } else {
    score += 5;
    signaux.push('aucun millésime trouvé dans le pied de page');
  }

  if (/<frameset|<marquee|<blink|FrontPage|Dreamweaver/i.test(html)) {
    score += 30;
    signaux.push('traces techniques très anciennes (frames/marquee/FrontPage...)');
  }

  if (/<object[^>]+flash|\.swf/i.test(html)) {
    score += 25;
    signaux.push('contenu Flash détecté');
  }

  if (/<!doctype html 4|xhtml 1\.0 transitional/i.test(html)) {
    score += 15;
    signaux.push('doctype ancien (HTML4/XHTML)');
  } else if (!/<!doctype html>/i.test(html)) {
    score += 10;
    signaux.push('pas de doctype HTML5 standard');
  }

  const jqueryMatch = html.match(/jquery[.-](\d+\.\d+\.\d+)/i);
  if (jqueryMatch) {
    const majeur = parseInt(jqueryMatch[1].split('.')[0], 10);
    if (majeur < 2) {
      score += 15;
      signaux.push(`jQuery très ancien (${jqueryMatch[1]})`);
    }
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    signaux,
    notes: signaux.length
      ? `Signaux détectés : ${signaux.join(', ')}.`
      : "Aucun signal d'obsolescence détecté.",
  };
}

function determinerStatut(score, entrepriseActive) {
  if (entrepriseActive === false) return 'rejete'; // entreprise fermée : ne jamais contacter
  if (score >= 50) return 'qualifie';
  if (score <= 20) return 'rejete';
  return 'a_analyser'; // zone grise : revue manuelle recommandée avant la maquette
}

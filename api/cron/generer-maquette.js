// api/cron/generer-maquette.js
//
// Étape 2 de la campagne "refonte_batiment" : pour chaque entreprise qualifiée
// (statut = 'qualifie' dans prospection_sites_obsoletes), génère une maquette
// "après" — un site one-page moderne et responsive — via l'API Claude, PUIS
// construit une page de comparaison "avant / après" avec un curseur à glisser
// (capture en direct de leur vrai site à gauche, nouvelle maquette à droite),
// publie le tout dans Supabase Storage, et passe le statut à 'maquette_prete'.
// C'est CETTE page de comparaison (pas la maquette seule) qui est envoyée
// dans l'email, via maquette_url.
//
// Volontairement : AUCUNE photo du site d'origine n'est réutilisée. Le prompt
// interdit explicitement de copier des images ou des textes protégés de
// l'entreprise ; la maquette utilise uniquement des couleurs/formes/icônes
// génériques et des textes réécrits à partir du nom/métier/ville connus.
//
// -----------------------------------------------------------------------
// DÉPLOIEMENT
// -----------------------------------------------------------------------
// 1) Placer ce fichier dans  api/cron/generer-maquette.js
// 2) Ajouter dans vercel.json :
//      { "path": "/api/cron/generer-maquette", "schedule": "30 6 * * *" }
//    (après le scan, par exemple 30 min plus tard)
// 3) Variables d'environnement nécessaires (toutes déjà présentes dans le
//    projet Vercel "salesflow-ecosky", y compris ANTHROPIC_API_KEY) :
//      SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
//    Optionnelle :
//      MAQUETTE_BATCH_SIZE  (défaut 5 — la génération coûte un appel API par
//      maquette, on reste prudent sur le volume par exécution)
// 4) Créer un bucket PUBLIC dans Supabase Storage nommé "maquettes-sites"
//    (Dashboard Supabase > Storage > New bucket > cocher "Public bucket").
//
// -----------------------------------------------------------------------
// CROSS-SELL SKYECO.FR
// -----------------------------------------------------------------------
// Selon la catégorie de l'entreprise, la maquette met en avant l'app Skyeco
// la plus pertinente (voir appSkyecoPour ci-dessous) :
//   - Constructeur maisons / Architecte            -> Estimateur BTP (devis rapides)
//   - Entreprise générale / Maître d'œuvre / Promoteur -> Contact Chantier (suivi multi-chantiers)
// Ajuste cette logique si tu préfères une autre association.

import { createClient } from '@supabase/supabase-js';

const BATCH_SIZE = Number(process.env.MAQUETTE_BATCH_SIZE || 100);

export const config = { maxDuration: 300 };
const CAMPAGNE = 'refonte_batiment';
const BUCKET = 'maquettes-sites';
const SITE_PUBLIC_URL = process.env.SITE_PUBLIC_URL || 'https://salesflow-ecosky.vercel.app';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const resultats = { traites: 0, generes: 0, erreurs: 0 };

  try {
    const { data: candidats, error } = await supabase
      .from('prospection_sites_obsoletes')
      .select('id, siren, nom, ville, categorie, site_web, signaux')
      .eq('campagne', CAMPAGNE)
      .eq('statut', 'qualifie')
      .is('maquette_url', null)
      .limit(BATCH_SIZE);

    if (error) throw error;

    for (const candidat of candidats) {
      resultats.traites++;
      try {
        // 1) La nouvelle maquette "après" (modèle gratuit, sans appel IA)
        const htmlApres = genererHtmlMaquette(candidat);
        const cheminApres = `${CAMPAGNE}/${candidat.siren}-apres.html`;

        const { error: errUploadApres } = await supabase.storage
          .from(BUCKET)
          .upload(cheminApres, htmlApres, {
            contentType: 'text/html; charset=utf-8',
            upsert: true,
          });
        if (errUploadApres) throw errUploadApres;

        // Supabase Storage sert le HTML en texte brut : on passe par notre
        // route /api/maquette/ qui le renvoie en vraie page web.
        const urlApres = `/api/maquette/${candidat.siren}-apres.html`;

        // 2) La page de comparaison "avant / après" avec curseur, qui embarque
        //    une capture en direct du vrai site (service gratuit thum.io, pas
        //    de clé requise) et la nouvelle maquette dans un cadre
        const htmlComparaison = genererHtmlComparaison(candidat, urlApres);
        const cheminComparaison = `${CAMPAGNE}/${candidat.siren}-comparaison.html`;

        const { error: errUploadComp } = await supabase.storage
          .from(BUCKET)
          .upload(cheminComparaison, htmlComparaison, {
            contentType: 'text/html; charset=utf-8',
            upsert: true,
          });
        if (errUploadComp) throw errUploadComp;

        const urlComparaison = `${SITE_PUBLIC_URL}/api/maquette/${candidat.siren}-comparaison.html`;

        // C'est la page de COMPARAISON (pas la maquette seule) qui est envoyée
        // dans l'email par envoyer-prospection-sites.js
        const { error: errUpdate } = await supabase
          .from('prospection_sites_obsoletes')
          .update({
            maquette_url: urlComparaison,
            statut: 'maquette_prete',
            maj_le: new Date().toISOString(),
          })
          .eq('id', candidat.id);
        if (errUpdate) throw errUpdate;

        resultats.generes++;
      } catch (e) {
        console.error(`Erreur maquette pour ${candidat.siren} (${candidat.nom}) :`, e.message);
        resultats.erreurs++;
      }
    }

    return res.status(200).json(resultats);
  } catch (e) {
    console.error('Erreur generer-maquette :', e);
    return res.status(500).json({ error: e.message, ...resultats });
  }
}

function appSkyecoPour(categorie) {
  const cible = (categorie || '').toLowerCase();
  if (cible.includes('constructeur') || cible.includes('architecte')) {
    return {
      nom: 'Estimateur BTP',
      pitch: 'un outil pour chiffrer un devis client en quelques minutes depuis le chantier',
    };
  }
  return {
    nom: 'Contact Chantier',
    pitch: 'un outil pour suivre tous vos chantiers et vos équipes au même endroit, sans paperasse',
  };
}

// --- Maquette "après" construite à partir d'un modèle (0 €, instantané).
//     Seuls le nom, le métier et la ville de l'entreprise sont utilisés. ---
function servicesPour(categorie) {
  const c = (categorie || '').toLowerCase();
  if (c.includes('architecte')) return [
    ['Conception sur mesure', 'Des plans pensés pour votre terrain, votre budget et votre façon de vivre.'],
    ['Permis de construire', 'Montage complet du dossier et suivi auprès de la mairie.'],
    ['Suivi de chantier', 'Un regard attentif à chaque étape, jusqu\'à la réception.'],
  ];
  if (c.includes('constructeur') || c.includes('maison')) return [
    ['Maisons neuves', 'Plain-pied ou étage, une maison construite selon vos envies.'],
    ['Accompagnement complet', 'Du choix du terrain à la remise des clés, un seul interlocuteur.'],
    ['Garanties', 'Contrat de construction encadré et garanties légales incluses.'],
  ];
  if (c.includes('promoteur')) return [
    ['Programmes neufs', 'Appartements et maisons dans des emplacements choisis.'],
    ['Accompagnement acquéreurs', 'Conseils, visites et suivi jusqu\'à la livraison.'],
    ['Qualité de construction', 'Des logements performants et durables.'],
  ];
  return [
    ['Construction & gros œuvre', 'Fondations, maçonnerie, structure : un travail solide et durable.'],
    ['Rénovation', 'Remise à neuf, extension, transformation de vos espaces.'],
    ['Gestion de chantier', 'Coordination des corps de métier, délais tenus, chantier propre.'],
  ];
}

function genererHtmlMaquette(candidat) {
  const app = appSkyecoPour(candidat.categorie);
  const nom = escapeHtml(candidat.nom || 'Votre entreprise');
  const metier = escapeHtml(candidat.categorie || 'Entreprise du bâtiment');
  const ville = escapeHtml(candidat.ville || 'votre région');
  const services = servicesPour(candidat.categorie).map(([t, d], i) => `
      <div class="service">
        <div class="ico">${['🏗️', '🔨', '📐'][i]}</div>
        <h3>${t}</h3><p>${d}</p>
      </div>`).join('');

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${nom} — ${metier} à ${ville}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#1d2a24;background:#fff;line-height:1.55}
.demo{background:#fff8e1;color:#6d5400;font-size:12px;text-align:center;padding:6px 12px}
nav{display:flex;justify-content:space-between;align-items:center;padding:16px 6vw}
.logo{font-weight:800;font-size:20px;color:#14532d}
nav a.btn{padding:10px 18px}
.hero{background:linear-gradient(135deg,#14532d 0%,#1f7a4c 55%,#e3a008 140%);color:#fff;padding:90px 6vw 100px;position:relative;overflow:hidden}
.hero:after{content:"";position:absolute;right:-80px;bottom:-80px;width:340px;height:340px;border-radius:50%;background:rgba(255,255,255,.08)}
.hero h1{font-size:clamp(30px,5vw,52px);margin:0 0 14px;max-width:720px;line-height:1.1}
.hero p{font-size:18px;max-width:560px;opacity:.92;margin:0 0 28px}
.btn{display:inline-block;background:#e3a008;color:#1d2a24;font-weight:700;text-decoration:none;border-radius:10px;padding:14px 26px}
.btn.clair{background:#fff;color:#14532d;margin-left:8px}
section{padding:70px 6vw}
h2{font-size:30px;margin:0 0 30px;color:#14532d}
.services{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px}
.service{background:#f4f7f5;border-radius:14px;padding:26px}
.service .ico{font-size:32px}.service h3{margin:10px 0 6px}
.pourquoi{background:#14532d;color:#fff}.pourquoi h2{color:#fff}
.atouts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:18px}
.atout b{display:block;font-size:34px;color:#e3a008}
.contact{text-align:center}.contact p{color:#555}
.skyeco{margin:0 6vw 50px;background:#f4f7f5;border-left:4px solid #1f7a4c;border-radius:10px;padding:18px 22px;font-size:14px}
footer{text-align:center;font-size:13px;color:#777;padding:24px}
@media(max-width:600px){.btn.clair{margin:10px 0 0}nav a.btn{display:none}}
</style></head><body>
<div class="demo">Maquette de démonstration réalisée par EcoSky — illustration du potentiel de votre futur site, aucune donnée réelle de votre entreprise n'a été utilisée hormis son nom et son secteur.</div>
<nav><span class="logo">${nom}</span><a class="btn" href="#contact">Demander un devis</a></nav>
<header class="hero">
  <h1>${metier} à ${ville}, un travail soigné et dans les délais</h1>
  <p>${nom} vous accompagne dans tous vos projets, avec un interlocuteur unique et des devis clairs.</p>
  <a class="btn" href="#contact">Demander un devis gratuit</a><a class="btn clair" href="#services">Nos services</a>
</header>
<section id="services"><h2>Nos services</h2><div class="services">${services}</div></section>
<section class="pourquoi"><h2>Pourquoi nous choisir ?</h2><div class="atouts">
  <div class="atout"><b>✓</b>Artisans qualifiés et assurés</div>
  <div class="atout"><b>✓</b>Devis détaillé sous 48 h</div>
  <div class="atout"><b>✓</b>Interventions autour de ${ville}</div>
  <div class="atout"><b>✓</b>Suivi de chantier transparent</div>
</div></section>
<section class="contact" id="contact"><h2>Parlons de votre projet</h2>
  <p>contact@exemple.fr · 02 XX XX XX XX (coordonnées d'exemple)</p>
  <a class="btn" href="#contact">Demander un devis</a>
</section>
<div class="skyeco"><strong>${app.nom}</strong> par Skyeco Pro (skyeco.fr) : ${app.pitch}.</div>
<footer>© ${new Date().getFullYear()} ${nom} — maquette de démonstration</footer>
</body></html>`;
}

// --- Construit la page de comparaison "avant / après" avec curseur à glisser.
//     "Avant" = capture d'écran EN DIRECT de leur vrai site, via thum.io (service
//     gratuit, aucune clé requise : on construit juste une URL d'image).
//     "Après" = la maquette générée, affichée dans un <iframe>. ---
function genererHtmlComparaison(candidat, urlMaquetteApres) {
  const siteBrut = candidat.site_web.replace(/^https?:\/\//, '');
  const urlCapture = `https://image.thum.io/get/width/1000/noanimate/https://${siteBrut}`;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(candidat.nom)} — avant / après</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f4f5f3; color: #222;
  }
  header {
    padding: 18px 16px; text-align: center; background: #1a7a4c; color: #fff;
  }
  header h1 { margin: 0 0 4px; font-size: 18px; }
  header p { margin: 0; font-size: 13px; opacity: .9; }
  .cadre {
    position: relative; max-width: 1000px; margin: 20px auto; aspect-ratio: 10 / 7;
    overflow: hidden; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.15);
    background: #ddd; touch-action: pan-y;
  }
  .couche { position: absolute; inset: 0; width: 100%; height: 100%; }
  .couche img, .couche iframe { width: 100%; height: 100%; border: 0; object-fit: cover; object-position: top; display: block; }
  .apres-couche { clip-path: inset(0 0 0 50%); }
  .etiquette {
    position: absolute; top: 10px; padding: 4px 10px; border-radius: 20px;
    background: rgba(0,0,0,.6); color: #fff; font-size: 12px; font-weight: bold; z-index: 3;
  }
  .etiquette.avant { left: 10px; }
  .etiquette.apres { right: 10px; }
  .curseur {
    position: absolute; top: 0; bottom: 0; left: 50%; width: 0;
    border-left: 3px solid #fff; z-index: 4; pointer-events: none;
  }
  .poignee {
    position: absolute; top: 50%; left: 50%; width: 42px; height: 42px;
    transform: translate(-50%, -50%); background: #fff; border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0,0,0,.3); z-index: 5; cursor: ew-resize;
    display: flex; align-items: center; justify-content: center; font-size: 18px;
  }
  input[type=range] {
    width: 100%; max-width: 1000px; display: block; margin: 0 auto 24px; accent-color: #1a7a4c;
  }
  .bas { max-width: 640px; margin: 0 auto; padding: 0 16px 40px; text-align: center; }
  .cta {
    display: inline-block; margin-top: 10px; background: #1a7a4c; color: #fff;
    padding: 12px 26px; border-radius: 8px; text-decoration: none; font-weight: bold;
  }
  .appli {
    margin-top: 28px; padding: 16px; background: #fff; border-radius: 10px;
    font-size: 14px; color: #444; text-align: left;
  }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(candidat.nom)} — à quoi pourrait ressembler votre site</h1>
    <p>Glissez le curseur pour comparer : à gauche votre site actuel, à droite un aperçu possible.</p>
  </header>

  <div class="cadre" id="cadre">
    <div class="couche">
      <span class="etiquette avant">Votre site actuel</span>
      <img src="${urlCapture}" alt="Site actuel de ${escapeHtml(candidat.nom)}" loading="lazy">
    </div>
    <div class="couche apres-couche" id="coucheApres">
      <span class="etiquette apres">Ce qu'on pourrait proposer</span>
      <iframe src="${urlMaquetteApres}" title="Nouvelle maquette"></iframe>
    </div>
    <div class="curseur" id="curseur"><div class="poignee">↔</div></div>
  </div>

  <input type="range" min="0" max="100" value="50" id="slider" aria-label="Curseur avant après">

  <div class="bas">
    <p>Cette maquette est une démonstration : aucune photo ni texte de votre site actuel n'a été réutilisé.</p>
    <a class="cta" href="mailto:infos@ecosky.fr?subject=${encodeURIComponent('Intéressé par le nouveau site - ' + candidat.nom)}">Ça m'intéresse, on en parle</a>
    <div class="appli">
      Au passage, si vous gérez plusieurs chantiers en même temps, on a aussi un outil pensé pour les pros du bâtiment sur <strong>skyeco.fr</strong> — simple à prendre en main, pas de paperasse en plus.
    </div>
  </div>

<script>
(function () {
  var cadre = document.getElementById('cadre');
  var coucheApres = document.getElementById('coucheApres');
  var curseur = document.getElementById('curseur');
  var slider = document.getElementById('slider');

  function appliquer(pourcent) {
    coucheApres.style.clipPath = 'inset(0 0 0 ' + pourcent + '%)';
    curseur.style.left = pourcent + '%';
  }

  slider.addEventListener('input', function (e) {
    appliquer(Number(e.target.value));
  });

  appliquer(50);
})();
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

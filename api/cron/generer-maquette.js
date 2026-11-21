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

const BATCH_SIZE = Number(process.env.MAQUETTE_BATCH_SIZE || 5);
const CAMPAGNE = 'refonte_batiment';
const BUCKET = 'maquettes-sites';

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
        // 1) La nouvelle maquette "après" (générée par Claude)
        const htmlApres = await genererHtmlMaquette(candidat);
        const cheminApres = `${CAMPAGNE}/${candidat.siren}-apres.html`;

        const { error: errUploadApres } = await supabase.storage
          .from(BUCKET)
          .upload(cheminApres, htmlApres, {
            contentType: 'text/html; charset=utf-8',
            upsert: true,
          });
        if (errUploadApres) throw errUploadApres;

        const { data: pubApres } = supabase.storage.from(BUCKET).getPublicUrl(cheminApres);

        // 2) La page de comparaison "avant / après" avec curseur, qui embarque
        //    une capture en direct du vrai site (service gratuit thum.io, pas
        //    de clé requise) et la nouvelle maquette dans un cadre
        const htmlComparaison = genererHtmlComparaison(candidat, pubApres.publicUrl);
        const cheminComparaison = `${CAMPAGNE}/${candidat.siren}-comparaison.html`;

        const { error: errUploadComp } = await supabase.storage
          .from(BUCKET)
          .upload(cheminComparaison, htmlComparaison, {
            contentType: 'text/html; charset=utf-8',
            upsert: true,
          });
        if (errUploadComp) throw errUploadComp;

        const { data: pubComp } = supabase.storage.from(BUCKET).getPublicUrl(cheminComparaison);

        // C'est la page de COMPARAISON (pas la maquette seule) qui est envoyée
        // dans l'email par envoyer-prospection-sites.js
        const { error: errUpdate } = await supabase
          .from('prospection_sites_obsoletes')
          .update({
            maquette_url: pubComp.publicUrl,
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

async function genererHtmlMaquette(candidat) {
  const app = appSkyecoPour(candidat.categorie);

  const prompt = `Tu es designer web. Génère une page HTML unique, complète et autonome (tout le CSS inline dans une balise <style>, aucun fichier externe sauf une police Google Fonts si tu veux), pour servir de MAQUETTE DE DÉMONSTRATION "avant/après" à envoyer par email à un artisan du bâtiment, afin de lui proposer une refonte de son site.

Informations connues sur l'entreprise (n'invente rien d'autre de factuel) :
- Nom : ${candidat.nom}
- Métier : ${candidat.categorie || 'entreprise du bâtiment'}
- Ville : ${candidat.ville || 'France'}
- Signaux relevés sur leur site actuel : ${(candidat.signaux || []).join(', ') || 'site daté'}

Contraintes IMPORTANTES :
- N'utilise JAMAIS de vraie photo ni de texte copié du site actuel de l'entreprise. Zéro image réelle : utilise uniquement des dégradés CSS, des formes géométriques simples (div stylées) ou des icônes en SVG inline génériques (silhouette de maison, outils, casque de chantier stylisé) — jamais de <img> pointant vers une vraie photo.
- Rédige un contenu générique mais crédible pour ce métier et cette ville (accroche, 3 services types, une section "pourquoi nous", coordonnées factices du type "contact@exemple.fr" / "02 XX XX XX XX" clairement en exemple).
- Design moderne 2026 : responsive mobile, typographie soignée, une section héro avec un bon contraste, des boutons d'appel à l'action clairs ("Demander un devis").
- Tout en haut de la page (avant le header), ajoute un bandeau discret mais visible avec le texte : "Maquette de démonstration réalisée par EcoSky — illustration du potentiel de votre futur site, aucune donnée réelle de votre entreprise n'a été utilisée hormis son nom et son secteur."
- En bas de page, ajoute un encart présentant en 2-3 lignes l'application "${app.nom}" de Skyeco Pro (skyeco.fr) : ${app.pitch}.
- Réponds UNIQUEMENT avec le code HTML complet, sans explication avant ou après, sans balises markdown \`\`\`.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!r.ok) {
    throw new Error(`Appel API Claude échoué (${r.status}) : ${await r.text()}`);
  }

  const data = await r.json();
  let html = data.content?.[0]?.text || '';
  html = html.replace(/^```html\s*/i, '').replace(/```\s*$/i, '').trim();

  if (!/<html/i.test(html)) {
    throw new Error('La réponse ne ressemble pas à une page HTML complète.');
  }

  return html;
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
    <a class="cta" href="mailto:contact@ecosky.fr?subject=${encodeURIComponent('Intéressé par le nouveau site - ' + candidat.nom)}">Ça m'intéresse, on en parle</a>
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

// api/radar/dashboard.js
//
// "Skyeco Radar" — tableau de bord de pilotage de la campagne refonte_batiment
// (repérage des sites bâtiment obsolètes, maquettes générées, emails envoyés).
//
// -----------------------------------------------------------------------
// DÉPLOIEMENT
// -----------------------------------------------------------------------
// 1) Placer ce fichier dans  api/radar/dashboard.js  de ton projet Vercel
//    "salesflow-ecosky" (il va chercher directement dans Supabase, donc pas
//    besoin d'autre route).
// 2) Accessible à l'URL : https://salesflow-ecosky.vercel.app/api/radar/dashboard
// 3) Variables d'environnement utilisées (toutes déjà présentes) :
//      SUPABASE_URL, SUPABASE_SERVICE_KEY, DASHBOARD_USER, DASHBOARD_PASSWORD
//    -> même identifiant/mot de passe que ton dashboard SalesFlow existant.
// 4) Filtres disponibles par l'URL, ex. :
//      /api/radar/dashboard?statut=qualifie
//      /api/radar/dashboard?statut=email_envoye&ville=Mauron

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const CAMPAGNE = 'refonte_batiment';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (!verifierAuth(req)) {
    // Renvoie vers la page de connexion SalesFlow (avec l'œil pour voir le mot de passe)
    res.writeHead(302, { Location: '/connexion?next=/api/radar/dashboard' });
    return res.end();
  }

  const statutFiltre = req.query.statut || null;
  const villeFiltre = req.query.ville || null;

  try {
    const { data: compteurs } = await supabase
      .from('prospection_sites_obsoletes')
      .select('statut')
      .eq('campagne', CAMPAGNE);

    const totauxParStatut = {};
    (compteurs || []).forEach((r) => {
      totauxParStatut[r.statut] = (totauxParStatut[r.statut] || 0) + 1;
    });

    let requete = supabase
      .from('prospection_sites_obsoletes')
      .select('*')
      .eq('campagne', CAMPAGNE)
      .order('score_obsolescence', { ascending: false, nullsFirst: false })
      .limit(200);

    if (statutFiltre) requete = requete.eq('statut', statutFiltre);
    if (villeFiltre) requete = requete.ilike('ville', `%${villeFiltre}%`);

    const { data: lignes, error } = await requete;
    if (error) throw error;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(rendreHtml(totauxParStatut, lignes || [], statutFiltre, villeFiltre));
  } catch (e) {
    console.error('Erreur dashboard radar :', e);
    return res.status(500).send('Erreur serveur : ' + escapeHtml(e.message));
  }
}

function verifierAuth(req) {
  const user = process.env.DASHBOARD_USER || 'cyrille';
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!pass) return true; // pas de protection configurée, on laisse passer

  // Session ouverte via la page de connexion SalesFlow (cookie sf_session)
  const jeton = createHash('sha256').update(`${user}:${pass}:salesflow-session`).digest('hex');
  const cookies = req.headers['cookie'] || '';
  if (cookies.split(';').some((c) => c.trim() === `sf_session=${jeton}`)) return true;

  // Ancienne méthode (Basic) toujours acceptée
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
  const [u, ...p] = decoded.split(':');
  return u === user && p.join(':') === pass;
}

const LIBELLES_STATUT = {
  a_analyser: 'À analyser',
  qualifie: 'Qualifié',
  rejete: 'Rejeté',
  maquette_prete: 'Maquette prête',
  email_envoye: 'Email envoyé',
  repondu: 'A répondu',
  client: 'Client',
  stop: 'STOP',
};

function rendreHtml(totaux, lignes, statutFiltre, villeFiltre) {
  const ordreStatuts = ['qualifie', 'maquette_prete', 'email_envoye', 'repondu', 'client', 'a_analyser', 'rejete', 'stop'];

  const cartes = ordreStatuts.map((s) => {
    const n = totaux[s] || 0;
    const actif = statutFiltre === s;
    return `<a class="carte${actif ? ' actif' : ''}" href="?statut=${s}${villeFiltre ? '&ville=' + encodeURIComponent(villeFiltre) : ''}">
      <div class="nombre">${n}</div>
      <div class="libelle">${LIBELLES_STATUT[s] || s}</div>
    </a>`;
  }).join('');

  const lignesHtml = lignes.map((l) => `
    <tr>
      <td>${escapeHtml(l.nom || '')}</td>
      <td>${escapeHtml(l.ville || '')}</td>
      <td>${escapeHtml(l.categorie || '')}</td>
      <td><a href="https://${escapeAttr(l.site_web)}" target="_blank" rel="noopener">${escapeHtml(l.site_web || '')}</a></td>
      <td class="score score-${classeScore(l.score_obsolescence)}">${l.score_obsolescence ?? '—'}</td>
      <td><span class="badge badge-${l.statut}">${LIBELLES_STATUT[l.statut] || l.statut}</span></td>
      <td>${l.entreprise_active === true ? '✅' : l.entreprise_active === false ? '❌ fermée' : '❔ à vérifier'}</td>
      <td>${l.maquette_url ? `<a href="${escapeAttr(lienMaquette(l.maquette_url))}" target="_blank" rel="noopener">voir</a>` : '—'}</td>
      <td>${escapeHtml((l.notes || '').slice(0, 140))}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skyeco Radar — refonte_batiment</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f4f5f3; color: #222; }
  header { background: #1a7a4c; color: #fff; padding: 18px 24px; }
  header h1 { margin: 0; font-size: 20px; }
  header p { margin: 4px 0 0; font-size: 13px; opacity: .9; }
  .contenu { padding: 20px; max-width: 1200px; margin: 0 auto; }
  .cartes { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 24px; }
  .carte { background: #fff; border-radius: 8px; padding: 12px 18px; text-align: center; text-decoration: none; color: #222; box-shadow: 0 1px 4px rgba(0,0,0,.08); min-width: 100px; }
  .carte.actif { outline: 2px solid #1a7a4c; }
  .carte .nombre { font-size: 22px; font-weight: bold; }
  .carte .libelle { font-size: 12px; color: #666; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; font-size: 13px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
  th { background: #eef0ed; font-size: 12px; text-transform: uppercase; color: #555; }
  .score-haut { color: #b00020; font-weight: bold; }
  .score-moyen { color: #a66a00; }
  .score-bas { color: #1a7a4c; }
  .badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; background: #eee; }
  .badge-qualifie { background: #d9f3e2; color: #1a7a4c; }
  .badge-maquette_prete { background: #d9e8f3; color: #1a4f7a; }
  .badge-email_envoye { background: #e3d9f3; color: #5a1a7a; }
  .badge-rejete, .badge-stop { background: #f3d9d9; color: #7a1a1a; }
  form.filtre { margin-bottom: 16px; }
  form.filtre input { padding: 6px 10px; border-radius: 6px; border: 1px solid #ccc; }
  form.filtre button { padding: 6px 14px; border-radius: 6px; border: none; background: #1a7a4c; color: #fff; cursor: pointer; }
</style>
</head>
<body>
<header>
  <h1>Skyeco Radar</h1>
  <p>Campagne refonte_batiment — sites obsolètes du bâtiment</p>
</header>
<div class="contenu">
  <div class="cartes">
    <a class="carte${!statutFiltre ? ' actif' : ''}" href="?">
      <div class="nombre">${lignes.length}</div>
      <div class="libelle">Affichés</div>
    </a>
    ${cartes}
  </div>

  <form class="filtre" method="get">
    ${statutFiltre ? `<input type="hidden" name="statut" value="${escapeAttr(statutFiltre)}">` : ''}
    <input type="text" name="ville" placeholder="Filtrer par ville" value="${escapeAttr(villeFiltre || '')}">
    <button type="submit">Filtrer</button>
    ${(statutFiltre || villeFiltre) ? '<a href="?" style="margin-left:10px;font-size:13px">Réinitialiser</a>' : ''}
  </form>

  <table>
    <thead>
      <tr>
        <th>Nom</th><th>Ville</th><th>Métier</th><th>Site</th><th>Score</th><th>Statut</th><th>Active ?</th><th>Maquette</th><th>Notes</th>
      </tr>
    </thead>
    <tbody>${lignesHtml || '<tr><td colspan="9">Aucun résultat.</td></tr>'}</tbody>
  </table>
</div>
</body>
</html>`;
}

function classeScore(score) {
  if (score == null) return 'moyen';
  if (score >= 50) return 'haut';
  if (score <= 20) return 'bas';
  return 'moyen';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// Anciennes fiches : lien direct Supabase (affiché en texte) -> route /api/maquette/
function lienMaquette(url) {
  return String(url || '').replace(
    /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/maquettes-sites\/refonte_batiment\//,
    '/api/maquette/'
  );
}

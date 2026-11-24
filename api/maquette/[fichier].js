// api/maquette/[fichier].js
//
// Sert les maquettes "Skyeco Radar" (avant/après) en vraie page web.
//
// Pourquoi : Supabase Storage renvoie volontairement les fichiers .html en
// "text/plain" (protection anti-piratage), donc le lien direct vers le
// bucket affichait le code source au lieu de la maquette. Cette route lit le
// fichier dans le bucket "maquettes-sites" et le renvoie en text/html.
//
// URL : /api/maquette/<siren>-comparaison.html  ou  /api/maquette/<siren>-apres.html
// Route publique (les prospects doivent pouvoir l'ouvrir sans mot de passe).

import { createClient } from '@supabase/supabase-js';

const BUCKET = 'maquettes-sites';
const CAMPAGNE = 'refonte_batiment';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const fichier = String(req.query.fichier || '');
  if (!/^\d{9}-(apres|comparaison)\.html$/.test(fichier)) {
    return res.status(400).send('Lien invalide.');
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(`${CAMPAGNE}/${fichier}`);

  if (error || !data) {
    return res.status(404).send('Maquette introuvable.');
  }

  let html = await data.text();

  // Les anciennes pages de comparaison chargent la maquette "après" depuis
  // l'URL Supabase (qui s'affiche en texte) : on la remplace par cette route.
  html = html.replace(
    /https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/maquettes-sites\/refonte_batiment\//g,
    '/api/maquette/'
  );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(html);
}

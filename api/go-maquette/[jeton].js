// api/go-maquette/[jeton].js
//
// Lien de suivi cliqué dans l'email de la campagne "refonte_batiment".
// Enregistre le clic dans prospection_envois (même logique que tes autres
// campagnes : clic_le, nb_clics) puis redirige vers la vraie maquette.
//
// DÉPLOIEMENT : placer dans api/go-maquette/[jeton].js (le nom de fichier
// avec crochets est important pour que Vercel route /api/go-maquette/<jeton>
// vers ce fichier avec req.query.jeton rempli automatiquement).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const { jeton } = req.query;

  if (!jeton) {
    return res.status(400).send('Lien invalide.');
  }

  try {
    const { data: envoi } = await supabase
      .from('prospection_envois')
      .select('id, siren, campagne, nb_clics')
      .eq('jeton', jeton)
      .maybeSingle();

    if (!envoi) {
      return res.status(404).send('Lien introuvable ou expiré.');
    }

    // Journalise le clic (ne bloque pas la redirection si ça échoue)
    supabase
      .from('prospection_envois')
      .update({
        clic_le: new Date().toISOString(),
        nb_clics: (envoi.nb_clics || 0) + 1,
      })
      .eq('id', envoi.id)
      .then(() => {})
      .catch((e) => console.error('Erreur journalisation clic :', e.message));

    const { data: fiche } = await supabase
      .from('prospection_sites_obsoletes')
      .select('maquette_url')
      .eq('siren', envoi.siren)
      .eq('campagne', envoi.campagne)
      .maybeSingle();

    if (!fiche?.maquette_url) {
      return res.status(404).send('Maquette introuvable.');
    }

    res.writeHead(302, { Location: fiche.maquette_url });
    return res.end();
  } catch (e) {
    console.error('Erreur go-maquette :', e);
    return res.status(500).send('Erreur serveur.');
  }
}

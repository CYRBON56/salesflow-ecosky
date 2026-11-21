// api/cron/envoyer-prospection-sites.js
//
// Étape 3 de la campagne "refonte_batiment" : envoie l'email de prise de
// contact aux entreprises dont la maquette est prête (statut = 'maquette_prete'
// dans prospection_sites_obsoletes), en réutilisant exactement le même circuit
// que les autres campagnes Contact Chantier / SalesFlow :
//   - vérifie prospection_stop avant tout envoi (jamais de mail à une adresse
//     qui a déjà demandé à être désinscrite, quelle que soit la campagne)
//   - journalise l'envoi dans prospection_envois (même table que les autres
//     campagnes), avec un jeton de suivi
//   - envoie via Resend
//
// -----------------------------------------------------------------------
// DÉPLOIEMENT
// -----------------------------------------------------------------------
// 1) Placer ce fichier dans  api/cron/envoyer-prospection-sites.js
// 2) Ajouter dans vercel.json :
//      { "path": "/api/cron/envoyer-prospection-sites", "schedule": "0 9 * * 2" }
//    (exemple : tous les mardis à 9h — à adapter selon le rythme d'envoi que
//    tu veux tenir ; commence petit, ex. 20-30 emails par semaine)
// 3) Variables d'environnement nécessaires :
//      SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL
//      (toutes déjà présentes dans le projet Vercel "salesflow-ecosky")
//      SITE_PUBLIC_URL   (nouvelle — ex. https://salesflow-ecosky.vercel.app,
//                         sert à construire le lien de suivi des clics)
//    Optionnelle :
//      ENVOI_BATCH_SIZE  (défaut 20)
//
// 4) Déployer aussi api/go-maquette/[jeton].js (fichier séparé fourni) : c'est
//    le lien cliqué dans l'email qui enregistre le clic puis redirige vers la
//    maquette réelle hébergée sur Supabase Storage.
//
// -----------------------------------------------------------------------
// IMPORTANT (conformité prospection B2B) :
// -----------------------------------------------------------------------
// - email_contact doit être une adresse professionnelle (contact@, pas un
//   gmail personnel) : c'est déjà le cas dans prospects_construction.
// - Le mail contient une mention claire de désinscription ("Répondez STOP").
// - On ne contacte jamais une entreprise dont entreprise_active = false.

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const CAMPAGNE = 'refonte_batiment';
const BATCH_SIZE = Number(process.env.ENVOI_BATCH_SIZE || 20);
const EXPEDITEUR = process.env.RESEND_FROM_EMAIL;
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

  const resultats = { eligibles: 0, envoyes: 0, stop: 0, sans_email: 0, erreurs: 0 };

  try {
    const { data: candidats, error } = await supabase
      .from('prospection_sites_obsoletes')
      .select('id, siren, nom, ville, categorie, site_web, maquette_url, email_contact, entreprise_active')
      .eq('campagne', CAMPAGNE)
      .eq('statut', 'maquette_prete')
      .not('maquette_url', 'is', null)
      .limit(BATCH_SIZE);

    if (error) throw error;

    const { data: stops } = await supabase.from('prospection_stop').select('email');
    const emailsStop = new Set((stops || []).map((s) => s.email.toLowerCase()));

    for (const candidat of candidats) {
      resultats.eligibles++;

      if (candidat.entreprise_active === false) {
        await marquer(candidat.id, 'rejete', 'Entreprise fermée au registre, envoi annulé.');
        continue;
      }

      if (!candidat.email_contact) {
        resultats.sans_email++;
        await marquer(candidat.id, 'a_analyser', "Pas d'email connu, impossible d'envoyer.");
        continue;
      }

      const emailLower = candidat.email_contact.toLowerCase();
      if (emailsStop.has(emailLower)) {
        resultats.stop++;
        await marquer(candidat.id, 'stop', 'Adresse déjà en liste STOP, envoi annulé.');
        continue;
      }

      try {
        const jeton = randomUUID();
        const lienMaquette = `${SITE_PUBLIC_URL}/api/go-maquette/${jeton}`;

        const { data: envoi, error: errResend } = await envoyerEmail({
          to: candidat.email_contact,
          nom: candidat.nom,
          ville: candidat.ville,
          lienMaquette,
        });
        if (errResend) throw errResend;

        await supabase.from('prospection_envois').insert({
          siren: candidat.siren,
          email: candidat.email_contact,
          campagne: CAMPAGNE,
          envoye_le: new Date().toISOString(),
          jeton,
          statut: 'envoye',
          resend_id: envoi?.id || null,
          categorie: candidat.categorie,
          nom: candidat.nom,
        });

        await marquer(candidat.id, 'email_envoye', `Email envoyé le ${new Date().toISOString()} (jeton ${jeton}).`);
        resultats.envoyes++;
      } catch (e) {
        console.error(`Erreur envoi pour ${candidat.siren} (${candidat.nom}) :`, e.message);
        resultats.erreurs++;
      }
    }

    return res.status(200).json(resultats);
  } catch (e) {
    console.error('Erreur envoyer-prospection-sites :', e);
    return res.status(500).json({ error: e.message, ...resultats });
  }
}

async function marquer(id, statut, note) {
  await supabase
    .from('prospection_sites_obsoletes')
    .update({ statut, notes: note, maj_le: new Date().toISOString() })
    .eq('id', id);
}

async function envoyerEmail({ to, nom, ville, lienMaquette }) {
  const sujet = `${nom} : un aperçu de ce que pourrait donner votre site`;

  const texte = `Bonjour,

On a jeté un œil au site de ${nom}${ville ? ` (${ville})` : ''}, et on s'est dit qu'il mériterait un coup de neuf.

Alors on a pris une heure pour vous préparer un aperçu concret de ce que ça pourrait donner, sans engagement de votre part : ${lienMaquette}

Si ça vous plaît, on propose une formule simple : le site en location, avec la maintenance et les mises à jour incluses, sans que vous ayez à y penser. On peut aussi vous montrer nos outils pour gagner du temps au quotidien sur vos chantiers.

Si vous préférez ne plus recevoir ce type de message, répondez simplement "STOP" à cet email.

Cordialement,
Cyrille Bon
EcoSky by RMS`;

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.5;max-width:560px">
      <p>Bonjour,</p>
      <p>On a jeté un œil au site de <strong>${escapeHtml(nom)}</strong>${ville ? ` (${escapeHtml(ville)})` : ''}, et on s'est dit qu'il mériterait un coup de neuf.</p>
      <p>Alors on a pris une heure pour vous préparer un aperçu concret de ce que ça pourrait donner, sans engagement de votre part :</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${lienMaquette}" style="background:#1a7a4c;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Voir l'aperçu de votre futur site</a>
      </p>
      <p>Si ça vous plaît, on propose une formule simple : le site en location, avec la maintenance et les mises à jour incluses, sans que vous ayez à y penser. On peut aussi vous montrer nos outils pour gagner du temps au quotidien sur vos chantiers.</p>
      <p style="color:#777;font-size:13px">Si vous préférez ne plus recevoir ce type de message, répondez simplement "STOP" à cet email.</p>
      <p>Cordialement,<br>Cyrille Bon<br>EcoSky by RMS</p>
    </div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: EXPEDITEUR,
      to: [to],
      subject: sujet,
      text: texte,
      html: htmlBody,
    }),
  });

  const data = await r.json();
  if (!r.ok) return { error: new Error(data?.message || 'Echec envoi Resend') };
  return { data };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

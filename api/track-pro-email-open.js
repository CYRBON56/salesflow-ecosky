import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Pixel transparent 1x1 (GIF) en base64
const TRANSPARENT_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64'
);

export default async function handler(req, res) {
  // On répond TOUJOURS avec le pixel immédiatement, même en cas d'erreur interne,
  // pour ne jamais casser l'affichage de l'email chez le destinataire.
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  try {
    const email = (req.query.email || '').toString();
    const entreprise = (req.query.entreprise || '').toString();

    if (email) {
      // On vérifie si ce contact a déjà été vu, pour n'envoyer le SMS qu'une seule fois
      const { data: existing } = await supabase
        .from('pro_email_opens')
        .select('id')
        .eq('contact_email', email)
        .limit(1);

      const isFirstOpen = !existing || existing.length === 0;

      const { error: insertError } = await supabase
        .from('pro_email_opens')
        .insert({
          contact_email: email,
          entreprise: entreprise || null,
          user_agent: req.headers['user-agent'] || null,
        });

      if (insertError) {
        console.error('Erreur insertion pro_email_opens:', insertError);
      }

      // SMS uniquement à la première ouverture détectée pour ce contact
      if (!insertError && isFirstOpen) {
        const message = entreprise
          ? `📧 ${entreprise} (${email}) vient d'ouvrir votre email de prospection RMS EcoSky.`
          : `📧 ${email} vient d'ouvrir votre email de prospection RMS EcoSky.`;

        try {
          await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_FROM_NUMBER,
            to: process.env.TWILIO_TO_NUMBER,
          });
        } catch (smsError) {
          console.error('Erreur envoi SMS ouverture email:', smsError);
        }
      }
    }
  } catch (err) {
    console.error('Erreur track-pro-email-open:', err);
  }

  res.status(200).send(TRANSPARENT_PIXEL);
}

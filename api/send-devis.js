import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import twilio from "twilio";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Le RIB est un fichier statique servi par le site lui-même (public/rib-ecosky.pdf),
// donc accessible à cette URL fixe sur le domaine de production.
const RIB_URL = "https://salesflow-ecosky.vercel.app/rib-ecosky.pdf";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const { devis_id, channels, message } = req.body; // channels: ["email", "sms"], message: texte personnalisé (optionnel)

    if (!devis_id || !Array.isArray(channels) || channels.length === 0) {
      return res.status(400).json({ error: "Champs manquants (devis_id, channels)" });
    }

    const { data: devis, error: devisError } = await supabase
      .from("devis")
      .select("*, leads(prenom, nom, email, telephone)")
      .eq("id", devis_id)
      .single();

    if (devisError || !devis) {
      return res.status(404).json({ error: "Devis introuvable" });
    }

    const lead = devis.leads;
    const texteMessage = (message && message.trim())
      || devis.message_perso
      || `Bonjour, veuillez recevoir votre devis n° ${devis.numero}.`;
    const results = { email: null, sms: null };

    // --- Email (via Resend), PDF du devis + RIB joints en pièce jointe ---
    if (channels.includes("email")) {
      if (!lead?.email) {
        results.email = { sent: false, reason: "Pas d'email sur cette fiche" };
      } else {
        const [pdfResponse, ribResponse] = await Promise.all([
          fetch(devis.pdf_url),
          fetch(RIB_URL),
        ]);
        const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
        const ribBuffer = ribResponse.ok ? Buffer.from(await ribResponse.arrayBuffer()) : null;

        const attachments = [
          {
            filename: `Devis_${devis.numero || devis_id}.pdf`,
            content: pdfBuffer.toString("base64"),
          },
        ];
        if (ribBuffer) {
          attachments.push({
            filename: "RIB-RMS-EcoSky.pdf",
            content: ribBuffer.toString("base64"),
          });
        }

        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: lead.email,
          bcc: process.env.OWNER_EMAIL,
          subject: `Votre devis RMS EcoSky${devis.numero ? ` n° ${devis.numero}` : ""}`,
          html: `
            <p>${texteMessage.replace(/\n/g, "<br>")}</p>
            <p>Vous trouverez ci-joint le devis ainsi que notre RIB pour le règlement.</p>
            <p>N'hésitez pas à nous contacter pour toute question.</p>
            <p>L'équipe RMS EcoSky</p>
          `,
          attachments,
        });

        await supabase.from("devis").update({ envoye_email_at: new Date().toISOString() }).eq("id", devis_id);
        results.email = { sent: true };
      }
    }

    // --- SMS (via Twilio), message personnalisé + lien devis + lien RIB ---
    if (channels.includes("sms")) {
      if (!lead?.telephone) {
        results.sms = { sent: false, reason: "Pas de téléphone sur cette fiche" };
      } else {
        await twilioClient.messages.create({
          from: process.env.TWILIO_FROM_NUMBER,
          to: lead.telephone,
          body: `${texteMessage}\nDevis : ${devis.pdf_url}\nRIB : ${RIB_URL}`,
        });

        await supabase.from("devis").update({ envoye_sms_at: new Date().toISOString() }).eq("id", devis_id);
        results.sms = { sent: true };
      }
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error("Erreur send-devis:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}

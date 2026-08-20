import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import twilio from "twilio";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const { devis_id, channels } = req.body; // channels: ["email", "sms"]

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
    const results = { email: null, sms: null };

    // --- Email (via Resend), PDF joint en pièce jointe ---
    if (channels.includes("email")) {
      if (!lead?.email) {
        results.email = { sent: false, reason: "Pas d'email sur cette fiche" };
      } else {
        const pdfResponse = await fetch(devis.pdf_url);
        const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: lead.email,
          bcc: process.env.OWNER_EMAIL,
          subject: `Votre devis RMS EcoSky n° ${devis.numero}`,
          html: `
            <p>Bonjour ${lead.prenom || ""},</p>
            <p>Veuillez trouver ci-joint votre devis n° <strong>${devis.numero}</strong>${devis.montant_ttc ? ` d'un montant de <strong>${devis.montant_ttc} € TTC</strong>` : ""}.</p>
            <p>N'hésitez pas à nous contacter pour toute question.</p>
            <p>L'équipe RMS EcoSky</p>
          `,
          attachments: [
            {
              filename: `Devis_${devis.numero}.pdf`,
              content: pdfBuffer.toString("base64"),
            },
          ],
        });

        await supabase.from("devis").update({ envoye_email_at: new Date().toISOString() }).eq("id", devis_id);
        results.email = { sent: true };
      }
    }

    // --- SMS (via Twilio), lien vers le PDF ---
    if (channels.includes("sms")) {
      if (!lead?.telephone) {
        results.sms = { sent: false, reason: "Pas de téléphone sur cette fiche" };
      } else {
        await twilioClient.messages.create({
          from: process.env.TWILIO_FROM_NUMBER,
          to: lead.telephone,
          body: `RMS EcoSky - Votre devis n° ${devis.numero} est disponible ici : ${devis.pdf_url}`,
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

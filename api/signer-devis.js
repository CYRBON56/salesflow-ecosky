// api/signer-devis.js
// GET  /api/signer-devis?token=xxx   -> infos du devis pour affichage
// POST /api/signer-devis             -> enregistre la signature, tamponne le PDF, notifie Cyrille
//
// Schéma confirmé (table devis) : numero, montant_ttc (numeric), type_projet,
// pdf_url, nom_client — tous en colonnes directes.
// Nécessite le package "pdf-lib" (npm i pdf-lib).

import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service_role, jamais la clé anon
);

export default async function handler(req, res) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Méthode non autorisée' });
}

async function handleGet(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token manquant' });

  const { data, error } = await supabase
    .from('devis')
    .select('numero, montant_ttc, type_projet, pdf_url, statut, date_signature, nom_client')
    .eq('token_signature', token)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Devis introuvable' });

  const montantFormate = data.montant_ttc != null
    ? Number(data.montant_ttc).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
    : null;

  return res.status(200).json({ ...data, montant: montantFormate });
}

async function handlePost(req, res) {
  const { token, signature, nom_signataire } = req.body || {};
  if (!token || !signature || !nom_signataire) {
    return res.status(400).json({ error: 'Champs manquants' });
  }

  const { data: devis, error: findError } = await supabase
    .from('devis')
    .select('*')
    .eq('token_signature', token)
    .single();

  if (findError || !devis) return res.status(404).json({ error: 'Devis introuvable' });
  if (devis.statut === 'signe') return res.status(409).json({ error: 'Devis déjà signé' });

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const now = new Date();

  let pdfSigneUrl = null;
  try {
    pdfSigneUrl = await tamponnerPdf({
      pdfUrl: devis.pdf_url, // [VÉRIFIER] nom de colonne
      signatureDataUrl: signature,
      nomSignataire: nom_signataire,
      ip,
      date: now,
      token
    });
  } catch (e) {
    console.error('Erreur tamponnage PDF:', e);
    // On continue quand même : la signature est enregistrée même si le PDF tamponné échoue
  }

  const { error: updateError } = await supabase
    .from('devis')
    .update({
      statut: 'signe',
      signature_image_url: signature.length < 500000 ? signature : null, // évite de stocker un base64 énorme si trop lourd
      pdf_signe_url: pdfSigneUrl,
      date_signature: now.toISOString(),
      nom_signataire,
      ip_signature: ip
    })
    .eq('token_signature', token);

  if (updateError) {
    console.error(updateError);
    return res.status(500).json({ error: 'Erreur enregistrement' });
  }

  notifierCyrille(devis, nom_signataire).catch(e => console.error('Notif SMS échouée:', e));

  return res.status(200).json({ ok: true, pdf_signe_url: pdfSigneUrl });
}

async function tamponnerPdf({ pdfUrl, signatureDataUrl, nomSignataire, ip, date, token }) {
  if (!pdfUrl) return null;

  const original = await fetch(pdfUrl).then(r => r.arrayBuffer());
  const pdfDoc = await PDFDocument.load(original);
  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];
  const { width } = lastPage.getSize();

  const pngBytes = Buffer.from(signatureDataUrl.split(',')[1], 'base64');
  const pngImage = await pdfDoc.embedPng(pngBytes);
  const sigDims = pngImage.scale(0.35);

  const marginX = 40;
  const sigY = 60;
  lastPage.drawImage(pngImage, {
    x: marginX,
    y: sigY,
    width: sigDims.width,
    height: sigDims.height
  });

  lastPage.drawText(
    `Signé électroniquement par ${nomSignataire} le ${date.toLocaleString('fr-FR')} (IP ${ip})`,
    { x: marginX, y: sigY - 14, size: 8 }
  );

  const signedBytes = await pdfDoc.save();

  const path = `devis-signes/${token}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('media') // [VÉRIFIER] nom du bucket
    .upload(path, signedBytes, { contentType: 'application/pdf', upsert: true });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from('media').getPublicUrl(path);
  return publicUrlData?.publicUrl || null;
}

async function notifierCyrille(devis, nomSignataire) {
  if (!process.env.TWILIO_ACCOUNT_SID) return; // notif SMS optionnelle
  const twilio = (await import('twilio')).default(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  await twilio.messages.create({
    to: process.env.TWILIO_TO_NUMBER,
    from: process.env.TWILIO_FROM_NUMBER,
    body: `Devis ${devis.numero || ''} signé par ${nomSignataire}. ✅`
  });
}

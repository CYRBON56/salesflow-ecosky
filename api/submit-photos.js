// api/submit-photos.js
// Reçoit l'adresse exacte du chantier et les photos envoyées par le client
// via photos.html (lien reçu par SMS après son estimation). Sauvegarde
// l'adresse et les URLs des photos sur le lead, upload les photos dans
// Supabase Storage, et notifie le propriétaire par email.

import { sendEmail } from "./_email.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OWNER_EMAIL = process.env.OWNER_EMAIL || "infos@ecosky.fr";

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function uploadPhotoToSupabase(dataUrl, leadId, index, filename) {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("Format de photo invalide");
  const contentType = match[1];
  const base64Data = match[2];
  const bytes = Buffer.from(base64Data, "base64");
  const safeName = (filename || `photo-${index}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `photos-chantier/${leadId}/${Date.now()}-${index}-${safeName}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/media/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`Supabase storage upload error ${res.status}: ${await res.text()}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { lead_id, adresse, photos } = req.body || {};

    if (!lead_id) {
      return res.status(400).json({ success: false, error: "Lien invalide (lead manquant)." });
    }

    const photoUrls = [];
    for (let i = 0; i < (photos || []).length; i++) {
      try {
        const url = await uploadPhotoToSupabase(photos[i].dataUrl, lead_id, i, photos[i].filename);
        photoUrls.push(url);
      } catch (uploadErr) {
        console.error(`Erreur upload photo ${i}:`, uploadErr.message);
        // On continue avec les autres photos même si une échoue
      }
    }

    const patch = {};
    if (adresse) patch.adresse_projet = adresse;
    if (photoUrls.length > 0) patch.photos_chantier_urls = photoUrls;

    let lead = null;
    if (Object.keys(patch).length > 0) {
      const updated = await supabaseRequest(`leads?id=eq.${lead_id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      lead = updated?.[0] || null;
    } else {
      const existing = await supabaseRequest(`leads?id=eq.${lead_id}&select=nom,prenom,telephone`);
      lead = existing?.[0] || null;
    }

    const fullName = lead ? `${lead.prenom || ""} ${lead.nom || ""}`.trim() : "Un client";
    const photosHtml =
      photoUrls.length > 0
        ? `<p>${photoUrls.length} photo(s) reçue(s) :</p>` +
          photoUrls.map((u) => `<p><a href="${u}">${u}</a></p>`).join("")
        : "<p>Aucune photo envoyée.</p>";

    await sendEmail({
      to: OWNER_EMAIL,
      subject: `📍 Adresse et photos reçues — ${fullName}`,
      html:
        `<p>${fullName}${lead?.telephone ? " — " + lead.telephone : ""}</p>` +
        `<p><strong>Adresse du chantier :</strong> ${adresse || "non renseignée"}</p>` +
        photosHtml,
    });

    return res.status(200).json({ success: true, photo_urls: photoUrls });
  } catch (err) {
    console.error("submit-photos error:", err.message);
    return res.status(200).json({
      success: false,
      error: "Une erreur technique est survenue.",
    });
  }
}

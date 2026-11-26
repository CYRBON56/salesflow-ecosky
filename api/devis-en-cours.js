// api/devis-en-cours.js — onglet « Devis en cours » du tableau de bord (/mobile), 26/11/2026
// GET  : lit les devis Pennylane (via la fonction Supabase pennylane-devis), garde
//        ceux qui ne sont pas finis (signés « accepted » et en attente « pending »,
//        non archivés) et y ajoute le planning (ordre, date d'intervention, terminé)
//        rangé dans la table devis_planning.
// POST : { action: "maj", id, patch: { date_intervention?, termine?, note? } }
//        { action: "ordre", ids: [pennylane_id, ...] }  (nouvel ordre d'intervention)
// Protégé par le mot de passe du tableau de bord (middleware.js).

import { tousLesDevis, sequenceDevis } from "./_pennylane.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Clé publique « anon » du projet (publique par nature) : sert seulement à passer
// la passerelle des fonctions Supabase ; la vraie protection est la clé x-cle.
async function sb(path, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// "Devis-Guillaume Achard-RESINE MARBRE SOL-D-2026-11-168.pdf" -> "Guillaume Achard"
function nomClient(q) {
  const f = (q.filename || "").replace(/\.pdf$/i, "");
  const m = f.match(/^Devis-(.+?)-RESINE MARBRE SOL-/i) || f.match(/^Devis-(.+?)-D-\d{4}/i);
  return m ? m[1].trim() : q.label || "Client";
}

async function lireDevis() {
  const [tous, signesSf] = await Promise.all([
    tousLesDevis(),
    sb("devis?select=numero&statut=eq.signe&type_document=eq.devis"),
  ]);
  // Devis signés sur la page de signature SalesFlow : comptés comme signés
  // même si Pennylane ne les a pas (encore) passés en « accepté ».
  const seqSignes = new Set((signesSf || []).map((x) => sequenceDevis(x.numero)).filter(Boolean));
  return tous
    .filter((q) => !q.archived_at)
    .map((q) => ({ ...q, signeSf: seqSignes.has(sequenceDevis(q.quote_number || q.label)) }))
    .filter((q) => ["accepted", "pending"].includes(q.status) || (q.signeSf && q.status === "expired"))
    .map((q) => ({
      id: q.id,
      numero: q.quote_number || q.label,
      client: nomClient(q),
      statut: q.status === "accepted" || q.signeSf ? "signe" : "attente",
      date: q.date,
      validite: q.deadline,
      ttc: q.amount != null ? Number(q.amount) : null,
      ht: q.currency_amount_before_tax != null ? Number(q.currency_amount_before_tax) : null,
      objet: q.pdf_invoice_subject || "",
      pdf: q.public_file_url || null,
      lien: `https://app.pennylane.com/`,
    }));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const [devis, planning] = await Promise.all([lireDevis(), sb("devis_planning?select=*")]);
      const p = Object.fromEntries((planning || []).map((x) => [String(x.pennylane_id), x]));
      const liste = devis
        .map((d) => {
          const x = p[String(d.id)] || {};
          return { ...d, ordre: x.ordre ?? null, date_intervention: x.date_intervention || null, termine: !!x.termine, note: x.note || "" };
        })
        .filter((d) => !d.termine);
      return res.status(200).json({ success: true, devis: liste });
    }

    if (req.method === "POST") {
      const { action, id, patch, ids } = req.body || {};
      if (action === "maj" && id && patch) {
        const ligne = { pennylane_id: Number(id), maj: new Date().toISOString() };
        for (const k of ["date_intervention", "termine", "note"]) if (k in patch) ligne[k] = patch[k] || (k === "termine" ? false : null);
        await sb("devis_planning?on_conflict=pennylane_id", {
          method: "POST",
          body: JSON.stringify([ligne]),
          prefer: "resolution=merge-duplicates,return=minimal",
        });
        return res.status(200).json({ success: true });
      }
      if (action === "ordre" && Array.isArray(ids)) {
        const maj = new Date().toISOString();
        const lignes = ids.map((x, i) => ({ pennylane_id: Number(x), ordre: i + 1, maj }));
        if (lignes.length) {
          await sb("devis_planning?on_conflict=pennylane_id", {
            method: "POST",
            body: JSON.stringify(lignes),
            prefer: "resolution=merge-duplicates,return=minimal",
          });
        }
        return res.status(200).json({ success: true });
      }
      return res.status(400).json({ success: false, error: "Action inconnue." });
    }
    return res.status(405).json({ success: false, error: "Méthode non autorisée." });
  } catch (e) {
    console.error("devis-en-cours:", e.message);
    return res.status(500).json({ success: false, error: "Impossible de lire les devis Pennylane." });
  }
}

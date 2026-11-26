// api/devis-en-cours.js — onglet « Devis en cours » du tableau de bord (/mobile), 26/11/2026
// GET  : lit les devis Pennylane (via la fonction Supabase pennylane-devis), garde
//        ceux qui ne sont pas finis (signés « accepted » et en attente « pending »,
//        non archivés) et y ajoute le planning (ordre, date d'intervention, terminé)
//        rangé dans la table devis_planning.
// POST : { action: "maj", id, patch: { date_intervention?, termine?, note? } }
//        { action: "ordre", ids: [pennylane_id, ...] }  (nouvel ordre d'intervention)
// Protégé par le mot de passe du tableau de bord (middleware.js).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Clé publique « anon » du projet (publique par nature) : sert seulement à passer
// la passerelle des fonctions Supabase ; la vraie protection est la clé x-cle.
const ANON_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrbGRkd3VtaXJrZGprYnh2enlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTMzNDksImV4cCI6MjA5ODc4OTM0OX0._2cVv3rmhHb-7VLTCqiMRq0F2S30NMnD8qRhTiBM7nc";

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

async function pennylane(path, cle) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/pennylane-devis`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_JWT}`, "x-cle": cle },
    body: JSON.stringify({ action: "api", method: "GET", path }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.status !== 200) throw new Error(`Pennylane ${r.status}/${d.status}: ${JSON.stringify(d).slice(0, 200)}`);
  return d.data;
}

// "Devis-Guillaume Achard-RESINE MARBRE SOL-D-2026-11-168.pdf" -> "Guillaume Achard"
function nomClient(q) {
  const f = (q.filename || "").replace(/\.pdf$/i, "");
  const m = f.match(/^Devis-(.+?)-RESINE MARBRE SOL-/i) || f.match(/^Devis-(.+?)-D-\d{4}/i);
  return m ? m[1].trim() : q.label || "Client";
}

async function lireDevis() {
  const cles = await sb("cles_internes?select=valeur&nom=eq.pennylane_fn");
  const cle = cles?.[0]?.valeur;
  if (!cle) throw new Error("Clé pennylane_fn introuvable");
  const tous = [];
  let cursor = null;
  for (let page = 0; page < 6; page++) {
    const path = `/quotes?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const d = await pennylane(path, cle);
    tous.push(...(d.items || []));
    if (!d.has_more || !d.next_cursor) break;
    cursor = d.next_cursor;
  }
  return tous
    .filter((q) => ["accepted", "pending"].includes(q.status) && !q.archived_at)
    .map((q) => ({
      id: q.id,
      numero: q.quote_number || q.label,
      client: nomClient(q),
      statut: q.status === "accepted" ? "signe" : "attente",
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

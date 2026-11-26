// api/_pennylane.js — accès à l'API Pennylane via la fonction Supabase
// « pennylane-devis » (qui détient le jeton PENNYLANE_TOKEN), 26/11/2026.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Clé publique « anon » du projet (publique par nature) : sert seulement à passer
// la passerelle des fonctions Supabase ; la vraie protection est la clé x-cle.
const ANON_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrbGRkd3VtaXJrZGprYnh2enlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTMzNDksImV4cCI6MjA5ODc4OTM0OX0._2cVv3rmhHb-7VLTCqiMRq0F2S30NMnD8qRhTiBM7nc";

let cleCache = null;
async function cleFonction() {
  if (cleCache) return cleCache;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/cles_internes?select=valeur&nom=eq.pennylane_fn`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  const d = await r.json().catch(() => []);
  cleCache = d?.[0]?.valeur || null;
  if (!cleCache) throw new Error("Clé pennylane_fn introuvable");
  return cleCache;
}

export async function pennylane(method, path, body) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/pennylane-devis`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_JWT}`, "x-cle": await cleFonction() },
    body: JSON.stringify({ action: "api", method, path, body }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.status || d.status >= 300) throw new Error(`Pennylane ${r.status}/${d.status}: ${JSON.stringify(d).slice(0, 300)}`);
  return d.data;
}

// Tous les devis Pennylane (les plus récents d'abord), jusqu'à 600.
export async function tousLesDevis() {
  const tous = [];
  let cursor = null;
  for (let page = 0; page < 6; page++) {
    const d = await pennylane("GET", `/quotes?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    tous.push(...(d.items || []));
    if (!d.has_more || !d.next_cursor) break;
    cursor = d.next_cursor;
  }
  return tous;
}

// Numéro de séquence d'un devis : "D-2026-11-168" -> "168". Sert à rapprocher
// un devis SalesFlow d'un devis Pennylane même si le mois lu sur le PDF diffère.
export function sequenceDevis(numero) {
  const m = String(numero || "").trim().match(/^D-\d{4}-\d{1,2}-(\d+)$/i);
  return m ? String(Number(m[1])) : null;
}

// Passe le devis Pennylane correspondant en « accepté » (signature SalesFlow).
export async function marquerAccepteDansPennylane(numero) {
  const seq = sequenceDevis(numero);
  if (!seq) return { ok: false, raison: "numéro non reconnu" };
  const devis = await tousLesDevis();
  const q = devis.find((x) => sequenceDevis(x.quote_number || x.label) === seq);
  if (!q) return { ok: false, raison: "devis introuvable dans Pennylane" };
  if (["accepted", "invoiced"].includes(q.status)) return { ok: true, deja: true };
  await pennylane("PUT", `/quotes/${q.id}/update_status`, { status: "accepted" });
  return { ok: true, id: q.id };
}

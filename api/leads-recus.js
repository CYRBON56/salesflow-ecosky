// api/leads-recus.js
// Retourne l'historique des demandes d'estimation (table leads), pour la
// page /sms-recus.html de SalesFlow System. Protégée par le même
// middleware que le reste du dashboard. GET pour lister, DELETE pour
// supprimer un ou plusieurs leads (?id=X ou ?ids=1,2,3), PATCH pour éditer
// un champ (nom, prénom, téléphone, adresse) directement depuis le tableau.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Seuls ces champs sont modifiables depuis le tableau — on ne laisse pas
// n'importe quelle clé être écrite pour éviter d'ouvrir la porte à une
// modification arbitraire d'autres colonnes (statut, PDF, etc.) via ce
// même endpoint.
const CHAMPS_MODIFIABLES = ["nom", "prenom", "telephone", "adresse_projet", "code_postal"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "PATCH") {
    try {
      const { id, champ, valeur } = req.body || {};
      if (!id || !champ) {
        return res.status(400).json({ ok: false, error: "id et champ requis" });
      }
      if (!CHAMPS_MODIFIABLES.includes(champ)) {
        return res.status(400).json({ ok: false, error: `Champ non modifiable : ${champ}` });
      }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ [champ]: valeur === "" ? null : valeur }),
      });
      if (!r.ok) throw new Error(`Supabase error ${r.status}: ${await r.text()}`);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("leads-recus patch error:", err.message);
      return res.status(500).json({ ok: false, error: "Erreur lors de la modification" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const { id, ids } = req.query;
      const idList = ids ? ids.split(",").map((s) => s.trim()).filter(Boolean) : (id ? [id] : []);
      if (idList.length === 0) return res.status(400).json({ ok: false, error: "id ou ids requis" });
      const filtre = idList.length === 1
        ? `id=eq.${idList[0]}`
        : `id=in.(${idList.join(",")})`;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?${filtre}`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      });
      if (!r.ok) throw new Error(`Supabase error ${r.status}: ${await r.text()}`);
      return res.status(200).json({ ok: true, deleted: idList.length });
    } catch (err) {
      console.error("leads-recus delete error:", err.message);
      return res.status(500).json({ ok: false, error: "Erreur lors de la suppression" });
    }
  }

  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const colonnes = [
      "id", "created_at", "nom", "prenom", "telephone", "email",
      "adresse_projet", "code_postal", "surface_m2", "type_projet",
      "delai_souhaite", "source", "statut", "formulaire_complete",
      "callback_demande", "estimation_numero", "estimation_pdf_url",
    ].join(",");
    const url =
      `${SUPABASE_URL}/rest/v1/leads?select=${colonnes}&order=created_at.desc&limit=${limit}`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!r.ok) throw new Error(`Supabase error ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    return res.status(200).json({ ok: true, rows });
  } catch (err) {
    console.error("leads-recus error:", err.message);
    return res.status(500).json({ ok: false, error: "Erreur lors de la récupération des demandes" });
  }
}

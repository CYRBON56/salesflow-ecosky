<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SMS &amp; demandes reçues — SalesFlow System</title>
<style>
  :root {
    --vert: #14312a;
    --vert-clair: #1e6f4c;
    --bg: #f5f8f6;
    --bordure: #e2e8e5;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    background: var(--bg);
    color: var(--vert);
  }
  header {
    background: var(--vert);
    color: white;
    padding: 20px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  header h1 { font-size: 1.3rem; margin: 0; font-weight: 700; }
  header .sous-titre { font-size: 0.85rem; opacity: 0.8; margin-top: 4px; }
  .controles {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  select, button {
    font-family: inherit;
    font-size: 0.85rem;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--bordure);
    background: white;
    color: var(--vert);
    cursor: pointer;
  }
  button.principal {
    background: var(--vert-clair);
    color: white;
    border: none;
    font-weight: 600;
  }
  .onglets {
    display: flex;
    gap: 4px;
    padding: 0 28px;
    background: white;
    border-bottom: 1px solid var(--bordure);
  }
  .onglet {
    padding: 14px 18px;
    font-size: 0.9rem;
    font-weight: 600;
    color: #7a8983;
    cursor: pointer;
    border-bottom: 3px solid transparent;
  }
  .onglet.actif {
    color: var(--vert);
    border-bottom-color: var(--vert-clair);
  }
  main { padding: 20px 28px 60px; max-width: 1300px; margin: 0 auto; }
  .vue { display: none; }
  .vue.actif { display: block; }
  .stats {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }
  .stat-carte {
    background: white;
    border: 1px solid var(--bordure);
    border-radius: 12px;
    padding: 14px 18px;
    min-width: 140px;
  }
  .stat-carte .valeur { font-size: 1.5rem; font-weight: 700; }
  .stat-carte .libelle { font-size: 0.78rem; color: #5a6b64; margin-top: 2px; }
  table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(20,49,42,0.08);
  }
  thead { background: #eef4f1; }
  th, td {
    text-align: left;
    padding: 10px 14px;
    font-size: 0.85rem;
    border-bottom: 1px solid var(--bordure);
    white-space: nowrap;
  }
  th { font-weight: 700; color: var(--vert); }
  tbody tr:hover { background: #f8fbfa; }
  .badge {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
  }
  .badge-ok { background: #e3f5e9; color: #1e6f4c; }
  .badge-ko { background: #fbe6e6; color: #b3261e; }
  .badge-type, .badge-statut { background: #eef4f1; color: var(--vert); font-weight: 600; }
  .badge-nouveau { background: #e8f0fb; color: #1a4d8f; }
  .badge-contacte { background: #fff4e0; color: #9a6a00; }
  .msg-col {
    max-width: 300px;
    white-space: normal;
    font-size: 0.78rem;
    color: #4a5a54;
  }
  .checkbox-col { width: 30px; }
  .btn-suppr, .btn-suppr-lead {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    padding: 2px 6px;
    border-radius: 6px;
  }
  .btn-suppr:hover, .btn-suppr-lead:hover { background: #fbe6e6; }
  .barre-selection {
    display: none;
    align-items: center;
    gap: 12px;
    background: #14312a;
    color: white;
    padding: 10px 16px;
    border-radius: 10px;
    margin-bottom: 14px;
    font-size: 0.85rem;
  }
  .barre-selection.visible { display: flex; }
  .barre-selection button {
    background: #b3261e;
    color: white;
    border: none;
    font-weight: 600;
  }
  .vide { padding: 40px; text-align: center; color: #7a8983; }
  .chargement { padding: 40px; text-align: center; color: #7a8983; }
</style>
</head>
<body>

<header>
  <div>
    <h1 id="titrePage">📩 SMS reçus</h1>
    <div class="sous-titre" id="sousTitrePage">Historique des notifications SMS envoyées automatiquement</div>
  </div>
  <div class="controles">
    <select id="filtreType"></select>
    <button class="principal" id="btnActualiser">🔄 Actualiser</button>
  </div>
</header>

<div class="onglets">
  <div class="onglet actif" data-onglet="sms">SMS reçus</div>
  <div class="onglet" data-onglet="leads">Demandes d'estimation</div>
</div>

<main>
  <div class="barre-selection" id="barreSelection">
    <span id="texteSelection">0 sélectionné(s)</span>
    <button id="btnSupprimerSelection">🗑️ Supprimer la sélection</button>
    <button id="btnAnnulerSelection" style="background:transparent; border:1px solid white;">Annuler</button>
  </div>
  <div class="stats" id="stats"></div>
  <div id="conteneurTableau">
    <div class="chargement">Chargement…</div>
  </div>
</main>

<script>
  const API_SMS = "/api/sms-recus";
  const API_LEADS = "/api/leads-recus";
  const API_LEADS_ADMIN = "/api/leads-admin";

  const LIBELLES_TYPE_SMS = {
    arrivee_pub: "Arrivée pub",
    catalogue_telecharge: "Catalogue téléchargé",
    clic_devis: "Clic devis",
    etude_anc_uploadee: "Étude ANC",
    demande_rappel: "Demande de rappel",
    nouveau_clic: "Nouveau clic",
  };

  const LIBELLES_STATUT_LEAD = {
    nouveau: "Nouveau",
    "contacté": "Contacté",
    "en cours": "En cours",
    gagné: "Gagné",
    perdu: "Perdu",
  };

  let ongletActif = "sms";
  let toutesLignesSms = [];
  let toutesLignesLeads = [];
  let selectionSms = new Set();
  let selectionLeads = new Set();

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function echapper(s) {
    return (s || "").toString().replace(/</g, "&lt;");
  }

  function selectionActive() {
    return ongletActif === "sms" ? selectionSms : selectionLeads;
  }

  function majBarreSelection() {
    const barre = document.getElementById("barreSelection");
    const texte = document.getElementById("texteSelection");
    const selection = selectionActive();
    if (selection.size === 0) {
      barre.classList.remove("visible");
      return;
    }
    barre.classList.add("visible");
    texte.textContent = `${selection.size} sélectionné(s)`;
  }

  async function supprimerSms(ids) {
    if (!ids.length) return;
    if (!confirm(`Supprimer ${ids.length} SMS ? Cette action est définitive.`)) return;
    try {
      const res = await fetch(`${API_SMS}?ids=${ids.join(",")}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Erreur inconnue");
      selectionSms.clear();
      await chargerSms();
    } catch (err) {
      alert("Erreur lors de la suppression : " + err.message);
    }
  }

  async function supprimerLeads(ids) {
    if (!ids.length) return;
    if (!confirm(`Supprimer ${ids.length} demande(s) d'estimation ? Cette action est définitive.`)) return;
    try {
      for (const id of ids) {
        const res = await fetch(API_LEADS_ADMIN, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete_lead", id }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Erreur inconnue");
      }
      selectionLeads.clear();
      await chargerLeads();
    } catch (err) {
      alert("Erreur lors de la suppression : " + err.message);
    }
  }

  // ---------- Onglet SMS ----------

  function renderStatsSms(lignes) {
    const total = lignes.length;
    const reussis = lignes.filter(l => l.twilio_success === true).length;
    const echoues = lignes.filter(l => l.twilio_success === false).length;
    document.getElementById("stats").innerHTML = `
      <div class="stat-carte"><div class="valeur">${total}</div><div class="libelle">Total affiché</div></div>
      <div class="stat-carte"><div class="valeur">${reussis}</div><div class="libelle">Envoyés avec succès</div></div>
      <div class="stat-carte"><div class="valeur">${echoues}</div><div class="libelle">Échecs</div></div>
    `;
  }

  function renderTableSms(lignes) {
    const conteneur = document.getElementById("conteneurTableau");
    if (!lignes.length) {
      conteneur.innerHTML = `<div class="vide">Aucun SMS pour ce filtre.</div>`;
      return;
    }
    const lignesHtml = lignes.map(l => `
      <tr>
        <td class="checkbox-col"><input type="checkbox" class="case-sms" data-id="${l.id}" ${selectionSms.has(l.id) ? "checked" : ""}></td>
        <td>${formatDate(l.created_at)}</td>
        <td><span class="badge badge-type">${LIBELLES_TYPE_SMS[l.sms_type] || l.sms_type}</span></td>
        <td>${echapper(l.source) || "—"}</td>
        <td>${echapper(l.utm_campaign) || "—"}</td>
        <td>${echapper([l.geo_city, l.geo_country].filter(Boolean).join(", ")) || "—"}</td>
        <td>${l.twilio_success === true ? '<span class="badge badge-ok">Envoyé</span>' : l.twilio_success === false ? '<span class="badge badge-ko">Échec</span>' : "—"}</td>
        <td class="msg-col">${echapper(l.message_body)}</td>
        <td><button class="btn-suppr" data-id-suppr="${l.id}" title="Supprimer">🗑️</button></td>
      </tr>
    `).join("");
    conteneur.innerHTML = `
      <table>
        <thead>
          <tr>
            <th class="checkbox-col"><input type="checkbox" id="caseToutSms"></th>
            <th>Date / heure</th>
            <th>Type</th>
            <th>Source / nom</th>
            <th>Campagne / commune</th>
            <th>Localisation</th>
            <th>Statut</th>
            <th>Message</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${lignesHtml}</tbody>
      </table>
    `;

    document.querySelectorAll(".case-sms").forEach(cb => {
      cb.addEventListener("change", () => {
        const id = parseInt(cb.dataset.id, 10);
        if (cb.checked) selectionSms.add(id); else selectionSms.delete(id);
        majBarreSelection();
      });
    });
    document.querySelectorAll(".btn-suppr").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.dataset.idSuppr, 10);
        supprimerSms([id]);
      });
    });
    const caseTout = document.getElementById("caseToutSms");
    if (caseTout) {
      caseTout.addEventListener("change", () => {
        document.querySelectorAll(".case-sms").forEach(cb => {
          cb.checked = caseTout.checked;
          const id = parseInt(cb.dataset.id, 10);
          if (caseTout.checked) selectionSms.add(id); else selectionSms.delete(id);
        });
        majBarreSelection();
      });
    }
  }

  function appliquerFiltreSms() {
    const type = document.getElementById("filtreType").value;
    const lignes = type ? toutesLignesSms.filter(l => l.sms_type === type) : toutesLignesSms;
    renderStatsSms(lignes);
    renderTableSms(lignes);
    majBarreSelection();
  }

  async function chargerSms() {
    document.getElementById("conteneurTableau").innerHTML = `<div class="chargement">Chargement…</div>`;
    try {
      const res = await fetch(API_SMS);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Erreur inconnue");
      toutesLignesSms = data.rows || [];
      appliquerFiltreSms();
    } catch (err) {
      document.getElementById("conteneurTableau").innerHTML =
        `<div class="vide">Erreur de chargement : ${err.message}</div>`;
    }
  }

  // ---------- Onglet Demandes d'estimation ----------

  function renderStatsLeads(lignes) {
    const total = lignes.length;
    const completes = lignes.filter(l => l.formulaire_complete === true).length;
    const rappels = lignes.filter(l => l.callback_demande === true).length;
    document.getElementById("stats").innerHTML = `
      <div class="stat-carte"><div class="valeur">${total}</div><div class="libelle">Total affiché</div></div>
      <div class="stat-carte"><div class="valeur">${completes}</div><div class="libelle">Formulaires complétés</div></div>
      <div class="stat-carte"><div class="valeur">${rappels}</div><div class="libelle">Rappels demandés</div></div>
    `;
  }

  function badgeStatut(statut) {
    if (!statut) return "—";
    const cls = statut === "nouveau" ? "badge-nouveau" : statut === "contacté" ? "badge-contacte" : "badge-statut";
    return `<span class="badge ${cls}">${LIBELLES_STATUT_LEAD[statut] || statut}</span>`;
  }

  function renderTableLeads(lignes) {
    const conteneur = document.getElementById("conteneurTableau");
    if (!lignes.length) {
      conteneur.innerHTML = `<div class="vide">Aucune demande pour ce filtre.</div>`;
      return;
    }
    const lignesHtml = lignes.map(l => {
      const nomComplet = [l.prenom, l.nom].filter(Boolean).join(" ") || "—";
      return `
      <tr>
        <td class="checkbox-col"><input type="checkbox" class="case-lead" data-id="${l.id}" ${selectionLeads.has(l.id) ? "checked" : ""}></td>
        <td>${formatDate(l.created_at)}</td>
        <td>${echapper(nomComplet)}</td>
        <td>${echapper(l.telephone) || "—"}</td>
        <td>${echapper(l.email) || "—"}</td>
        <td>${echapper(l.type_projet) || "—"}</td>
        <td>${echapper([l.adresse_projet, l.code_postal].filter(Boolean).join(", ")) || "—"}</td>
        <td>${echapper(l.source) || "—"}</td>
        <td>${badgeStatut(l.statut)}</td>
        <td>${l.formulaire_complete === true ? '<span class="badge badge-ok">Complet</span>' : '<span class="badge badge-ko">Incomplet</span>'}</td>
        <td>${l.callback_demande === true ? "📞 Oui" : "—"}</td>
        <td><button class="btn-suppr-lead" data-id-suppr="${l.id}" title="Supprimer">🗑️</button></td>
      </tr>
    `;
    }).join("");
    conteneur.innerHTML = `
      <table>
        <thead>
          <tr>
            <th class="checkbox-col"><input type="checkbox" id="caseToutLead"></th>
            <th>Date / heure</th>
            <th>Nom</th>
            <th>Téléphone</th>
            <th>Email</th>
            <th>Projet</th>
            <th>Adresse / CP</th>
            <th>Source</th>
            <th>Statut</th>
            <th>Formulaire</th>
            <th>Rappel</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${lignesHtml}</tbody>
      </table>
    `;

    document.querySelectorAll(".case-lead").forEach(cb => {
      cb.addEventListener("change", () => {
        const id = cb.dataset.id;
        if (cb.checked) selectionLeads.add(id); else selectionLeads.delete(id);
        majBarreSelection();
      });
    });
    document.querySelectorAll(".btn-suppr-lead").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.idSuppr;
        supprimerLeads([id]);
      });
    });
    const caseToutLead = document.getElementById("caseToutLead");
    if (caseToutLead) {
      caseToutLead.addEventListener("change", () => {
        document.querySelectorAll(".case-lead").forEach(cb => {
          cb.checked = caseToutLead.checked;
          const id = cb.dataset.id;
          if (caseToutLead.checked) selectionLeads.add(id); else selectionLeads.delete(id);
        });
        majBarreSelection();
      });
    }
  }

  function appliquerFiltreLeads() {
    const statut = document.getElementById("filtreType").value;
    const lignes = statut ? toutesLignesLeads.filter(l => l.statut === statut) : toutesLignesLeads;
    renderStatsLeads(lignes);
    renderTableLeads(lignes);
    majBarreSelection();
  }

  async function chargerLeads() {
    document.getElementById("conteneurTableau").innerHTML = `<div class="chargement">Chargement…</div>`;
    try {
      const res = await fetch(API_LEADS);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Erreur inconnue");
      toutesLignesLeads = data.rows || [];
      appliquerFiltreLeads();
    } catch (err) {
      document.getElementById("conteneurTableau").innerHTML =
        `<div class="vide">Erreur de chargement : ${err.message}</div>`;
    }
  }

  // ---------- Bascule d'onglet ----------

  function remplirFiltreSelonOnglet() {
    const select = document.getElementById("filtreType");
    if (ongletActif === "sms") {
      select.innerHTML = `<option value="">Tous les types</option>` +
        Object.entries(LIBELLES_TYPE_SMS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    } else {
      select.innerHTML = `<option value="">Tous les statuts</option>` +
        Object.entries(LIBELLES_STATUT_LEAD).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    }
  }

  function activerOnglet(onglet) {
    ongletActif = onglet;
    document.querySelectorAll(".onglet").forEach(el => {
      el.classList.toggle("actif", el.dataset.onglet === onglet);
    });
    if (onglet === "sms") {
      document.getElementById("titrePage").textContent = "📩 SMS reçus";
      document.getElementById("sousTitrePage").textContent = "Historique des notifications SMS envoyées automatiquement";
      remplirFiltreSelonOnglet();
      chargerSms();
    } else {
      document.getElementById("titrePage").textContent = "📋 Demandes d'estimation";
      document.getElementById("sousTitrePage").textContent = "Visiteurs ayant rempli (ou entamé) le formulaire d'estimation";
      remplirFiltreSelonOnglet();
      chargerLeads();
    }
  }

  document.querySelectorAll(".onglet").forEach(el => {
    el.addEventListener("click", () => {
      selectionSms.clear();
      selectionLeads.clear();
      activerOnglet(el.dataset.onglet);
    });
  });
  document.getElementById("filtreType").addEventListener("change", () => {
    if (ongletActif === "sms") {
      selectionSms.clear();
      appliquerFiltreSms();
    } else {
      selectionLeads.clear();
      appliquerFiltreLeads();
    }
  });
  document.getElementById("btnActualiser").addEventListener("click", () => {
    ongletActif === "sms" ? chargerSms() : chargerLeads();
  });
  document.getElementById("btnSupprimerSelection").addEventListener("click", () => {
    if (ongletActif === "sms") {
      supprimerSms(Array.from(selectionSms));
    } else {
      supprimerLeads(Array.from(selectionLeads));
    }
  });
  document.getElementById("btnAnnulerSelection").addEventListener("click", () => {
    if (ongletActif === "sms") {
      selectionSms.clear();
      appliquerFiltreSms();
    } else {
      selectionLeads.clear();
      appliquerFiltreLeads();
    }
  });

  activerOnglet("sms");
</script>

</body>
</html>

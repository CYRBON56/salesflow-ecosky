/**
 * api/_chiffrage-anc.js
 *
 * Construit le CHIFFRAGE INTERNE détaillé (pour RMS, pas pour le client) d'une
 * demande ANC, à partir de la grille anc-pricing-config-server.js et des
 * données extraites de l'étude de sol. Produit :
 *   - un tableau HTML (corps de l'email interne)
 *   - un fichier Excel (.xlsx, pièce jointe) avec formules modifiables
 *
 * Les quantités inconnues (longueurs, tonnage de déblais…) sont estimées et
 * marquées « à confirmer » (cellules jaunes dans l'Excel).
 */
import ExcelJS from "exceljs";
import PRICING_CONFIG_ANC from "./anc-pricing-config-server.js";

const O = PRICING_CONFIG_ANC.optionsComplementaires;
const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));

export function construireChiffrage(entree) {
  const {
    filiereKey, eh, posteRelevage, ventilation, roche,
    longueurRaccordement, longueurTrancheeEvacuation, donneesEtude = {},
  } = entree;
  const filiere = PRICING_CONFIG_ANC.filieres[filiereKey] || PRICING_CONFIG_ANC.filieres.filtreCompact;
  const d = donneesEtude || {};
  const surfaceFiltre = num(d.dimensionFiltreM2);
  const relevage = posteRelevage === "amont" || posteRelevage === "aval" || d.posteDeRelevage === true;
  const relevageAmont = posteRelevage === "amont";
  const L = (ref, des, unite, qte, pu, aConfirmer = false, remarque = "", horsEcoPtz = false) =>
    ({ ref, des, unite, qte, pu, aConfirmer, remarque, horsEcoPtz });

  const sections = [];

  sections.push({ code: "1", titre: `FILIÈRE DE BASE (forfait grille ${eh} EH)`, lignes: [
    L("1.1", `${filiere.label} — ${eh} EH — forfait comprenant : ${filiere.composantsInclus.join(", ")}`,
      "forfait", 1, filiere.prixParEH[eh] ?? null, filiere.prixParEH[eh] == null,
      filiere.prixParEH[eh] == null ? "Hors grille : prix à définir" : (surfaceFiltre ? `Filtre ${surfaceFiltre} m² selon étude` : "")),
  ]});

  sections.push({ code: "2", titre: "PRÉPARATION / ANCIENNE INSTALLATION", lignes: [
    L("2.1", O.vidangeEntrepriseAgreee.label, "forfait", 1, O.vidangeEntrepriseAgreee.prixHT, true, "Si ancienne installation existante"),
    L("2.2", O.neutralisationAncienDispositif.label, "forfait", 1, O.neutralisationAncienDispositif.prixHT, true, "Si ancienne installation existante"),
    L("2.3", O.abattageArbresDebroussaillage.label, "forfait", 1, O.abattageArbresDebroussaillage.prixHT, true, "Selon visite"),
  ]});

  const lRacc = num(longueurRaccordement);
  const lEvac = num(longueurTrancheeEvacuation);
  sections.push({ code: "3", titre: "COLLECTE ET RACCORDEMENTS", lignes: [
    L("3.1", O.teControleVisite.label, "unité", 1, O.teControleVisite.prixHT, true, "1 par sortie EU"),
    L("3.2", "Terrassement de raccordement (maison → fosse → traitement)", "ml", lRacc ?? 20, O.terrassementRaccordement.prixHT, lRacc == null, lRacc == null ? "Longueur estimée — à métrer" : "Longueur indiquée par le client"),
    L("3.3", O.trancheeTechniqueEvacuation.label, "ml", lEvac ?? 15, O.trancheeTechniqueEvacuation.prixHT, lEvac == null, lEvac == null ? "Longueur estimée — à métrer" : "Longueur indiquée par le client"),
  ]});

  if (relevage) {
    const p = relevageAmont ? O.pompeRelevageAmont : O.pompeRelevageAval;
    sections.push({ code: "4", titre: "RELEVAGE", lignes: [
      L("4.1", p.label, "forfait", 1, p.prixHT, false, "Exclu du montant éco-PTZ (AQTA)", true),
      L("4.2", O.alarmeRelevage.label, "unité", 1, O.alarmeRelevage.prixHT),
      L("4.3", O.branchementElectrique.label, "forfait", 1, O.branchementElectrique.prixHT),
    ]});
  }

  sections.push({ code: "5", titre: "VENTILATION", lignes: [
    L("5.1", O.ventilationToiture.label, "forfait", 1, O.ventilationToiture.prixHT, ventilation !== "oui", ventilation === "oui" ? "" : "Non confirmée par le client"),
    L("5.2", O.extracteurStatiqueEolien.label, "unité", 1, O.extracteurStatiqueEolien.prixHT),
  ]});

  const surfaceTraitement = surfaceFiltre || 0;
  const tonnes = Math.max(10, Math.round((surfaceTraitement * 0.9 + 6) * 1.6));
  const remblai = [
    L("6.1", O.evacuationDeblais.label + " — camion de 10 t", "camion", Math.ceil(tonnes / (O.evacuationDeblais.tonnesParCamion || 10)), O.evacuationDeblais.prixHT, true, `≈ ${tonnes} t estimées — à confirmer`),
  ];
  if (surfaceFiltre) remblai.push(L("6.2", O.apportTerreVegetale.label, "m³", Math.round(surfaceFiltre * 0.2 * 10) / 10, O.apportTerreVegetale.prixHT, true, `${surfaceFiltre} m² × 0,20 m ; 0 si terre réutilisée`));
  sections.push({ code: "6", titre: "DÉBLAIS / REMBLAIS", lignes: remblai });

  const contraintes = [];
  if (roche === "oui" || d.rocheSignalee === true) contraintes.push(L("7.1", O.briseRocheHydraulique.label, "jour", 1, O.briseRocheHydraulique.prixHT, true, "Roche signalée"));
  if (d.eauFaibleProfondeur === true) {
    contraintes.push(L("7.2", "Pompage / épuisement des fouilles pendant travaux", "forfait", 1, null, true, "Eau à faible profondeur selon étude — prix à définir"));
    contraintes.push(L("7.3", "Lestage / ancrage anti-soulèvement de la fosse", "forfait", 1, null, true, "Recommandé en sol saturé — prix à définir"));
  }
  if (contraintes.length) sections.push({ code: "7", titre: "CONTRAINTES DE TERRAIN", lignes: contraintes });

  let totalHT = 0, horsEcoPtz = 0;
  for (const s of sections) for (const l of s.lignes) {
    l.totalHT = l.pu == null ? 0 : Math.round(l.qte * l.pu * 100) / 100;
    totalHT += l.totalHT;
    if (l.horsEcoPtz) horsEcoPtz += l.totalHT;
  }
  return { filiere, sections, totalHT, totalHorsRelevageHT: totalHT - horsEcoPtz, aChiffrer: sections.flatMap(s => s.lignes).filter(l => l.pu == null).length };
}

const eur = (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

export function chiffrageHtml(c, tva = 0.1) {
  const lignes = c.sections.map(s => `
    <tr><td colspan="5" style="background:#E8F5E9;font-weight:bold;padding:6px;">${s.code}. ${s.titre}</td></tr>
    ${s.lignes.map(l => `<tr>
      <td style="padding:4px 6px;border-bottom:1px solid #eee;font-size:12px;">${l.ref} ${l.des}${l.remarque ? `<br><span style="color:#888;font-size:11px;">${l.remarque}</span>` : ""}</td>
      <td style="padding:4px;border-bottom:1px solid #eee;text-align:center;font-size:12px;${l.aConfirmer ? "background:#FFF59D;" : ""}">${l.qte} ${l.unite}</td>
      <td style="padding:4px;border-bottom:1px solid #eee;text-align:right;font-size:12px;">${l.pu == null ? "<b>à chiffrer</b>" : eur(l.pu)}</td>
      <td style="padding:4px;border-bottom:1px solid #eee;text-align:right;font-size:12px;">${eur(l.totalHT)}</td></tr>`).join("")}`).join("");
  return `
  <table style="border-collapse:collapse;width:100%;max-width:640px;font-family:Arial,Helvetica,sans-serif;">
    <tr style="background:#2E7D32;color:#fff;"><th style="padding:6px;text-align:left;">Désignation</th><th>Qté</th><th>PU HT</th><th>Total HT</th></tr>
    ${lignes}
    <tr><td colspan="3" style="text-align:right;padding:6px;font-weight:bold;">TOTAL HT</td><td style="text-align:right;font-weight:bold;">${eur(c.totalHT)}</td></tr>
    <tr><td colspan="3" style="text-align:right;padding:6px;">TVA ${Math.round(tva * 100)} %</td><td style="text-align:right;">${eur(c.totalHT * tva)}</td></tr>
    <tr><td colspan="3" style="text-align:right;padding:6px;font-weight:bold;">TOTAL TTC</td><td style="text-align:right;font-weight:bold;">${eur(c.totalHT * (1 + tva))}</td></tr>
    ${c.totalHorsRelevageHT !== c.totalHT ? `<tr><td colspan="3" style="text-align:right;padding:6px;color:#C62828;">Total HT hors poste de relevage (éco-PTZ)</td><td style="text-align:right;color:#C62828;">${eur(c.totalHorsRelevageHT)}</td></tr>` : ""}
  </table>
  <p style="font-size:11px;color:#888;font-family:Arial;">Cases jaunes = quantités estimées à confirmer sur place.${c.aChiffrer ? ` ${c.aChiffrer} poste(s) « à chiffrer » non inclus dans le total.` : ""}</p>`;
}

export async function chiffrageXlsxBase64(c, entete, tva = 0.1) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Chiffrage");
  ws.columns = [{ width: 6 }, { width: 62 }, { width: 9 }, { width: 8 }, { width: 13 }, { width: 15 }, { width: 42 }];
  const font = { name: "Arial", size: 10 };
  ws.addRow(["CHIFFRAGE INTERNE — NE PAS TRANSMETTRE AU CLIENT"]).font = { name: "Arial", bold: true, size: 14, color: { argb: "FFC62828" } };
  for (const t of entete) ws.addRow([t]).font = font;
  ws.addRow(["Bleu = modifiable · jaune = à confirmer / à chiffrer · prix issus de la grille ANC RMS"]).font = { ...font, italic: true, size: 9 };
  ws.addRow([]);
  const h = ws.addRow(["Réf.", "Désignation", "Unité", "Qté", "PU HT (€)", "Total HT (€)", "Remarque"]);
  h.eachCell(cell => { cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E7D32" } }; });
  const lignesTot = []; let relevageRow = null;
  const jaune = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  for (const s of c.sections) {
    const r = ws.addRow([s.code, s.titre]);
    r.font = { name: "Arial", bold: true };
    for (let i = 1; i <= 7; i++) r.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5E9" } };
    for (const l of s.lignes) {
      const row = ws.addRow([l.ref, l.des, l.unite, l.qte, l.pu, null, l.remarque]);
      const n = row.number;
      row.getCell(6).value = { formula: `IF(E${n}="",0,D${n}*E${n})`, result: l.totalHT };
      row.font = font;
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
      row.getCell(7).alignment = { wrapText: true, vertical: "top" };
      row.getCell(4).font = { ...font, color: { argb: "FF0000FF" } };
      row.getCell(5).font = { ...font, color: { argb: "FF0000FF" } };
      if (l.aConfirmer) row.getCell(4).fill = jaune;
      if (l.pu == null) row.getCell(5).fill = jaune;
      row.getCell(5).numFmt = '#,##0.00 €';
      row.getCell(6).numFmt = '#,##0.00 €';
      if (l.horsEcoPtz) relevageRow = n;
      lignesTot.push(n);
    }
  }
  ws.addRow([]);
  const a = lignesTot[0], b = lignesTot[lignesTot.length - 1];
  const t = ws.addRow(["", "", "", "", "TOTAL HT", { formula: `SUM(F${a}:F${b})`, result: c.totalHT }]).number;
  ws.addRow(["", "", "", "", "TVA", tva]).getCell(6).numFmt = "0%";
  ws.addRow(["", "", "", "", "Montant TVA", { formula: `F${t}*F${t + 1}`, result: c.totalHT * tva }]);
  ws.addRow(["", "", "", "", "TOTAL TTC", { formula: `F${t}+F${t + 2}`, result: c.totalHT * (1 + tva) }]);
  if (relevageRow) ws.addRow(["", "", "", "", "Total HT hors poste de relevage (éco-PTZ)", { formula: `F${t}-F${relevageRow}`, result: c.totalHorsRelevageHT }]);
  for (let r = t; r <= ws.rowCount; r++) { const row = ws.getRow(r); row.font = { name: "Arial", bold: true }; row.getCell(6).numFmt = r === t + 1 ? "0%" : '#,##0.00 €'; row.getCell(5).alignment = { horizontal: "right" }; }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}

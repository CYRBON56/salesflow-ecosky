/**
 * Compresseur de PDF côté navigateur pour le formulaire ANC (estimation-anc.html)
 * ---------------------------------------------------------------------------
 * Principe : chaque page du PDF est "photographiée" (rendue en image) via
 * pdf.js, recompressée en JPEG de qualité réduite, puis réassemblée dans un
 * nouveau PDF via pdf-lib. Efficace sur les études de sol scannées (souvent
 * lourdes à cause des photos/tableaux), moins sur les PDF déjà 100% texte.
 *
 * DÉPENDANCES À AJOUTER dans le <head> de public/estimation-anc.html :
 *
 * <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js"></script>
 * <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js"></script>
 *
 * (pdf.js a aussi besoin de son "worker" ; on le configure ci-dessous via CDN)
 */

// À placer une seule fois, avant la fonction compressPdfFile
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
} catch (e) {
  console.error("pdf.js n'a pas pu être initialisé — la compression sera désactivée.", e);
}

/**
 * Compresse un fichier PDF (File/Blob) si besoin.
 * @param {File} file - le PDF sélectionné par l'utilisateur
 * @param {Object} options
 * @param {number} options.maxSizeBytes - taille cible max (défaut 2.9 Mo)
 * @param {number} options.scale - résolution de rendu des pages (1.2 = bon compromis lisibilité/poids)
 * @param {number} options.quality - qualité JPEG (0 à 1)
 * @returns {Promise<File>} - le fichier compressé (ou l'original si déjà assez léger / échec)
 */
async function compressPdfFile(file, options = {}) {
  const {
    maxSizeBytes = 2.9 * 1024 * 1024,
    scale = 1.2,
  } = options;

  console.log(`[compress-pdf] Fichier reçu : ${(file.size / 1024 / 1024).toFixed(2)} Mo`);

  // Si le fichier est déjà assez léger, on ne touche à rien
  if (file.size <= maxSizeBytes) {
    console.log("[compress-pdf] Déjà sous la limite, pas de compression nécessaire.");
    return file;
  }

  if (typeof pdfjsLib === "undefined" || typeof PDFLib === "undefined") {
    console.error("[compress-pdf] pdf.js ou pdf-lib non chargé — envoi du fichier original sans compression.");
    return file;
  }

  // Paliers de qualité JPEG essayés dans l'ordre, du meilleur au plus compressé.
  // On s'arrête au premier palier qui passe sous maxSizeBytes.
  const paliersQualite = [0.6, 0.45, 0.3, 0.2];

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // On rend chaque page une seule fois (coûteux), puis on ré-encode le
    // JPEG à des qualités décroissantes jusqu'à passer sous la taille cible.
    const canvasParPage = [];
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      canvasParPage.push({ canvas, width: viewport.width, height: viewport.height });
    }

    const { PDFDocument } = PDFLib;
    let dernierResultat = null;

    for (const quality of paliersQualite) {
      const newPdf = await PDFDocument.create();

      for (const { canvas, width, height } of canvasParPage) {
        const jpegDataUrl = canvas.toDataURL("image/jpeg", quality);
        const jpegBytes = await fetch(jpegDataUrl).then((r) => r.arrayBuffer());
        const jpegImage = await newPdf.embedJpg(jpegBytes);
        const newPage = newPdf.addPage([width, height]);
        newPage.drawImage(jpegImage, { x: 0, y: 0, width, height });
      }

      const compressedBytes = await newPdf.save();
      dernierResultat = compressedBytes;

      if (compressedBytes.byteLength <= maxSizeBytes) {
        break; // ce palier de qualité suffit, pas besoin d'aller plus loin
      }
    }

    const compressedBlob = new Blob([dernierResultat], { type: "application/pdf" });
    console.log(`[compress-pdf] Résultat final : ${(compressedBlob.size / 1024 / 1024).toFixed(2)} Mo`);
    return new File([compressedBlob], file.name.replace(/\.pdf$/i, "-compresse.pdf"), {
      type: "application/pdf",
    });
  } catch (err) {
    console.error("[compress-pdf] Compression échouée, envoi du fichier original :", err);
    return file; // on ne bloque jamais l'utilisateur si la compression plante
  }
}

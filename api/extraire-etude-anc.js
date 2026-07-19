/**
 * api/extraire-etude-anc.js
 *
 * Reçoit le PDF de l'étude de sol (base64), l'héberge dans Supabase Storage
 * (bucket media-anc), en extrait le texte, puis demande à Claude de retourner
 * les informations structurées utiles au formulaire ANC : coordonnées du
 * demandeur, filière préconisée, EH, dimensions, contraintes.
 *
 * Dépendances à ajouter dans package.json (npm install côté repo) :
 *   - pdf-parse
 *   - @anthropic-ai/sdk
 *
 * Variables d'environnement Vercel à ajouter :
 *   - ANTHROPIC_API_KEY
 *   (+ les SUPABASE_ANC_URL / SUPABASE_ANC_SERVICE_ROLE_KEY déjà en place)
 *
 * Limite à connaître : le body des fonctions Vercel est plafonné à 4.5 Mo.
 * La plupart des études de sol (texte + petits plans) passent, mais une étude
 * très riche en images haute résolution peut dépasser cette limite — si ça
 * arrive en pratique, il faudra faire uploader le PDF directement par le
 * client vers Supabase Storage (URL signée) puis ne transmettre que l'URL
 * à cet endpoint, au lieu du base64 complet.
 */

const { createClient } = require("@supabase/supabase-js");
const pdfParse = require("pdf-parse");
const Anthropic = require("@anthropic-ai/sdk");

const supabaseAnc = createClient(
  process.env.SUPABASE_ANC_URL,
  process.env.SUPABASE_ANC_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Doit correspondre exactement aux clés de PRICING_CONFIG_ANC.filieres
// (cf. anc-pricing-config-server.js)
const FILIERES_CONNUES = [
  "filtreSableDraineEtanche",
  "filtreSableDraineNonEtanche",
  "tranchesEpandage",
  "filtreCompact",
  "microstation",
];

const PROMPT_EXTRACTION = `Tu vas lire le texte d'une étude de filière d'assainissement non collectif (ANC) réalisée par un bureau d'études français. Extrait UNIQUEMENT les informations suivantes et réponds STRICTEMENT en JSON valide, sans aucun texte avant ou après, selon ce schéma exact :

{
  "demandeur": { "prenom": string|null, "nom": string|null, "adresse": string|null, "telephone": string|null, "email": string|null },
  "adresseProjet": string|null,
  "communeProjet": string|null,
  "piecesPrincipales": number|null,
  "eh": number|null,
  "filiere": "filtreSableDraineEtanche" | "filtreSableDraineNonEtanche" | "tranchesEpandage" | "filtreCompact" | "microstation" | null,
  "filiereLibelle": string|null,
  "dimensionFiltreM2": number|null,
  "volumeFosseLitres": number|null,
  "posteDeRelevage": boolean|null,
  "exutoire": "infiltration" | "fosse" | null,
  "rocheSignalee": boolean|null,
  "ventilationAPrevoir": boolean|null
}

Règles :
- "filiere" doit être EXACTEMENT une des 5 valeurs listées, choisie selon la filière réellement préconisée dans l'étude (ex : un "filtre à sable vertical drainé et imperméabilisé par géomembrane" = filtreSableDraineEtanche ; un système avec média filtrant / cuve compacte type Xperco, X-PERCO, filtre compact, filtre coco = filtreCompact ; un système avec pompe + cuve tout-en-un présenté comme microstation ou "OXYFIX" = microstation ; "tranchées d'épandage" ou "lit d'épandage" en sol naturel sans filtre rapporté = tranchesEpandage).
- "eh" : nombre d'équivalents-habitants (souvent indiqué directement, sinon égal au nombre de pièces principales).
- "posteDeRelevage" : true si l'étude mentionne un poste de relevage, une pompe de relevage, ou "R" sur le schéma de principe.
- "rocheSignalee" : true si l'étude mentionne un risque de roche, un brise-roche, ou une contrainte géologique de type roche/mylonitique/granite en profondeur.
- Si une information n'est pas présente dans le texte, mets null. N'invente rien.
- Les études n'indiquent presque jamais d'email : laisse "email" à null sauf s'il est explicitement écrit.

Texte de l'étude :
"""
{{TEXTE_ETUDE}}
"""`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  try {
    const { fichierBase64, nomFichier } = req.body;
    if (!fichierBase64) {
      res.status(400).json({ error: "Fichier manquant" });
      return;
    }

    const bufferPdf = Buffer.from(fichierBase64, "base64");

    // --- 1. Hébergement du PDF dans Supabase Storage (traçabilité + lien dans le lead) ---
    const cheminStorage = `etudes/${Date.now()}-${(nomFichier || "etude.pdf").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: erreurUpload } = await supabaseAnc.storage
      .from("media-anc")
      .upload(cheminStorage, bufferPdf, { contentType: "application/pdf" });
    if (erreurUpload) throw erreurUpload;

    const { data: urlPublique } = supabaseAnc.storage.from("media-anc").getPublicUrl(cheminStorage);
    const etudePdfUrl = urlPublique.publicUrl;

    // --- 2. Extraction du texte du PDF ---
    const resultatPdf = await pdfParse(bufferPdf);
    const texteEtude = resultatPdf.text.slice(0, 40000); // garde-fou taille de prompt

    // --- 3. Extraction structurée via Claude ---
    const prompt = PROMPT_EXTRACTION.replace("{{TEXTE_ETUDE}}", texteEtude);

    const reponseClaude = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001", // extraction structurée simple : Haiku suffit, moins cher
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const texteBrut = reponseClaude.content
      .map(bloc => (bloc.type === "text" ? bloc.text : ""))
      .join("")
      .trim();

    let donneesExtraites;
    try {
      // Retire d'éventuels ```json ... ``` si le modèle en ajoute malgré la consigne
      const nettoye = texteBrut.replace(/```json|```/g, "").trim();
      donneesExtraites = JSON.parse(nettoye);
    } catch (erreurParse) {
      console.error("Réponse Claude non parsable :", texteBrut);
      throw new Error("Extraction impossible à interpréter");
    }

    if (donneesExtraites.filiere && !FILIERES_CONNUES.includes(donneesExtraites.filiere)) {
      donneesExtraites.filiere = null; // valeur inattendue -> laissé au choix manuel du client
    }

    res.status(200).json({
      ok: true,
      etudePdfUrl,
      donneesExtraites,
    });
  } catch (err) {
    console.error("extraire-etude-anc error:", err);
    res.status(500).json({ error: "Erreur lors de l'analyse de l'étude" });
  }
};

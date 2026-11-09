# SalesFlow System — EcoSky by RMS

Version connectée : base de données partagée (Supabase) + réception automatique des leads
Facebook Ads via Make.com, sans jamais toucher à un CSV.

## Étape 1 — Configurer Supabase

1. Crée un compte sur https://supabase.com et un nouveau projet (`ecosky-salesflow`, région Europe).
2. Dans **SQL Editor**, colle le contenu de `supabase-setup.sql` et clique **Run**.
3. Dans **Project Settings → API**, note ton **Project URL** et ta clé **anon public**.
4. Ouvre `src/supabaseClient.js` et remplace `SUPABASE_URL` et `SUPABASE_ANON_KEY` par tes valeurs.

## Étape 2 — Déployer sur Vercel

1. Crée un dépôt GitHub et uploade tout le contenu de ce dossier.
2. Va sur https://vercel.com → **Add New → Project** → importe ton dépôt.
3. Laisse les réglages par défaut (Vite est détecté automatiquement) → **Deploy**.
4. Tu obtiens une URL du type `salesflow-ecosky.vercel.app`, utilisable par toi et Fanny — les
   données sont maintenant partagées entre vous deux via Supabase.

## Étape 3 — Connecter Facebook Lead Ads avec Make.com (récupération automatique des leads)

1. Crée un compte gratuit sur https://www.make.com
2. **Create a new scenario**
3. Premier module : cherche **Facebook Lead Ads** → action **Watch Leads**
   - Connecte ton compte Facebook (autorise l'accès à ta Page et à tes formulaires pub)
   - Choisis ta Page, puis ton formulaire Lead Ads actif
4. Deuxième module : clique le **+** → cherche **Supabase** → action **Create a Row**
   - Connecte Supabase avec ton Project URL + ta clé **service_role** (Project Settings → API,
     PAS la clé anon — celle-ci a les droits d'écriture complets)
   - Table : `leads`
   - Fais correspondre les champs de ton formulaire Facebook à nos colonnes :
     - `nom` ← le champ nom/prénom du formulaire
     - `telephone` ← le champ téléphone
     - `email` ← le champ email
     - `source` ← tu peux mettre le nom de la campagne en texte fixe, ex. "Facebook Ads"
     - `stage` ← texte fixe : `nouveau`
5. Clique **Run once** pour tester, puis active le scénario (bouton en haut à gauche) et passe-le
   en fonctionnement **immédiat** (dans les réglages du scénario, intervalle "instantané" via
   webhook, sinon toutes les 15 min sur le plan gratuit).
6. Désormais, chaque nouvelle demande sur ta pub Facebook arrive automatiquement dans le
   SalesFlow System, en temps réel, sans aucune manipulation de ta part.

## Important à savoir

- La clé **anon** dans `supabaseClient.js` est visible dans le code de l'app (normal pour ce
  type d'outil). Les policies mises en place autorisent la lecture/écriture pour un usage
  interne équipe. Si tu veux restreindre l'accès plus tard (ex. mot de passe d'équipe), dis-le
  moi.
- Le bouton **Export** reste disponible pour sortir un CSV à tout moment (sauvegarde, compta...).
- Le CSV import manuel fonctionne toujours en complément, pour les leads d'autres sources
  (salons, formulaire Webador, etc.).

## Étape 4 — Le "cerveau" WhatsApp (réponse automatique par IA)

Cette fonction reçoit chaque message WhatsApp entrant, répond intelligemment via l'IA
(explique les prestations, pose les bonnes questions, propose le catalogue et le lien devis),
et garde tout l'historique dans Supabase.

### 4.1 — Créer les tables Supabase pour les conversations

Dans Supabase → SQL Editor, exécute le contenu de `supabase-whatsapp-setup.sql`.

### 4.2 — Récupérer tes accès WhatsApp Business

1. Va sur https://developers.facebook.com/apps → sélectionne (ou crée) ton app liée à WhatsApp Business
2. Dans le menu de gauche : **WhatsApp → Configuration de l'API**
3. Note :
   - **Phone number ID** (l'identifiant du numéro, pas le numéro lui-même)
   - **Temporary access token** (valide 24h) — pour une utilisation durable, génère plutôt un
     **token permanent** via **Système d'utilisateurs** dans les paramètres de l'app (rôle "Admin",
     permissions `whatsapp_business_messaging` + `whatsapp_business_management`)

### 4.3 — Ajouter les variables d'environnement sur Vercel

Dans ton projet Vercel → **Settings → Environment Variables**, ajoute :

| Nom | Valeur |
|---|---|
| `SUPABASE_URL` | `https://wklddwumirkdjkbxvzyj.supabase.co` |
| `SUPABASE_SERVICE_KEY` | ta clé **secret** Supabase (Project Settings → API Keys → Secret keys) |
| `WHATSAPP_TOKEN` | le token récupéré à l'étape 4.2 |
| `WHATSAPP_PHONE_NUMBER_ID` | le Phone number ID récupéré à l'étape 4.2 |
| `WHATSAPP_VERIFY_TOKEN` | invente une phrase secrète, ex. `ecosky-verif-2026` |
| `ANTHROPIC_API_KEY` | ta clé API Anthropic (depuis console.anthropic.com) |

Après ajout, redéploie le projet (Vercel → Deployments → ⋮ → Redeploy) pour que les
variables soient prises en compte.

### 4.4 — Connecter le webhook dans Meta

1. Toujours dans developers.facebook.com → ton app → **WhatsApp → Configuration**
2. Section **Webhook** → clique **Modifier**
3. **URL de rappel** : `https://salesflow-ecosky.vercel.app/api/whatsapp-webhook`
4. **Jeton de vérification** : la même phrase secrète que `WHATSAPP_VERIFY_TOKEN` ci-dessus
5. Clique **Vérifier et enregistrer**
6. Abonne-toi au champ **messages** (bouton "Gérer" à côté du champ, coche "messages")

### 4.5 — Tester

Envoie un message WhatsApp depuis ton téléphone personnel vers le numéro WhatsApp Business
de RMS ECOSKY. L'IA doit répondre en quelques secondes. Consulte les tables `wa_messages` et
`wa_conversations` dans Supabase pour voir la conversation enregistrée.

### Important à savoir

- Ceci gère les réponses aux messages **reçus**. Pour envoyer un premier message toi-même
  (relance automatique), Meta impose un **modèle de message pré-approuvé** — à soumettre
  séparément dans Meta Business Manager (validation en quelques jours).
- Le "cerveau" (`SYSTEM_PROMPT` dans `api/whatsapp-webhook.js`) peut être ajusté à tout moment :
  modifie le texte, redéploie, et le ton/comportement de l'assistant change immédiatement.

## Développement local (optionnel)

```
npm install
npm run dev
```

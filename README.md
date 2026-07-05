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

## Développement local (optionnel)

```
npm install
npm run dev
```

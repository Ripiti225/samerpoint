# Web Push (PWA) — mise en route

Objectif : recevoir les notifications **hors de l'app** (téléphone verrouillé,
app fermée), avec le bon routage — le tel du resto reçoit **ses** notifs, le
tel du manager reçoit **les siennes**.

## Pourquoi ce n'était pas reçu avant

L'ancien circuit `lib/notifications.js` (Expo) **sort dès qu'on est sur le web**
(`if (Platform.OS === 'web') return`). Or les gérants tournent en PWA Safari :
aucun token n'était jamais enregistré. Expo push ne marche **que** dans un build
natif. Sur PWA, il faut le **Web Push (VAPID)** — c'est ce qui est mis en place ici.

## Architecture (rappel)

- `public/sw.js` — service worker qui affiche la notif (copié dans `dist/` au build).
- `lib/webPush.js` — abonne le navigateur, enregistre `{ endpoint, restaurant_id, user_id, role }`.
- `web_push_subscriptions` (table) — 1 ligne par appareil.
- `supabase/functions/send-web-push` — **ciblage serveur** + envoi (détient la clé privée VAPID).
- Déclenchement : `creerNotification()` appelle l'Edge Function → **couvre les 8 événements existants** et les futurs.

**Routage** (topologie « 1 tel par resto ») :
| Destinataire | Clé de sélection |
|---|---|
| gérant / caissier | `restaurant_id` (le tel du resto) |
| manager / directeur / rh | `user_id` (leur tel perso) |

---

## Étapes (à faire une fois)

### 1. Générer les clés VAPID
```bash
npx web-push generate-vapid-keys
```
Note la **Public Key** et la **Private Key**.

### 2. Renseigner la clé PUBLIQUE côté app
Dans `.env` :
```
EXPO_PUBLIC_VAPID_PUBLIC_KEY=BExxxxx…   # la Public Key
```
⚠️ En prod (Vercel/LWS), si le build ne lit pas `.env`, remplace aussi le
fallback dans `lib/webPush.js` :
```js
const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY || 'BExxxxx…'
```
(comme la clé Supabase est déjà en dur dans `app.config.js`, mets la clé
publique VAPID en dur ici aussi pour être tranquille.)

### 3. Secrets de l'Edge Function
Dashboard Supabase → **Edge Functions → Manage secrets** (ou CLI) :
```
VAPID_PUBLIC_KEY   = BExxxxx…                 # même Public Key
VAPID_PRIVATE_KEY  = xxxxx…                    # la Private Key (SECRET)
VAPID_SUBJECT      = mailto:contact@alkayanabj.com
```
CLI équivalent :
```bash
supabase secrets set VAPID_PUBLIC_KEY="…" VAPID_PRIVATE_KEY="…" VAPID_SUBJECT="mailto:contact@alkayanabj.com"
```

### 4. Créer la table
SQL editor du dashboard → coller **`supabase_web_push.sql`** → Run.

### 5. Déployer l'Edge Function
- **CLI** : `supabase functions deploy send-web-push`
- **Si le CLI échoue depuis le Mac (réseau)** : Dashboard → **Edge Functions →
  Create a function** → nom `send-web-push` → coller le contenu de
  `supabase/functions/send-web-push/index.ts` → Deploy.

> **Si l'invocation renvoie 401** : l'app appelle la fonction avec la clé anon
> (elle n'a pas de session Supabase Auth). La clé anon est un JWT valide et
> passe normalement `verify_jwt`. Si ce n'est pas le cas, redéploie avec
> `supabase functions deploy send-web-push --no-verify-jwt` (ou décoche
> « Verify JWT » dans le Dashboard).

### 6. Redéployer l'app web
Rebuild + déploiement web habituel (pour livrer `dist/sw.js` + le nouveau code).
**Aucun nouveau build natif nécessaire** : les gérants rechargent leur PWA.

---

## Côté utilisateur (une fois, par téléphone)

1. L'app doit être **épinglée à l'écran d'accueil** (iOS ≥ 16.4 obligatoire).
   Sinon, sur iPhone, l'abonnement est refusé (Safari onglet ≠ PWA).
2. Ouvrir l'app **depuis l'icône** de l'écran d'accueil.
3. Sur l'accueil : bandeau **« 🔔 Activer les alertes sur ce téléphone »** →
   appuyer → accepter la demande de permission.

À partir de là, chaque connexion réactualise le mapping de l'appareil
(important sur le tel du resto où gérant et caissier alternent).

---

## Vérifier que ça marche

**Voir les appareils abonnés + leur routage :**
```sql
select role, restaurant_id, user_id, left(endpoint, 40) as endpoint, updated_at
from web_push_subscriptions order by updated_at desc;
```
- Un tel de resto → `restaurant_id` renseigné.
- Un tel manager/rh → `user_id` renseigné, `restaurant_id` NULL.

**Test direct de l'Edge Function** (remplace l'URL du projet / le restaurant_id) :
```bash
curl -X POST 'https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/send-web-push' \
  -H 'Authorization: Bearer <ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"type":"test","titre":"Test Angré 7e","message":"ça marche ?","cible_role":["gerant"],"restaurant_id":"<UUID_ANGRE_7E>","screen":"accueil"}'
```
La réponse `{ ok: true, envoyes: N, cibles: N }` confirme l'envoi ; seul le tel
d'Angré 7e doit sonner.

**Test bout-en-bout** : valide un shift caissier / crée une demande → la notif
in-app **et** le push doivent partir ensemble (les deux passent par `creerNotification`).

---

## Notes

- L'ancien circuit Expo (`lib/notifications.js` + `admin_push_tokens`) reste en
  place pour d'éventuels builds natifs ; il ne gêne pas le Web Push.
- Les abonnements périmés (404/410) sont purgés automatiquement à l'envoi.
- Le service worker ne fait **que** du push (pas de cache) → n'interfère pas
  avec la SPA Expo.

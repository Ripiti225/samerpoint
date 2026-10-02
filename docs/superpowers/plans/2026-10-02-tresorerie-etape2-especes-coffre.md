# Trésorerie étape 2 — Banque, espèces et coffre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Espèces comme vrai compte (entrées avec origine restaurant ou prêt, virements), coffre-épargne avec emprunts à rembourser (date ou prochaine réception partenaire).

**Architecture:** Espèces = une ligne de `tresorerie_comptes` ; toutes les sorties « espèces » passent par ce compte. Prêt, virement, emprunt et remboursement sont des fonctions SQL atomiques (plusieurs écritures liées). L'état d'un emprunt se calcule en pur JS (`statutEmprunt`).

**Tech Stack:** Expo / React Native web, Supabase (PostgREST + RPC plpgsql), tests `node:test`.

**Spec :** `docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md` (« Étape 2 »).

## Global Constraints

- Français courant, FCFA entiers (`bigint`), dates ISO `AAAA-MM-JJ`.
- Logique pure dans `lib/*.js`, tests `node lib/<x>.test.mjs`, imports entre fichiers `lib/` testés avec `.js`.
- Migration idempotente passée par l'utilisateur ; l'app reste utilisable avant (fonctions nouvelles → message « … passer supabase_tresorerie*.sql »).
- Ne jamais lancer le serveur local ; vérifier par tests, lint (0 erreur) et `npx expo export -p web`.
- Pas de publication Vercel / EAS.

---

### Task 1: Migration `supabase_tresorerie_especes.sql`

**Produces:** compte « Espèces » ; `tresorerie_mouvements.type` + `especes`, `virement`, `pret` ; colonnes `tresorerie_mouvements.restaurant_id`, `tresorerie_mouvements.groupe` ; `tresorerie_dus.est_pret`, `tresorerie_dus.pret_mouvement_id` ; table `tresorerie_coffre_emprunts` ; RPC `tresorerie_entree_pret`, `tresorerie_annuler_pret`, `tresorerie_virement`, `tresorerie_coffre_emprunter`, `tresorerie_coffre_rembourser`, `tresorerie_coffre_emprunt_annuler` ; `tresorerie_coffre_annuler` refuse un mouvement lié à un emprunt.

- [ ] Écrire le fichier (voir le dépôt), `git commit -m "feat(tresorerie): migration espèces, virements, emprunts au coffre"`.

### Task 2: Logique pure

**Files:** `lib/tresorerie.js`, `lib/direction.js`, tests.

- `classerDu` : `categorie === 'dette' && est_pret && !en_dette_depuis` → `'dette_recente'`.
- `statutEmprunt(emprunt, receptions, aujourdhui) → 'rembourse' | 'a_rembourser' | 'en_cours'` :
  remboursé si `rembourse_le` ; à rembourser si `rembourser_le <= aujourdhui`, ou si une réception
  `type 'recu'` du partenaire choisi a `created_at > emprunt.created_at` ; sinon en cours.
- `resteARembourser(emprunts) → somme des montants non remboursés`.

Tests (échouer puis passer) :

```js
test('prêt en espèces : dette récente, puis dette à la main', () => {
  const p = { id: 'p', categorie: 'dette', creancier: 'Ibrahim', est_pret: true, montant_du: 500000 }
  assert.equal(classerDu(p, [p], {}, '2026-10-02'), 'dette_recente')
  assert.equal(classerDu({ ...p, en_dette_depuis: '2026-10-05' }, [p], {}, '2026-10-05'), 'dette')
})
```

```js
describe('emprunts au coffre', () => {
  const e = { id: 'e', montant: 300000, created_at: '2026-10-02T10:00:00Z', rembourser_le: '2026-10-15' }
  test('avant la date : en cours ; le jour même : à rembourser', () => {
    assert.equal(statutEmprunt(e, [], '2026-10-14'), 'en_cours')
    assert.equal(statutEmprunt(e, [], '2026-10-15'), 'a_rembourser')
  })
  test('prochaine réception Glovo : seulement une réception marquée après l\'emprunt', () => {
    const g = { ...e, rembourser_le: null, rembourser_partenaire: 'glovo' }
    const avant = { partenaire: 'glovo', type: 'recu', created_at: '2026-10-01T09:00:00Z' }
    const apres = { partenaire: 'glovo', type: 'recu', created_at: '2026-10-03T09:00:00Z' }
    const wave = { partenaire: 'wave', type: 'recu', created_at: '2026-10-03T09:00:00Z' }
    assert.equal(statutEmprunt(g, [avant, wave], '2026-10-04'), 'en_cours')
    assert.equal(statutEmprunt(g, [avant, apres], '2026-10-04'), 'a_rembourser')
  })
  test('remboursé', () => {
    assert.equal(statutEmprunt({ ...e, rembourse_le: '2026-10-10' }, [], '2026-10-20'), 'rembourse')
  })
  test('reste à rembourser', () => {
    assert.equal(resteARembourser([e, { ...e, id: 'f', montant: 100000, rembourse_le: '2026-10-10' }]), 300000)
  })
})
```

Commit : `feat(tresorerie): prêt en dette récente, état des emprunts au coffre`.

### Task 3: Couche base de données (`lib/tresorerieDb.js`)

- `entreeEspeces({ compteId, montant, date, restaurantId, note, photoUrl }, user)` : mouvement `type 'especes'`, `restaurant_id`, libellé « Espèces · {restaurant} ».
- `entreePret({ compteId, montant, date, creancier, note }, user)` → RPC `tresorerie_entree_pret`.
- `virement({ deId, versId, montant, date, note }, user)` → RPC `tresorerie_virement`.
- `supprimerMouvement` : `groupe` → supprime les deux mouvements ; `type 'pret'` → RPC `tresorerie_annuler_pret`.
- `emprunterCoffre({ montant, compteId, date, rembourserLe, rembourserPartenaire, note }, user)`, `rembourserEmprunt({ emprunt, compteId, date }, user)`, `annulerEmprunt(emprunt, user)` → RPC.
- `chargerDirection()` renvoie aussi `emprunts` et `receptions` (lignes `recu`), vides si la migration manque.
- `chargerTresorerie()` : rien à changer (Espèces arrive avec les comptes).

Commit : `feat(tresorerie): espèces, virements et emprunts en base`.

### Task 4: Écrans

- **Banque et espèces** (`app/tresorerie-banque.js`) : titre ; libellés de tous les types ; sur Espèces : « + Entrée d'espèces » (origine : restaurant ou prêt ; prêt = prêteur + avertissement « la dette est créée en dette récente ») ; sur BACI / SIB : recaler, + reçu banque ; boutons « Virement entre comptes » et « Épargner (vers le coffre) » (→ `/tresorerie-coffre?op=epargner`).
- **Coffre** (`app/tresorerie-coffre.js`) : « + Épargner » (ancien dépôt, comptes seulement) ; « Emprunter » (montant ≤ solde, compte qui reçoit, quand rembourser : date ou partenaire) ; carte « À rembourser » (orange quand c'est le moment, bouton « Rembourser » → compte d'où part l'argent, date) ; appui long sur un emprunt non remboursé → annuler.
- **Sources** : `components/tresorerie/du.js` (paiement), `app/tresorerie-direction.js` (dépense) : plus d'option « Espèces » séparée, le compte Espèces suffit.
- **Vue d'ensemble** : « Banque et espèces » ; coffre : « à rembourser X F ».
- **Dettes** : « Passer en Dette » aussi pour un prêt (`du.js`).

Vérifier : lint, tests, `npx expo export -p web`. Commit : `feat(tresorerie): banque et espèces, épargne et emprunts au coffre`.

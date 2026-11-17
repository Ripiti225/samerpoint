# Bannière Comptabilité — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la bannière « Trésorerie » de l'accueil manager/RH par une bannière « Comptabilité » (Trésorerie, Crédits fournisseurs, Salaires du mois, Rapports), écrans colorés en vert.

**Architecture:** Changement purement déclaratif dans `lib/groupesAccueil.js` (`GROUPES_ADMIN`, `GROUPES_THEME_ACTIFS`). L'accueil (`components/accueil/AccueilManager.js` via `organiserAccueil`) et le thème (`context/ThemeContext.js` via `groupeDeRoute`) lisent déjà ces constantes : aucun autre fichier de code ne change.

**Tech Stack:** Expo / React Native, tests `node:test` (`lib/*.test.mjs`).

Spec : `docs/superpowers/specs/2026-11-17-groupe-comptabilite-design.md`

## Global Constraints

- Interface et messages en français.
- Aucune route, aucun id de tuile du catalogue `TUILES` (`lib/menus.js`), aucune table ne change. Pas de SQL.
- `GROUPES_GERANT` et `FAVORIS_ADMIN` restent identiques.
- Ne jamais lancer `expo start` / localhost : vérifier par tests, lint et `npx expo export -p web`.
- Publication (Vercel + EAS) uniquement sur décision de l'utilisateur, pas dans ce plan.

---

### Task 1: Bannière Comptabilité et couleur des écrans

**Files:**
- Modify: `lib/groupesAccueil.js:19-30` (`GROUPES_ADMIN`) et `lib/groupesAccueil.js:166` (`GROUPES_THEME_ACTIFS`)
- Test: `lib/groupesAccueil.test.mjs`

**Interfaces:**
- Consumes: `organiserAccueil(tuiles, role)`, `organiserAccueilAdmin(tuiles)`, `groupeDeRoute(chemin, actifs?)` — existants, inchangés.
- Produces: groupe admin `{ id: 'comptabilite', icone: 'calculator-variant', couleur: '#0E9F6E', fonce: '#047857', titre: 'Comptabilité', tuiles: ['tresorerie', 'credits-fournisseurs', 'salaires', 'rapports'] }` en tête de `GROUPES_ADMIN` ; `GROUPES_THEME_ACTIFS = ['comptabilite', 'controle', 'tableaux']`.

- [ ] **Step 1: Mettre à jour les tests existants et écrire les nouveaux**

Dans `lib/groupesAccueil.test.mjs` :

Remplacer l'attente du test « favoris d'abord, groupes vides retirés… » :

```js
    assert.deepEqual(r.groupes.map(g => [g.id, g.tuiles.map(t => t.id)]), [['comptabilite', ['tresorerie']], ['administration', ['journal']]])
```

Remplacer le test « écrans de la Trésorerie, sous-écrans et crédits fournisseurs » par :

```js
  test('écrans de la Comptabilité : Trésorerie et sous-écrans, crédits fournisseurs, salaires, rapports', () => {
    for (const r of ['/tresorerie', '/tresorerie-a-payer?onglet=loyer', '/tresorerie-restaurant', '/credits-fournisseurs', '/salaires', '/rapports']) {
      assert.equal(groupeDeRoute(r)?.id, 'comptabilite', r)
    }
  })
```

Ajouter à la fin du fichier :

```js
describe('bannière Comptabilité', () => {
  const t = ids => ids.map(id => ({ id }))
  test('en tête, verte, avec exactement ses 4 écrans dans l’ordre', () => {
    const g = GROUPES_ADMIN[0]
    assert.equal(g.id, 'comptabilite')
    assert.equal(g.titre, 'Comptabilité')
    assert.equal(g.couleur, '#0E9F6E')
    assert.deepEqual(g.tuiles, ['tresorerie', 'credits-fournisseurs', 'salaires', 'rapports'])
    assert.ok(!GROUPES_ADMIN.some(x => x.id === 'tresorerie'))
  })
  test('Rapports quitte Tableaux de bord, Salaires quitte Personnel', () => {
    assert.deepEqual(GROUPES_ADMIN.find(g => g.id === 'tableaux').tuiles, ['dashboard-global', 'stats-caissiers'])
    assert.ok(!GROUPES_ADMIN.find(g => g.id === 'personnel').tuiles.includes('salaires'))
  })
  test('RH : seulement ses écrans autorisés dans la bannière', () => {
    const r = organiserAccueil(t(['tresorerie', 'credits-fournisseurs', 'salaires', 'equipe']), 'rh')
    assert.deepEqual(r.groupes.find(g => g.id === 'comptabilite').tuiles.map(x => x.id), ['tresorerie', 'credits-fournisseurs', 'salaires'])
  })
  test('RH sans aucun écran de comptabilité : pas de bannière', () => {
    const r = organiserAccueil(t(['equipe', 'contrats']), 'rh')
    assert.ok(!r.groupes.some(g => g.id === 'comptabilite'))
  })
  test('gérant inchangé : Crédits fournisseurs reste dans Dépenses', () => {
    assert.ok(GROUPES_GERANT.find(g => g.id === 'depenses').tuiles.includes('credits-fournisseurs'))
    assert.ok(!GROUPES_GERANT.some(g => g.id === 'comptabilite'))
  })
})
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `node lib/groupesAccueil.test.mjs`
Expected: FAIL — `GROUPES_ADMIN[0].id` vaut `'tresorerie'`, `groupeDeRoute('/rapports')?.id` vaut `'tableaux'`, `groupeDeRoute('/salaires')` vaut `null`.

- [ ] **Step 3: Implémenter**

Dans `lib/groupesAccueil.js`, remplacer la ligne du groupe `tresorerie` et ajuster `tableaux` et `personnel` :

```js
export const GROUPES_ADMIN = [
  { id: 'comptabilite', icone: 'calculator-variant', couleur: '#0E9F6E', fonce: '#047857', titre: 'Comptabilité', tuiles: ['tresorerie', 'credits-fournisseurs', 'salaires', 'rapports'] },
  { id: 'tableaux', icone: 'chart-box', couleur: '#6C63E0', fonce: '#4F46C8', titre: 'Tableaux de bord', tuiles: ['dashboard-global', 'stats-caissiers'] },
  { id: 'controle', icone: 'clipboard-check', couleur: '#E07B00', fonce: '#B45309', titre: 'Contrôle des points', tuiles: ['verification', 'point-caissier', 'modifier-point', 'litiges', 'supervision', 'corbeille'] },
  { id: 'stock', icone: 'package-variant-closed', couleur: '#B7791F', fonce: '#92400E', titre: 'Stock', tuiles: ['gestion-stock', 'modifier-inventaire', 'recap-verifications'] },
  {
    id: 'personnel', icone: 'account-group', couleur: '#2F7FD8', fonce: '#1D5FB0', titre: 'Personnel et documents',
    tuiles: ['equipe', 'contrats', 'embauches', 'demandes-admin', 'demandes-explication-admin', 'documents', 'evenements'],
  },
  { id: 'clients', icone: 'star-face', couleur: '#D53F8C', fonce: '#B0306F', titre: 'Clients', tuiles: ['avis-plateformes', 'contacts'] },
  { id: 'administration', icone: 'shield-account', couleur: '#64748B', fonce: '#475569', titre: 'Administration', tuiles: ['journal', 'parametres'] },
]
```

Et ligne 166 :

```js
export const GROUPES_THEME_ACTIFS = ['comptabilite', 'controle', 'tableaux']
```

(`groupeDeRoute` ramène déjà `tresorerie-*` à la tuile `tresorerie`, désormais dans `comptabilite` : rien à changer.)

- [ ] **Step 4: Relancer tous les tests**

Run: `for f in lib/*.test.mjs; do node "$f" || echo "ÉCHEC $f"; done`
Expected: aucun « ÉCHEC », tous les `# fail 0`.

- [ ] **Step 5: Lint + export web**

Run: `npm run lint && npx expo export -p web`
Expected: 0 erreur de lint ; export terminé sans erreur.

- [ ] **Step 6: Commit + graphe**

```bash
git add lib/groupesAccueil.js lib/groupesAccueil.test.mjs
git commit -m "feat(accueil): bannière Comptabilité (trésorerie, crédits fournisseurs, salaires, rapports)"
graphify update . && git add -A graphify-out && git commit -m "chore(graphify): graphe à jour après la bannière Comptabilité"
git push
```

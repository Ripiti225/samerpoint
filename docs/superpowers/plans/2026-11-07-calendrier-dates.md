# Calendrier : toutes les dates — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** afficher dans le fil des Événements les chèques, échéances, prévisions, remboursements du coffre, charges administratives, fins de contrat, congés et tâches de supervision, selon les droits de chacun.

**Architecture :** `lib/calendrierDates.js` transforme les données en lignes selon les droits, sans import de React Native. `lib/evenements.js` gagne la section En retard et les filtres par famille. L'écran charge ces données à part, pour qu'un échec n'empêche pas le reste de s'afficher.

**Tech Stack :** React Native / Expo Router, Supabase, `node:test`.

**Conception :** `docs/superpowers/specs/2026-11-07-calendrier-dates-design.md`.

## Global Constraints

- Interface en français courant, sans code technique.
- Aucune migration, aucune écriture en base, aucune nouvelle notification.
- Un compte ne lit jamais les données qu'il n'a pas le droit de voir.
- Lectures susceptibles de dépasser 1000 lignes : `.range()` et `.order()` stable.
- `git` : préfixer par `export DEVELOPER_DIR=/Library/Developer/CommandLineTools`. Ne jamais lancer `git add -A` : `.claude/settings.json` et `graphify-out/` ne doivent pas être committés, et une autre session peut travailler dans ce dossier.
- Ne jamais lancer `expo start` ni `localhost`, ni `CI=1`. Aucune publication.
- Commit et push à chaque tâche.
- Tests : `for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ECHEC $f"; done`.

---

### Task 1 : logique pure

**Files :**
- Create : `lib/calendrierDates.js`
- Test : `lib/calendrierDates.test.mjs`
- Modify : `lib/evenements.js`, `lib/evenements.test.mjs`

**Interfaces :**
- Produces (depuis `lib/calendrierDates.js`) :
  - `droitsDates(role, userId, droits) → { cheques, coffre, charges, categories, dettes, contrats, conges, taches }`
  - `SANS_TRESORERIE` : les champs à recouvrir si les droits ne peuvent pas être lus
  - `lignesDates(donnees, { aujourdhui, droits, restaurantId, groupe }) → lignes`. Une ligne : `{ cle, type: 'date', famille, sousType, date, retard, titre, detail, montant, route, restaurant_id }`
- Produces (depuis `lib/evenements.js`) : `fusionnerLignes(a, b) → lignes triées` ; `construireFil` gère `En retard`, les familles et `Plus tard` pour `calendrier`, `tresorerie`, `personnel`, `taches`.

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `lib/calendrierDates.test.mjs` :

```js
// Tests de lib/calendrierDates.js — droits et lignes du calendrier.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { droitsDates, lignesDates } from './calendrierDates.js'

const AUJ = '2026-11-07'
const proprietaire = droitsDates('manager', 'p', [{ user_id: 'p', niveau: 'proprietaire' }])
const vide = {
  restaurants: [{ id: 'r1', nom: 'Samer Maroc' }], cheques: [], dus: [], paiements: [], previsions: [], emprunts: [],
  fournisseurs: [], contrats: [], demandes: [], permissions: [], taches: [],
}
const lignes = (d, o = {}) => lignesDates({ ...vide, ...d }, { aujourdhui: AUJ, droits: proprietaire, restaurantId: null, groupe: true, ...o })
const du = (o = {}) => ({ id: 'd1', categorie: 'loyer', restaurant_id: 'r1', libelle: 'Loyer novembre', montant_du: 500000, echeance: '2026-11-20', ...o })

test('droits : propriétaire, autre manager, RH, gérant', () => {
  const droits = [{ user_id: 'p', niveau: 'proprietaire' }]
  assert.deepEqual(
    [proprietaire.cheques, proprietaire.coffre, proprietaire.dettes, proprietaire.charges, proprietaire.contrats],
    [true, true, true, true, true],
  )
  const autre = droitsDates('manager', 'x', droits)
  assert.deepEqual([autre.cheques, autre.coffre, autre.dettes, autre.charges], [true, false, false, true])
  const rh = droitsDates('rh', 'r', droits)
  assert.deepEqual([rh.cheques, rh.coffre, rh.dettes, rh.charges, rh.contrats, rh.conges], [false, false, false, true, true, true])
  assert.equal(rh.categories.includes('dette'), false)
})

test('droits : un gérant n\'a jamais de Trésorerie, même avec une ligne de droits', () => {
  const g = droitsDates('gerant', 'g', [{ user_id: 'g', niveau: 'proprietaire' }])
  assert.deepEqual([g.cheques, g.coffre, g.dettes, g.charges, g.contrats], [false, false, false, false, false])
  assert.deepEqual(g.categories, [])
  assert.deepEqual([g.conges, g.taches], [true, true])
})

test('chèque émis : date d\'encaissement, retard si dépassée ; encaissé ou annulé absents', () => {
  const l = lignes({
    cheques: [
      { id: 'c1', numero: '12', banque: 'BACI', ordre: 'SODECI', montant: 300000, statut: 'emis', date_encaissement: '2026-11-10' },
      { id: 'c2', numero: '13', banque: 'SIB', ordre: 'X', montant: 100, statut: 'emis', date_encaissement: '2026-11-01' },
      { id: 'c3', numero: '14', banque: 'SIB', ordre: 'X', montant: 100, statut: 'encaisse', date_encaissement: '2026-11-10' },
      { id: 'c4', numero: '15', banque: 'SIB', ordre: 'X', montant: 100, statut: 'annule', date_encaissement: '2026-11-10' },
    ],
  })
  assert.equal(l.length, 2)
  const c1 = l.find(x => x.cle === 'cheque-c1')
  assert.deepEqual([c1.famille, c1.sousType, c1.date, c1.retard, c1.montant, c1.route], ['tresorerie', 'cheque', '2026-11-10', false, 300000, '/tresorerie-cheques'])
  assert.match(c1.titre, /12/)
  assert.match(c1.detail, /SODECI/)
  assert.equal(l.find(x => x.cle === 'cheque-c2').retard, true)
})

test('sans le droit banque : aucun chèque', () => {
  const rh = droitsDates('rh', 'r', [])
  const l = lignes({ cheques: [{ id: 'c1', numero: '1', banque: 'B', montant: 1, statut: 'emis', date_encaissement: '2026-11-10' }] }, { droits: rh })
  assert.equal(l.length, 0)
})

test('échéance : montant restant, soldée absente, catégorie administrative absente', () => {
  const l = lignes({
    dus: [du(), du({ id: 'd2' }), du({ id: 'd3', categorie: 'tee' }), du({ id: 'd4', echeance: null })],
    paiements: [{ du_id: 'd1', montant: 200000 }, { du_id: 'd2', montant: 500000 }],
  })
  assert.deepEqual(l.map(x => [x.cle, x.montant]), [['du-d1', 300000]])
  assert.equal(l[0].route, '/tresorerie-a-payer')
  assert.match(l[0].detail, /Samer Maroc/)
})

test('échéances en retard : une seule ligne, réservée au droit de voir les dettes', () => {
  const d = { dus: [du({ id: 'a', echeance: '2026-10-01' }), du({ id: 'b', echeance: '2026-09-01', montant_du: 100 })] }
  const [l] = lignes(d)
  assert.equal(lignes(d).length, 1)
  assert.deepEqual([l.titre, l.montant, l.retard, l.date, l.route], ['2 échéances en retard', 500100, true, '2026-09-01', '/tresorerie-a-payer'])
  assert.equal(lignes({ dus: [du({ echeance: '2026-10-01' })] })[0].titre, '1 échéance en retard')
  const autre = droitsDates('manager', 'x', [{ user_id: 'p', niveau: 'proprietaire' }])
  assert.equal(lignes(d, { droits: autre }).length, 0)
})

test('prévision : non réalisée, sans chèque émis lié, ligne visible', () => {
  const l = lignes({
    dus: [du()],
    previsions: [
      { id: 'p1', du_id: 'd1', montant: 100000, date_prevue: '2026-11-12' },
      { id: 'p2', du_id: 'd1', montant: 100000, date_prevue: '2026-11-13' },
      { id: 'p3', du_id: 'd1', montant: 100000, date_prevue: null, partenaire: 'glovo' },
      { id: 'p4', du_id: 'inconnu', montant: 100000, date_prevue: '2026-11-14' },
      { id: 'p5', du_id: 'd1', montant: 100000, date_prevue: '2026-11-01' },
    ],
    cheques: [{ id: 'c', numero: '1', banque: 'B', montant: 1, statut: 'emis', date_encaissement: '2026-11-13', prevision_id: 'p2', du_id: 'd1' }],
  })
  const previsions = l.filter(x => x.sousType === 'prevision')
  assert.deepEqual(previsions.map(x => x.cle).sort(), ['prevision-p1', 'prevision-p5'])
  assert.equal(previsions.find(x => x.cle === 'prevision-p5').retard, true)
})

test('coffre : réservé au propriétaire, remboursé absent', () => {
  const d = { emprunts: [{ id: 'e1', montant: 50000, rembourser_le: '2026-11-15' }, { id: 'e2', montant: 1, rembourser_le: '2026-11-15', rembourse_le: '2026-11-02' }] }
  assert.deepEqual(lignes(d).map(x => [x.cle, x.route]), [['coffre-e1', '/tresorerie-coffre']])
  const autre = droitsDates('manager', 'x', [{ user_id: 'p', niveau: 'proprietaire' }])
  assert.equal(lignes(d, { droits: autre }).length, 0)
})

test('charges administratives : une ligne par date, avec le nombre et le total', () => {
  const f = (o = {}) => ({ id: 'f1', nom: 'TEE', type: 'administratif', actif: true, restaurant_id: 'r1', facture_mensuelle: 1000, facture_periodicite: 'mensuel', ...o })
  const l = lignes({ fournisseurs: [f(), f({ id: 'f2', facture_mensuelle: 2000 }), f({ id: 'f3', actif: false }), f({ id: 'f4', type: 'marchandise' }), f({ id: 'f5', facture_mensuelle: 0 })] })
  assert.deepEqual(l.map(x => [x.date, x.titre, x.montant, x.route]), [['2026-12-01', '2 charges administratives', 3000, '/credits-fournisseurs']])
})

test('fin de contrat : signé, non clôturé, à venir', () => {
  const c = (o = {}) => ({ id: 'c1', statut: 'signe', type: 'CDD', date_fin: '2027-01-31', cloture_le: null, restaurant_id: 'r1', travailleurs: { nom: 'KONE AWA' }, ...o })
  const l = lignes({ contrats: [c(), c({ id: 'c2', statut: 'a_signer' }), c({ id: 'c3', cloture_le: '2026-10-01' }), c({ id: 'c4', date_fin: '2026-10-01' }), c({ id: 'c5', date_fin: null })] })
  assert.deepEqual(l.map(x => [x.cle, x.famille, x.route]), [['contrat-c1', 'personnel', '/contrats']])
  assert.match(l[0].titre, /KONE AWA/)
  const g = droitsDates('gerant', 'g', [])
  assert.equal(lignes({ contrats: [c()] }, { droits: g, groupe: false, restaurantId: 'r1' }).length, 0)
})

test('congé : accepté, fin à venir ; déjà commencé, il s\'affiche aujourd\'hui', () => {
  const d = (o = {}) => ({ id: 'a', type: 'Congé annuel', statut: 'validee', travailleur_nom: 'KONE AWA', restaurant_id: 'r1', date_debut: '2026-11-20', date_fin: '2026-11-25', ...o })
  const l = lignes({
    demandes: [d(), d({ id: 'b', date_debut: '2026-11-01', date_fin: '2026-11-09' }), d({ id: 'c', statut: 'declinee' }), d({ id: 'e', date_fin: '2026-11-01', date_debut: '2026-10-01' }), d({ id: 'f', date_debut: null, date_fin: null })],
    permissions: [{ id: 'z', type: 'Permission', travailleur_nom: 'BAMBA', restaurant_id: 'r1', date_debut: '2026-11-08', date_fin: '2026-11-08' }],
  })
  const parCle = Object.fromEntries(l.map(x => [x.cle, x]))
  assert.deepEqual(Object.keys(parCle).sort(), ['conge-a', 'conge-b', 'permission-z'])
  assert.equal(parCle['conge-a'].date, '2026-11-20')
  assert.equal(parCle['conge-a'].detail.startsWith('Du 20/11/2026 au 25/11/2026'), true)
  assert.equal(parCle['conge-b'].date, AUJ)
  assert.equal(parCle['conge-b'].retard, false)
  assert.equal(parCle['conge-a'].route, '/demandes-admin')
  const g = droitsDates('gerant', 'g', [])
  assert.equal(lignes({ demandes: [d()] }, { droits: g, groupe: false, restaurantId: 'r1' })[0].route, '/demandes')
})

test('tâche : ouverte seulement, retard si l\'échéance est passée', () => {
  const t = (o = {}) => ({ id: 't1', titre: 'Réparer la hotte', statut: 'a_faire', echeance: '2026-11-10', restaurant_id: 'r1', ...o })
  const l = lignes({ taches: [t(), t({ id: 't2', statut: 'signalee', echeance: '2026-11-01' }), t({ id: 't3', statut: 'faite' }), t({ id: 't4', statut: 'annulee' }), t({ id: 't5', echeance: null })] })
  assert.deepEqual(l.map(x => [x.cle, x.famille, x.retard]).sort(), [['tache-t1', 'taches', false], ['tache-t2', 'taches', true]])
})

test('filtre par restaurant : garde ce restaurant et les lignes sans restaurant', () => {
  const l = lignes({
    taches: [{ id: 'a', titre: 'A', statut: 'a_faire', echeance: '2026-11-10', restaurant_id: 'r1' }, { id: 'b', titre: 'B', statut: 'a_faire', echeance: '2026-11-10', restaurant_id: 'r2' }],
    emprunts: [{ id: 'e', montant: 1, rembourser_le: '2026-11-15' }],
  }, { restaurantId: 'r1' })
  assert.deepEqual(l.map(x => x.cle).sort(), ['coffre-e', 'tache-a'])
})
```

Dans `lib/evenements.test.mjs`, ajouter `fusionnerLignes` à l'import, puis à la fin du fichier :

```js
const ligneDate = (o = {}) => ({ cle: 'x', type: 'date', famille: 'tresorerie', date: '2026-11-10', retard: false, titre: 'X', ...o })

test('fil : section En retard en tête, seulement les lignes en retard', () => {
  const fil = construireFil([ligneDate({ cle: 'a', date: '2026-11-01', retard: true }), ligneDate({ cle: 'b' })], AUJ)
  assert.deepEqual(fil.map(s => s.cle), ['retard', 'semaine'])
  assert.deepEqual(fil[0].lignes.map(l => l.cle), ['a'])
  assert.equal(fil[0].titre, 'En retard')
})

test('fil : les filtres Trésorerie, Personnel et Tâches suivent la famille', () => {
  const l = [ligneDate({ cle: 'a' }), ligneDate({ cle: 'b', famille: 'personnel' }), ligneDate({ cle: 'c', famille: 'taches' })]
  assert.deepEqual(construireFil(l, AUJ, 'personnel').flatMap(s => s.lignes.map(x => x.cle)), ['b'])
  assert.deepEqual(construireFil(l, AUJ, 'anniversaire'), [])
})

test('fil : Plus tard pour Trésorerie, Personnel et Tâches, jamais sous Tout', () => {
  const l = [ligneDate({ cle: 'a', date: '2027-03-01', famille: 'personnel' })]
  assert.deepEqual(construireFil(l, AUJ, 'personnel', { plusTard: true }).map(s => s.cle), ['plusTard'])
  assert.deepEqual(construireFil(l, AUJ, 'tout', { plusTard: true }), [])
  assert.deepEqual(construireFil(l, AUJ, 'personnel'), [])
})

test('fusionnerLignes : triées par date puis par nom', () => {
  const a = [{ cle: 'evt', type: 'calendrier', date: '2026-11-12', evenement: { titre: 'Noël' } }]
  const b = [ligneDate({ cle: 'b', date: '2026-11-10', titre: 'Z' }), ligneDate({ cle: 'c', date: '2026-11-10', titre: 'A' })]
  assert.deepEqual(fusionnerLignes(a, b).map(l => l.cle), ['c', 'b', 'evt'])
})
```

- [ ] **Step 2 : vérifier l'échec**

Run : `node lib/calendrierDates.test.mjs; node lib/evenements.test.mjs`
Expected : échec `Cannot find module` pour le premier ; export `fusionnerLignes` absent pour le second.

- [ ] **Step 3 : adapter `lib/evenements.js`**

Remplacer `nomLigne`, la fin de `construireLignes` et `construireFil` pour obtenir :

```js
const nomLigne = l => l.travailleur?.nom || l.evenement?.titre || l.titre || ''
const comparerLignes = (a, b) => a.date.localeCompare(b.date) || nomLigne(a).localeCompare(nomLigne(b), 'fr') || a.type.localeCompare(b.type)

export function construireLignes({ travailleurs, evenements, aujourdhui }) {
  const lignes = [
    ...travailleurs.filter(estActif).flatMap(t => lignesTravailleur(t, aujourdhui)),
    ...evenements.map(e => ligneCalendrier(e, aujourdhui)).filter(Boolean),
  ]
  return lignes.sort(comparerLignes)
}

export const fusionnerLignes = (a, b) => [...a, ...b].sort(comparerLignes)

export const SECTION_RETARD = { cle: 'retard', titre: 'En retard' }
export const SECTION_PLUS_TARD = { cle: 'plusTard', titre: 'Plus tard' }
const FILTRES_AVEC_PLUS_TARD = ['calendrier', 'tresorerie', 'personnel', 'taches']

/** plusTard (direction et RH) : sous ces filtres, ajoute ce qui est au-delà du mois suivant. */
export function construireFil(lignes, aujourdhui, filtre = 'tout', { plusTard = false } = {}) {
  const gardees = filtre === 'tout' ? lignes : lignes.filter(l => l.type === filtre || l.famille === filtre)
  const sections = [
    { ...SECTION_RETARD, lignes: gardees.filter(l => l.retard) },
    ...SECTIONS.map(s => ({ ...s, lignes: gardees.filter(l => !l.retard && sectionDe(l.date, aujourdhui) === s.cle) })),
  ]
  if (plusTard && FILTRES_AVEC_PLUS_TARD.includes(filtre)) {
    const limite = finDuMoisSuivant(aujourdhui)
    sections.push({ ...SECTION_PLUS_TARD, lignes: gardees.filter(l => !l.retard && l.date > limite) })
  }
  return sections.filter(s => s.lignes.length > 0)
}
```

- [ ] **Step 4 : écrire `lib/calendrierDates.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Calendrier : les dates saisies ailleurs dans l'application (chèques, échéances,
// prévisions, coffre, charges administratives, contrats, congés, tâches).
// Lues à l'affichage, jamais copiées. Logique pure.
// Conception : docs/superpowers/specs/2026-11-07-calendrier-dates-design.md
// Tests : lib/calendrierDates.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { lignesDuCheque, libelleCheque } from './cheques.js'
import { contratsSignes } from './contrats.js'
import { voitToutLeGroupe } from './evenements.js'
import { estAdministratif, prochaineEcheance } from './fournisseursAdmin.js'
import { etatPrevision } from './previsions.js'
import { tacheOuverte } from './supervision.js'
import { LIBELLES_CATEGORIE, categoriesVisibles, formatDateFR, niveauTresorerie, paiementsParDu, peut, resteDu } from './tresorerie.js'

export const SANS_TRESORERIE = { cheques: false, coffre: false, charges: false, categories: [], dettes: false }

/** Un gérant n'a jamais de Trésorerie ici, même s'il a une ligne de droits. */
export function droitsDates(role, userId, droits = []) {
  const groupe = voitToutLeGroupe(role)
  const niveau = groupe ? niveauTresorerie(role, userId, droits) : null
  return {
    cheques: peut(niveau, 'voir_banque'),
    coffre: peut(niveau, 'voir_coffre'),
    charges: peut(niveau, 'voir_a_payer'),
    categories: groupe ? categoriesVisibles(niveau) : [],
    dettes: peut(niveau, 'voir_dettes'),
    contrats: groupe,
    conges: groupe || role === 'gerant',
    taches: groupe || role === 'gerant',
  }
}

const n = v => Number(v) || 0
const pluriel = (k, mot, motPluriel = `${mot}s`) => `${k} ${k > 1 ? motPluriel : mot}`

export function lignesDates(d, { aujourdhui, droits, restaurantId, groupe }) {
  const nomResto = id => d.restaurants.find(r => r.id === id)?.nom || null
  const ligne = (cle, famille, sousType, date, titre, detail, route, restaurant_id = null, montant = null) => ({
    cle, type: 'date', famille, sousType, date, retard: date < aujourdhui, titre, detail, montant, route, restaurant_id,
  })
  const dansLeResto = id => !restaurantId || !id || id === restaurantId
  const sortie = []

  if (droits.cheques) {
    for (const c of d.cheques) {
      if (c.statut !== 'emis' || !c.date_encaissement) continue
      sortie.push(ligne(`cheque-${c.id}`, 'tresorerie', 'cheque', c.date_encaissement, libelleCheque(c),
        c.ordre ? `À l'ordre de ${c.ordre}` : 'Chèque à encaisser', '/tresorerie-cheques', null, n(c.montant)))
    }
  }

  const parDu = paiementsParDu(d.paiements)
  const dusVisibles = d.dus.filter(x => droits.categories.includes(x.categorie) && dansLeResto(x.restaurant_id))
  const enRetard = []
  for (const du of dusVisibles) {
    const reste = resteDu(du, parDu[du.id] || [])
    if (!du.echeance || reste <= 0) continue
    if (du.echeance < aujourdhui) { enRetard.push({ du, reste }); continue }
    sortie.push(ligne(`du-${du.id}`, 'tresorerie', 'echeance', du.echeance,
      du.libelle || du.creancier || LIBELLES_CATEGORIE[du.categorie] || 'Échéance',
      nomResto(du.restaurant_id) || 'Groupe', '/tresorerie-a-payer', du.restaurant_id, reste))
  }
  if (droits.dettes && enRetard.length) {
    const plusAncienne = enRetard.map(x => x.du.echeance).sort()[0]
    sortie.push(ligne('echeances-retard', 'tresorerie', 'echeances_retard', plusAncienne,
      `${pluriel(enRetard.length, 'échéance')} en retard`, 'À régler dans À payer', '/tresorerie-a-payer', null,
      enRetard.reduce((s, x) => s + x.reste, 0)))
  }

  if (droits.categories.length) {
    const deCheque = new Set(d.cheques.filter(c => c.statut === 'emis').flatMap(c => lignesDuCheque(c).map(l => l.prevision_id)).filter(Boolean))
    for (const p of d.previsions) {
      if (!p.date_prevue || deCheque.has(p.id)) continue
      const du = dusVisibles.find(x => x.id === p.du_id)
      if (!du) continue
      const etat = etatPrevision(p, { du, paiementsDu: parDu[du.id] || [], receptions: [], aujourdhui })
      if (etat.statut === 'realisee') continue
      sortie.push(ligne(`prevision-${p.id}`, 'tresorerie', 'prevision', p.date_prevue,
        `Paiement prévu : ${du.libelle || du.creancier || LIBELLES_CATEGORIE[du.categorie] || 'échéance'}`,
        nomResto(du.restaurant_id) || 'Groupe', '/tresorerie-a-payer', du.restaurant_id, etat.aPayer))
    }
  }

  if (droits.coffre) {
    for (const e of d.emprunts) {
      if (e.rembourse_le || !e.rembourser_le) continue
      sortie.push(ligne(`coffre-${e.id}`, 'tresorerie', 'coffre', e.rembourser_le, 'Remboursement du coffre',
        e.note || 'Emprunt à rembourser', '/tresorerie-coffre', null, n(e.montant)))
    }
  }

  if (droits.charges) {
    const parDate = {}
    for (const f of d.fournisseurs) {
      if (!estAdministratif(f) || f.actif === false || !dansLeResto(f.restaurant_id)) continue
      const date = prochaineEcheance(f, aujourdhui)
      if (!date) continue
      parDate[date] = parDate[date] || { nb: 0, total: 0 }
      parDate[date].nb += 1
      parDate[date].total += n(f.facture_mensuelle)
    }
    for (const [date, { nb, total }] of Object.entries(parDate)) {
      sortie.push(ligne(`charges-${date}`, 'tresorerie', 'charges', date, pluriel(nb, 'charge administrative', 'charges administratives'),
        'CNPS, ITS, TEE, Timbre, Bail…', '/credits-fournisseurs', null, total))
    }
  }

  if (droits.contrats) {
    for (const c of contratsSignes(d.contrats)) {
      if (c.cloture_le || !c.date_fin || c.date_fin < aujourdhui || !dansLeResto(c.restaurant_id)) continue
      sortie.push(ligne(`contrat-${c.id}`, 'personnel', 'contrat', c.date_fin, `Fin de contrat : ${c.travailleurs?.nom || 'travailleur'}`,
        [c.type, nomResto(c.restaurant_id)].filter(Boolean).join(' · '), '/contrats', c.restaurant_id))
    }
  }

  if (droits.conges) {
    const absences = [
      ...d.demandes.filter(a => a.statut === 'validee').map(a => ({ a, prefixe: 'conge' })),
      ...d.permissions.map(a => ({ a, prefixe: 'permission' })),
    ]
    for (const { a, prefixe } of absences) {
      if (!a.date_debut || !a.date_fin || a.date_fin < aujourdhui || !dansLeResto(a.restaurant_id)) continue
      const date = a.date_debut > aujourdhui ? a.date_debut : aujourdhui
      const periode = `Du ${formatDateFR(a.date_debut)} au ${formatDateFR(a.date_fin)}`
      sortie.push(ligne(`${prefixe}-${a.id}`, 'personnel', 'conge', date, `${a.type || 'Absence'} : ${a.travailleur_nom || 'travailleur'}`,
        [periode, nomResto(a.restaurant_id)].filter(Boolean).join(' · '), groupe ? '/demandes-admin' : '/demandes', a.restaurant_id))
    }
  }

  if (droits.taches) {
    for (const t of d.taches) {
      if (!tacheOuverte(t) || !t.echeance || !dansLeResto(t.restaurant_id)) continue
      sortie.push(ligne(`tache-${t.id}`, 'taches', 'tache', t.echeance, t.titre,
        [nomResto(t.restaurant_id), t.responsable_nom].filter(Boolean).join(' · '), '/supervision', t.restaurant_id))
    }
  }

  return sortie
}
```

- [ ] **Step 5 : vérifier**

Run : `node lib/calendrierDates.test.mjs; node lib/evenements.test.mjs; for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ECHEC $f"; done`
Expected : tous les tests passent, aucun `ECHEC`. Si un module importé (`contrats.js`, `fournisseursAdmin.js`, `previsions.js`, `cheques.js`) charge quelque chose d'incompatible avec `node`, s'arrêter et le signaler.

- [ ] **Step 6 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add lib/calendrierDates.js lib/calendrierDates.test.mjs lib/evenements.js lib/evenements.test.mjs
git commit -m "feat(evenements): dates de Trésorerie, contrats, congés et tâches dans le fil

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 2 : chargement et affichage

**Files :**
- Create : `components/evenements/LigneDate.js`
- Modify : `lib/evenementsDb.js`, `app/evenements.js`

**Interfaces :**
- Consumes : `droitsDates`, `SANS_TRESORERIE`, `lignesDates` de `lib/calendrierDates.js` ; `fusionnerLignes` de `lib/evenements.js` ; `attacherLignes` de `lib/cheques.js`.
- Produces : `chargerDatesCalendrier({ role, userId, restaurantId }) → Promise<{ donnees, droits, manque }>` ; ne lève jamais d'erreur.

- [ ] **Step 1 : ajouter le chargement**

Dans `lib/evenementsDb.js`, ajouter en tête :

```js
import { SANS_TRESORERIE, droitsDates } from './calendrierDates'
import { attacherLignes } from './cheques'
```

Puis à la fin du fichier :

```js
const DONNEES_VIDES = {
  restaurants: [], cheques: [], dus: [], paiements: [], previsions: [], emprunts: [],
  fournisseurs: [], contrats: [], demandes: [], permissions: [], taches: [],
}

async function toutesLesPages(construire) {
  let tout = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await construire().range(de, de + 999)
    if (error) throw error
    tout = tout.concat(data || [])
    if (!data || data.length < 1000) return tout
  }
}

/**
 * Dates du calendrier selon les droits : ce qu'un compte ne peut pas voir n'est
 * pas lu. Chaque source peut échouer seule : le reste s'affiche, `manque` le signale.
 */
export async function chargerDatesCalendrier({ role, userId, restaurantId }) {
  const groupe = ['manager', 'directeur', 'rh'].includes(role)
  if (!groupe && !restaurantId) return { donnees: DONNEES_VIDES, droits: droitsDates(role, userId, []), manque: false }

  let manque = false
  let droits
  if (groupe) {
    const r = await supabase.from('tresorerie_droits').select('user_id, niveau')
    droits = droitsDates(role, userId, r.data || [])
    if (r.error) { manque = true; droits = { ...droits, ...SANS_TRESORERIE } }
  } else {
    droits = droitsDates(role, userId, [])
  }

  const aujourdhui = aujourdhuiISO()
  const lire = async construire => {
    const { data, error } = await construire()
    if (error) throw error
    return data || []
  }
  const parResto = q => (groupe ? q : q.eq('restaurant_id', restaurantId))
  const sources = {
    restaurants: () => lire(() => supabase.from('restaurants').select('id, nom')),
    cheques: droits.cheques ? () => lire(() => supabase.from('tresorerie_cheques').select('*').eq('statut', 'emis')) : null,
    lignesCheques: droits.cheques ? () => lire(() => supabase.from('tresorerie_cheques_lignes').select('*')) : null,
    dus: droits.categories.length ? () => toutesLesPages(() => supabase.from('tresorerie_dus').select('*').order('id')) : null,
    paiements: droits.categories.length ? () => toutesLesPages(() => supabase.from('tresorerie_paiements').select('id, du_id, montant, prevision_id, date').order('id')) : null,
    previsions: droits.categories.length ? () => lire(() => supabase.from('tresorerie_previsions').select('*')) : null,
    emprunts: droits.coffre ? () => lire(() => supabase.from('tresorerie_coffre_emprunts').select('*').is('rembourse_le', null)) : null,
    fournisseurs: droits.charges ? () => lire(() => supabase.from('fournisseurs').select('id, nom, type, actif, restaurant_id, facture_mensuelle, facture_periodicite, facture_mensuelle_depuis').eq('type', 'administratif')) : null,
    contrats: droits.contrats ? () => lire(() => supabase.from('contrats_travailleurs').select('id, statut, type, date_fin, cloture_le, restaurant_id, travailleurs(nom)').is('cloture_le', null).gte('date_fin', aujourdhui)) : null,
    demandes: droits.conges ? () => lire(() => parResto(supabase.from('demandes').select('id, type, statut, travailleur_nom, restaurant_id, date_debut, date_fin').eq('statut', 'validee').gte('date_fin', aujourdhui))) : null,
    permissions: droits.conges ? () => lire(() => parResto(supabase.from('permissions_conges').select('id, type, travailleur_nom, restaurant_id, date_debut, date_fin').gte('date_fin', aujourdhui))) : null,
    taches: droits.taches ? () => lire(() => parResto(supabase.from('supervision_taches').select('id, titre, statut, echeance, restaurant_id, responsable_nom').in('statut', ['a_faire', 'signalee']).not('echeance', 'is', null))) : null,
  }

  const cles = Object.keys(sources).filter(k => sources[k])
  const resultats = await Promise.allSettled(cles.map(k => sources[k]()))
  const valeurs = {}
  const echecs = new Set()
  cles.forEach((k, i) => {
    if (resultats[i].status === 'fulfilled') valeurs[k] = resultats[i].value
    else { valeurs[k] = []; echecs.add(k); manque = true }
  })

  // Sans les paiements, tout paraîtrait impayé : échéances et prévisions sont retirées.
  const paiementsManquants = echecs.has('paiements')
  // Sans leurs lignes, une prévision portée par un chèque paraîtrait à part : les prévisions sont retirées.
  const lignesManquantes = echecs.has('lignesCheques')
  return {
    droits,
    manque,
    donnees: {
      ...DONNEES_VIDES,
      ...valeurs,
      cheques: attacherLignes(valeurs.cheques || [], valeurs.lignesCheques || []),
      dus: paiementsManquants ? [] : (valeurs.dus || []),
      previsions: paiementsManquants || lignesManquantes ? [] : (valeurs.previsions || []),
    },
  }
}
```

Ajouter aussi, avec les autres imports :

```js
import { aujourdhuiISO } from './contrats'
```

Si `tresorerie_cheques_lignes` n'a pas de colonne attendue par `attacherLignes`, lire `lib/cheques.js:49` pour vérifier le nom du champ de liaison.

- [ ] **Step 2 : écrire la ligne**

Créer `components/evenements/LigneDate.js` :

```js
// Une date venue d'un autre écran : toucher la ligne ouvre cet écran.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router } from 'expo-router'
import { Text, TouchableOpacity, View } from 'react-native'

import { libelleJour } from '../../lib/evenements'
import { fmt } from '../../lib/tresorerie'

const ICONES = {
  cheque: '🧾', echeance: '🏠', echeances_retard: '⚠️', prevision: '🗓️', coffre: '🔐',
  charges: '🏛️', contrat: '📝', conge: '🌴', tache: '🧭',
}

export default function LigneDate({ ligne, aujourdhui, styles, colors }) {
  return (
    <TouchableOpacity style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} activeOpacity={0.8}
      accessibilityRole="button" accessibilityLabel={`${ligne.titre}. Ouvrir.`} onPress={() => router.push(ligne.route)}>
      <Text style={{ fontSize: 20 }}>{ICONES[ligne.sousType] || '📅'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }} numberOfLines={2}>{ligne.titre}</Text>
        {ligne.detail ? <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }} numberOfLines={2}>{ligne.detail}</Text> : null}
        <Text style={{ fontSize: 13, fontWeight: '700', color: ligne.retard ? colors.error : colors.textMuted, marginTop: 2 }}>
          {libelleJour(ligne.date, aujourdhui)}{ligne.montant !== null ? ` · ${fmt(ligne.montant)} F` : ''}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  )
}
```

- [ ] **Step 3 : brancher sur l'écran**

Dans `app/evenements.js` :

Remplacer l'import d'`expo-router` par :

```js
import { router, useFocusEffect } from 'expo-router'
```

Ajouter les imports :

```js
import LigneDate from '../components/evenements/LigneDate'
import { lignesDates } from '../lib/calendrierDates'
```

Ajouter `fusionnerLignes` à l'import de `../lib/evenements` et `chargerDatesCalendrier` à celui de `../lib/evenementsDb`.

Remplacer la constante `FILTRES` par :

```js
const FILTRES = [
  { cle: 'tout', label: 'Tout' },
  { cle: 'anniversaire', label: '🎂 Anniversaires' },
  { cle: 'anciennete', label: '🏅 Ancienneté' },
  { cle: 'calendrier', label: '📅 Calendrier' },
  { cle: 'tresorerie', label: '🏦 Trésorerie', visible: d => d?.cheques || d?.charges },
  { cle: 'personnel', label: '👥 Personnel', visible: d => d?.contrats || d?.conges },
  { cle: 'taches', label: '🧭 Tâches', visible: d => d?.taches },
]
```

Ajouter l'état après `joursFeries` :

```js
  const [dates, setDates] = useState({ donnees: null, droits: null, manque: false })
```

Après `useEffect(() => { charger() }, [charger])`, ajouter :

```js
  // Rechargé à chaque retour sur l'écran : un chèque encaissé disparaît du fil.
  useFocusEffect(useCallback(() => {
    if (!autorise) return undefined
    let vivant = true
    chargerDatesCalendrier({ role: roleActif, userId, restaurantId })
      .then(r => { if (vivant) setDates(r) })
      .catch(() => { if (vivant) setDates(d => ({ ...d, manque: true })) })
    return () => { vivant = false }
  }, [autorise, roleActif, userId, restaurantId]))
```

Remplacer le `useMemo` de `lignes` par :

```js
  const lignes = useMemo(() => {
    const base = construireLignes({ ...visibles, aujourdhui })
    if (!dates.donnees) return base
    const autres = lignesDates(dates.donnees, { aujourdhui, droits: dates.droits, restaurantId: groupe ? restoFiltre : restaurantId, groupe })
    return fusionnerLignes(base, autres)
  }, [visibles, aujourdhui, dates, groupe, restoFiltre, restaurantId])
  const filtres = useMemo(() => FILTRES.filter(f => !f.visible || f.visible(dates.droits)), [dates.droits])
```

Dans le rendu, passer `elements={filtres}` au lieu de `elements={FILTRES}` sur les puces de filtre.

Juste après le texte « fiches sans date de naissance », dans le même `View`, ajouter :

```jsx
            {dates.manque ? (
              <Text style={{ fontSize: 13, color: colors.textMuted }}>Certaines dates n'ont pas pu être chargées.</Text>
            ) : null}
```

Remplacer le rendu de chaque ligne du fil par :

```jsx
              {section.lignes.map(ligne => (ligne.type === 'date' ? (
                <LigneDate key={ligne.cle} ligne={ligne} aujourdhui={aujourdhui} styles={styles} colors={colors} />
              ) : (
                <LigneEvenement key={ligne.cle} ligne={ligne} aujourdhui={aujourdhui} voitAge={groupe} peutGerer={groupe}
                  styles={styles} colors={colors} accent={accent}
                  onMessage={setLigneMessage}
                  onModifier={evenement => setFormulaire({ visible: true, evenement })} />
              )))}
```

`FeuilleJoursFeries` reçoit toujours `donnees.evenements`, pas ces lignes. Le rappel de l'accueil n'utilise pas `lignesDates` : il reste inchangé.

- [ ] **Step 4 : tout vérifier**

Run : `for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ECHEC $f"; done; npm run lint 2>&1 | tail -4; npx expo export -p web 2>&1 | tail -3; grep -l "chez nous" dist/_expo/static/js/web/*.js | head -2; grep -l "pas pu" dist/_expo/static/js/web/*.js | head -2`
Expected : aucun `ECHEC`, `0 errors`, export réussi, fichiers trouvés.

- [ ] **Step 5 : mettre le graphe à jour puis committer**

```bash
graphify update .
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add components/evenements/LigneDate.js lib/evenementsDb.js app/evenements.js
git commit -m "feat(evenements): chèques, échéances, contrats, congés et tâches dans le calendrier

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
```

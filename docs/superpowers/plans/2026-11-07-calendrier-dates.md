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

---

### Task 3 : accès réglables, logique pure

**Files :**
- Create : `lib/accesCalendrier.js`, `lib/accesCalendrier.test.mjs`
- Modify : `lib/calendrierDates.js`, `lib/calendrierDates.test.mjs`

**Interfaces :**
- Produces (depuis `lib/accesCalendrier.js`) : `TYPES_CALENDRIER`, `ROLES_CALENDRIER`, `INTERDITS_GERANT`, `ACCES_CALENDRIER_DEFAUT`, `typesAutorises(role, { proprietaire, config }) → string[]`, `estVerrouille(role, cle) → boolean`, `basculerType(types, cle) → string[]`.
- Produces (depuis `lib/calendrierDates.js`) : `droitsDates(role, userId, droits, config = {})` renvoie aussi `proprietaire`, `echeances`, `previsions`, `anniversaires`, `age`, `anciennete`, `evenements` ; `filtrerParDroits(lignes, droits) → lignes`.

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `lib/accesCalendrier.test.mjs` :

```js
// Tests de lib/accesCalendrier.js — qui voit quoi dans le calendrier.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ACCES_CALENDRIER_DEFAUT, TYPES_CALENDRIER, basculerType, estVerrouille, typesAutorises } from './accesCalendrier.js'

const TOUS = TYPES_CALENDRIER.map(t => t.cle)

test('par défaut : le RH sans chèques, coffre ni dettes ; le gérant sans Trésorerie ni contrats', () => {
  const rh = typesAutorises('rh')
  for (const k of ['cheques', 'coffre', 'echeances_retard']) assert.equal(rh.includes(k), false, k)
  for (const k of ['echeances', 'previsions', 'charges', 'contrats', 'conges', 'taches']) assert.equal(rh.includes(k), true, k)
  const g = typesAutorises('gerant')
  for (const k of ['cheques', 'coffre', 'echeances_retard', 'echeances', 'previsions', 'charges', 'contrats', 'age']) assert.equal(g.includes(k), false, k)
  for (const k of ['anniversaires', 'anciennete', 'evenements', 'conges', 'taches']) assert.equal(g.includes(k), true, k)
})

test('le réglage remplace le défaut du rôle, les types inconnus sont ignorés', () => {
  assert.deepEqual(typesAutorises('rh', { config: { rh: ['cheques', 'inconnu'] } }), ['cheques'])
  assert.deepEqual(typesAutorises('rh', { config: { rh: [] } }), [])
  assert.deepEqual(typesAutorises('rh', { config: { gerant: [] } }), ACCES_CALENDRIER_DEFAUT.rh)
})

test('garde-fou : jamais de chèques, coffre ni dettes pour le gérant, même cochés', () => {
  const g = typesAutorises('gerant', { config: { gerant: ['cheques', 'coffre', 'echeances_retard', 'echeances'] } })
  assert.deepEqual(g, ['echeances'])
  for (const k of ['cheques', 'coffre', 'echeances_retard']) assert.equal(estVerrouille('gerant', k), true, k)
  assert.equal(estVerrouille('gerant', 'echeances'), false)
  assert.equal(estVerrouille('rh', 'cheques'), false)
})

test('le propriétaire voit toujours tout, quels que soient les réglages', () => {
  assert.deepEqual(typesAutorises('manager', { proprietaire: true, config: { manager: [] } }), TOUS)
})

test('un rôle hors liste ne voit rien', () => {
  assert.deepEqual(typesAutorises('caissier'), [])
  assert.deepEqual(typesAutorises('caissier', { config: { caissier: ['cheques'] } }), [])
})

test('basculerType : ajoute ou retire', () => {
  assert.deepEqual(basculerType(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(basculerType(['a', 'b'], 'a'), ['b'])
})
```

Dans `lib/calendrierDates.test.mjs`, ajouter `filtrerParDroits` à l'import, puis à la fin du fichier :

```js
test('le réglage décide : chèques cochés pour le RH, coffre coupé pour le propriétaire impossible', () => {
  const rh = droitsDates('rh', 'r', [], { rh: ['cheques'] })
  assert.equal(rh.cheques, true)
  assert.equal(rh.echeances, false)
  assert.deepEqual(rh.categories, [])
  const p = droitsDates('manager', 'p', [{ user_id: 'p', niveau: 'proprietaire' }], { manager: [] })
  assert.deepEqual([p.proprietaire, p.coffre, p.cheques, p.dettes], [true, true, true, true])
})

test('échéances et prévisions se règlent séparément', () => {
  const dus = [du()]
  const previsions = [{ id: 'p1', du_id: 'd1', montant: 100, date_prevue: '2026-11-12' }]
  const sansEcheances = droitsDates('rh', 'r', [], { rh: ['previsions'] })
  assert.deepEqual(lignes({ dus, previsions }, { droits: sansEcheances }).map(x => x.sousType), ['prevision'])
  const sansPrevisions = droitsDates('rh', 'r', [], { rh: ['echeances'] })
  assert.deepEqual(lignes({ dus, previsions }, { droits: sansPrevisions }).map(x => x.sousType), ['echeance'])
})

test('garde-fou gérant : seulement son restaurant, même avec tout coché', () => {
  const g = droitsDates('gerant', 'g', [], { gerant: ['echeances', 'charges', 'contrats', 'taches'] })
  const d = {
    dus: [du({ id: 'a' }), du({ id: 'b', restaurant_id: 'r2' }), du({ id: 'c', restaurant_id: null })],
    taches: [{ id: 't', titre: 'T', statut: 'a_faire', echeance: '2026-11-10', restaurant_id: 'r2' }],
    contrats: [{ id: 'k', statut: 'signe', type: 'CDD', date_fin: '2027-01-31', restaurant_id: 'r2' }],
    fournisseurs: [{ id: 'f', type: 'administratif', actif: true, restaurant_id: 'r2', facture_mensuelle: 10 }],
  }
  const l = lignes(d, { droits: g, groupe: false, restaurantId: 'r1' })
  assert.deepEqual(l.map(x => x.cle), ['du-a'])
})

test('filtrerParDroits : les anniversaires, l\'ancienneté et les événements suivent le réglage', () => {
  const l = [{ type: 'anniversaire' }, { type: 'anciennete' }, { type: 'calendrier' }, { type: 'date' }]
  const g = droitsDates('rh', 'r', [], { rh: ['anniversaires'] })
  assert.deepEqual(filtrerParDroits(l, g).map(x => x.type), ['anniversaire', 'date'])
})
```

- [ ] **Step 2 : vérifier l'échec**

Run : `node lib/accesCalendrier.test.mjs; node lib/calendrierDates.test.mjs`
Expected : échec `Cannot find module` pour le premier ; export `filtrerParDroits` absent pour le second.

- [ ] **Step 3 : écrire `lib/accesCalendrier.js`**

```js
// ──────────────────────────────────────────────────────────────────────────────
// Qui voit quoi dans le calendrier. Réglable dans l'écran Accès au calendrier
// (table calendrier_acces), réservé au propriétaire de la Trésorerie.
// Garde-fous NON réglables : le propriétaire voit tout ; le gérant n'a jamais ce
// qui n'est rattaché à aucun restaurant (voir aussi lignesDates pour sa portée).
// Tests : lib/accesCalendrier.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

export const TYPES_CALENDRIER = [
  { cle: 'anniversaires', label: '🎂 Anniversaires', famille: 'Personnel' },
  { cle: 'age', label: "🔢 Âge dans les anniversaires", famille: 'Personnel' },
  { cle: 'anciennete', label: '🏅 Ancienneté', famille: 'Personnel' },
  { cle: 'conges', label: '🌴 Congés et permissions', famille: 'Personnel' },
  { cle: 'contrats', label: '📝 Fins de contrat', famille: 'Personnel' },
  { cle: 'evenements', label: '📅 Événements et jours fériés', famille: 'Calendrier' },
  { cle: 'taches', label: '🧭 Tâches de supervision', famille: 'Calendrier' },
  { cle: 'cheques', label: '🧾 Chèques à encaisser', famille: 'Trésorerie' },
  { cle: 'echeances', label: '🏠 Échéances À payer', famille: 'Trésorerie' },
  { cle: 'previsions', label: '🗓️ Prévisions de paiement', famille: 'Trésorerie' },
  { cle: 'charges', label: '🏛️ Charges administratives', famille: 'Trésorerie' },
  { cle: 'echeances_retard', label: '⚠️ Échéances en retard', famille: 'Trésorerie' },
  { cle: 'coffre', label: '🔐 Remboursements du coffre', famille: 'Trésorerie' },
]

export const ROLES_CALENDRIER = [
  { cle: 'manager', label: 'Manager' },
  { cle: 'directeur', label: 'Directeur' },
  { cle: 'rh', label: 'RH' },
  { cle: 'gerant', label: 'Gérant' },
]

export const INTERDITS_GERANT = ['cheques', 'coffre', 'echeances_retard']

const COMMUN = ['anniversaires', 'anciennete', 'evenements', 'conges', 'taches']
const DIRECTION = [...COMMUN, 'age', 'contrats', 'cheques', 'echeances', 'previsions', 'charges']

export const ACCES_CALENDRIER_DEFAUT = {
  manager: DIRECTION,
  directeur: DIRECTION,
  rh: [...COMMUN, 'age', 'contrats', 'echeances', 'previsions', 'charges'],
  gerant: COMMUN,
}

const CONNUS = TYPES_CALENDRIER.map(t => t.cle)

export const estVerrouille = (role, cle) => role === 'gerant' && INTERDITS_GERANT.includes(cle)

export function typesAutorises(role, { proprietaire = false, config = {} } = {}) {
  if (!ROLES_CALENDRIER.some(r => r.cle === role)) return []
  if (proprietaire) return CONNUS
  const types = Array.isArray(config[role]) ? config[role] : ACCES_CALENDRIER_DEFAUT[role]
  return types.filter(k => CONNUS.includes(k) && !estVerrouille(role, k))
}

export const basculerType = (types, cle) => (types.includes(cle) ? types.filter(k => k !== cle) : [...types, cle])
```

- [ ] **Step 4 : adapter `lib/calendrierDates.js`**

Ajouter l'import `import { typesAutorises } from './accesCalendrier.js'`.

Remplacer `SANS_TRESORERIE` et `droitsDates` par :

```js
export const SANS_TRESORERIE = { cheques: false, coffre: false, charges: false, echeances: false, previsions: false, categories: [], dettes: false }

/** Le réglage décide ; un gérant n'est jamais propriétaire ici, même avec une ligne de droits. */
export function droitsDates(role, userId, droits = [], config = {}) {
  const groupe = voitToutLeGroupe(role)
  const proprietaire = groupe && niveauTresorerie(role, userId, droits) === 'proprietaire'
  const types = typesAutorises(role, { proprietaire, config })
  const a = k => types.includes(k)
  const lireDus = a('echeances') || a('previsions') || a('echeances_retard')
  return {
    proprietaire,
    cheques: a('cheques'),
    coffre: a('coffre'),
    charges: a('charges'),
    echeances: a('echeances'),
    previsions: a('previsions'),
    dettes: a('echeances_retard'),
    categories: lireDus ? categoriesVisibles('proprietaire').filter(c => c !== 'dette' || a('echeances_retard')) : [],
    contrats: a('contrats'),
    conges: a('conges'),
    taches: a('taches'),
    anniversaires: a('anniversaires'),
    age: a('age'),
    anciennete: a('anciennete'),
    evenements: a('evenements'),
  }
}

/** Les lignes qui ne viennent pas de lignesDates suivent aussi le réglage. */
export function filtrerParDroits(lignes, droits) {
  const permis = { anniversaire: droits.anniversaires, anciennete: droits.anciennete, calendrier: droits.evenements }
  return lignes.filter(l => !(l.type in permis) || permis[l.type])
}
```

Retirer `peut` de l'import de `./tresorerie.js` s'il n'est plus utilisé.

Dans `lignesDates` :

Remplacer `const dansLeResto = …` par :

```js
  // Garde-fou : un gérant n'a que son restaurant, jamais ce qui n'en a aucun.
  const dansLeResto = id => (groupe ? (!restaurantId || !id || id === restaurantId) : !!id && id === restaurantId)
```

Dans la boucle des échéances, entourer le `sortie.push(…)` de l'échéance à venir par `if (droits.echeances)` : l'échéance en retard continue d'alimenter `enRetard`.

Remplacer `if (droits.categories.length) {` du bloc des prévisions par `if (droits.previsions) {`.

- [ ] **Step 5 : vérifier**

Run : `node lib/accesCalendrier.test.mjs; node lib/calendrierDates.test.mjs; for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ECHEC $f"; done`
Expected : tous les tests passent, y compris ceux de la Task 1, aucun `ECHEC`.

- [ ] **Step 6 : commit**

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add lib/accesCalendrier.js lib/accesCalendrier.test.mjs lib/calendrierDates.js lib/calendrierDates.test.mjs
git commit -m "feat(evenements): accès au calendrier réglables par rôle, avec garde-fous

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 4 : écran de réglage et application des accès

**Files :**
- Create : `supabase_calendrier_acces.sql`, `app/acces-calendrier.js`
- Modify : `lib/evenementsDb.js`, `lib/journal.js`, `app/evenements.js`, `app/parametres.js`, `app/_layout.tsx`, `components/evenements/RappelEvenements.js`

**Interfaces :**
- Consumes : `droitsDates`, `filtrerParDroits`, `SANS_TRESORERIE` de `lib/calendrierDates.js` ; tout `lib/accesCalendrier.js`.
- Produces (dans `lib/evenementsDb.js`) : `chargerAccesCalendrier() → Promise<config>`, sans erreur levée ; `chargerDroitsCalendrier({ role, userId }) → Promise<{ droits, manque }>` ; `enregistrerAccesCalendrier(role, types, ctx) → Promise<void>`.

- [ ] **Step 1 : écrire la migration**

Créer `supabase_calendrier_acces.sql` :

```sql
-- Qui voit quoi dans le calendrier. Sans ligne pour un rôle, les réglages par
-- défaut de lib/accesCalendrier.js s'appliquent.
-- Conception : docs/superpowers/specs/2026-11-07-calendrier-dates-design.md

create table if not exists public.calendrier_acces (
  role text primary key check (role in ('manager', 'directeur', 'rh', 'gerant')),
  types jsonb not null default '[]'::jsonb,
  modifie_par_nom text,
  updated_at timestamptz not null default now()
);

-- Mêmes règles d'accès que roles_acces.
alter table public.calendrier_acces enable row level security;
drop policy if exists allow_all on public.calendrier_acces;
create policy allow_all on public.calendrier_acces for all to public using (true) with check (true);
grant select, insert, update on public.calendrier_acces to anon, authenticated;

-- Contrôle : 1 table.
select count(*) as table_ok from information_schema.tables where table_schema = 'public' and table_name = 'calendrier_acces';
```

Elle est seulement écrite : ne pas l'exécuter.

- [ ] **Step 2 : ajouter la lecture et l'écriture**

Dans `lib/journal.js`, ajouter `CALENDRIER_ACCES_MODIFIE: 'calendrier_acces_modifie',` à `ACTIONS`, et dans `ACTION_LABELS` : `calendrier_acces_modifie: { icon: '🔐', label: 'Accès au calendrier modifié' },`.

Dans `lib/evenementsDb.js`, remplacer l'import de `./calendrierDates` par `import { SANS_TRESORERIE, droitsDates, filtrerParDroits } from './calendrierDates'` si `filtrerParDroits` y est utilisé, sinon sans lui, puis ajouter :

```js
/** Réglages par rôle ; sans table ou sans ligne, les réglages par défaut s'appliquent. */
export async function chargerAccesCalendrier() {
  const { data, error } = await supabase.from('calendrier_acces').select('role, types')
  if (error) return {}
  return Object.fromEntries((data || []).filter(l => Array.isArray(l.types)).map(l => [l.role, l.types]))
}

export async function chargerDroitsCalendrier({ role, userId }) {
  const config = await chargerAccesCalendrier()
  if (!['manager', 'directeur', 'rh'].includes(role)) return { droits: droitsDates(role, userId, [], config), manque: false }
  const r = await supabase.from('tresorerie_droits').select('user_id, niveau')
  const droits = droitsDates(role, userId, r.data || [], config)
  // Droits illisibles : personne n'est considéré propriétaire et rien de la Trésorerie n'est lu.
  return r.error ? { droits: { ...droits, ...SANS_TRESORERIE, proprietaire: false }, manque: true } : { droits, manque: false }
}

export async function enregistrerAccesCalendrier(role, types, ctx) {
  const { error } = await supabase.from('calendrier_acces')
    .upsert({ role, types, modifie_par_nom: ctx.userNom || null, updated_at: new Date().toISOString() }, { onConflict: 'role' })
  if (error) throw error
  journaliser(ACTIONS.CALENDRIER_ACCES_MODIFIE, { role, types }, { userId: ctx.userId, userNom: ctx.userNom }).catch(() => {})
}
```

Dans `chargerDatesCalendrier` :

Remplacer le bloc qui lit `tresorerie_droits` (de `let manque = false` jusqu'à la fin du `else`) par :

```js
  const lus = await chargerDroitsCalendrier({ role, userId })
  const droits = lus.droits
  let manque = lus.manque
```

et le premier `return` (compte sans restaurant) par `return { donnees: DONNEES_VIDES, droits: (await chargerDroitsCalendrier({ role, userId })).droits, manque: false }`.

Garde-fou de lecture pour le gérant : dans `sources`,
- `dus` : `toutesLesPages(() => parResto(supabase.from('tresorerie_dus').select('*')).order('id'))` ;
- `paiements` : pour un gérant, sélectionner `'id, du_id, montant, prevision_id, date, tresorerie_dus!inner(restaurant_id)'` et filtrer `.eq('tresorerie_dus.restaurant_id', restaurantId)` ; pour le groupe, garder la lecture actuelle ;
- `previsions` : pour un gérant, sélectionner `'*, tresorerie_dus!inner(restaurant_id)'` et filtrer `.eq('tresorerie_dus.restaurant_id', restaurantId)` ; pour le groupe, garder la lecture actuelle ;
- `fournisseurs` et `contrats` : passer la requête dans `parResto(…)`.

- [ ] **Step 3 : appliquer les accès sur l'écran Événements**

Dans `app/evenements.js` :

Ajouter `filtrerParDroits` à l'import de `../lib/calendrierDates`.

Dans `FILTRES`, donner à `anniversaire`, `anciennete` et `calendrier` : `visible: d => d?.anniversaires`, `visible: d => d?.anciennete`, `visible: d => d?.evenements`.

Dans le `.catch` du `useFocusEffect`, ne rien changer à la logique, mais `chargerDatesCalendrier` ayant déjà échoué, utiliser :

```js
      .catch(() => { if (vivant) setDates(d => ({ ...d, manque: true, droits: d.droits || droitsDates('gerant', userId, []) })) })
```

et ajouter `droitsDates` à l'import. Tant qu'on ne connaît pas les droits, l'écran ne montre rien : `loading` à l'affichage devient `loading || !dates.droits`.

Remplacer le corps du `useMemo` de `lignes` par :

```js
    if (!dates.donnees || !dates.droits) return []
    const base = filtrerParDroits(construireLignes({ ...visibles, aujourdhui }), dates.droits)
    const autres = lignesDates(dates.donnees, { aujourdhui, droits: dates.droits, restaurantId: groupe ? restoFiltre : restaurantId, groupe })
    return fusionnerLignes(base, autres)
```

Remplacer `voitAge={groupe}` par `voitAge={!!dates.droits?.age}`.

Le bouton « Ajouter un événement » et le bouton « Jours fériés ivoiriens » ne s'affichent que si `dates.droits?.evenements`. Le compteur « fiches sans date de naissance » ne s'affiche que si `dates.droits?.anniversaires`.

Pour le propriétaire seulement, ajouter sous ces boutons :

```jsx
            {dates.droits?.proprietaire ? (
              <Bouton label="🔐 Accès au calendrier : qui voit quoi" couleur={principale} styles={styles} onPress={() => router.push('/acces-calendrier')} />
            ) : null}
```

- [ ] **Step 4 : appliquer les accès au rappel de l'accueil**

Dans `components/evenements/RappelEvenements.js`, ajouter `import { filtrerParDroits } from '../../lib/calendrierDates'`, ajouter `chargerDroitsCalendrier` à l'import de `../../lib/evenementsDb`, ajouter `userId` aux props et aux dépendances. Remplacer le chargement par :

```js
    Promise.all([
      chargerDonneesEvenements({ groupe: voitToutLeGroupe(role), restaurantId }),
      chargerDroitsCalendrier({ role, userId }),
    ])
      .then(([d, { droits }]) => {
        if (!vivant) return
        const lignes = filtrerParDroits(construireLignes({ ...d, aujourdhui }), droits)
        setTexte(texteRappel(compterAujourdhui(lignes, aujourdhui)))
      })
      .catch(() => { if (vivant) setTexte(null) })
```

Dans `components/accueil/AccueilManager.js`, passer `userId={userId}` à `<RappelEvenements … />`.

- [ ] **Step 5 : écrire l'écran de réglage**

Créer `app/acces-calendrier.js` :

```js
// ──────────────────────────────────────────────────────────────────────────────
// Accès au calendrier : qui voit quoi, par rôle. Réservé au propriétaire de la
// Trésorerie. Garde-fous dans lib/accesCalendrier.js.
// ──────────────────────────────────────────────────────────────────────────────
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, Switch, Text, View } from 'react-native'

import { EnTete, Libelle, Puces, Vide, useEcranModerne } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { ROLES_CALENDRIER, TYPES_CALENDRIER, basculerType, estVerrouille, typesAutorises } from '../lib/accesCalendrier'
import { chargerAccesCalendrier, chargerDroitsCalendrier, enregistrerAccesCalendrier } from '../lib/evenementsDb'

const FAMILLES = ['Personnel', 'Calendrier', 'Trésorerie']

export default function AccesCalendrierScreen() {
  const { roleActif, userId, userNom } = useApp()
  const { styles, colors, principale } = useEcranModerne('sarcelle')
  const [autorise, setAutorise] = useState(null)
  const [config, setConfig] = useState({})
  const [role, setRole] = useState('rh')

  useEffect(() => {
    let vivant = true
    Promise.all([chargerDroitsCalendrier({ role: roleActif, userId }), chargerAccesCalendrier()])
      .then(([{ droits }, c]) => { if (vivant) { setAutorise(droits.proprietaire); setConfig(c) } })
      .catch(() => { if (vivant) setAutorise(false) })
    return () => { vivant = false }
  }, [roleActif, userId])

  const types = typesAutorises(role, { config })

  async function basculer(cle) {
    const avant = config
    const suivants = basculerType(types, cle)
    setConfig({ ...config, [role]: suivants })
    try {
      await enregistrerAccesCalendrier(role, suivants, { userId: userId || null, userNom: userNom || null })
    } catch {
      setConfig(avant)
      Alert.alert('Accès au calendrier', "Le réglage n'a pas pu être enregistré. Réessayez.")
    }
  }

  if (autorise === null) {
    return (
      <SafeAreaView style={styles.container}>
        <EnTete titre="Accès au calendrier" onRetour={() => router.back()} styles={styles} />
        <ActivityIndicator color={principale} style={{ marginTop: 40 }} />
      </SafeAreaView>
    )
  }

  if (!autorise) {
    return (
      <SafeAreaView style={styles.container}>
        <EnTete titre="Accès au calendrier" onRetour={() => router.back()} styles={styles} />
        <Vide icone="🔒" texte="Seul le propriétaire peut modifier ces réglages." styles={styles} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Accès au calendrier" sous="Qui voit quoi, par rôle" onRetour={() => router.back()} styles={styles} />
      <Puces ligne styles={styles} actif={role} onChoisir={setRole} elements={ROLES_CALENDRIER.map(r => ({ cle: r.cle, label: r.label }))} />
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>
          Le propriétaire voit toujours tout. {role === 'gerant' ? 'Le gérant reste limité à son restaurant, quoi que vous cochiez.' : 'Ouvrir un écran de la Trésorerie reste soumis aux droits de la Trésorerie.'}
        </Text>
        {FAMILLES.map(famille => (
          <View key={famille}>
            <Libelle styles={styles}>{famille}</Libelle>
            {TYPES_CALENDRIER.filter(t => t.famille === famille).map(t => {
              const verrou = estVerrouille(role, t.cle)
              return (
                <View key={t.cle} style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{t.label}</Text>
                    {verrou ? <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>🔒 Rattaché à aucun restaurant : jamais pour le gérant</Text> : null}
                  </View>
                  <Switch value={types.includes(t.cle)} disabled={verrou} onValueChange={() => basculer(t.cle)} />
                </View>
              )
            })}
          </View>
        ))}
        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  )
}
```

- [ ] **Step 6 : relier l'écran**

Dans `app/_layout.tsx`, après `<Stack.Screen name="evenements" />` : `<Stack.Screen name="acces-calendrier" />`.

Dans `app/parametres.js`, juste après le bloc `<View style={styles.infoBox}>` de la section des accès par rôle (autour de la ligne 1698), ajouter le bouton suivant, et importer `router` depuis `expo-router` s'il ne l'est pas déjà :

```jsx
        <TouchableOpacity style={styles.infoBox} onPress={() => router.push('/acces-calendrier')} accessibilityRole="button">
          <Text style={styles.infoTxt}>🔐 Accès au calendrier : qui voit quoi dans Événements ›</Text>
        </TouchableOpacity>
```

- [ ] **Step 7 : tout vérifier**

Run : `for f in lib/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "ECHEC $f"; done; npm run lint 2>&1 | tail -4; npx expo export -p web 2>&1 | tail -3; grep -l "qui voit quoi" dist/_expo/static/js/web/*.js | head -2`
Expected : aucun `ECHEC`, `0 errors`, export réussi, au moins un fichier trouvé.

- [ ] **Step 8 : mettre le graphe à jour puis committer**

```bash
graphify update .
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
git add supabase_calendrier_acces.sql app/acces-calendrier.js lib/evenementsDb.js lib/journal.js app/evenements.js app/parametres.js app/_layout.tsx components/evenements/RappelEvenements.js components/accueil/AccueilManager.js
git commit -m "feat(evenements): écran Accès au calendrier et application des réglages

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
```

Ne pas exécuter `supabase_calendrier_acces.sql`.

// Tests de lib/calendrierDates.js — droits et lignes du calendrier.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { droitsDates, filtrerParDroits, lignesDates } from './calendrierDates.js'

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

// Tests de lib/conseilsMois.js — règles d'analyse et de conseils du rapport mensuel.
// Cas calqués sur octobre 2026 (chiffres arrondis, noms de restaurants fictifs).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { analyserGroupe, analyserResto, entreeResto, objectifsProposes, referencesGroupe } from './conseilsMois.js'

const heures = repartition => Object.entries(repartition).map(([h, ca]) => ({ h: Number(h), ca, nb: Math.round(ca / 5000) }))
const semaine = parJour => Object.entries(parJour).map(([j, nb]) => ({ j: Number(j), h: 20, nb }))
const pos = ({ nb, ca, annulees = 0, offerts = 0, parType, parHeure, jours, paiements }) => ({
  totaux: { nb, ca, annulees, offerts },
  par_type: parType || [{ type: 'SUR_PLACE', nb, ca }],
  par_heure: parHeure || heures({ 12: ca * 0.2, 16: ca * 0.15, 20: ca * 0.65 }),
  semaine: semaine(jours || { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100 }),
  paiements: paiements || [{ mode: 'ESPECES', montant: ca * 0.8 }, { mode: 'WAVE', montant: ca * 0.2 }],
})
const resto = (x = {}) => ({
  id: x.id || 'r', nom: x.nom || 'Resto A', ca: 10_000_000, depenses: 6_000_000, depensesParCategorie: [{ categorie: 'Marché', montant: 2_000_000 }],
  fournisseurs: { facture: 4_000_000 }, livraisons: { totalCommission: 0 }, litiges: { total: 0, parType: [] },
  inventaireDetail: { totalDeduit: 0 }, ecartEspeces: 0, objectif: 10_000_000, tauxObjectif: 100, ...x,
})

describe('analyserResto', () => {
  test('restaurant en perte avec beaucoup d\'annulations et de livraison (type Angré 7E)', () => {
    const e = entreeResto({
      resto: resto({ ca: 10_340_600, livraisons: { totalCommission: 1_051_922 }, tauxObjectif: 103.4 }),
      ligne: { net: -158_990, netPrec: 120_000, varCa: 2 },
      pos: pos({
        nb: 2126, ca: 10_370_100, annulees: 282, offerts: 20,
        parType: [{ type: 'SUR_PLACE', nb: 1300, ca: 6_357_000 }, { type: 'LIVRAISON', partenaire: 'GLOVO', nb: 500, ca: 2_483_500 }, { type: 'LIVRAISON', partenaire: 'YANGO', nb: 326, ca: 1_529_600 }],
      }),
    })
    const a = analyserResto(e)
    assert.ok(a.constats.some(c => c.ton === 'alerte' && /En perte/.test(c.texte)))
    const ann = a.conseils.find(c => c.cle === 'annulations')
    assert.equal(ann.priorite, 1)                                   // 11,7 % ≥ 10 %
    assert.ok(ann.gain > 0)
    const liv = a.conseils.find(c => c.cle === 'livraison')
    assert.equal(liv.priorite, 1)                                   // marge nette < 5 %
    assert.equal(liv.gain, 105_192)                                 // 10 % des commissions
    assert.ok(a.objectifs.some(o => o.cle === 'net' && o.valeur === '≥ 0 F'))
    assert.ok(a.objectifs.some(o => o.cle === 'annulations'))
    assert.ok(a.conseils.length <= 5)
    assert.deepEqual(a.conseils.map(c => c.priorite), [...a.conseils.map(c => c.priorite)].sort())
  })

  test('achats trop hauts face au groupe (type Maroc)', () => {
    const maroc = entreeResto({ resto: resto({ id: 'm', nom: 'Maroc', ca: 12_487_600, fournisseurs: { facture: 7_230_000 } }), ligne: { net: 1_282_709 } })
    const autres = [
      entreeResto({ resto: resto({ id: 'a', nom: 'Angré', fournisseurs: { facture: 3_670_000 } }) }),
      entreeResto({ resto: resto({ id: 'k', nom: 'KMS', fournisseurs: { facture: 3_790_000 } }) }),
      entreeResto({ resto: resto({ id: 'l', nom: 'Lavage', fournisseurs: { facture: 4_090_000 } }) }),
    ]
    const ref = referencesGroupe([maroc, ...autres])
    assert.equal(ref.meilleurAchats.nom, 'Angré')
    const a = analyserResto(maroc, ref)
    const c = a.conseils.find(x => x.cle === 'achats')
    assert.equal(c.priorite, 1)
    assert.ok(a.constats.some(x => /57.9 %/.test(x.texte) && /Angré : 36.7 %/.test(x.texte)))
    assert.ok(a.objectifs.some(o => o.cle === 'achats'))
    assert.ok(!a.conseils.some(x => x.cle === 'depenses'))       // pas de doublon avec les achats
  })

  test('jour faible, après-midi creux, carte avec plats morts, plat vedette', () => {
    const plats = [
      ...Array.from({ length: 8 }, (_, k) => ({ nom: `Plat vendu ${k}`, qte: 50 })),
      { nom: 'Chawarma Mélange', qte: 600 },
      { nom: 'Kebbé', qte: 0 }, { nom: 'Bourak', qte: 0 },
    ]
    const e = entreeResto({
      resto: resto(),
      pos: pos({ nb: 2000, ca: 10_000_000, parHeure: heures({ 12: 2_000_000, 16: 500_000, 20: 7_500_000 }), jours: { 1: 300, 2: 280, 3: 150, 4: 300, 5: 320, 6: 380, 7: 300 } }),
      plats,
    })
    const a = analyserResto(e)
    assert.ok(a.conseils.some(c => c.cle === 'jour_faible' && c.titre === 'Animer le mercredi'))
    assert.ok(a.conseils.some(c => c.cle === 'creux'))
    assert.ok(a.conseils.some(c => c.cle === 'carte' && /Kebbé/.test(c.action)))
    assert.ok(a.constats.some(c => /Chawarma Mélange fait à lui seul/.test(c.texte)))
  })

  test('baisse des ventes : le canal qui recule le plus', () => {
    const e = entreeResto({
      resto: resto(),
      ligne: { varCa: -12 },
      pos: pos({ nb: 2000, ca: 9_000_000, parType: [{ type: 'SUR_PLACE', nb: 1500, ca: 7_000_000 }, { type: 'LIVRAISON', partenaire: 'GLOVO', nb: 500, ca: 2_000_000 }] }),
      posPrec: pos({ nb: 2300, ca: 10_200_000, parType: [{ type: 'SUR_PLACE', nb: 1500, ca: 7_100_000 }, { type: 'LIVRAISON', partenaire: 'GLOVO', nb: 800, ca: 3_100_000 }] }),
    })
    const a = analyserResto(e)
    const c = a.conseils.find(x => x.cle === 'tendance')
    assert.equal(c.titre, 'Relancer Glovo')
    assert.equal(c.priorite, 1)
    assert.ok(a.constats.some(x => /baisse de 12 %/.test(x.texte)))
  })

  test('restaurant sain : aucun conseil inventé', () => {
    const e = entreeResto({ resto: resto(), ligne: { net: 1_500_000, varCa: 2 }, pos: pos({ nb: 2000, ca: 10_000_000, annulees: 30, offerts: 20 }) })
    const a = analyserResto(e)
    assert.deepEqual(a.conseils, [])
    assert.ok(a.constats.some(c => c.ton === 'bon'))
  })

  test('sans POS : les règles Samtrackly seules', () => {
    const e = entreeResto({ resto: resto({ litiges: { total: 200_000, parType: [{ type: 'Contacts manquants', montant: 150_000 }] }, ecartEspeces: -90_000 }) })
    const a = analyserResto(e)
    assert.ok(a.conseils.some(c => c.cle === 'litiges' && /Contacts manquants/.test(c.action)))
    assert.ok(a.conseils.some(c => c.cle === 'especes' && c.gain === 45_000))
  })
})

test('objectifs proposés : ventes arrondies, ticket visé', () => {
  const e = entreeResto({ resto: resto({ ca: 31_551_700, objectif: 37_000_000 }), ligne: { varCa: 3 }, pos: pos({ nb: 6621, ca: 31_661_200 }) })
  const o = objectifsProposes(e)
  const ventes = o.find(x => x.cle === 'ventes')
  assert.equal(ventes.valeur, '34 100 000 F')                       // +8 % (tendance positive), arrondi à 100 000
  assert.match(ventes.detail, /objectif actuel 37 M/)
  const ticket = o.find(x => x.cle === 'ticket')
  assert.equal(ticket.valeur, '4 950 F')                             // 4 782 + 150, arrondi à 50
})

test('analyserGroupe : conseils les plus rentables, restaurants en perte, sujet commun', () => {
  const avecAnn = (id, nom) => entreeResto({
    resto: resto({ id, nom }), ligne: { net: id === 'a' ? -100_000 : 500_000 },
    pos: pos({ nb: 2000, ca: 10_000_000, annulees: 200 }),
  })
  const g = analyserGroupe([avecAnn('a', 'A'), avecAnn('b', 'B'), avecAnn('c', 'C')])
  assert.ok(g.conseils.length > 0 && g.conseils.length <= 6)
  assert.ok(g.conseils.every(c => c.restaurant))
  assert.ok(g.constats.some(c => /1 restaurant en perte : A/.test(c.texte)))
  assert.ok(g.constats.some(c => /Sujet commun à 3 restaurants : « Contrôler les annulations »/.test(c.texte)))
  assert.equal(g.parResto.length, 3)
})

test('repères : un restaurant trop petit n\'est pas pris comme modèle', () => {
  const petit = entreeResto({ resto: resto({ id: 'b', nom: 'Braise', ca: 1_935_000, fournisseurs: { facture: 630_000 } }) })
  const grands = ['A', 'B', 'C'].map((nom, k) => entreeResto({ resto: resto({ id: nom, nom, fournisseurs: { facture: 3_700_000 + k * 400_000 } }) }))
  const ref = referencesGroupe([petit, ...grands])
  assert.equal(ref.meilleurAchats.nom, 'A')
  assert.equal(ref.achatsMediane, 41)
  const g = analyserGroupe([petit, ...grands])
  assert.equal(g.objectifs[0].cle, 'ventes')
})

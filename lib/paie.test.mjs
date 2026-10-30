// Tests de lib/paie.js — les 5 bulletins Sage de juillet 2026, au franc près.
// Cas anonymisés (A–E) : seuls les montants comptent.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  anciennete, tauxAnciennete, impotBrutITS, ricf, calculerBulletin, parametresPour,
  propositionGratification, propositionFeries, propositionFinCdd, propositionConges, PARAMETRES_DEFAUT,
} from './paie.js'

const FIN = '2026-07-31'
const fiche = (x) => ({ sursalaire: 0, prime_transport: 30000, prime_tenue: 3031, ...x })

const CAS = {
  A: { // cuisinier, 8 ans 8 mois, 3 parts, 3 personnes CMU
    e: { fiche: fiche({ salaire_categoriel: 88007, sursalaire: 15000, parts_fiscales: 3, personnes_cmu: 3 }), dateEmbauche: '2017-11-01' },
    brut: 110048, anc: 7041, cmu: 1500, cnps: 6933, impotBrut: 5608, ricf: 22000, its: 0, sal: 8433, pat: 18868, arrondi: 54, net: 134700,
  },
  B: { // assistante comptable, 3 ans 1 mois, 1 part, 2 personnes CMU
    e: { fiche: fiche({ salaire_categoriel: 81693, sursalaire: 54500, parts_fiscales: 1, personnes_cmu: 2 }), dateEmbauche: '2023-06-15' },
    brut: 138644, anc: 2451, cmu: 1000, cnps: 8735, impotBrut: 10183, ricf: 0, its: 10183, sal: 19918, pat: 21372, arrondi: 43, net: 151800,
  },
  C: { // gérant adjoint, 15 ans 2 mois, 3,5 parts, 5 personnes CMU
    e: { fiche: fiche({ salaire_categoriel: 81693, sursalaire: 20000, parts_fiscales: 3.5, personnes_cmu: 5 }), dateEmbauche: '2011-05-10' },
    brut: 113947, anc: 12254, cmu: 2500, cnps: 7179, impotBrut: 6232, ricf: 27500, its: 0, sal: 9679, pat: 20278, arrondi: 1, net: 137300,
  },
  D: { // serveur, 3 ans 8 mois, 2 parts, 2 personnes CMU
    e: { fiche: fiche({ salaire_categoriel: 75000, parts_fiscales: 2, personnes_cmu: 2 }), dateEmbauche: '2022-11-01' },
    brut: 77250, anc: 2250, cmu: 1000, cnps: 4867, impotBrut: 360, ricf: 11000, its: 0, sal: 5867, pat: 14925, arrondi: 86, net: 104500,
  },
  E: { // caissière, 8 mois, avance 91 400
    e: { fiche: fiche({ salaire_categoriel: 75000, parts_fiscales: 1, personnes_cmu: 1 }), dateEmbauche: '2025-11-01', avances: 91400 },
    brut: 75000, anc: 0, cmu: 500, cnps: 4725, impotBrut: 0, ricf: 0, its: 0, sal: 5225, pat: 14188, arrondi: 94, net: 11500,
  },
}

describe('bulletins Sage de juillet 2026 (au franc près)', () => {
  for (const [nom, c] of Object.entries(CAS)) {
    test(`cas ${nom}`, () => {
      const b = calculerBulletin({ ...c.e, finPeriode: FIN })
      assert.equal(b.brut, c.brut, 'brut')
      assert.equal(b.gains.find(g => g.code === 100)?.gain ?? 0, c.anc, 'ancienneté')
      assert.equal(b.retenues.cmu, c.cmu, 'CMU')
      assert.equal(b.retenues.cnps, c.cnps, 'CNPS')
      assert.equal(b.retenues.impotBrut, c.impotBrut, 'impôt brut')
      assert.equal(b.retenues.ricf, c.ricf, 'RICF')
      assert.equal(b.retenues.its, c.its, 'ITS')
      assert.equal(b.chargesSalariales, c.sal, 'charges salariales')
      assert.equal(b.chargesPatronales, c.pat, 'charges patronales')
      assert.equal(b.arrondi, c.arrondi, 'arrondi')
      assert.equal(b.net, c.net, 'net')
      assert.equal(b.salaireBrutCumul, c.brut + 30000, 'salaire brut des cumuls')
    })
  }

  test('cas A : part patronale ligne par ligne', () => {
    const b = calculerBulletin({ ...CAS.A.e, finPeriode: FIN })
    const m = Object.fromEntries(b.patronal.map(l => [l.code, l.montant]))
    assert.deepEqual(m, { 415: 1500, 470: 8474, 480: 3750, 481: 563, 490: 1500, 500: 1321, 520: 440, 530: 660, 531: 660 })
  })
})

describe('ancienneté', () => {
  test('années et mois complets', () => {
    assert.deepEqual(anciennete('2017-11-01', '2026-07-31'), { ans: 8, mois: 8 })
    assert.deepEqual(anciennete('2026-07-31', '2026-07-31'), { ans: 0, mois: 0 })
    assert.deepEqual(anciennete('', '2026-07-31'), { ans: 0, mois: 0 })
  })
  test('taux : 0 avant 2 ans, 1 % par an, plafond 25 %', () => {
    assert.equal(tauxAnciennete(1), 0)
    assert.equal(tauxAnciennete(2), 200)
    assert.equal(tauxAnciennete(15), 1500)
    assert.equal(tauxAnciennete(30), 2500)
  })
  test('1 an 11 mois → pas de prime', () => {
    const b = calculerBulletin({ ...CAS.D.e, dateEmbauche: '2024-08-15', finPeriode: FIN })
    assert.equal(b.gains.find(g => g.code === 100), undefined)
  })
})

describe('ITS', () => {
  test('tranches', () => {
    assert.equal(impotBrutITS(75000), 0)
    assert.equal(impotBrutITS(240000), 26400)
    assert.equal(impotBrutITS(300000), 26400 + 12600)
  })
  test('RICF par demi-part, plafond 5 parts', () => {
    assert.equal(ricf(1), 0)
    assert.equal(ricf(1.5), 5500)
    assert.equal(ricf(5), 44000)
    assert.equal(ricf(7), 44000)
    assert.equal(ricf(null), 0)
  })
})

describe('absences et avances', () => {
  test('2 jours d\'absence : base, sursalaire et transport au prorata de 28/30', () => {
    const b = calculerBulletin({ ...CAS.A.e, finPeriode: FIN, absences: 2 })
    assert.equal(b.joursPayes, 28)
    assert.equal(b.gains[0].gain, Math.round(88007 * 28 / 30))
    assert.equal(b.transport, 28000)
    assert.equal(b.tenue, 3031)
  })
  test('avance plus grande que le net : net 0 et reste signalé', () => {
    const b = calculerBulletin({ ...CAS.E.e, avances: 200000, finPeriode: FIN })
    assert.equal(b.net, 0)
    assert.equal(b.arrondi, 0)
    assert.ok(b.avanceNonCouverte > 0)
  })
})

describe('éléments variables', () => {
  test('entrent dans le brut imposable', () => {
    const b = calculerBulletin({ ...CAS.D.e, finPeriode: FIN, variables: [{ code: 300, libelle: 'GRATIFICATION', montant: 56250 }] })
    assert.equal(b.brut, 77250 + 56250)
    assert.equal(b.retenues.cnps, Math.round((77250 + 56250) * 630 / 10000))
  })
  test('propositions', () => {
    assert.equal(propositionGratification(75000, 12), 56250)
    assert.equal(propositionGratification(75000, 6), 28125)
    assert.equal(propositionFeries(75000, 2), 5000)
    assert.equal(propositionFinCdd(1000000), 30000)
    assert.equal(propositionConges(1200000, 12, 3), 10000)
  })
})

describe('parametresPour', () => {
  test('la ligne la plus récente applicable au mois', () => {
    const lignes = [
      { applicable_du: '2026-11-01', valeurs: { smig: 75000 } },
      { applicable_du: '2027-01-01', valeurs: { smig: 80000 } },
    ]
    assert.equal(parametresPour(lignes, '2026-11-30').smig, 75000)
    assert.equal(parametresPour(lignes, '2027-01-31').smig, 80000)
    assert.equal(parametresPour([], '2026-11-30'), PARAMETRES_DEFAUT)
  })
})

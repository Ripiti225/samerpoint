// ──────────────────────────────────────────────────────────────────────────────
// Tests du bouton « Avis → Samtrackly » (favori Chrome).
//
// Le moteur vit dans public/bouton-avis.js, servi tel quel : il tourne sur les
// portails Glovo et Yango, hors de l'app. On le charge ici comme du texte pour
// tester ses conversions — un thème mal traduit ou un pouce inversé ferait
// créer (ou rater) des litiges à 1000 FCFA.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../public/bouton-avis.js', import.meta.url), 'utf8')
const moteurAvis = new Function(source + '\nreturn moteurAvis')()
const { periodeLecture, convertirGlovo, convertirYango, plateformeDuSite } = moteurAvis()

const MAINTENANT = Date.parse('2026-10-10T12:00:00Z')

describe('periodeLecture — quels jours relire', () => {
  test('depuis le dernier avis reçu, moins 3 jours de marge', () => {
    assert.deepEqual(periodeLecture('2026-10-08', MAINTENANT), { debut: '2026-10-05', fin: '2026-10-10' })
  })
  test('jamais plus de 45 jours en arrière', () => {
    assert.deepEqual(periodeLecture('2026-01-01', MAINTENANT), { debut: '2026-08-26', fin: '2026-10-10' })
  })
  test('aucun avis reçu : les 45 derniers jours', () => {
    assert.deepEqual(periodeLecture(null, MAINTENANT), { debut: '2026-08-26', fin: '2026-10-10' })
  })
})

describe('convertirGlovo — un avis Glovo au format Samtrackly', () => {
  const brut = {
    id: '101791205516-review', orderId: '101791205516', globalVendorCode: 'GV_CI;84806',
    date: '2026-10-03T02:41:04Z', rating: 1, text: 'Froid', thumbs_up: false,
    vendor_pills: ['TASTED_BAD', 'MISSING_OR_MISTAKEN_ITEMS', 'CODE_NOUVEAU'],
    product_ratings: [{ name: 'Chawarma Poulet' }],
  }
  test('pouce rouge = négatif, n° de commande, date, boutique par son code', () => {
    const a = convertirGlovo(brut)
    assert.equal(a.platform, 'glovo')
    assert.equal(a.classification, 'negatif')
    assert.equal(a.external_ref, '101791205516')
    assert.equal(a.external_store_label, 'GV_CI;84806')
    assert.equal(a.review_date, '2026-10-03')
    assert.equal(a.comment, 'Froid')
    assert.equal(a.rating_raw, null)
  })
  test('thèmes traduits comme au 05/09, code inconnu gardé tel quel', () => {
    assert.deepEqual(convertirGlovo(brut).raw.theme, ['Mauvais goût', 'Produits manquants ou incorrects', 'CODE_NOUVEAU'])
  })
  test('un plat → texte, plusieurs → liste, aucun → absent', () => {
    assert.equal(convertirGlovo(brut).raw.dish, 'Chawarma Poulet')
    assert.deepEqual(convertirGlovo({ ...brut, product_ratings: [{ name: 'A' }, { name: 'B' }] }).raw.dish, ['A', 'B'])
    assert.equal('dish' in convertirGlovo({ ...brut, product_ratings: [] }).raw, false)
  })
  test('pouce vert = bon ; pas de thème → pas de clé theme', () => {
    const a = convertirGlovo({ ...brut, thumbs_up: true, vendor_pills: [], text: '' })
    assert.equal(a.classification, 'bon')
    assert.equal(a.comment, '')
    assert.equal('theme' in a.raw, false)
  })
  test('nom lisible de la boutique conservé', () => {
    assert.equal(convertirGlovo(brut).raw.store_name, 'Chez Samer (Riviéra Palmeraie Abidjan CI) [ABN]')
  })
})

describe('convertirYango — un avis Yango au format Samtrackly', () => {
  const brut = {
    order: { order_nr: '261003-CI0622322', place_id: '1969340' },
    order_feedback: { id: 2001389143, rating: 1, feedback_filled_at: '2026-10-03T21:05:00+00:00',
      predefined_comments: [{ comment: 'Pas très bon' }] },
  }
  test('note sous 3 = négatif, tags dans raw.tag, boutique par place_id', () => {
    const a = convertirYango(brut)
    assert.equal(a.platform, 'yango')
    assert.equal(a.classification, 'negatif')
    assert.equal(a.rating_raw, 1)
    assert.equal(a.rating_scale, 5)
    assert.equal(a.external_ref, '261003-CI0622322')
    assert.equal(a.external_store_label, '1969340')
    assert.equal(a.review_date, '2026-10-03')
    assert.equal(a.comment, '')
    assert.deepEqual(a.raw.tag, ['Pas très bon'])
  })
  test('3 étoiles = bon ; sans tag → pas de clé tag', () => {
    const a = convertirYango({ ...brut, order_feedback: { ...brut.order_feedback, rating: 3, predefined_comments: [] } })
    assert.equal(a.classification, 'bon')
    assert.equal('tag' in a.raw, false)
  })
})

describe('plateformeDuSite', () => {
  test('reconnaît les deux portails, rien d’autre', () => {
    assert.equal(plateformeDuSite('portal.glovoapp.com'), 'glovo')
    assert.equal(plateformeDuSite('vendor.yango.com'), 'yango')
    assert.equal(plateformeDuSite('samtrackly.vercel.app'), null)
  })
})

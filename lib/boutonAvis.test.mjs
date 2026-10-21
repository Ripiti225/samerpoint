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
import { construireFavori, secretValide } from './boutonAvis.js'

const source = readFileSync(new URL('../public/bouton-avis.js', import.meta.url), 'utf8')
const moteurAvis = new Function(source + '\nreturn moteurAvis')()
const {
  periodeLecture, convertirGlovo, convertirYango, plateformeDuSite, heureGlovo, heureYango, enParallele,
  periodeCommandes, convertirCommandeGlovo, convertirCommandeYango, avecReprise,
  indexerAvisGlovo, planReponses,
} = moteurAvis()
const fixturesGlovo = JSON.parse(readFileSync(new URL('./fixtures/commandes-glovo.json', import.meta.url), 'utf8'))
const fixturesYango = JSON.parse(readFileSync(new URL('./fixtures/commandes-yango.json', import.meta.url), 'utf8'))

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
  test('plafond propre à la plateforme : Yango refuse plus de 5 semaines, on s’arrête à 30 jours', () => {
    assert.deepEqual(periodeLecture(null, MAINTENANT, 30), { debut: '2026-09-10', fin: '2026-10-10' })
    assert.deepEqual(periodeLecture('2026-10-08', MAINTENANT, 30), { debut: '2026-10-05', fin: '2026-10-10' })
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

describe('construireFavori — le favori à glisser dans Chrome', () => {
  const SECRET = 'a'.repeat(64)

  test('secret attendu : 64 caractères hexadécimaux', () => {
    assert.equal(secretValide(SECRET), true)
    assert.equal(secretValide('  ' + SECRET + ' '), true)
    assert.equal(secretValide('abc'), false)
    assert.equal(secretValide('z'.repeat(64)), false)
    assert.equal(secretValide(''), false)
  })

  test('un lien javascript: qui embarque le moteur et lance avec la bonne config', () => {
    const fav = construireFavori(source, { origine: 'https://samtrackly.vercel.app/', secret: ' ' + SECRET })
    assert.ok(fav.startsWith('javascript:'))
    const code = decodeURIComponent(fav.slice('javascript:'.length))
    assert.ok(code.includes('function moteurAvis()'))
    assert.ok(code.includes(`moteurAvis().lancer({"origine":"https://samtrackly.vercel.app","secret":"${SECRET}"})`))
    // Le code doit être du JavaScript valide (compilé, pas exécuté).
    assert.doesNotThrow(() => new Function(code))
  })

  test('refuse une source qui n’est pas le moteur', () => {
    assert.throws(() => construireFavori('<!doctype html>', { origine: 'https://x.test', secret: SECRET }))
  })
})

describe('heure de la commande lue sur le portail', () => {
  test('Glovo : placedTimestamp du détail de commande', () => {
    const j = { data: { orders: { order: { order: { orderId: '1', placedTimestamp: '2026-10-03T23:20:10Z' } } } } }
    assert.equal(heureGlovo(j), '2026-10-03T23:20:10.000Z')
  })
  test('Yango : created_at du détail de commande', () => {
    assert.equal(heureYango({ created_at: '2026-10-03T18:59:49.819258+00:00' }), '2026-10-03T18:59:49.819Z')
  })
  test('réponse incomplète ou illisible : pas d’heure', () => {
    assert.equal(heureGlovo({ data: null }), null)
    assert.equal(heureGlovo(null), null)
    assert.equal(heureYango({ created_at: 'n’importe quoi' }), null)
  })
  test('enParallele garde l’ordre et limite le nombre d’appels simultanés', async () => {
    let enCours = 0, maxi = 0
    const r = await enParallele([1, 2, 3, 4, 5, 6], 2, async x => {
      enCours++; maxi = Math.max(maxi, enCours)
      await new Promise(ok => setTimeout(ok, 5))
      enCours--
      return x * 10
    })
    assert.deepEqual(r, [10, 20, 30, 40, 50, 60])
    assert.ok(maxi <= 2)
  })
})

// Glovo plafonne le détail des commandes (« rejected by grpc_ratelimit
// middleware, please retry later », constaté le 10/10/2026 : 78 refus sur 222
// commandes) : un seul réessai immédiat faisait échouer toute la lecture.
describe('avecReprise — réessais espacés quand le portail freine', () => {
  test('réessaie en attendant de plus en plus longtemps, puis réussit', async () => {
    const attentes = []
    let appels = 0
    const r = await avecReprise(async () => {
      appels++
      if (appels < 4) throw new Error('rejected by grpc_ratelimit')
      return 'ok'
    }, async ms => { attentes.push(ms) })
    assert.equal(r, 'ok')
    assert.deepEqual(attentes, [1000, 2000, 4000])
  })
  test('abandonne après 5 réessais avec un message en français', async () => {
    const attentes = []
    await assert.rejects(
      avecReprise(async () => { throw new Error('toujours freiné') }, async ms => { attentes.push(ms) }),
      e => /n’a pas abouti/.test(e.messageFr),
    )
    assert.deepEqual(attentes, [1000, 2000, 4000, 8000, 16000])
  })
  test('session expirée : pas de réessai, le message est gardé', async () => {
    let appels = 0
    const expiree = Object.assign(new Error('x'), { messageFr: 'Ta session Glovo a expiré', definitif: true })
    await assert.rejects(
      avecReprise(async () => { appels++; throw expiree }, async () => {}),
      e => e.messageFr === 'Ta session Glovo a expiré',
    )
    assert.equal(appels, 1)
  })
})

describe('periodeCommandes — quels jours de commandes relire', () => {
  test('premier passage : depuis hier', () => {
    assert.deepEqual(periodeCommandes(null, MAINTENANT, 30), { debut: '2026-10-09', fin: '2026-10-10' })
  })
  test('ensuite : 2 jours de marge avant le dernier jour reçu', () => {
    assert.deepEqual(periodeCommandes('2026-10-08', MAINTENANT, 30), { debut: '2026-10-06', fin: '2026-10-10' })
  })
  test('jamais au-delà du plafond du portail', () => {
    assert.deepEqual(periodeCommandes('2026-01-01', MAINTENANT, 30), { debut: '2026-09-10', fin: '2026-10-10' })
  })
})

describe('convertirCommandeGlovo — une commande Glovo au format Samtrackly', () => {
  const [rembourse, attente, autreBoutique, annulee] = fixturesGlovo.commandes.map(convertirCommandeGlovo)
  test('livrée, remboursement retenu, menu = une seule ligne (options ignorées)', () => {
    assert.deepEqual(rembourse, {
      plateforme: 'glovo', numero: '101796963699', boutique: 'GV_CI;84806',
      commande_le: '2026-10-08T20:08:11.000Z', statut: 'livree', montant_paye: 0,
      rembourse: 5200, penalite_attente: 0,
      lignes: [{ nom: 'Tacos Viande + Frites + Coca-Cola Original 33cl Canette', quantite: 1, prix_unitaire: 6500 }],
    })
  })
  test('pénalité d’attente et quantités', () => {
    assert.equal(attente.penalite_attente, 468)
    assert.equal(attente.rembourse, 0)
    assert.deepEqual(attente.lignes.map(l => [l.nom, l.quantite, l.prix_unitaire]), [
      ['Chawarma Poulet', 2, 3500], ['Coca-Cola Original  33cl Canette', 2, 1500],
    ])
  })
  test('code boutique complet', () => {
    assert.equal(autreBoutique.boutique, 'GV_CI;121904')
  })
  test('annulée sans détail : annulee, aucune ligne', () => {
    assert.equal(annulee.statut, 'annulee')
    assert.deepEqual(annulee.lignes, [])
  })
  test('commande en cours : autre', () => {
    const c = convertirCommandeGlovo({ liste: { ...fixturesGlovo.commandes[2].liste, orderStatus: 'ACCEPTED' }, detail: null })
    assert.equal(c.statut, 'autre')
  })
})

describe('convertirCommandeYango — une commande Yango au format Samtrackly', () => {
  const [annuleePayee, annuleeNonPayee, livree] = fixturesYango.commandes.map(convertirCommandeYango)
  test('annulée mais payée (« Sera payée ») : annulee avec montant payé', () => {
    assert.deepEqual(annuleePayee, {
      plateforme: 'yango', numero: '261008-CI0870074', boutique: '1969345',
      commande_le: '2026-10-08T01:18:55.149Z', statut: 'annulee', montant_paye: 3000,
      rembourse: 0, penalite_attente: 0,
      lignes: [{ nom: 'Jambon fromage', quantite: 1, prix_unitaire: 3000 }],
    })
  })
  test('annulée non payée : montant payé 0', () => {
    assert.equal(annuleeNonPayee.statut, 'annulee')
    assert.equal(annuleeNonPayee.montant_paye, 0)
  })
  test('livrée : prix unitaire et quantité', () => {
    assert.equal(livree.statut, 'livree')
    assert.deepEqual(livree.lignes, [{ nom: 'Tacos viande + frites + 1 boisson', quantite: 2, prix_unitaire: 5200 }])
  })
  test('sans détail : heure de la liste, aucune ligne', () => {
    const c = convertirCommandeYango({ liste: fixturesYango.commandes[2].liste, detail: null })
    assert.equal(c.commande_le, '2026-10-08T19:12:30.000Z')
    assert.deepEqual(c.lignes, [])
  })
})

describe('réponses aux avis Glovo', () => {
  const bruts = [
    { id: 'rv1', orderId: '101806279410', globalVendorCode: 'GV_CI;84806', reply: null },
    { id: 'rv2', orderId: '101807594693', globalVendorCode: 'GV_CI;84806', reply: { text: 'déjà fait' } },
  ]
  const rep = (id, ref) => ({ id, external_ref: ref, external_store_label: 'GV_CI;84806', review_date: '2026-10-19', texte: 'Merci' })
  test('index par boutique et numéro de commande', () => {
    const i = indexerAvisGlovo(bruts)
    assert.deepEqual(i.get('GV_CI;84806|101806279410'), { id: 'rv1', deja: false })
    assert.deepEqual(i.get('GV_CI;84806|101807594693'), { id: 'rv2', deja: true })
  })
  test('à envoyer, déjà répondu chez Glovo, introuvable', () => {
    const p = planReponses([rep('a', '101806279410'), rep('b', '101807594693'), rep('c', '999')], indexerAvisGlovo(bruts))
    assert.deepEqual(p.aEnvoyer.map(x => [x.reponse.id, x.reviewId]), [['a', 'rv1']])
    assert.deepEqual(p.deja, ['b'])
    assert.deepEqual(p.introuvables.map(r => r.id), ['c'])
  })
})

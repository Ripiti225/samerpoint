// ──────────────────────────────────────────────────────────────────────────────
// Tests du favori « Ventes Yango → Samtrackly ».
//
// Le moteur vit dans public/bouton-ventes-yango.js, servi tel quel : il tourne
// sur le portail Yango. On le charge comme du texte pour tester ses conversions.
// Formes des réponses relevées sur le portail le 26/10/2026.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { construireFavoriVentes } from './boutonVentesYango.js'
import { analyserYango } from './partenairesImport.js'

const source = readFileSync(new URL('../public/bouton-ventes-yango.js', import.meta.url), 'utf8')
const moteur = new Function(source + '\nreturn moteurVentesYango')()()
const {
  ENTETES, bornesLecture, nomBoutique, dateExport, ligneExport, lignesExport, lirePub, pubAJourAu,
  avecReprise, aConnexion, optionsAppel, erreurHttp,
} = moteur

const PLACES = [
  { id: 1969340, name: 'Chez Samer', address: "Рон-пуэн-Ривьера-Пальнре, Абиджан, Кот-д'Ивуар, Rond point Riviera Palmraie" },
  { id: 1969365, name: 'Chez Samer', address: 'Quartier de la Zone 4, Quartier de la Zone 4, Abidjan' },
]
const cmd = (o) => ({
  order_nr: 'X', flow: 'native', status: 'released', place_id: 1969340,
  place_confirmed_at: '2026-09-28T12:00:00+00:00', is_reimbursement_to_place: true,
  sum: '3000', total_sum: '3000', discount: '0', payment_type: 'cashless', summary_date: '2026-09-28', service: 'eda', ...o,
})

describe('bornes de lecture', () => {
  test('semaine vendredi → jeudi : on lit du jeudi d’avant au jeudi de fin (comme l’export)', () => {
    assert.deepEqual(bornesLecture({ debut: '2026-09-25', fin: '2026-10-01' }), { from: '2026-09-24', to: '2026-10-01' })
  })
})

describe('commande du portail → ligne d’export', () => {
  const noms = { 1969340: nomBoutique(PLACES[0]) }
  test('nom de boutique = « nom (adresse) », comme la colonne de l’export', () => {
    assert.equal(nomBoutique({ name: 'Al Kayan', address: 'Rue S95, Abidjan' }), 'Al Kayan (Rue S95, Abidjan)')
  })
  test('date confirmée en UTC, au format de l’export', () => {
    assert.equal(dateExport('2026-10-01T23:51:59+00:00'), '2026-10-01 23:51:59')
    assert.equal(dateExport(null), '')
  })
  test('livrée payée', () => {
    assert.deepEqual(ligneExport(cmd({ order_nr: 'A' }), noms), [noms[1969340], 'A', 3000, 'Livré', 'Oui', '2026-09-28 12:00:00'])
  })
  test('refusée : « Annulé », et « Non » quand Yango ne paie pas', () => {
    const l = ligneExport(cmd({ status: 'refused', is_reimbursement_to_place: false }), noms)
    assert.equal(l[3], 'Annulé')
    assert.equal(l[4], 'Non')
  })
  test('boutique inconnue : son numéro, pour être signalée', () => {
    assert.equal(ligneExport(cmd({ place_id: 42 }), noms)[0], '42')
  })
})

describe('lignes complètes → analyserYango (même calcul que le fichier)', () => {
  const lignes = lignesExport([
    cmd({ order_nr: 'B1', place_confirmed_at: '2026-09-24T21:59:00+00:00' }), // jeudi d'avant < 22h : coupée
    cmd({ order_nr: 'B2', place_confirmed_at: '2026-09-24T22:10:00+00:00' }), // gardée
    cmd({ order_nr: 'B3', status: 'refused' }),                                 // annulée payée : gardée
    cmd({ order_nr: 'B4', status: 'refused', is_reimbursement_to_place: false }), // non payable
    cmd({ order_nr: 'B5', place_id: 1969365, sum: '5000' }),
    cmd({ order_nr: 'B6', place_confirmed_at: '2026-10-01T22:30:00+00:00' }), // jeudi de fin ≥ 22h : coupée
  ], PLACES)

  test('en-têtes de l’export en première ligne', () => {
    assert.deepEqual(lignes[0], ENTETES)
  })
  test('mêmes filtres et mêmes codes que l’export Excel', () => {
    const r = analyserYango(lignes)
    assert.deepEqual(r.ecarte, { bordDebut: 1, bordFin: 1, nonPayables: 1 })
    assert.equal(r.annuleesPayees, 1)
    assert.deepEqual(r.parCode.PALM, { nb: 2, montant: 6000, paye: 4620 })
    assert.deepEqual(r.parCode.KMS, { nb: 1, montant: 5000, paye: 3850 })
  })
})

describe('pub', () => {
  const rep = (points, maj) => ({
    available: [{
      slug: 'cpa_advert_costs', total_value: { title: '', value: points.reduce((s, p) => s + p[1], 0) },
      points_data: points.map(([j, v]) => ({ dt_from: j + 'T00:00:00+00:00', dt_to: j + 'T00:00:00+00:00', value: v })),
      ...(maj ? { updated_at: maj } : {}),
    }],
    unavailable: [],
  })
  test('total et dernier jour compté', () => {
    assert.deepEqual(lirePub(rep([['2026-09-30', 22762], ['2026-10-01', 14391]])), { montant: 37153, dernierJour: '2026-10-01', majLe: null })
  })
  test('jours à 0 en fin de période : Yango n’a pas encore compté', () => {
    assert.equal(lirePub(rep([['2026-10-05', 10782], ['2026-10-06', 0]])).dernierJour, '2026-10-05')
  })
  test('métrique absente : rien', () => {
    assert.deepEqual(lirePub({ available: [] }), { montant: 0, dernierJour: null, majLe: null })
  })
  test('à jour au : veille de updated_at si Yango le donne, sinon dernier jour avec une pub', () => {
    assert.equal(pubAJourAu([{ majLe: '2026-10-06', dernierJour: '2026-10-05' }]), '2026-10-05')
    assert.equal(pubAJourAu([{ majLe: null, dernierJour: '2026-10-01' }, { majLe: null, dernierJour: '2026-09-29' }]), '2026-10-01')
    assert.equal(pubAJourAu([{ majLe: null, dernierJour: null }]), null)
  })
})

describe('exécution', () => {
  test('connexion reconnue aux NOMS d’en-têtes, jamais à leur valeur', () => {
    assert.equal(aConnexion({ 'X-Oauth': 'a', 'X-Partner-Id': 'b' }), true)
    assert.equal(aConnexion({ authorization: 'a' }), true)
    assert.equal(aConnexion({ Accept: 'application/json' }), false)
  })
  test('reprise : 5 nouveaux essais, puis message en français', async () => {
    let n = 0
    await assert.rejects(avecReprise(async () => { n++; throw new Error('x') }, async () => {}), e => /clique à nouveau/.test(e.messageFr))
    assert.equal(n, 6)
  })
  // 28/10/2026 : en-têtes captés sur v2/active (simple lecture, sans
  // Content-Type) → la liste des commandes (POST JSON) répondait 400 à chaque essai.
  test('envoi JSON : Content-Type ajouté si la requête captée n’en avait pas', () => {
    const o = optionsAppel({ Accept: 'application/json', 'X-Oauth': 'a' }, { from: '2026-10-15' })
    assert.equal(o.method, 'POST')
    assert.equal(o.headers['Content-Type'], 'application/json')
    assert.equal(o.headers['X-Oauth'], 'a')
    assert.equal(o.body, '{"from":"2026-10-15"}')
    assert.equal(o.credentials, 'include')
  })
  test('envoi JSON : Content-Type déjà présent (quelle que soit la casse) gardé tel quel', () => {
    const o = optionsAppel({ 'content-type': 'application/json;charset=UTF-8' }, {})
    assert.deepEqual(Object.keys(o.headers), ['content-type'])
  })
  test('lecture simple : ni corps ni Content-Type, en-têtes de la page non modifiés', () => {
    const entetes = { 'X-Oauth': 'a' }
    const o = optionsAppel(entetes, null)
    assert.equal(o.method, 'GET')
    assert.equal(o.body, undefined)
    assert.deepEqual(o.headers, { 'X-Oauth': 'a' })
    optionsAppel(entetes, {})
    assert.deepEqual(entetes, { 'X-Oauth': 'a' })
  })
  test('refus de Yango (400) : définitif, pas 5 nouveaux essais pendant 30 s', () => {
    assert.equal(erreurHttp(400).definitif, true)
    assert.equal(erreurHttp(401).definitif, true)
    assert.match(erreurHttp(401).messageFr, /session Yango a expiré/)
    assert.equal(erreurHttp(429).definitif, undefined)
    assert.equal(erreurHttp(502).definitif, undefined)
  })
  test('session expirée : pas de nouvel essai', async () => {
    let n = 0
    await assert.rejects(avecReprise(async () => { n++; const e = new Error('s'); e.definitif = true; throw e }, async () => {}))
    assert.equal(n, 1)
  })
})

describe('construireFavoriVentes', () => {
  test('emballe le moteur avec l’origine, sans barre finale', () => {
    const lien = construireFavoriVentes(source, { origine: 'https://samtrackly.vercel.app/' })
    assert.ok(lien.startsWith('javascript:'))
    const code = decodeURIComponent(lien.slice('javascript:'.length))
    assert.ok(code.includes('moteurVentesYango().lancer({"origine":"https://samtrackly.vercel.app"})'))
  })
  test('refuse un code qui n’est pas le moteur', () => {
    assert.throws(() => construireFavoriVentes('alert(1)', { origine: 'https://x' }))
  })
})

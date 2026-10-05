// ──────────────────────────────────────────────────────────────────────────────
// Tests de lib/derniersRestesFournisseurs.js — le crédit veille des fournisseurs.
//
// Le bug d'origine : une requête non paginée, coupée à 1 000 lignes par
// Supabase. Le faux client ci-dessous applique la même coupure ; le test
// « au-delà de 1 000 lignes » échouait avec l'ancienne requête.
// ──────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { choisirDerniersRestes, chargerDerniersRestes, PAQUET_POINTS } from './derniersRestesFournisseurs.js'

/** Un faux client Supabase : filtres in/neq/eq/is, order, range, et la coupure à 1 000. */
function fauxSupabase(tables) {
  const appels = { points: [] }
  return {
    appels,
    from(nom) {
      let lignes = [...tables[nom]]
      let debut = 0, fin = Infinity
      const q = {
        select() { return q },
        in(col, vals) { if (nom === 'points') appels.points.push(vals.length); lignes = lignes.filter(l => vals.includes(l[col])); return q },
        // Comme en SQL : `point_id <> x` est faux quand point_id est vide.
        neq(col, v) { lignes = lignes.filter(l => l[col] != null && l[col] !== v); return q },
        eq(col, v) { lignes = lignes.filter(l => l[col] === v); return q },
        is(col, v) { lignes = lignes.filter(l => (l[col] ?? null) === v); return q },
        order(col) { lignes.sort((a, b) => (a[col] < b[col] ? -1 : 1)); return q },
        range(a, b) { debut = a; fin = b; return q },
        then(res) {
          const page = lignes.slice(debut, Math.min(fin + 1, debut + 1000))
          return Promise.resolve({ data: page, error: null }).then(res)
        },
      }
      return q
    },
  }
}

describe('choisirDerniersRestes', () => {

  test('la journée la plus récente gagne, quel que soit l’ordre des lignes', () => {
    const m = choisirDerniersRestes(
      [
        { fournisseur_id: 'f', point_id: 'p2', reste: 224000, saisi_par: 'caissier' },
        { fournisseur_id: 'f', point_id: 'p1', reste: 50000, saisi_par: 'gerant_caissier' },
      ],
      { p1: '2026-09-21', p2: '2026-09-22' }
    )
    assert.equal(m.f.reste, 224000)
  })

  test('à date égale : gerant_caissier > gerant > caissier', () => {
    const m = choisirDerniersRestes(
      [
        { fournisseur_id: 'f', point_id: 'p', reste: 1, saisi_par: 'caissier' },
        { fournisseur_id: 'f', point_id: 'p', reste: 3, saisi_par: 'gerant_caissier' },
        { fournisseur_id: 'f', point_id: 'p', reste: 2, saisi_par: 'gerant' },
      ],
      { p: '2026-09-22' }
    )
    assert.equal(m.f.reste, 3)
  })

  test('facture mensuelle : datée du 1er par date_point, après la veille', () => {
    const m = choisirDerniersRestes(
      [
        { fournisseur_id: 'f', point_id: 'p30', reste: 0, saisi_par: 'gerant' },
        { fournisseur_id: 'f', point_id: null, date_point: '2026-10-01', reste: 20000, saisi_par: 'mensuel' },
      ],
      { p30: '2026-09-30' }
    )
    assert.equal(m.f.reste, 20000)
  })

  test('facture mensuelle : la saisie du même jour passe après elle', () => {
    for (const ordre of [[0, 1], [1, 0]]) {
      const lignes = [
        { fournisseur_id: 'f', point_id: null, date_point: '2026-10-01', reste: 20000, saisi_par: 'mensuel' },
        { fournisseur_id: 'f', point_id: 'p1', reste: 0, saisi_par: 'caissier' },
      ]
      const m = choisirDerniersRestes(ordre.map(i => lignes[i]), { p1: '2026-10-01' })
      assert.equal(m.f.reste, 0)
    }
  })

  test('cotisation reçue (trésorerie, sans journée) : comptée à sa date', () => {
    // Bug d'origine : sans journée, elle n'était jamais « la plus récente » et
    // la remise au RH disparaissait du crédit veille dès le lendemain.
    const m = choisirDerniersRestes(
      [
        { fournisseur_id: 'f', point_id: 'p', reste: -50000, saisi_par: 'gerant' },
        { fournisseur_id: 'f', point_id: null, date_point: '2026-10-05', reste: 0, saisi_par: 'tresorerie' },
      ],
      { p: '2026-10-04' }
    )
    assert.equal(m.f.reste, 0)
  })

  test('deux lignes sans journée le même jour : la plus tardive gagne', () => {
    const m = choisirDerniersRestes(
      [
        { fournisseur_id: 'f', point_id: null, date_point: '2026-10-01', reste: 30000, saisi_par: 'tresorerie', created_at: '2026-10-01T15:00' },
        { fournisseur_id: 'f', point_id: null, date_point: '2026-10-01', reste: 20000, saisi_par: 'mensuel', created_at: '2026-10-01T08:00' },
      ],
      {}
    )
    assert.equal(m.f.reste, 30000)
  })

  test('même rang le même jour (deux caissiers) : la saisie la plus tardive gagne', () => {
    for (const ordre of [[0, 1], [1, 0]]) {
      const lignes = [
        { fournisseur_id: 'f', point_id: 'p', reste: 7, saisi_par: 'caissier', created_at: '2026-10-01T09:00' },
        { fournisseur_id: 'f', point_id: 'p', reste: 9, saisi_par: 'caissier', created_at: '2026-10-01T18:00' },
      ]
      const m = choisirDerniersRestes(ordre.map(i => lignes[i]), { p: '2026-10-01' })
      assert.equal(m.f.reste, 9)
    }
  })

  test('une ligne de journée sans date connue ne passe pas devant', () => {
    const m = choisirDerniersRestes(
      [
        { fournisseur_id: 'f', point_id: 'p', reste: 5, saisi_par: 'gerant' },
        { fournisseur_id: 'f', point_id: 'inconnu', date_point: '2026-12-01', reste: 99, saisi_par: 'gerant' },
      ],
      { p: '2026-09-22' }
    )
    assert.equal(m.f.reste, 5)
  })
})

describe('chargerDerniersRestes', () => {

  test('au-delà de 1 000 lignes, un fournisseur saisi en dernier garde son crédit', async () => {
    // 1 500 vieilles lignes d'un autre fournisseur, puis celle d'Ibrahim.
    const transactions = []
    for (let i = 0; i < 1500; i++) {
      transactions.push({ id: `a${String(i).padStart(5, '0')}`, fournisseur_id: 'autre', point_id: 'p_vieux', reste: 0, saisi_par: 'caissier' })
    }
    transactions.push({ id: 'z00001', fournisseur_id: 'ibrahim', point_id: 'p_veille', reste: 224000, saisi_par: 'gerant_caissier' })
    const sb = fauxSupabase({
      transactions_fournisseurs: transactions,
      points: [{ id: 'p_vieux', date: '2026-07-01' }, { id: 'p_veille', date: '2026-09-22' }],
    })
    const m = await chargerDerniersRestes(sb, ['autre', 'ibrahim'], 'p_jour')
    assert.equal(m.ibrahim?.reste, 224000)
  })

  test('le point courant est exclu', async () => {
    const sb = fauxSupabase({
      transactions_fournisseurs: [
        { id: '1', fournisseur_id: 'f', point_id: 'p_veille', reste: 10, saisi_par: 'caissier' },
        { id: '2', fournisseur_id: 'f', point_id: 'p_jour', reste: 99, saisi_par: 'caissier' },
      ],
      points: [{ id: 'p_veille', date: '2026-09-22' }, { id: 'p_jour', date: '2026-09-23' }],
    })
    const m = await chargerDerniersRestes(sb, ['f'], 'p_jour')
    assert.equal(m.f.reste, 10)
  })

  test('les dates des points sont demandées par paquets (URL trop longue sinon)', async () => {
    const transactions = [], points = []
    for (let i = 0; i < 400; i++) {
      transactions.push({ id: String(i).padStart(4, '0'), fournisseur_id: 'f', point_id: `p${i}`, reste: i, saisi_par: 'caissier' })
      points.push({ id: `p${i}`, date: `2026-01-01T${String(i).padStart(4, '0')}` })
    }
    const sb = fauxSupabase({ transactions_fournisseurs: transactions, points })
    const m = await chargerDerniersRestes(sb, ['f'])
    assert.equal(m.f.reste, 399)
    assert.ok(sb.appels.points.every(n => n <= PAQUET_POINTS))
  })

  test('la facture mensuelle (sans journée) compte malgré l’exclusion du point courant', async () => {
    const sb = fauxSupabase({
      transactions_fournisseurs: [
        { id: '1', fournisseur_id: 'app', point_id: 'p30', reste: 0, saisi_par: 'gerant' },
        { id: '2', fournisseur_id: 'app', point_id: null, date_point: '2026-10-01', reste: 20000, saisi_par: 'mensuel' },
        { id: '3', fournisseur_id: 'app', point_id: 'p_jour', reste: 0, saisi_par: 'gerant' },
      ],
      points: [{ id: 'p30', date: '2026-09-30' }, { id: 'p_jour', date: '2026-10-01' }],
    })
    const m = await chargerDerniersRestes(sb, ['app'], 'p_jour')
    assert.equal(m.app.reste, 20000)
  })

  test('sans point exclu, la facture mensuelle n’est chargée qu’une fois', async () => {
    const sb = fauxSupabase({
      transactions_fournisseurs: [
        { id: '2', fournisseur_id: 'app', point_id: null, date_point: '2026-10-01', reste: 20000, saisi_par: 'mensuel' },
      ],
      points: [],
    })
    const m = await chargerDerniersRestes(sb, ['app'])
    assert.equal(m.app.reste, 20000)
  })

  test('aucun fournisseur : aucune requête', async () => {
    assert.deepEqual(await chargerDerniersRestes(null, []), {})
  })
})

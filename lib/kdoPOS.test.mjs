import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { detailKdoShift, grouperKdoParService } from './kdoPOS.js'

const lignes = [
  { service: 'S1', ticket: 9224, heure: '2026-10-08T23:06:06.082+00:00', total: 1000, motif: 'chef adama',
    articles: [{ nom: 'Eau Céleste (Grande)', qte: 1, prix: 1000, supplements: [] }] },
  { service: 'S1', ticket: 9210, heure: '2026-10-08T21:54:07.101+00:00', total: 2500, motif: '  ',
    articles: [{ nom: 'Chawarma Mélange', qte: 2, prix: 1250, supplements: [{ nom: 'Frites', prix: 0 }, 'Fromage'] }] },
  { service: 'S2', ticket: 2190, heure: '2026-10-08T23:44:05.472+00:00', total: 2000, motif: 'Invité de la maison',
    articles: [] },
]

describe('rangement des commandes offertes', () => {
  test('groupe par service et trie par heure', () => {
    const r = grouperKdoParService(lignes)
    assert.deepEqual(Object.keys(r).sort(), ['S1', 'S2'])
    assert.deepEqual(r.S1.map(c => c.ticket), [9210, 9224])
    assert.equal(r.S1[0].heure, '21:54')
  })

  test('un motif vide devient null', () => {
    const r = grouperKdoParService(lignes)
    assert.equal(r.S1[0].motif, null)
    assert.equal(r.S1[1].motif, 'chef adama')
  })

  test('calcule le montant de chaque article et lit les suppléments', () => {
    const [art] = grouperKdoParService(lignes).S1[0].articles
    assert.equal(art.montant, 2500)
    assert.equal(art.qte, 2)
    assert.deepEqual(art.supplements, ['Frites', 'Fromage'])
  })

  test('résiste à une réponse vide ou invalide', () => {
    assert.deepEqual(grouperKdoParService(null), {})
    assert.deepEqual(grouperKdoParService([{ ticket: 1 }]), {})
  })
})

describe('KDO d’un shift', () => {
  const parService = grouperKdoParService(lignes)

  test('shift du POS : commandes et écart nul quand tout concorde', () => {
    const d = detailKdoShift({ kdo: '3500', pos_service_id: 'S1' }, parService)
    assert.equal(d.origine, 'pos')
    assert.equal(d.montant, 3500)
    assert.equal(d.commandes.length, 2)
    assert.equal(d.ecart, 0)
  })

  test('signale un écart entre le montant du shift et les commandes', () => {
    const d = detailKdoShift({ kdo: 4000, pos_service_id: 'S1' }, parService)
    assert.equal(d.ecart, 500)
  })

  test('shift saisi à la main : pas de détail', () => {
    const d = detailKdoShift({ kdo: 1500, pos_service_id: null }, parService)
    assert.equal(d.origine, 'manuel')
    assert.deepEqual(d.commandes, [])
  })
})

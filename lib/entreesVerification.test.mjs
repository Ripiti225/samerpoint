import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

let preparerEntreesVerification
try {
  ({ preparerEntreesVerification } = await import('./entreesVerification.js'))
} catch {
  // Premier passage TDD : le contrat n'existe pas encore.
}

describe('entrées affichées dans la vérification d’un point', () => {
  test('les réceptions POS remplacent entièrement les anciennes entrées', () => {
    assert.equal(typeof preparerEntreesVerification, 'function')

    const resultat = preparerEntreesVerification({
      inventaires: [{
        id: 'inv-pos', pos_service_id: 'service-pos', caissier_id: 'c1', type_shift: 'soir',
      }],
      entrees: [
        { inventaire_id: 'inv-pos', fournisseur_nom: 'Marché central', produit_nom: 'Poulet', quantite: 12 },
        { inventaire_id: 'inv-pos', fournisseur_nom: 'Marché central', produit_nom: 'Frites', quantite: 4 },
      ],
      shifts: [{ caissier_id: 'c1', caissier_nom: 'Awa' }],
      historiqueDisponible: true,
    })

    assert.deepEqual(resultat, {
      source: 'POS',
      nbEntrees: 2,
      groupes: [{
        fournisseur: 'Marché central',
        produits: [
          { nom: 'Frites', quantite: 4, auteur: 'Awa', shift: 'Shift Soir' },
          { nom: 'Poulet', quantite: 12, auteur: 'Awa', shift: 'Shift Soir' },
        ],
      }],
    })
  })

  test('une journée sans réception POS conserve l’ancien affichage historique', () => {
    const resultat = preparerEntreesVerification({
      inventaires: [{ id: 'inv-manuel', pos_service_id: null, caissier_id: 'c1', type_shift: 'matin' }],
      entrees: [{
        inventaire_id: 'inv-manuel', fournisseur_nom: 'Albert', produit_nom: 'Pain', quantite: 6,
      }],
      shifts: [{ caissier_id: 'c1', caissier_nom: 'Awa' }],
      historiqueDisponible: true,
    })

    assert.deepEqual(resultat, { source: 'HISTORIQUE', nbEntrees: 0, groupes: [] })
  })

  test('une journée vide ne crée pas de section artificielle', () => {
    assert.deepEqual(preparerEntreesVerification({
      inventaires: [], entrees: [], shifts: [], historiqueDisponible: false,
    }), { source: 'VIDE', nbEntrees: 0, groupes: [] })
  })
})

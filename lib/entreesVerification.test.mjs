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
        { inventaire_id: 'inv-pos', fournisseur_nom: 'Marché central', produit_id: 'POULET', produit_nom: 'Poulet', quantite: 12 },
        { inventaire_id: 'inv-pos', fournisseur_nom: 'Marché central', produit_id: 'FRITES', produit_nom: 'Frites', quantite: 4 },
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
          {
            nom: 'Frites', quantite: 4, auteur: 'Awa', shift: 'Shift Soir',
            inventaireId: 'inv-pos', produitId: 'FRITES', fournisseurNom: 'Marché central',
            quantiteOrigine: 4, correction: null,
          },
          {
            nom: 'Poulet', quantite: 12, auteur: 'Awa', shift: 'Shift Soir',
            inventaireId: 'inv-pos', produitId: 'POULET', fournisseurNom: 'Marché central',
            quantiteOrigine: 12, correction: null,
          },
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
  test('une entrée corrigée affiche la nouvelle quantité et garde l’origine', () => {
    const resultat = preparerEntreesVerification({
      inventaires: [{ id: 'inv-pos', pos_service_id: 's', caissier_id: 'c1', type_shift: 'matin' }],
      entrees: [
        { inventaire_id: 'inv-pos', fournisseur_nom: ' Boulangerie ', produit_id: 'PAIN', produit_nom: 'Pain', quantite: 6 },
        { inventaire_id: 'inv-pos', fournisseur_nom: 'Boulangerie', produit_id: 'PAIN', produit_nom: 'Pain', quantite: 4 },
      ],
      shifts: [{ caissier_id: 'c1', caissier_nom: 'Awa' }],
      corrections: [
        { inventaire_id: 'inv-pos', produit_id: 'PAIN', fournisseur_nom: 'Boulangerie', ancienne_quantite: 10, nouvelle_quantite: 15, delta: 5, raison: 'reçu', par: 'Ali', created_at: '2026-10-04T10:00:00Z' },
        { inventaire_id: 'inv-pos', produit_id: 'PAIN', fournisseur_nom: 'Boulangerie', ancienne_quantite: 15, nouvelle_quantite: 20, delta: 5, raison: 'reçu 2', par: 'Ali', created_at: '2026-10-04T11:00:00Z' },
        // Autre fournisseur : ne touche pas cette ligne.
        { inventaire_id: 'inv-pos', produit_id: 'PAIN', fournisseur_nom: null, ancienne_quantite: 0, nouvelle_quantite: 3, delta: 3, raison: 'x', par: 'Ali', created_at: '2026-10-04T12:00:00Z' },
      ],
    })
    const pain = resultat.groupes.find(g => g.fournisseur === 'Boulangerie').produits[0]
    assert.equal(pain.quantiteOrigine, 10)
    assert.equal(pain.quantite, 20)
    assert.equal(pain.fournisseurNom, 'Boulangerie')
    assert.deepEqual(pain.correction, { depuis: 10, vers: 20, raison: 'reçu 2', par: 'Ali', nb: 2 })
  })

  test('une correction sans réception POS correspondante n’invente pas de ligne', () => {
    const resultat = preparerEntreesVerification({
      inventaires: [{ id: 'inv-pos', pos_service_id: 's', caissier_id: 'c1', type_shift: 'matin' }],
      entrees: [{ inventaire_id: 'inv-pos', fournisseur_nom: null, produit_id: 'PAIN', produit_nom: 'Pain', quantite: 10 }],
      shifts: [],
      corrections: [{ inventaire_id: 'inv-pos', produit_id: 'COCA', fournisseur_nom: null, ancienne_quantite: 0, nouvelle_quantite: 2, delta: 2, raison: 'x', par: 'A', created_at: '2026-10-04T10:00:00Z' }],
    })
    assert.equal(resultat.groupes.length, 1)
    assert.equal(resultat.groupes[0].fournisseur, 'Sans fournisseur')
    assert.equal(resultat.groupes[0].produits.length, 1)
    assert.equal(resultat.groupes[0].produits[0].fournisseurNom, null)
  })
})

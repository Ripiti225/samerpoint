// ──────────────────────────────────────────────────────────────────────────────
// Résumé des litiges de plusieurs restaurants (sortie de chargerLitigesRestaurant,
// lib/litigesGlobal.js) : total par catégorie, par restaurant, et les personnes
// qui portent le plus de montants. Pur : testé par lib/litigesResume.test.mjs.
// Lu par le Dashboard global (onglet Litiges) et par l'écran Litiges.
// ──────────────────────────────────────────────────────────────────────────────

const n = v => Number(v) || 0

// Définition UNIQUE du « restaurant sans litige ». L'écran et le PDF avaient
// chacun la leur : un resto pouvait s'afficher « Aucun litige » dans l'app
// et sortir avec des lignes dans le rapport envoyé.
export function restoSansLitige(d) {
  return !d.ecartTotal && !d.invTotal && !d.avis.length && !d.yango.length
    && !d.glovo.length && !d.contactTotal && !d.pasFaitTotal
    && !d.responsables.length && !d.verifRetenu
}

// Catégories dans l'ordre de l'écran Litiges. Avis, Yango et Glovo peuvent
// être négatifs (bon avis, « tapé + ») : un montant en faveur du restaurant.
export const CATEGORIES_LITIGES = [
  { cle: 'ecart', nom: 'Écarts de caisse', icone: 'cash-remove', couleur: '#DC2626', champ: 'ecartTotal' },
  { cle: 'inventaire', nom: 'Inventaire', icone: 'package-variant-closed', couleur: '#D97706', champ: 'invTotal' },
  { cle: 'verif', nom: 'Comptage vérificateur', icone: 'magnify', couleur: '#B45309', champ: 'verifRetenu' },
  { cle: 'avis', nom: 'Avis clients', icone: 'star-outline', couleur: '#DB2777', champ: 'avisTotal' },
  { cle: 'yango', nom: 'Yango', icone: 'moped', couleur: '#E11D48', champ: 'yangoTotal' },
  { cle: 'glovo', nom: 'Glovo', icone: 'bike-fast', couleur: '#F59E0B', champ: 'glovoTotal' },
  { cle: 'contacts', nom: 'Contacts manquants', icone: 'phone-off-outline', couleur: '#7C3AED', champ: 'contactTotal' },
  { cle: 'pasFait', nom: 'Point pas fait', icone: 'cancel', couleur: '#475569', champ: 'pasFaitTotal' },
]

// Toutes les lignes qui portent un nom de personne et un montant.
function lignesNominatives(d) {
  return [
    ...(d.responsables || []).map(r => ({ nom: r.responsable_nom, montant: n(r.montant), cle: 'ecart' })),
    ...(d.invEnriched || []).map(s => ({ nom: s.caissier_nom, montant: n(s.montant_a_deduire), cle: 'inventaire' })),
    ...(d.verifLignes || []).map(l => ({ nom: l.caissier_nom, montant: n(l.montant), cle: 'verif' })),
    ...(d.avis || []).map(a => ({ nom: a.responsable_nom, montant: n(a.montant), cle: 'avis' })),
    ...(d.yango || []).map(y => ({ nom: y.responsable_nom, montant: n(y.montant), cle: 'yango' })),
    ...(d.glovo || []).map(g => ({ nom: g.responsable_nom, montant: n(g.montant), cle: 'glovo' })),
    ...(d.pasFait || []).map(p => ({ nom: p.responsable_nom, montant: n(p.montant), cle: 'pasFait' })),
  ].filter(l => l.nom && String(l.nom).trim() && l.montant)
}

/**
 * donnees : [{ restaurant, ecartTotal, …, total }] (un élément par restaurant).
 * Renvoie le total, les catégories non nulles, les restaurants concernés
 * (du plus gros au plus petit) et les personnes les plus chargées.
 */
export function resumeLitiges(donnees = [], { nbPersonnes = 5 } = {}) {
  const liste = donnees || []
  const total = liste.reduce((s, d) => s + n(d.total), 0)
  const categories = CATEGORIES_LITIGES
    .map(c => ({ ...c, montant: liste.reduce((s, d) => s + n(d[c.champ]), 0) }))
    .filter(c => c.montant !== 0)
    .sort((a, b) => b.montant - a.montant)

  const parResto = liste.filter(d => !restoSansLitige(d)).map(d => {
    const principale = CATEGORIES_LITIGES
      .map(c => ({ ...c, montant: n(d[c.champ]) }))
      .sort((a, b) => b.montant - a.montant)[0]
    return { id: d.restaurant?.id, nom: d.restaurant?.nom, couleur: d.restaurant?.couleur, total: n(d.total), principale }
  }).sort((a, b) => b.total - a.total)

  const parNom = new Map()
  for (const d of liste) {
    for (const l of lignesNominatives(d)) {
      const cle = String(l.nom).trim()
      const p = parNom.get(cle) || { nom: cle, montant: 0, nb: 0, restaurant: d.restaurant?.nom }
      p.montant += l.montant
      p.nb += 1
      parNom.set(cle, p)
    }
  }
  const personnes = [...parNom.values()].filter(p => p.montant > 0)
    .sort((a, b) => b.montant - a.montant).slice(0, nbPersonnes)

  return {
    total,
    categories,
    parResto,
    personnes,
    nbConcernes: parResto.length,
    contactsEnAttente: liste.reduce((s, d) => s + n(d.contactsEnAttente), 0),
  }
}

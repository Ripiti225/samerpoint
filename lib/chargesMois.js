// ──────────────────────────────────────────────────────────────────────────────
// Charges du mois d'un restaurant — source unique pour tous les écrans.
//
// Depuis le 01/10/2026, l'écran Charges est retiré : les charges se saisissent
// dans Trésorerie → À payer (loyer, salaires, CNPS, charges admin avec un mois).
// Pour ne rien perdre, l'ancien tableau `charges` reste pris en compte pour
// chaque couple (restaurant, mois) qui n'a AUCUNE ligne dans « À payer » :
// les mois passés gardent leurs charges, et rien n'est compté deux fois.
//
// Lignes rendues au format de l'ancien tableau : { restaurant_id, mois
// 'AAAA-MM', libelle, montant }. Tests : lib/chargesMois.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const LIBELLES = { loyer: 'Loyer', salaire: 'Salaires', cnps: 'CNPS' }
const CATEGORIES = ['loyer', 'salaire', 'cnps', 'admin']

// Mois (AAAA-MM) auquel un dû de trésorerie est rattaché.
export function moisDuDu(du) {
  if (du.mois) return du.mois.slice(0, 7)
  if (du.categorie === 'admin' && du.echeance) return du.echeance.slice(0, 7)
  return null
}

export function fusionnerCharges(anciennes = [], dus = []) {
  const depuisTreso = []
  for (const du of dus || []) {
    if (!CATEGORIES.includes(du.categorie)) continue // les dettes ne sont pas des charges
    const mois = moisDuDu(du)
    if (!mois) continue
    depuisTreso.push({
      restaurant_id: du.restaurant_id || null,
      mois,
      libelle: du.categorie === 'admin' ? du.libelle || 'Charge admin' : LIBELLES[du.categorie],
      montant: Number(du.montant_du) || 0,
      source: 'tresorerie',
    })
  }
  const couverts = new Set(depuisTreso.map(c => `${c.restaurant_id}|${c.mois}`))
  const gardees = (anciennes || [])
    .filter(c => !couverts.has(`${c.restaurant_id || null}|${c.mois}`))
    .map(c => ({ ...c, source: 'ancien' }))
  return [...gardees, ...depuisTreso]
}

// Charge les deux sources pour une liste de mois (AAAA-MM), éventuellement pour
// un seul restaurant. Sans les tables de trésorerie (migration pas passée), ne
// rend que l'ancien tableau.
export async function chargerChargesMois(supabase, mois, { restaurantId = null } = {}) {
  if (!mois?.length) return []
  const tries = [...mois].sort()
  const debut = `${tries[0]}-01`
  // Borne exclusive au 1er du mois suivant : « AAAA-02-31 » serait une date invalide.
  const [a0, m0] = tries[tries.length - 1].split('-').map(Number)
  const finExclue = `${m0 === 12 ? a0 + 1 : a0}-${String(m0 === 12 ? 1 : m0 + 1).padStart(2, '0')}-01`

  let qa = supabase.from('charges').select('id, restaurant_id, libelle, montant, mois').in('mois', mois)
  if (restaurantId) qa = qa.eq('restaurant_id', restaurantId)
  let qt = supabase.from('tresorerie_dus').select('id, categorie, restaurant_id, mois, echeance, libelle, montant_du')
    .in('categorie', CATEGORIES)
    .or(`and(mois.gte.${debut},mois.lt.${finExclue}),and(mois.is.null,echeance.gte.${debut},echeance.lt.${finExclue})`)
  if (restaurantId) qt = qt.eq('restaurant_id', restaurantId)

  const [a, t] = await Promise.all([qa.range(0, 9999), qt.range(0, 9999)])
  const voulus = new Set(mois)
  const dus = t.error ? [] : (t.data || [])
  return fusionnerCharges(a.data || [], dus).filter(c => voulus.has(c.mois))
}

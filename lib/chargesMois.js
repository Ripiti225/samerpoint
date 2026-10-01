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

// ── Résultat net : loyer, salaires, CNPS au mois du PAIEMENT ─────────────────
// Le loyer de juillet payé en octobre pèse sur octobre : on compte ce qui est
// sorti dans le mois (date du versement), pas ce qui était dû pour ce mois.
// Les charges admin restent au mois auquel elles sont rattachées.
//
// L'ancien tableau `charges` reste pris en compte, catégorie par catégorie,
// pour chaque (restaurant, mois) que « À payer » ne suit pas encore : un mois
// suivi dans À payer (dû créé ou paiement fait) n'est compté qu'au paiement,
// sinon le loyer de juillet compterait en juillet (ancien) ET en octobre.

export const CATEGORIES_AU_PAIEMENT = ['loyer', 'salaire', 'cnps']

// Catégorie d'une ligne de l'ancien tableau, d'après son libellé libre.
export function categorieAncienne(libelle) {
  const l = String(libelle || '').toLowerCase()
  if (l.includes('loyer')) return 'loyer'
  if (l.includes('salaire')) return 'salaire'
  if (l.includes('cnps')) return 'cnps'
  return 'autre'
}

// paiements : [{ montant, date, du: { categorie, restaurant_id, mois } }]
export function fusionnerChargesResultat(anciennes = [], dus = [], paiements = []) {
  const lignes = []
  const suivis = new Set()
  const cle = (r, m, c) => `${r || null}|${m}|${c}`

  for (const du of dus || []) {
    if (!CATEGORIES.includes(du.categorie)) continue
    const mois = moisDuDu(du)
    if (!mois) continue
    if (CATEGORIES_AU_PAIEMENT.includes(du.categorie)) {
      suivis.add(cle(du.restaurant_id, mois, du.categorie))
    } else {
      suivis.add(cle(du.restaurant_id, mois, 'autre'))
      lignes.push({
        restaurant_id: du.restaurant_id || null, mois, libelle: du.libelle || 'Charge admin',
        montant: Number(du.montant_du) || 0, source: 'tresorerie',
      })
    }
  }
  for (const p of paiements || []) {
    const du = p.du
    if (!du || !CATEGORIES_AU_PAIEMENT.includes(du.categorie) || !p.date) continue
    const mois = p.date.slice(0, 7)
    suivis.add(cle(du.restaurant_id, mois, du.categorie))
    if (du.mois) suivis.add(cle(du.restaurant_id, du.mois.slice(0, 7), du.categorie))
    lignes.push({
      restaurant_id: du.restaurant_id || null, mois,
      libelle: `${LIBELLES[du.categorie]}${du.mois && du.mois.slice(0, 7) !== mois ? ` (${du.mois.slice(0, 7)})` : ''}`,
      montant: Number(p.montant) || 0, source: 'tresorerie',
    })
  }
  const gardees = (anciennes || [])
    .filter(c => !suivis.has(cle(c.restaurant_id, c.mois, categorieAncienne(c.libelle))))
    .map(c => ({ ...c, source: 'ancien' }))
  return [...gardees, ...lignes]
}

// Charges du résultat net pour une liste de mois (AAAA-MM) : dus rattachés à
// ces mois, paiements faits pendant ces mois. Un paiement d'octobre pour
// juillet masque aussi l'ancien loyer de juillet (via son du.mois).
export async function chargerChargesResultat(supabase, mois) {
  if (!mois?.length) return []
  const tries = [...mois].sort()
  const debut = `${tries[0]}-01`
  const [a0, m0] = tries[tries.length - 1].split('-').map(Number)
  const finExclue = `${m0 === 12 ? a0 + 1 : a0}-${String(m0 === 12 ? 1 : m0 + 1).padStart(2, '0')}-01`

  const [a, t, p] = await Promise.all([
    supabase.from('charges').select('id, restaurant_id, libelle, montant, mois').in('mois', mois).range(0, 9999),
    supabase.from('tresorerie_dus').select('id, categorie, restaurant_id, mois, echeance, libelle, montant_du')
      .in('categorie', CATEGORIES)
      .or(`and(mois.gte.${debut},mois.lt.${finExclue}),and(mois.is.null,echeance.gte.${debut},echeance.lt.${finExclue})`)
      .range(0, 9999),
    supabase.from('tresorerie_paiements').select('montant, date, du:tresorerie_dus(categorie, restaurant_id, mois)')
      .gte('date', debut).lt('date', finExclue).order('date').order('id').range(0, 9999),
  ])
  const voulus = new Set(mois)
  return fusionnerChargesResultat(a.data || [], t.error ? [] : (t.data || []), p.error ? [] : (p.data || []))
    .filter(c => voulus.has(c.mois))
}

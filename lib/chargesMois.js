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

import { compteDansResultat } from './direction.js'

const LIBELLES = { loyer: 'Loyer', salaire: 'Salaires', cnps: 'CNPS', impot: 'Impôts', its: 'ITS', tee: 'TEE', bail: 'Contrat de bail' }
const CATEGORIES = ['loyer', 'salaire', 'cnps', 'impot', 'its', 'tee', 'bail', 'admin']

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

// ── Résultat net : au mois de la DATE LIMITE ─────────────────────────────────
// Une charge en série pèse sur le mois de sa date limite, payée ou non : le
// loyer de juin, dû début juillet, pèse sur juillet. Une ligne de l'ancien
// tableau `charges` est écartée quand la trésorerie suit déjà ce mois consommé
// pour ce restaurant et cette catégorie (sinon le loyer d'août compterait en
// août par l'ancien tableau ET en septembre par sa date limite). Les autres
// charges payées comptent au mois du paiement, si leur catégorie de dépense
// direction compte dans le résultat (réparation, matériel… d'un restaurant).

export const CATEGORIES_SERIE_RESULTAT = ['loyer', 'salaire', 'cnps', 'impot', 'its', 'tee', 'bail']

// Catégorie d'une ligne de l'ancien tableau, d'après son libellé libre.
export function categorieAncienne(libelle) {
  const l = String(libelle || '').toLowerCase()
  if (l.includes('loyer')) return 'loyer'
  if (l.includes('salaire')) return 'salaire'
  if (l.includes('cnps')) return 'cnps'
  return 'autre'
}

// paiementsAutres : [{ montant, date, du: { categorie, restaurant_id, categorie_direction, libelle } }]
export function fusionnerChargesResultat(anciennes = [], dus = [], paiementsAutres = []) {
  const lignes = []
  const suivis = new Set()
  const cle = (r, m, c) => `${r || null}|${m}|${c}`

  for (const du of dus || []) {
    if (CATEGORIES_SERIE_RESULTAT.includes(du.categorie)) {
      if (du.mois) suivis.add(cle(du.restaurant_id, du.mois.slice(0, 7), du.categorie))
      if (!du.echeance) continue
      lignes.push({
        restaurant_id: du.restaurant_id || null,
        mois: du.echeance.slice(0, 7),
        libelle: `${LIBELLES[du.categorie]}${du.mois ? ` (${du.mois.slice(0, 7)})` : ''}`,
        montant: Number(du.montant_du) || 0,
        source: 'tresorerie',
      })
    } else if (du.categorie === 'admin') {
      const mois = moisDuDu(du)
      if (!mois) continue
      suivis.add(cle(du.restaurant_id, mois, 'autre'))
      lignes.push({
        restaurant_id: du.restaurant_id || null, mois, libelle: du.libelle || 'Charge admin',
        montant: Number(du.montant_du) || 0, source: 'tresorerie',
      })
    }
  }
  for (const p of paiementsAutres || []) {
    const du = p.du
    if (!du || du.categorie !== 'autre' || !p.date) continue
    if (!compteDansResultat({ categorie: du.categorie_direction, restaurant_id: du.restaurant_id })) continue
    lignes.push({
      restaurant_id: du.restaurant_id, mois: p.date.slice(0, 7), libelle: du.libelle || 'Autre charge',
      montant: Number(p.montant) || 0, source: 'tresorerie',
    })
  }
  const gardees = (anciennes || [])
    .filter(c => !suivis.has(cle(c.restaurant_id, c.mois, categorieAncienne(c.libelle))))
    .map(c => ({ ...c, source: 'ancien' }))
  return [...gardees, ...lignes]
}

// Charges du résultat net pour une liste de mois (AAAA-MM) : dus dont le mois
// consommé OU la date limite tombe dans la plage, et paiements faits pendant la
// plage (pour les autres charges).
export async function chargerChargesResultat(supabase, mois) {
  if (!mois?.length) return []
  const tries = [...mois].sort()
  const debut = `${tries[0]}-01`
  const [a0, m0] = tries[tries.length - 1].split('-').map(Number)
  const finExclue = `${m0 === 12 ? a0 + 1 : a0}-${String(m0 === 12 ? 1 : m0 + 1).padStart(2, '0')}-01`
  const dansPlage = col => `and(${col}.gte.${debut},${col}.lt.${finExclue})`

  const [a, t, p] = await Promise.all([
    supabase.from('charges').select('id, restaurant_id, libelle, montant, mois').in('mois', mois).range(0, 9999),
    supabase.from('tresorerie_dus').select('id, categorie, restaurant_id, mois, echeance, libelle, montant_du')
      .in('categorie', CATEGORIES)
      .or(`${dansPlage('mois')},${dansPlage('echeance')}`)
      .range(0, 9999),
    supabase.from('tresorerie_paiements')
      .select('montant, date, du:tresorerie_dus(*)')
      .gte('date', debut).lt('date', finExclue).order('date').order('id').range(0, 9999),
  ])
  const voulus = new Set(mois)
  return fusionnerChargesResultat(a.data || [], t.error ? [] : (t.data || []), p.error ? [] : (p.data || []))
    .filter(c => voulus.has(c.mois))
}

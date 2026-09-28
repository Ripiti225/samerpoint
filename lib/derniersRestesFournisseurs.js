// ──────────────────────────────────────────────────────────────────────────────
// Le crédit de la veille d'un fournisseur = le `reste` de sa transaction la plus
// récente, par DATE DE JOURNÉE (points.date), hors point courant.
// Priorité à date égale : gerant_caissier > gerant > caissier.
//
// Pourquoi un module : trois écrans faisaient la même requête sans pagination
// (Déductions gérant, Fournisseurs, sauvegarde caissier). Supabase coupe en
// silence à 1 000 lignes ; au-delà, les fournisseurs dont les transactions
// tombaient hors de la page n'avaient plus AUCUN historique → crédit veille à 0
// (Al Kayan Yop, 1 589 transactions, septembre 2026 : Ibrahim, Coq ivoire…).
//
// Tests : lib/derniersRestesFournisseurs.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

export const PAGE_SUPABASE = 1000
// Les identifiants passent dans l'URL (`in.(…)`) : au-delà de quelques
// centaines d'UUID, la requête devient trop longue et échoue.
export const PAQUET_POINTS = 150

const SOURCE_PRIO = { gerant_caissier: 3, gerant: 2, caissier: 1 }

/** Choisit, par fournisseur, la transaction la plus récente (logique pure). */
export function choisirDerniersRestes(transactions = [], dateParPoint = {}) {
  const prevMap = {}
  ;(transactions || []).forEach(t => {
    const date = dateParPoint[t.point_id] || ''
    const ex = prevMap[t.fournisseur_id]
    const tp = SOURCE_PRIO[t.saisi_par] || 0
    const ep = ex ? (SOURCE_PRIO[ex.saisi_par] || 0) : -1
    if (!ex || date > ex.date || (date === ex.date && tp > ep)) {
      prevMap[t.fournisseur_id] = { reste: t.reste, date, saisi_par: t.saisi_par }
    }
  })
  return prevMap
}

/**
 * Charge TOUTES les transactions des fournisseurs (page par page) puis la date
 * de leurs points (par paquets), et rend { [fournisseur_id]: { reste, date, saisi_par } }.
 */
export async function chargerDerniersRestes(supabase, fournIds, pointIdExclu) {
  if (!fournIds?.length) return {}

  const transactions = []
  for (let debut = 0; ; debut += PAGE_SUPABASE) {
    let q = supabase
      .from('transactions_fournisseurs')
      .select('id, fournisseur_id, reste, saisi_par, point_id')
      .in('fournisseur_id', fournIds)
    if (pointIdExclu) q = q.neq('point_id', pointIdExclu)
    const { data, error } = await q
      .order('id', { ascending: true })   // ordre stable : sans ça, la pagination saute des lignes
      .range(debut, debut + PAGE_SUPABASE - 1)
    if (error) { console.error('[derniersRestes] transactions', error.message); break }
    if (!data?.length) break
    transactions.push(...data)
    if (data.length < PAGE_SUPABASE) break
  }

  const pointIds = [...new Set(transactions.map(t => t.point_id).filter(Boolean))]
  const dateParPoint = {}
  for (let i = 0; i < pointIds.length; i += PAQUET_POINTS) {
    const { data, error } = await supabase
      .from('points')
      .select('id, date')
      .in('id', pointIds.slice(i, i + PAQUET_POINTS))
    if (error) { console.error('[derniersRestes] points', error.message); continue }
    ;(data || []).forEach(p => { dateParPoint[p.id] = p.date })
  }

  return choisirDerniersRestes(transactions, dateParPoint)
}

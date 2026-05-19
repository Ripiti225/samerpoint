import { supabase } from './supabase'

// ──────────────────────────────────────────────
// Utilitaires date
// ──────────────────────────────────────────────
function getSemaine(dateStr) {
  const d = new Date(dateStr)
  const day = d.getDay() // 0=dim, 1=lun ...
  const diffLundi = day === 0 ? -6 : 1 - day
  const lundi = new Date(d)
  lundi.setDate(d.getDate() + diffLundi)
  const dimanche = new Date(lundi)
  dimanche.setDate(lundi.getDate() + 6)
  return {
    lundi: lundi.toISOString().split('T')[0],
    dimanche: dimanche.toISOString().split('T')[0],
  }
}

function getDatesRange(start, end) {
  const dates = []
  const current = new Date(start)
  const endDate = new Date(end)
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0])
    current.setDate(current.getDate() + 1)
  }
  return dates
}

function formatDateFr(dateStr) {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function fmt(n) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toLocaleString('fr-FR') + ' F'
}

// ──────────────────────────────────────────────
// Envoi notification rapport hebdo (via Expo push)
// ──────────────────────────────────────────────
async function envoyerNotifRapportHebdo(lundi, dimanche, venteTotal, beneficeTotal) {
  try {
    const { data: rows } = await supabase
      .from('admin_push_tokens')
      .select('token')
    if (!rows?.length) return

    const messages = rows.map(r => ({
      to: r.token,
      title: '📊 Rapport hebdomadaire disponible',
      body: `Semaine du ${formatDateFr(lundi)} au ${formatDateFr(dimanche)} : Ventes ${fmt(venteTotal)} · Bénéfice ${fmt(beneficeTotal)}`,
      sound: 'default',
    }))

    const BATCH = 100
    for (let i = 0; i < messages.length; i += BATCH) {
      try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(messages.slice(i, i + BATCH)),
        })
        const result = await response.json()
        const data = Array.isArray(result.data) ? result.data : [result.data]
        const toDelete = []
        data.forEach((item, idx) => {
          if (item?.status === 'error' &&
            (item.details?.error === 'DeviceNotRegistered' || item.details?.error === 'InvalidCredentials')) {
            const token = rows[i + idx]?.token
            if (token) toDelete.push(token)
          }
        })
        for (const token of toDelete) {
          await supabase.from('admin_push_tokens').delete().eq('token', token)
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// ──────────────────────────────────────────────
// Vérification et génération du rapport hebdo
// Appelé après chaque validation de point
// ──────────────────────────────────────────────
export async function verifierEtGenererRapportHebdo(datePoint) {
  try {
    const { lundi, dimanche } = getSemaine(datePoint)

    // Générer uniquement le dimanche (semaine complète)
    const jourSemaine = new Date(datePoint).getDay()
    if (jourSemaine !== 0) return null

    // Déjà généré ?
    const { data: existing } = await supabase
      .from('rapports_hebdomadaires')
      .select('id')
      .eq('semaine_debut', lundi)
      .maybeSingle()
    if (existing) return null

    // Tous les restaurants actifs
    const { data: restaurants } = await supabase
      .from('restaurants')
      .select('id, nom')
      .eq('actif', true)
    if (!restaurants?.length) return null

    // Points validés de toute la semaine
    const { data: points, error: pointsError } = await supabase
      .from('points')
      .select('id, date, restaurant_id, vente_total, benefice_sc, depense_total')
      .gte('date', lundi)
      .lte('date', dimanche)
      .eq('valide', true)

    if (pointsError) {
      console.error('[RapportHebdo] Erreur chargement points:', pointsError.message)
      return null
    }

    if (!points?.length) return null

    // Agrégation globale
    const venteTotal = Math.round(points.reduce((s, p) => s + (p.vente_total || 0), 0))
    const beneficeTotal = Math.round(points.reduce((s, p) => s + (p.benefice_sc || 0), 0))
    const depenseTotal = Math.round(points.reduce((s, p) => s + (p.depense_total || 0), 0))
    const nbPoints = points.length
    const nbRestaurants = new Set(points.map(p => p.restaurant_id)).size

    // Détail par restaurant
    const parResto = {}
    for (const p of points) {
      if (!parResto[p.restaurant_id]) {
        parResto[p.restaurant_id] = { venteTotal: 0, beneficeTotal: 0, depenseTotal: 0, nbJours: 0 }
      }
      parResto[p.restaurant_id].venteTotal += p.vente_total || 0
      parResto[p.restaurant_id].beneficeTotal += p.benefice_sc || 0
      parResto[p.restaurant_id].depenseTotal += p.depense_total || 0
      parResto[p.restaurant_id].nbJours++
    }

    const detailRestaurants = restaurants
      .filter(r => parResto[r.id])
      .map(r => ({
        id: r.id,
        nom: r.nom,
        venteTotal: Math.round(parResto[r.id].venteTotal),
        beneficeTotal: Math.round(parResto[r.id].beneficeTotal),
        depenseTotal: Math.round(parResto[r.id].depenseTotal),
        nbJours: parResto[r.id].nbJours,
      }))

    const rapport = {
      semaine_debut: lundi,
      semaine_fin: dimanche,
      nb_points: nbPoints,
      nb_restaurants: nbRestaurants,
      vente_total: venteTotal,
      benefice_total: beneficeTotal,
      depense_total: depenseTotal,
      detail_restaurants: detailRestaurants,
      genere_le: new Date().toISOString(),
    }

    const { data: inserted, error } = await supabase
      .from('rapports_hebdomadaires')
      .insert(rapport)
      .select()
      .single()

    if (error) {
      console.error('[RapportHebdo] Erreur insertion:', error.message)
      return null
    }

    envoyerNotifRapportHebdo(lundi, dimanche, venteTotal, beneficeTotal).catch(() => {})
    return inserted
  } catch (err) {
    console.error('[RapportHebdo] Erreur générale:', err)
    return null
  }
}

// ──────────────────────────────────────────────
// Chargement de l'historique des rapports
// ──────────────────────────────────────────────
export async function chargerRapports(limite = 20) {
  const { data, error } = await supabase
    .from('rapports_hebdomadaires')
    .select('*')
    .order('semaine_debut', { ascending: false })
    .limit(limite)

  if (error) {
    console.error('[chargerRapports] Erreur:', error.message)
    throw error
  }

  return (data || []).map(r => ({
    ...r,
    detail_restaurants: typeof r.detail_restaurants === 'string'
      ? (() => { try { return JSON.parse(r.detail_restaurants) } catch { return [] } })()
      : (Array.isArray(r.detail_restaurants) ? r.detail_restaurants : [])
  }))
}

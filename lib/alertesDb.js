// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — alertes : chargement des données et notification de M. Zreik.
//
// `verifierAlertesTresorerie` est appelée après chaque validation de point. Elle
// ne bloque jamais la validation : toute erreur est avalée (tables pas encore
// installées, réseau…). Une alerte n'est notifiée qu'une fois : sa clé est
// d'abord réservée dans tresorerie_alertes_envoyees ; si une autre validation
// l'a réservée en même temps, l'insertion échoue et on n'envoie rien.
// ──────────────────────────────────────────────────────────────────────────────
import { calculerAlertes, alertesNouvelles, moisTerminePrecedent } from './alertes'
import { resultatsParRestoMois } from './direction'
import { creerNotification } from './notificationsInterne'
import { supabase } from './supabase'
import { aujourdhuiISO } from './tresorerie'
import { chargerResultats } from './tresorerieDb'

function ilYa(iso, jours) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - jours)
  return d.toISOString().slice(0, 10)
}

export async function chargerAlertes() {
  const aujourdhui = aujourdhuiISO()
  const mois = moisTerminePrecedent(aujourdhui)

  const [plafondsR, cnpsR, restosR, pointsR] = await Promise.all([
    supabase.from('tresorerie_plafonds_fond').select('*'),
    supabase.from('tresorerie_dus').select('*').eq('categorie', 'cnps').range(0, 4999),
    supabase.from('restaurants').select('id, nom'),
    // Le dernier point de chaque restaurant date au plus de quelques jours.
    supabase.from('points').select('restaurant_id, date, fc_veille').gte('date', ilYa(aujourdhui, 10)).range(0, 4999),
  ])
  if (plafondsR.error) throw plafondsR.error
  if (cnpsR.error) throw cnpsR.error

  const cnps = cnpsR.data || []
  let paiements = []
  if (cnps.length) {
    const { data, error } = await supabase.from('tresorerie_paiements').select('du_id, montant')
      .in('du_id', cnps.map(d => d.id)).range(0, 9999)
    if (error) throw error
    paiements = data || []
  }

  const brut = await chargerResultats([mois])
  const resultats = resultatsParRestoMois({ ...brut, mois: [mois] })
  const noms = Object.fromEntries((restosR.data || []).map(r => [r.id, r.nom]))

  return calculerAlertes({
    resultats, cnps, paiements, points: pointsR.data || [], plafonds: plafondsR.data || [],
    aujourdhui, nomResto: id => noms[id] || 'Restaurant',
  })
}

// Destinataires : les propriétaires désignés ; à défaut, les managers.
async function destinataires() {
  const { data } = await supabase.from('tresorerie_droits').select('user_id').eq('niveau', 'proprietaire')
  return (data || []).map(d => d.user_id)
}

export async function verifierAlertesTresorerie() {
  try {
    const alertes = await chargerAlertes()
    if (!alertes.length) return
    const { data: envoyees } = await supabase.from('tresorerie_alertes_envoyees')
      .select('cle').in('cle', alertes.map(a => a.cle))
    const nouvelles = alertesNouvelles(alertes, (envoyees || []).map(e => e.cle))
    if (!nouvelles.length) return

    const proprios = await destinataires()
    for (const a of nouvelles) {
      const { error } = await supabase.from('tresorerie_alertes_envoyees').insert({ cle: a.cle, type: a.type, message: a.message })
      if (error) continue // déjà réservée par une autre validation
      const base = { type: 'tresorerie_alerte', titre: `⚠️ ${a.titre}`, message: a.message, screen: 'tresorerie' }
      if (proprios.length) {
        for (const id of proprios) await creerNotification({ ...base, cible_user_id: id })
      } else {
        await creerNotification({ ...base, cible_role: ['manager'] })
      }
    }
  } catch (_) {
    // Jamais bloquant : la validation du point a déjà réussi.
  }
}

export async function enregistrerPlafonds(plafonds) {
  const lignes = Object.entries(plafonds).map(([restaurant_id, plafond]) => ({
    restaurant_id, plafond, updated_at: new Date().toISOString(),
  }))
  if (!lignes.length) return
  const { error } = await supabase.from('tresorerie_plafonds_fond').upsert(lignes, { onConflict: 'restaurant_id' })
  if (error) throw error
}

export async function chargerPlafonds() {
  const { data, error } = await supabase.from('tresorerie_plafonds_fond').select('*')
  if (error) throw error
  return data || []
}

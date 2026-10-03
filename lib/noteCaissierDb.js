// ──────────────────────────────────────────────────────────────────────────────
// Chargement des données de la note des caissiers (lib/noteCaissier.js) : les
// 30 derniers jours ET les 30 jours d'avant (pour la flèche de progression),
// en une seule lecture découpée ensuite par dates.
//
// Toutes les listes sont paginées : au-delà de 1 000 lignes Supabase tronque
// SANS erreur (cf. mémoire « Supabase limite 1000 lignes »).
// ──────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { JOURS_PERIODE, calculerNotes } from './noteCaissier'
import { chargerVentesParService } from './statsPOSDb'

const PAGE = 1000

async function toutes(construire) {
  const lignes = []
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await construire().range(debut, debut + PAGE - 1)
    if (error) throw error
    lignes.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return lignes
}

const iso = d => d.toISOString().slice(0, 10)
function decaler(dateIso, jours) {
  const d = new Date(`${dateIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + jours)
  return iso(d)
}

/** Bornes des deux périodes : [debut, fin] et la précédente de même durée. */
export function periodesNote(aujourdhui = iso(new Date())) {
  const fin = aujourdhui
  const debut = decaler(fin, -(JOURS_PERIODE - 1))
  return { debut, fin, debutPrec: decaler(debut, -JOURS_PERIODE), finPrec: decaler(debut, -1) }
}

/**
 * Charge tout et calcule les notes des deux périodes.
 * restaurantId : limite aux shifts de ce restaurant (gérant), ou null (tous).
 * Renvoie { notes, notesPrec, restaurants, periodes, posErreur }.
 */
export async function chargerNotesCaissiers({ restaurantId = null } = {}) {
  const periodes = periodesNote()
  const { debutPrec, fin } = periodes
  const filtreResto = q => (restaurantId ? q.eq('restaurant_id', restaurantId) : q)

  const [shifts, inventaires, verifs, avis, yango, glovo, pasFait, absences, utilisateurs, restaurants, pos] = await Promise.all([
    toutes(() => filtreResto(supabase.from('points_shifts').select('*').eq('valide', true)
      .gte('date', debutPrec).lte('date', fin)).order('id')),
    toutes(() => filtreResto(supabase.from('inventaires_shifts').select('id, caissier_id, montant_a_deduire, date')
      .eq('valide', true).gte('date', debutPrec).lte('date', fin)).order('id')),
    toutes(() => filtreResto(supabase.from('deductions_verification').select('id, caissier_id, caissier_nom, montant, statut, date')
      .gte('date', debutPrec).lte('date', fin)).order('id')),
    toutes(() => filtreResto(supabase.from('litiges_avis_clients').select('id, type, responsable_id, responsable_nom, date')
      .gte('date', debutPrec).lte('date', fin)).order('id')),
    toutes(() => filtreResto(supabase.from('litiges_yango').select('id, type, responsable_id, responsable_nom, date')
      .gte('date', debutPrec).lte('date', fin)).order('id')),
    toutes(() => filtreResto(supabase.from('litiges_glovo').select('id, type, responsable_id, responsable_nom, date')
      .gte('date', debutPrec).lte('date', fin)).order('id')),
    toutes(() => filtreResto(supabase.from('litiges_point_pas_fait').select('id, responsable_id, responsable_nom, date')
      .gte('date', debutPrec).lte('date', fin)).order('id')),
    toutes(() => supabase.from('presences').select('id, travailleur_id, date').eq('statut', 'Absent')
      .gte('date', debutPrec).lte('date', fin).order('id')),
    toutes(() => supabase.from('utilisateurs').select('id, nom, travailleur_id, restaurant_id, role').order('id')),
    supabase.from('restaurants').select('id, nom, couleur').order('nom').then(r => r.data || []),
    chargerVentesParService({ debut: debutPrec, fin }),
  ])

  // Décisions de Vérification sur les écarts du POS (portées par le point).
  const pointIds = [...new Set(shifts.map(s => s.point_id).filter(Boolean))]
  const regularisations = []
  for (let i = 0; i < pointIds.length; i += 150) {
    const { data } = await supabase.from('points').select('id, ecart_regularisations').in('id', pointIds.slice(i, i + 150))
    for (const p of data || []) {
      for (const r of Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : []) {
        regularisations.push({ ...r, point_id: r.point_id || p.id })
      }
    }
  }

  const incidents = [
    ...avis.filter(a => a.type === 'mauvais' || a.type === 'bon')
      .map(a => ({ ...a, nature: a.type === 'bon' ? 'bon avis' : 'mauvais avis', bon: a.type === 'bon' })),
    ...yango.map(y => ({ ...y, nature: 'erreur Yango' })),
    ...glovo.map(g => ({ ...g, nature: 'erreur Glovo' })),
    ...pasFait.map(p => ({ ...p, nature: 'point pas fait' })),
  ].filter(i => i.responsable_id || (i.responsable_nom && String(i.responsable_nom).trim()))

  const dans = (debut, finP) => x => x.date >= debut && x.date <= finP
  const calcul = (debut, finP) => {
    const f = dans(debut, finP)
    return calculerNotes({
      shifts: shifts.filter(f), regularisations, inventaires: inventaires.filter(f), verifs: verifs.filter(f),
      incidents: incidents.filter(f), absences: absences.filter(f), utilisateurs, ventesParService: pos.parService,
    })
  }

  return {
    notes: calcul(periodes.debut, periodes.fin),
    notesPrec: calcul(periodes.debutPrec, periodes.finPrec),
    restaurants,
    periodes,
    posErreur: pos.erreur || null,
  }
}

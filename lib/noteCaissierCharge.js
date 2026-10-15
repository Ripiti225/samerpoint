// ──────────────────────────────────────────────────────────────────────────────
// Chargement + calcul de la note des caissiers (lib/noteCaissier.js), SANS
// dépendre de l'application : le client Supabase et la lecture des ventes du
// POS sont fournis par l'appelant.
//
// Deux appelants, un seul calcul :
//   - l'écran « Note des caissiers » (lib/noteCaissierDb.js) ;
//   - la fonction `publier-notes-pos`, qui envoie à chaque caissier sa note
//     sur la caisse (supabase/functions/publier-notes-pos).
// Ainsi la note affichée au POS est EXACTEMENT celle du back-office.
//
// Les 30 derniers jours ET les 30 jours d'avant (pour la flèche de
// progression), en une seule lecture découpée ensuite par dates. Toutes les
// listes sont paginées : au-delà de 1 000 lignes Supabase tronque SANS erreur.
// ──────────────────────────────────────────────────────────────────────────────
import { JOURS_PERIODE, calculerNotes } from './noteCaissier.js'
import { bonsAvisAttribues } from './avisResume.js'

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
export async function chargerEtCalculerNotes({ client, chargerVentes, restaurantId = null, debut = null, fin: finVoulue = null }) {
  const supabase = client
  // Par défaut les 30 derniers jours ; sinon la période demandée (ex. un mois
  // pour l'Analyse des Rapports), comparée à la période juste avant, de même durée.
  const periodes = debut && finVoulue
    ? (() => {
      const duree = Math.round((Date.parse(`${finVoulue}T12:00:00Z`) - Date.parse(`${debut}T12:00:00Z`)) / 86_400_000) + 1
      return { debut, fin: finVoulue, debutPrec: decaler(debut, -duree), finPrec: decaler(debut, -1) }
    })()
    : periodesNote()
  const { debutPrec, fin } = periodes
  const filtreResto = q => (restaurantId ? q.eq('restaurant_id', restaurantId) : q)

  const [shifts, inventaires, verifs, avis, yango, glovo, pasFait, absences, utilisateurs, restaurants, pos, bonsPlateformes] = await Promise.all([
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
    chargerVentes({ debut: debutPrec, fin }),
    toutes(() => filtreResto(supabase.from('platform_reviews').select('id, restaurant_id, classification, rating_raw, rating_scale, commande_le')
      .eq('classification', 'bon').not('commande_le', 'is', null)
      .gte('commande_le', `${debutPrec}T00:00:00Z`).lte('commande_le', `${fin}T23:59:59Z`)).order('id')),
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
    // Bons avis Glovo/Yango : au caissier présent à l'heure de la commande.
    ...bonsAvisAttribues(bonsPlateformes, shifts),
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

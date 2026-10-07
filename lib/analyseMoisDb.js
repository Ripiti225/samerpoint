// ──────────────────────────────────────────────────────────────────────────────
// Chargement de l'Analyse d'un mois (écran Rapports) : toutes les sources, en
// parallèle quand c'est possible. Chaque source qui manque (migration non
// passée, POS injoignable) est simplement absente : l'analyse reste lisible.
// Calculs : lib/analyseMois.js
// ──────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'
import { faitsDuMois, joursDuMois, lignesRestaurants, moisPrecedentDe, serieParJourDuMois, totauxMois } from './analyseMois'
import { resultatsParRestoMois } from './direction'
import { chargerLitigesRestaurant } from './litigesGlobal'
import { resumeLitiges } from './litigesResume'
import { chargerNotesCaissiers } from './noteCaissierDb'
import { chargerStatsPOS } from './statsPOSDb'
import { chargerResultats } from './tresorerieDb'

const PAGE = 1000
async function toutes(construire) {
  const out = []
  for (let i = 0; ; i += PAGE) {
    const { data, error } = await construire().range(i, i + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return out
}

const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Les 6 derniers mois, le plus récent d'abord (le mois en cours est marqué). */
export function moisProposes(nb = 6) {
  const auj = new Date()
  const out = []
  for (let i = 0; i < nb; i++) {
    const d = new Date(auj.getFullYear(), auj.getMonth() - i, 1)
    const mois = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ mois, enCours: i === 0, label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) })
  }
  return out
}

/**
 * Tout ce qu'il faut pour analyser un mois (AAAA-MM). Le mois en cours est
 * comparé au mois précédent à date égale (du 1er au même jour).
 */
export async function chargerAnalyse(mois, onProgres = () => {}) {
  const moisPrec = moisPrecedentDe(mois)
  const auj = new Date()
  const enCours = mois === isoLocal(auj).slice(0, 7)
  const jourCourant = enCours ? auj.getDate() : null
  const debut = `${mois}-01`
  const fin = enCours ? isoLocal(auj) : `${mois}-${joursDuMois(mois)}`
  const debutPrec = `${moisPrec}-01`
  const finPrec = `${moisPrec}-${String(enCours ? Math.min(jourCourant, joursDuMois(moisPrec)) : joursDuMois(moisPrec)).padStart(2, '0')}`

  onProgres('Ventes et restaurants…')
  let restos = await supabase.from('restaurants').select('id, nom, couleur, objectif_mensuel').order('nom')
  if (restos.error) restos = await supabase.from('restaurants').select('id, nom, couleur').order('nom')
  const restaurants = restos.data || []
  const champs = 'id, restaurant_id, date, valide, vente_total, vente_machine, depense_total, benefice_sc'
  const [points, pointsPrec] = await Promise.all([
    toutes(() => supabase.from('points').select(champs).gte('date', debut).lte('date', fin).order('id')),
    toutes(() => supabase.from('points').select(champs).gte('date', debutPrec).lte('date', finPrec).order('id')),
  ])

  onProgres('Résultat net, POS et équipe…')
  const [resultats, pos, posPrec, notes] = await Promise.all([
    chargerResultats([moisPrec, mois]).then(brut => resultatsParRestoMois({ ...brut, mois: [moisPrec, mois] })).catch(() => null),
    chargerStatsPOS({ debut, fin }).then(r => r.stats || null).catch(() => null),
    chargerStatsPOS({ debut: debutPrec, fin: finPrec }).then(r => r.stats || null).catch(() => null),
    chargerNotesCaissiers({ debut, fin }).then(r => r.notes).catch(() => []),
  ])

  onProgres('Litiges…')
  const litiges = await Promise.all(restaurants.map(r => chargerLitigesRestaurant(r, debut, fin).catch(() => null)))
    .then(l => l.filter(Boolean))

  const lignes = lignesRestaurants({ restaurants, points, pointsPrec, resultats, mois, moisPrec, litiges, pos, notes, jourCourant })
  const totaux = totauxMois(lignes)
  const resumeL = resumeLitiges(litiges)
  return {
    mois, moisPrec, enCours, jourCourant, debut, fin,
    lignes, totaux, pos, posPrec, notes, litiges: resumeL,
    serie: serieParJourDuMois(points, mois),
    seriePrec: serieParJourDuMois(pointsPrec, moisPrec),
    faits: faitsDuMois({ lignes, totaux, pos, posPrec, litiges: resumeL, notes, enCours }),
  }
}

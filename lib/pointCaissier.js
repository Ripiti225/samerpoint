// Les trois journées de l'écran « Point caissier » et le rangement des
// clôtures POS validées dans ces journées.
//
// Aucun accès réseau : la source reste `cloturesPOS()`, qui décide seule de
// ce qu'est une clôture POS (validée, dédoublonnée, écart global du rapport Z
// jamais remplacé par l'écart du tiroir). Ce module ne fait que dater et ordonner.
//
// Import avec l'extension `.js` : le module doit rester chargeable tel quel
// par `node lib/pointCaissier.test.mjs`, comme les autres modules purs.

import { cloturesPOS } from './cloturesCaisse.js'

const NB_JOURS = 3

// Date locale : sous le fuseau d'Abidjan, toISOString() ferait basculer la
// journée d'un shift de fin de soirée.
function isoLocal(date) {
  const an = date.getFullYear()
  const mois = String(date.getMonth() + 1).padStart(2, '0')
  const jour = String(date.getDate()).padStart(2, '0')
  return `${an}-${mois}-${jour}`
}

// Aujourd'hui + les deux jours calendaires précédents, du plus récent au plus
// ancien. Une journée sans shift reste dans la liste : l'écran l'affiche vide.
export function troisDerniersJours(dateRef = new Date()) {
  const jours = []
  for (let i = 0; i < NB_JOURS; i++) {
    const jour = new Date(dateRef.getFullYear(), dateRef.getMonth(), dateRef.getDate() - i)
    jours.push(isoLocal(jour))
  }
  return jours
}

// Un shift sans heure de début passe en dernier plutôt que de disparaître.
function comparerParHeure(a, b) {
  const ha = a.heure_debut || '99:99'
  const hb = b.heure_debut || '99:99'
  return ha.localeCompare(hb)
}

export function grouperShiftsParJour(shifts, dateRef = new Date()) {
  const jours = troisDerniersJours(dateRef)
  const parJour = new Map(jours.map(date => [date, []]))

  for (const cloture of cloturesPOS(shifts)) {
    const liste = parJour.get(cloture.date)
    if (liste) liste.push(cloture)
  }

  return jours.map(date => ({ date, shifts: parJour.get(date).sort(comparerParHeure) }))
}

// L'explication du caissier porte sur l'écart du comptage de caisse
// (points_shifts.ecart_pos, cf. le commentaire de la colonne) : c'est donc lui
// qui décide du badge, pas l'écart du rapport Z — toujours nul en base à ce jour.
// Un écart nul, ou absent, ne réclame aucune justification.
export function aBesoinExplication(cloture) {
  const ecart = cloture?.ecartEspeces
  if (typeof ecart !== 'number' || ecart === 0) return false
  return String(cloture?.explication_ecart || '').trim() === ''
}

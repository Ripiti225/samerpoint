// Présence d'un travailleur, affichée au gérant avant de le payer (Déductions → Paies).
// Purement informatif : un travailleur payé sans pointage du jour reste possible
// (paie d'un jour passé, pointage du shift pas encore remonté du POS).

export const JOURS_HISTORIQUE_PRESENCE = 14

export function dateIlYA(date, jours) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - jours)
  return d.toISOString().split('T')[0]
}

function jourMois(date) {
  const [, mois, jour] = date.split('-')
  return `${jour}/${mois}`
}

function plage(ligne) {
  if (ligne.heure_debut && ligne.heure_fin) return `${ligne.heure_debut}–${ligne.heure_fin}`
  if (ligne.heure_debut) return `depuis ${ligne.heure_debut}`
  return ''
}

/**
 * @param lignes     présences du restaurant sur la période (toutes dates confondues)
 * @param dateJour   journée en cours de saisie (AAAA-MM-JJ)
 * @returns (travailleurId) => { etiquette, ton, detail }
 *   « Pointage non reçu » si personne n'est pointé ce jour-là : on ne sait rien,
 *   et le travailleur ne doit pas paraître absent (KMS du 02 au 04/11 par exemple).
 */
export function indexerPresences(lignes, dateJour) {
  const duJour = (lignes || []).filter(l => l.date === dateJour)
  const pointageRecu = duJour.length > 0

  return travailleurId => {
    const siennes = duJour.filter(l => l.travailleur_id === travailleurId)
    const presentes = siennes.filter(l => l.statut === 'Présent')

    if (presentes.length > 0) {
      const plages = [...new Set(presentes.map(plage).filter(Boolean))]
      return { etiquette: 'Présent', ton: 'ok', detail: plages.join(', ') }
    }
    if (siennes.length > 0) {
      return { etiquette: siennes[0].statut, ton: siennes[0].statut === 'Absent' ? 'erreur' : 'alerte', detail: '' }
    }

    const derniere = (lignes || [])
      .filter(l => l.travailleur_id === travailleurId && l.statut === 'Présent' && l.date < dateJour)
      .reduce((max, l) => (l.date > max ? l.date : max), '')
    return {
      etiquette: pointageRecu ? 'Pas pointé' : 'Pointage non reçu',
      ton: pointageRecu ? 'alerte' : 'neutre',
      detail: derniere
        ? `Dernière présence ${jourMois(derniere)}`
        : `Aucune présence sur ${JOURS_HISTORIQUE_PRESENCE} jours`,
    }
  }
}

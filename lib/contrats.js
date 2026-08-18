// ──────────────────────────────────────────────────────────────────────────────
// Contrats de travail : Stage, CDD, CDI.
//
// Module pur — aucune fonction ne lit l'horloge : la date du jour est toujours
// passée en paramètre. C'est ce qui rend la désactivation automatique testable,
// et donc sûre : elle archive des gens.
//
// Les dates circulent en chaînes 'AAAA-MM-JJ'. Les comparer en chaîne est exact
// pour ce format, et évite le décalage d'un jour que provoque un objet Date lu
// dans le fuseau du navigateur.
// ──────────────────────────────────────────────────────────────────────────────

export const TYPES_CONTRAT = ['Stage', 'CDD', 'CDI']
export const DUREES_MOIS = [3, 6, 12]
export const PALIERS_ALERTE = [15, 7, 3]

const JOUR_MS = 24 * 60 * 60 * 1000

function versUTC(iso) {
  const [a, m, j] = String(iso).split('-').map(Number)
  return Date.UTC(a, m - 1, j)
}

export function aujourdhuiISO() {
  return new Date().toISOString().slice(0, 10)
}

export function ajouterJours(iso, n) {
  return new Date(versUTC(iso) + n * JOUR_MS).toISOString().slice(0, 10)
}

// 3 mois après le 31 janvier tombe sur un 31 avril qui n'existe pas : on
// retombe sur le dernier jour du mois plutôt que de déborder sur mai.
export function calculerDateFin(dateDebut, dureeMois) {
  if (!dateDebut || !dureeMois) return ''
  const [a, m, j] = String(dateDebut).split('-').map(Number)
  const total = (m - 1) + dureeMois
  const annee = a + Math.floor(total / 12)
  const mois = (total % 12) + 1
  const dernierJour = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  const jour = Math.min(j, dernierJour)
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}

// Une rupture anticipée prime toujours sur la date prévue.
export function finEffective(contrat) {
  if (!contrat) return null
  return contrat.cloture_le || contrat.date_fin || null
}

export function statutContrat(contrat, aujourdhui) {
  if (!contrat) return null
  if (aujourdhui < contrat.date_debut) return 'a_venir'
  const fin = finEffective(contrat)
  if (!fin) return 'en_cours'
  if (aujourdhui <= fin) return 'en_cours'
  return contrat.cloture_le ? 'rompu' : 'expire'
}

export function contratEnCours(contrats, aujourdhui) {
  return (contrats || []).find(c => statutContrat(c, aujourdhui) === 'en_cours') || null
}

export function joursRestants(contrat, aujourdhui) {
  const fin = finEffective(contrat)
  if (!fin) return null
  return Math.round((versUTC(fin) - versUTC(aujourdhui)) / JOUR_MS)
}

// Le palier applicable le plus haut non encore envoyé. Un contrat saisi à 5
// jours de sa fin reçoit J-7 tout de suite, au lieu d'attendre J-3.
export function palierAEnvoyer(contrat, aujourdhui) {
  if (!contrat || contrat.cloture_le || !contrat.date_fin) return null
  const restants = joursRestants(contrat, aujourdhui)
  if (restants === null || restants < 0) return null
  const envoyes = contrat.rappels_envoyes || []
  for (const palier of [...PALIERS_ALERTE].reverse()) {
    if (restants <= palier && !envoyes.includes(palier)) return palier
  }
  return null
}

// Trois verrous : il faut au moins un contrat (sinon le premier passage du cron
// archiverait les 130 travailleurs actifs), aucun contrat couvrant aujourd'hui,
// et aucun contrat à venir — le RH qui saisit le suivant avec trois jours de
// battement a signalé la continuité.
export function doitEtreDesactive(contrats, aujourdhui) {
  const liste = contrats || []
  if (liste.length === 0) return false
  if (contratEnCours(liste, aujourdhui)) return false
  if (liste.some(c => statutContrat(c, aujourdhui) === 'a_venir')) return false
  return true
}

export function validerFormulaireContrat(form) {
  const ko = erreur => ({ ok: false, erreur })
  if (!form?.type || !TYPES_CONTRAT.includes(form.type)) return ko('Choisis le type de contrat.')
  if (!form.date_debut) return ko('Indique la date de début du contrat.')
  if (!form.photo_url) return ko('La photo du contrat signé est obligatoire.')

  if (form.type === 'CDI') {
    if (form.date_fin) return ko("Un CDI n'a pas de date de fin.")
    return { ok: true, erreur: null }
  }
  if (!form.date_fin) return ko('Indique la durée, ou la date de fin du contrat.')
  if (form.date_fin < form.date_debut) return ko('La date de fin doit être après la date de début.')
  return { ok: true, erreur: null }
}

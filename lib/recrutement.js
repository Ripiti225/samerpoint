// ──────────────────────────────────────────────────────────────────────────────
// Demande de nouveau travailleur — le gérant propose, la RH valide.
//
// Module pur : aucune lecture de la base ni de l'horloge (voir
// lib/contratsSignesDb.js pour les écritures).
//
// Une demande peut partir incomplète (le gérant n'a pas toujours la CNI sous la
// main) mais jamais sans photo, nom, prénoms ni poste : sans eux, la RH ne sait
// pas qui elle embauche ni pour quoi faire.
// ──────────────────────────────────────────────────────────────────────────────

export const CIVILITES = ['M.', 'Mme']
export const SITUATIONS_FAMILLE = ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf(ve)']

export const STATUTS_DEMANDE_TRAV = {
  envoyee: { label: 'En attente RH', emoji: '🟡', couleur: '#B7791F' },
  acceptee: { label: 'Acceptée', emoji: '✅', couleur: '#3B8D2F' },
  refusee: { label: 'Refusée — à corriger', emoji: '❌', couleur: '#C2462B' },
}

const vide = v => v === null || v === undefined || String(v).trim() === ''

/**
 * { bloquants, incomplets } : libellés en français, dans l'ordre du formulaire.
 * Les bloquants empêchent l'envoi ; les incomplets sont signalés mais laissent
 * partir la demande.
 */
export function manquantsDemande(form) {
  const f = form || {}
  const bloquants = []
  if (vide(f.photo_url)) bloquants.push('Photo du travailleur')
  if (vide(f.nom_famille)) bloquants.push('Nom')
  if (vide(f.prenoms)) bloquants.push('Prénoms')
  if (vide(f.poste)) bloquants.push('Poste')

  const incomplets = []
  if (vide(f.civilite)) incomplets.push('Civilité')
  if (vide(f.date_naissance)) incomplets.push('Date de naissance')
  if (vide(f.lieu_naissance)) incomplets.push('Lieu de naissance')
  if (vide(f.nationalite)) incomplets.push('Nationalité')
  if (vide(f.situation_famille)) incomplets.push('Situation de famille')
  if (vide(f.cni_numero) && vide(f.nni_numero)) incomplets.push("Pièce d'identité (CNI ou NNI)")
  if (vide(f.lieu_residence)) incomplets.push('Lieu de résidence')
  if (vide(f.contact)) incomplets.push('Téléphone')
  if (vide(f.date_embauche)) incomplets.push("Date d'embauche")
  if (!(parseInt(f.salaire_journalier, 10) > 0)) incomplets.push('Salaire journalier')
  return { bloquants, incomplets }
}

// Numéros ivoiriens à 10 chiffres : l'indicatif 225 (ou 00225) est retiré.
export function normaliserTelephone(valeur) {
  let chiffres = String(valeur ?? '').replace(/\D/g, '')
  if (chiffres.startsWith('00225')) chiffres = chiffres.slice(5)
  else if (chiffres.startsWith('225') && chiffres.length > 10) chiffres = chiffres.slice(3)
  return chiffres
}

export function normaliserPiece(valeur) {
  return String(valeur ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Travailleur déjà connu (actif ou archivé) qui a la même CNI, le même NNI ou
 * le même téléphone. Une valeur vide ne correspond jamais à rien : deux
 * fiches sans téléphone ne sont pas la même personne.
 */
export function trouverDoublon(form, travailleurs) {
  const cni = normaliserPiece(form?.cni_numero)
  const nni = normaliserPiece(form?.nni_numero)
  const tel = normaliserTelephone(form?.contact)
  for (const t of travailleurs || []) {
    if (cni && normaliserPiece(t.cni_numero) === cni) return t
    if (nni && normaliserPiece(t.nni_numero) === nni) return t
    if (tel && normaliserTelephone(t.contact) === tel) return t
  }
  return null
}

// Format du champ `nom` de la fiche : « GBADIE Gogre Tanguy ».
export function nomComplet({ nom_famille, prenoms } = {}) {
  return [String(nom_famille ?? '').trim().toUpperCase(), String(prenoms ?? '').trim()].filter(Boolean).join(' ')
}

export function peutRenvoyer(demande) {
  return demande?.statut === 'refusee'
}

const arrondi = n => Math.round(n * 10) / 10

/**
 * Signature : liste de traits, chaque trait une liste de points [x, y] en
 * coordonnées relatives (0 à 1) au cadre. → chemin SVG à la taille voulue.
 */
export function traitsVersPath(traits, largeur, hauteur) {
  return (traits || [])
    .filter(t => Array.isArray(t) && t.length > 1)
    .map(t => t.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${arrondi(x * largeur)} ${arrondi(y * hauteur)}`).join(' '))
    .join(' ')
}

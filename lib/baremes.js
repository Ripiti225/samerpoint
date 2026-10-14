// ──────────────────────────────────────────────────────────────────────────────
// Barème par poste : les montants du contrat que la RH tape une fois pour un
// poste, et que l'application propose ensuite pour tous les contrats de ce
// poste (toujours modifiables).
//
// Deux familles : 'stage' (prime journalière) et 'contrat' (CDD et CDI :
// catégorie, salaire catégoriel, prime de tenue, indemnité de transport).
//
// Module pur — les lectures/écritures sont dans lib/contratsSignesDb.js.
// ──────────────────────────────────────────────────────────────────────────────

const CHAMPS_CONTRAT = ['categorie', 'salaire_categoriel', 'prime_tenue', 'indemnite_transport']
const CHAMPS_STAGE = ['prime_journaliere']

/**
 * Poste normalisé : minuscules, sans accents ni espaces superflus, au masculin.
 * « Caissière », « Caissier/re » et « Caissier » donnent « caissier ».
 */
export function clePoste(poste) {
  return String(poste ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\/\s*[a-z]+$/, '')        // « caissier/re », « serveur/se »
    .replace(/\(\s*[a-z]+\s*\)$/, '')   // « serveur(se) »
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/iere\b/g, 'ier')          // cuisinière, caissière
    .replace(/euse\b/g, 'eur')          // serveuse, plongeuse
}

export function familleDe(type) {
  return type === 'Stage' ? 'stage' : 'contrat'
}

export function baremePour(baremes, poste, type) {
  const cle = clePoste(poste)
  const famille = familleDe(type)
  return (baremes || []).find(b => b.cle_poste === cle && b.famille === famille) || null
}

const enNombre = v => (v === null || v === undefined || v === '' ? null : Number(v))

export function montantsDepuisBareme(ligne, type) {
  if (familleDe(type) === 'stage') return { prime_journaliere: ligne?.prime_journaliere ?? null }
  return {
    categorie: ligne?.categorie ?? '',
    salaire_categoriel: ligne?.salaire_categoriel ?? null,
    prime_tenue: ligne?.prime_tenue ?? null,
    indemnite_transport: ligne?.indemnite_transport ?? null,
  }
}

/** Vrai si les montants saisis ne sont pas ceux du barème (ou s'il n'y en a pas). */
export function differeDuBareme(ligne, montants, type) {
  if (!ligne) return true
  const champs = familleDe(type) === 'stage' ? CHAMPS_STAGE : CHAMPS_CONTRAT
  return champs.some(c => (c === 'categorie'
    ? String(ligne[c] ?? '').trim() !== String(montants?.[c] ?? '').trim()
    : enNombre(ligne[c]) !== enNombre(montants?.[c])))
}

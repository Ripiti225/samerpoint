// ──────────────────────────────────────────────────────────────────────────────
// Confronter deux termes A et B sans mentir.
//
// Quatre pièges, et c'est tout ce que fait ce module :
//
//   1. Un pourcentage qui bouge se compare en POINTS, jamais en pourcentage de
//      pourcentage. Un coût matières qui passe de 31 % à 37 % monte de 6 points,
//      pas de « 20 % ». Les deux sont arithmétiquement justes ; un seul est
//      compréhensible par un gérant.
//   2. A à zéro ne produit jamais de pourcentage. (b − a) / a est une division
//      par zéro, et le cas est réel : restaurant fermé, jour férié, pilier sans
//      donnée. On garde l'écart absolu et on écrit la phrase.
//   3. Aucun point saisi n'est pas zéro. « −100 % » se lirait comme un
//      effondrement là où personne n'a validé son point.
//   4. Une ligne peut être non comparable par nature — les charges fixes sur une
//      période partielle, § 6.2 de la conception. On l'affiche pour A seul, avec
//      sa raison, plutôt qu'un écart qui ne mesurerait que la différence de
//      loyer entre deux mois.
//
// La polarité décide de la COULEUR et de rien d'autre. La flèche et le signe
// redisent l'information, pour qui ne distingue pas le vert du rouge.
//
// Tests : lib/comparaisonDashboard.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { fmtFCFA } from './dashboardGlobal.js'

/** Monter est-il une bonne nouvelle ? Un mix de canaux, lui, n'a pas de sens. */
export const POLARITE = { BON: 'bon', MAUVAIS: 'mauvais', NEUTRE: 'neutre' }

/** Un montant se compare en %, un pourcentage se compare en points. */
export const UNITE = { MONTANT: 'montant', POURCENT: 'pourcent' }

/** Le moins typographique : « −21 % », pas « -21 % ». */
const MOINS = '−'

/** En dessous, l'affichage arrondirait à la même valeur : c'est égal. */
const EPSILON = { [UNITE.MONTANT]: 0.5, [UNITE.POURCENT]: 0.05 }

function nombre(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** « 6,2 » — décimale à la française. */
function decimal(n, chiffres = 1) {
  return n.toFixed(chiffres).replace('.', ',')
}

function signe(n, corps) {
  return (n < 0 ? MOINS : '') + corps
}

/**
 * L'écart d'un indicateur entre les deux termes.
 *
 * @param {object} spec
 * @param {string} spec.cle                identifiant stable (« ventes », « foodPct »…)
 * @param {string} spec.libelle            ce que lit le gérant (« Coût matières »)
 * @param {number} spec.a                  valeur du terme A
 * @param {number} spec.b                  valeur du terme B
 * @param {string} [spec.unite]            UNITE.MONTANT (défaut) ou UNITE.POURCENT
 * @param {string} [spec.polarite]         POLARITE.BON (défaut), MAUVAIS ou NEUTRE
 * @param {string} [spec.libelleA]         « Angré », « Ce mois »…
 * @param {string} [spec.libelleB]
 * @param {number} [spec.nbJoursA]         nombre de points saisis côté A
 * @param {number} [spec.nbJoursB]
 * @param {boolean} [spec.comparable]      false pour refuser la comparaison
 * @param {string} [spec.raison]           pourquoi, si comparable === false
 * @param {string} [spec.phraseZeroA]      la phrase à écrire quand A vaut 0
 */
export function ecart(spec = {}) {
  const {
    cle, libelle,
    unite = UNITE.MONTANT,
    polarite = POLARITE.BON,
    libelleA = 'A', libelleB = 'B',
    nbJoursA, nbJoursB,
    comparable, raison, phraseZeroA,
  } = spec
  const a = nombre(spec.a)
  const b = nombre(spec.b)

  const base = {
    cle, libelle, unite, polarite, a, b, libelleA, libelleB,
    delta: null, pct: null, points: null, ampleur: null,
    sens: 'egal', fleche: '=', couleur: null,
    comparable: true, message: null,
  }

  // 1. Refus explicite de l'appelant : charges fixes sur période partielle, etc.
  if (comparable === false) {
    return { ...base, comparable: false, message: raison || 'non comparable sur cette période' }
  }

  // 2. Un côté sans aucun point saisi : on ne sait pas, on ne calcule pas.
  const aSansPoint = nbJoursA === 0
  const bSansPoint = nbJoursB === 0
  if (aSansPoint || bSansPoint) {
    const message = aSansPoint && bSansPoint
      ? 'aucun point saisi de part et d’autre sur cette période'
      : `${aSansPoint ? libelleA : libelleB} : aucun point saisi sur cette période`
    return { ...base, comparable: false, message }
  }

  const delta = b - a
  const seuil = EPSILON[unite] ?? 0
  const sens = Math.abs(delta) < seuil ? 'egal' : (delta > 0 ? 'hausse' : 'baisse')
  const fleche = sens === 'hausse' ? '▲' : sens === 'baisse' ? '▼' : '='

  let couleur = null
  if (polarite !== POLARITE.NEUTRE && sens !== 'egal') {
    const bonneNouvelle = polarite === POLARITE.BON ? sens === 'hausse' : sens === 'baisse'
    couleur = bonneNouvelle ? 'bon' : 'mauvais'
  }

  // 3. Un pourcentage qui bouge se mesure en points.
  if (unite === UNITE.POURCENT) {
    return { ...base, delta, points: delta, ampleur: Math.abs(delta), sens, fleche, couleur }
  }

  // 4. A à zéro : l'écart absolu reste, le pourcentage non.
  if (a === 0) {
    return {
      ...base, delta, sens, fleche, couleur,
      message: phraseZeroA || `${libelleA} est à zéro sur cette période`,
    }
  }

  const pct = (delta / a) * 100
  return { ...base, delta, pct, ampleur: Math.abs(pct), sens, fleche, couleur }
}

/** Plusieurs indicateurs d'un coup, dans l'ordre donné. */
export function ecarts(specs = []) {
  return specs.map(ecart)
}

/**
 * L'écart, écrit comme il s'affiche : « ▼ 21 % », « ▲ 6,2 pts ».
 * Rien du tout si la comparaison a été refusée.
 */
export function formaterEcart(e) {
  if (!e || !e.comparable) return ''
  if (e.sens === 'egal') return '= identique'
  if (e.unite === UNITE.POURCENT) {
    return `${e.fleche} ${signe(e.points, decimal(Math.abs(e.points)) + ' pts')}`
  }
  if (e.pct === null) return ''
  return `${e.fleche} ${signe(e.pct, Math.round(Math.abs(e.pct)) + ' %')}`
}

/** L'écart en valeur : « −2 600 000 FCFA » ou « +6,2 pts ». */
export function formaterDelta(e) {
  if (!e || e.delta === null) return ''
  if (e.unite === UNITE.POURCENT) {
    return (e.delta > 0 ? '+' : e.delta < 0 ? MOINS : '') + decimal(Math.abs(e.delta)) + ' pts'
  }
  const montant = fmtFCFA(Math.abs(e.delta))
  return (e.delta > 0 ? '+' : e.delta < 0 ? MOINS : '') + montant
}

/** « qu'Angré », pas « que Angré » : l'élision devant voyelle ou h muet. */
function que(nom) {
  return /^[aàâeéèêëiîïoôuùûüyhAÀÂEÉÈÊËIÎÏOÔUÙÛÜYH]/.test(nom || '') ? `qu\u2019${nom}` : `que ${nom}`
}

/** « sur 25 jours » — la durée commune aux deux termes. */
function surDuree(nbJours) {
  if (!nbJours || nbJours < 1) return ''
  return nbJours === 1 ? ' sur la journée' : ` sur ${nbJours} jours`
}

/**
 * La bande de synthèse en tête du pilier : une phrase sur les ventes, puis les
 * trois plus gros écarts relatifs.
 *
 * Le classement met sur la même échelle un pourcentage d'écart (montants) et un
 * écart en points (taux) : six points de coût matières pèsent ici autant que
 * six pour cent de ventes. C'est un choix de hiérarchie, pas une conversion —
 * chaque ligne garde son unité à l'affichage.
 *
 * @param {object[]} liste   les écarts, dont un de clé « ventes »
 * @param {object} [options] { nbJours }
 * @returns {{phrase: string, lignes: object[]}}
 */
export function synthese(liste = [], { nbJours } = {}) {
  const ventes = liste.find(e => e?.cle === 'ventes')

  let phrase = ''
  if (!ventes) {
    phrase = ''
  } else if (!ventes.comparable) {
    phrase = ventes.message
  } else if (ventes.sens === 'egal') {
    phrase = `${ventes.libelleB} fait exactement autant ${que(ventes.libelleA)}${surDuree(nbJours)}.`
  } else {
    const sensMot = ventes.sens === 'hausse' ? 'de plus' : 'de moins'
    const montant = fmtFCFA(Math.abs(ventes.delta))
    const pourcent = ventes.pct === null
      ? ''
      : ` (${signe(ventes.pct, Math.round(Math.abs(ventes.pct)) + ' %')})`
    phrase = `${ventes.libelleB} fait ${montant} ${sensMot} ${que(ventes.libelleA)}${surDuree(nbJours)}${pourcent}.`
    if (ventes.pct === null && ventes.message) phrase += ` ${ventes.message}.`
  }

  const lignes = liste
    // Deux zéros n'ont rien à dire : c'est le cas d'un pilier dont les données
    // ne sont pas chargées, et ça ne doit pas occuper une des trois places.
    .filter(e => e && e.cle !== 'ventes' && e.comparable && e.ampleur !== null && (e.a !== 0 || e.b !== 0))
    .sort((x, y) => y.ampleur - x.ampleur)
    .slice(0, 3)

  return { phrase, lignes }
}

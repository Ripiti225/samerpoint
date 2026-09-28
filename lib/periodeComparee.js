// ──────────────────────────────────────────────────────────────────────────────
// La deuxième période d'une comparaison A / B n'est pas choisie : elle est
// déduite de la première.
//
// B = les mêmes jours, juste avant A. C'est la seule règle, et elle existe
// pour une raison arithmétique : si A et B n'ont pas la même durée, le
// pourcentage d'écart ne veut rien dire — et c'est ce pourcentage qu'on retient.
// Confronter « Ce mois » (25 jours écoulés) au « Mois précédent » (30 jours)
// fausserait l'écart d'un sixième.
//
// Conséquence assumée : « Mois préc. » n'est pas un terme B sélectionnable.
// C'est une période A comme les autres, et son B est alors le mois d'avant.
//
// La même règle est appliquée par la console du siège côté POS : deux écrans
// du même groupe ne doivent pas afficher deux vérités sur la même semaine.
//
// Tests : lib/periodeComparee.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const MS_JOUR = 86400000

/** Abréviations françaises usuelles — celles qui portent un point en portent un. */
const MOIS_COURT = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

const FORMAT_ISO = /^\d{4}-\d{2}-\d{2}$/

/** Un jour en millisecondes UTC : jamais de fuseau, sinon Abidjan décale d'un jour. */
function versUTC(iso) {
  if (typeof iso !== 'string' || !FORMAT_ISO.test(iso)) return null
  const [a, m, j] = iso.split('-').map(Number)
  const ms = Date.UTC(a, m - 1, j)
  const d = new Date(ms)
  // Rejette le 31 février et compagnie : Date.UTC les reporte en silence.
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return null
  return ms
}

function versISO(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Nombre de jours couverts, bornes incluses. Une journée seule vaut 1, pas 0.
 * @returns {number|null} null si l'une des bornes est invalide ou inversée.
 */
export function nombreDeJours(debut, fin) {
  const d = versUTC(debut)
  const f = versUTC(fin)
  if (d === null || f === null || f < d) return null
  return Math.round((f - d) / MS_JOUR) + 1
}

/**
 * Les bornes du terme B : la même durée que A, se terminant la veille de A.
 * Ni chevauchement (B finit avant que A commence) ni trou (B finit la veille).
 *
 * @returns {{debut: string, fin: string, nbJours: number}|null}
 */
export function periodePrecedente(debut, fin) {
  const n = nombreDeJours(debut, fin)
  if (n === null) return null
  const finB = versUTC(debut) - MS_JOUR
  const debutB = finB - (n - 1) * MS_JOUR
  return { debut: versISO(debutB), fin: versISO(finB), nbJours: n }
}

/**
 * Vrai seulement si la période couvre un mois calendaire du 1er au dernier jour.
 *
 * Sert au verdict du § 6.2 : la table `charges` est mensuelle, donc une ligne
 * de charges fixes n'est comparable que si les deux termes sont des mois
 * entiers. Sur 7 jours, on imputerait le loyer du mois complet.
 */
export function estMoisEntier(debut, fin) {
  const d = versUTC(debut)
  const f = versUTC(fin)
  if (d === null || f === null || f < d) return false
  const dd = new Date(d)
  const df = new Date(f)
  if (dd.getUTCDate() !== 1) return false
  if (dd.getUTCFullYear() !== df.getUTCFullYear() || dd.getUTCMonth() !== df.getUTCMonth()) return false
  const dernier = new Date(Date.UTC(df.getUTCFullYear(), df.getUTCMonth() + 1, 0)).getUTCDate()
  return df.getUTCDate() === dernier
}

/** « 25 oct. 2025 » — une date seule. */
export function libelleJour(iso) {
  const ms = versUTC(iso)
  if (ms === null) return ''
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MOIS_COURT[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * Les vraies dates d'une période, jamais un nom de mois.
 *
 * Le bandeau de comparaison écrit toujours ceci pour A comme pour B : « Mois
 * précédent » en face de « Ce mois » laisserait croire à deux périodes de même
 * nature alors que l'une est tronquée.
 *
 *   même mois   → « 1 → 25 oct. 2025 »
 *   même année  → « 6 sept. → 5 oct. 2025 »
 *   à cheval    → « 28 déc. 2024 → 3 janv. 2025 »
 */
export function libellePeriode(debut, fin) {
  const d = versUTC(debut)
  const f = versUTC(fin)
  if (d === null || f === null || f < d) return ''
  if (d === f) return libelleJour(debut)
  const dd = new Date(d)
  const df = new Date(f)
  const memeAnnee = dd.getUTCFullYear() === df.getUTCFullYear()
  const memeMois = memeAnnee && dd.getUTCMonth() === df.getUTCMonth()
  if (memeMois) {
    return `${dd.getUTCDate()} → ${df.getUTCDate()} ${MOIS_COURT[df.getUTCMonth()]} ${df.getUTCFullYear()}`
  }
  if (memeAnnee) {
    return `${dd.getUTCDate()} ${MOIS_COURT[dd.getUTCMonth()]} → ${df.getUTCDate()} ${MOIS_COURT[df.getUTCMonth()]} ${df.getUTCFullYear()}`
  }
  return `${libelleJour(debut)} → ${libelleJour(fin)}`
}

/** « les 25 jours précédents » — comment le terme B se nomme, par sa durée. */
export function libelleDuree(nbJours) {
  if (!nbJours || nbJours < 1) return ''
  if (nbJours === 1) return 'la journée précédente'
  return `les ${nbJours} jours précédents`
}

/**
 * Le bandeau complet des deux termes en mode « 2 périodes ».
 *
 * @returns {{a: {titre: string, dates: string, nbJours: number},
 *            b: {titre: string, dates: string, nbJours: number}}|null}
 */
export function bandeauDeuxPeriodes(debut, fin, titreA = '') {
  const b = periodePrecedente(debut, fin)
  if (!b) return null
  return {
    a: { titre: titreA, dates: libellePeriode(debut, fin), nbJours: b.nbJours },
    b: { titre: libelleDuree(b.nbJours), dates: libellePeriode(b.debut, b.fin), nbJours: b.nbJours },
  }
}

/**
 * Les mois « YYYY-MM » que la période touche, bornes incluses.
 *
 * La table `charges` est mensuelle : pour charger les charges d'une période, il
 * faut la liste de ses mois. Les déduire des points saisis raterait un mois
 * sans aucun point — et ferait disparaître son loyer.
 */
export function moisCouverts(debut, fin) {
  const d = versUTC(debut)
  const f = versUTC(fin)
  if (d === null || f === null || f < d) return []
  const mois = []
  let annee = new Date(d).getUTCFullYear()
  let m = new Date(d).getUTCMonth()
  const finAnnee = new Date(f).getUTCFullYear()
  const finMois = new Date(f).getUTCMonth()
  while (annee < finAnnee || (annee === finAnnee && m <= finMois)) {
    mois.push(`${annee}-${String(m + 1).padStart(2, '0')}`)
    m += 1
    if (m > 11) { m = 0; annee += 1 }
  }
  return mois
}

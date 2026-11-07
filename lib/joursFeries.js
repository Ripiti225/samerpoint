// ──────────────────────────────────────────────────────────────────────────────
// Jours fériés ivoiriens : liste par année et fichier .ics. Logique pure.
//
// Base : décret n° 96-205 du 7 mars 1996, modifié par le décret n° 2011-371.
// Les dates lunaires sont des ESTIMATIONS (calendrier Umm al-Qura) : la date
// officielle tombe quelques jours avant la fête et se corrige dans l'application.
// Conception : docs/superpowers/specs/2026-11-07-jours-feries-alertes-stock-design.md
// Tests : lib/joursFeries.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0')

export function ajouterJours(iso, n) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Dimanche de Pâques (calcul grégorien anonyme). */
export function datePaques(annee) {
  const a = annee % 19
  const b = Math.floor(annee / 100)
  const c = annee % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const q = h + l - 7 * m + 114
  return `${annee}-${pad(Math.floor(q / 31))}-${pad((q % 31) + 1)}`
}

const FIXES = [
  { cle: 'an', titre: "Jour de l'An", jour: '01-01' },
  { cle: 'travail', titre: 'Fête du Travail', jour: '05-01' },
  { cle: 'nationale', titre: 'Fête nationale', jour: '08-07' },
  { cle: 'assomption', titre: 'Assomption', jour: '08-15' },
  { cle: 'toussaint', titre: 'Toussaint', jour: '11-01' },
  { cle: 'paix', titre: 'Journée nationale de la Paix', jour: '11-15' },
  { cle: 'noel', titre: 'Noël', jour: '12-25' },
]

const CALCULEES = [
  { cle: 'lundi_paques', titre: 'Lundi de Pâques', decalage: 1 },
  { cle: 'ascension', titre: 'Ascension', decalage: 39 },
  { cle: 'lundi_pentecote', titre: 'Lundi de Pentecôte', decalage: 50 },
]

const TITRES_LUNAIRES = {
  nuit_destin: 'Lendemain de la Nuit du Destin',
  korite: 'Korité',
  tabaski: 'Tabaski',
  maouloud: 'Lendemain du Maouloud',
}

const DATES_LUNAIRES = {
  2026: { nuit_destin: '2026-03-17', korite: '2026-03-20', tabaski: '2026-05-27', maouloud: '2026-08-26' },
  2027: { nuit_destin: '2027-03-07', korite: '2027-03-09', tabaski: '2027-05-16', maouloud: '2027-08-15' },
  2028: { nuit_destin: '2028-02-24', korite: '2028-02-26', tabaski: '2028-05-05', maouloud: '2028-08-04' },
  2029: { nuit_destin: '2029-02-12', korite: '2029-02-14', tabaski: '2029-04-24', maouloud: '2029-07-25' },
  2030: { nuit_destin: '2030-02-01', korite: '2030-02-04', tabaski: '2030-04-13', maouloud: '2030-07-14' },
}

export const ANNEES_FERIES = Object.keys(DATES_LUNAIRES).map(Number)

export function joursFeriesAnnee(annee) {
  const paques = datePaques(annee)
  const lunaires = DATES_LUNAIRES[annee] || {}
  return [
    ...FIXES.map(f => ({ cle: f.cle, titre: f.titre, date: `${annee}-${f.jour}`, estimee: false })),
    ...CALCULEES.map(f => ({ cle: f.cle, titre: f.titre, date: ajouterJours(paques, f.decalage), estimee: false })),
    ...Object.entries(lunaires).map(([cle, date]) => ({ cle, titre: TITRES_LUNAIRES[cle], date, estimee: true })),
  ].sort((a, b) => a.date.localeCompare(b.date))
}

/** Année proposée à l'ouverture : celle en cours tant qu'il reste une fête, sinon la suivante. */
export function anneeParDefaut(aujourdhui) {
  const courante = Number(String(aujourdhui).slice(0, 4))
  if (ANNEES_FERIES.includes(courante) && joursFeriesAnnee(courante).some(f => f.date >= aujourdhui)) return courante
  return ANNEES_FERIES.find(a => a > courante) || ANNEES_FERIES[ANNEES_FERIES.length - 1]
}

export function lignesFeries(annee, creePar) {
  return joursFeriesAnnee(annee).map(f => ({
    titre: f.titre,
    date_evenement: f.date,
    note: f.cle === 'lundi_pentecote' ? 'Présence dans la liste officielle à confirmer.' : null,
    restaurant_id: null,
    chaque_annee: false,
    ferie_cle: f.cle,
    ferie_annee: annee,
    date_estimee: f.estimee,
    alerte_stock: true,
    cree_par_nom: creePar || null,
  }))
}

/**
 * Fêtes d'une année. Dès qu'une fête de cette année est en base, seules les
 * lignes en base comptent : une date corrigée la remplace, une fête supprimée
 * disparaît. Sinon, la liste de référence.
 */
export function listeDeLAnnee(annee, evenements) {
  const lignes = evenements.filter(e => e.ferie_cle && e.ferie_annee === annee)
  if (!lignes.length) return joursFeriesAnnee(annee).map(f => ({ ...f, evenement: null }))
  return lignes
    .map(e => ({
      cle: e.ferie_cle,
      titre: e.titre,
      date: String(e.date_evenement).slice(0, 10),
      estimee: !!e.date_estimee,
      evenement: e,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

const echapperIcs = t => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
const plier = l => (l.length <= 60 ? l : `${l.slice(0, 60)}\r\n ${plier(l.slice(60))}`)
const dateIcs = iso => iso.slice(0, 10).replace(/-/g, '')

function evenementIcs(f, horodatage, sequence) {
  const titre = `${f.titre}${f.estimee ? ' (date estimée)' : ''}`
  const rappel = (delai, jours) => [
    'BEGIN:VALARM', `TRIGGER:-P${jours}`, 'ACTION:DISPLAY',
    `DESCRIPTION:${echapperIcs(`${f.titre} dans ${delai}`)}`, 'END:VALARM',
  ]
  return [
    'BEGIN:VEVENT',
    `UID:ferie-${f.cle}-${f.date.slice(0, 4)}@samtrackly`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${horodatage}`,
    `DTSTART;VALUE=DATE:${dateIcs(f.date)}`,
    `DTEND;VALUE=DATE:${dateIcs(ajouterJours(f.date, 1))}`,
    `SUMMARY:${echapperIcs(titre)}`,
    ...rappel('7 jours', '6DT15H'),
    ...rappel('2 jours', '1DT15H'),
    'END:VEVENT',
  ]
}

/** `maintenant` : date ISO complète, passée en paramètre pour rester testable. */
export function fichierIcs(feries, maintenant) {
  const horodatage = `${maintenant.slice(0, 19).replace(/[-:]/g, '')}Z`
  const sequence = Math.floor(Date.parse(maintenant) / 60000)
  const lignes = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Samtrackly//Jours feries CI//FR', 'CALSCALE:GREGORIAN',
    ...feries.flatMap(f => evenementIcs(f, horodatage, sequence)),
    'END:VCALENDAR',
  ]
  return `${lignes.map(plier).join('\r\n')}\r\n`
}

export const nomFichierIcs = annee => `jours-feries-ci-${annee}.ics`

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** UTF-8 puis base64, sans dépendre de btoa ni de Buffer (web et téléphone). */
export function texteVersBase64(texte) {
  const code = encodeURIComponent(texte)
  const octets = []
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '%') { octets.push(parseInt(code.slice(i + 1, i + 3), 16)); i += 2 } else octets.push(code.charCodeAt(i))
  }
  let sortie = ''
  for (let i = 0; i < octets.length; i += 3) {
    const [a, b, c] = [octets[i], octets[i + 1], octets[i + 2]]
    sortie += ALPHABET[a >> 2]
    sortie += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]
    sortie += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]
    sortie += c === undefined ? '=' : ALPHABET[c & 63]
  }
  return sortie
}

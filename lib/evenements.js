// ──────────────────────────────────────────────────────────────────────────────
// Événements : anniversaires, ancienneté (années complètes seulement) et
// calendrier du groupe. Logique pure, sans import.
// Conception : docs/superpowers/specs/2026-11-07-evenements-design.md
// Tests : lib/evenements.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const ROLES_GROUPE = ['manager', 'directeur', 'rh']
export const voitToutLeGroupe = role => ROLES_GROUPE.includes(role)
export const peutVoirEvenements = role => voitToutLeGroupe(role) || role === 'gerant'

const pad = n => String(n).padStart(2, '0')
const bissextile = a => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0

function parties(iso) {
  const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number)
  return { a, m, j }
}

function ajouterJours(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function finDuMoisSuivant(iso) {
  const { a, m } = parties(iso)
  return new Date(Date.UTC(a, m + 1, 0)).toISOString().slice(0, 10)
}

/** La date d'anniversaire dans une année donnée ; le 29 février devient le 28 si besoin. */
export function dateDansAnnee(iso, annee) {
  const { m, j } = parties(iso)
  const jour = m === 2 && j === 29 && !bissextile(annee) ? 28 : j
  return `${annee}-${pad(m)}-${pad(jour)}`
}

/** Prochaine occurrence, aujourd'hui compris. */
export function prochaineDate(iso, aujourdhui) {
  const annee = parties(aujourdhui).a
  const cetteAnnee = dateDansAnnee(iso, annee)
  return cetteAnnee >= aujourdhui ? cetteAnnee : dateDansAnnee(iso, annee + 1)
}

export const SECTIONS = [
  { cle: 'aujourdhui', titre: "Aujourd'hui" },
  { cle: 'semaine', titre: '7 prochains jours' },
  { cle: 'mois', titre: 'Reste du mois' },
  { cle: 'suivant', titre: 'Mois suivant' },
]

export function sectionDe(date, aujourdhui) {
  if (date < aujourdhui) return null
  if (date === aujourdhui) return 'aujourdhui'
  if (date <= ajouterJours(aujourdhui, 7)) return 'semaine'
  if (date.slice(0, 7) === aujourdhui.slice(0, 7)) return 'mois'
  if (date <= finDuMoisSuivant(aujourdhui)) return 'suivant'
  return null
}

const estActif = t => !!t.actif && t.statut !== 'archive'

function lignesTravailleur(t, aujourdhui) {
  const lignes = []
  if (t.date_naissance) {
    const date = prochaineDate(t.date_naissance, aujourdhui)
    const age = parties(date).a - parties(t.date_naissance).a
    if (age >= 1) lignes.push({ cle: `anniversaire-${t.id}`, type: 'anniversaire', date, travailleur: t, age })
  }
  if (t.date_embauche) {
    const date = prochaineDate(t.date_embauche, aujourdhui)
    const annees = parties(date).a - parties(t.date_embauche).a
    if (annees >= 1) lignes.push({ cle: `anciennete-${t.id}`, type: 'anciennete', date, travailleur: t, annees })
  }
  return lignes
}

function ligneCalendrier(e, aujourdhui) {
  const debut = String(e.date_evenement).slice(0, 10)
  // Chaque année : jamais avant la date de départ de l'événement.
  const date = e.chaque_annee && debut <= aujourdhui ? prochaineDate(debut, aujourdhui) : debut
  return date >= aujourdhui ? { cle: `calendrier-${e.id}`, type: 'calendrier', date, evenement: e } : null
}

const nomLigne = l => l.travailleur?.nom || l.evenement?.titre || l.titre || ''
const comparerLignes = (a, b) => a.date.localeCompare(b.date) || nomLigne(a).localeCompare(nomLigne(b), 'fr') || a.type.localeCompare(b.type)

export function construireLignes({ travailleurs, evenements, aujourdhui }) {
  const lignes = [
    ...travailleurs.filter(estActif).flatMap(t => lignesTravailleur(t, aujourdhui)),
    ...evenements.map(e => ligneCalendrier(e, aujourdhui)).filter(Boolean),
  ]
  return lignes.sort(comparerLignes)
}

export const fusionnerLignes = (a, b) => [...a, ...b].sort(comparerLignes)

export const SECTION_RETARD = { cle: 'retard', titre: 'En retard' }
export const SECTION_PLUS_TARD = { cle: 'plusTard', titre: 'Plus tard' }
const FILTRES_AVEC_PLUS_TARD = ['calendrier', 'tresorerie', 'personnel', 'taches']

/** plusTard (direction et RH) : sous ces filtres, ajoute ce qui est au-delà du mois suivant. */
export function construireFil(lignes, aujourdhui, filtre = 'tout', { plusTard = false } = {}) {
  const gardees = filtre === 'tout' ? lignes : lignes.filter(l => l.type === filtre || l.famille === filtre)
  const sections = [
    { ...SECTION_RETARD, lignes: gardees.filter(l => l.retard) },
    ...SECTIONS.map(s => ({ ...s, lignes: gardees.filter(l => !l.retard && sectionDe(l.date, aujourdhui) === s.cle) })),
  ]
  if (plusTard && FILTRES_AVEC_PLUS_TARD.includes(filtre)) {
    const limite = finDuMoisSuivant(aujourdhui)
    sections.push({ ...SECTION_PLUS_TARD, lignes: gardees.filter(l => !l.retard && l.date > limite) })
  }
  return sections.filter(s => s.lignes.length > 0)
}

/** Un restaurant : ses travailleurs, ses événements et ceux de tout le groupe. */
export function dansRestaurant({ travailleurs, evenements }, restoId) {
  if (!restoId) return { travailleurs, evenements }
  return {
    travailleurs: travailleurs.filter(t => t.restaurant_id === restoId),
    evenements: evenements.filter(e => !e.restaurant_id || e.restaurant_id === restoId),
  }
}

export function compterAujourdhui(lignes, aujourdhui) {
  const compte = { anniversaire: 0, anciennete: 0, calendrier: 0, total: 0 }
  for (const l of lignes) {
    if (l.date !== aujourdhui) continue
    compte[l.type] += 1
    compte.total += 1
  }
  return compte
}

const pluriel = (n, mot, motPluriel = `${mot}s`) => `${n} ${n > 1 ? motPluriel : mot}`

export function texteRappel(c) {
  if (!c.total) return null
  const morceaux = [
    c.anniversaire && `🎂 ${pluriel(c.anniversaire, 'anniversaire')}`,
    c.anciennete && `🏅 ${pluriel(c.anciennete, 'ancienneté')}`,
    c.calendrier && `📅 ${pluriel(c.calendrier, 'événement')}`,
  ].filter(Boolean)
  return `${morceaux.join(' · ')} aujourd'hui`
}

export const nbSansNaissance = travailleurs => travailleurs.filter(t => estActif(t) && !t.date_naissance).length

export const texteAnnees = n => pluriel(n, 'an')

export function libelleJour(date, aujourdhui) {
  if (date === aujourdhui) return "Aujourd'hui"
  if (date === ajouterJours(aujourdhui, 1)) return 'Demain'
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

const prenomDe = t => String(t.prenoms || '').trim() || t.nom

/** Texte de départ du message ; l'utilisateur le modifie librement avant l'envoi. */
export function messagePour(ligne) {
  const t = ligne.travailleur
  const resto = t.restaurants?.nom
  if (ligne.type === 'anciennete') {
    return `Bonjour ${prenomDe(t)}, cela fait ${texteAnnees(ligne.annees)} que vous êtes avec nous${resto ? ` à ${resto}` : ''}. Merci pour votre travail et votre fidélité !`
  }
  return `Joyeux anniversaire ${prenomDe(t)} ! 🎂 Toute l'équipe${resto ? ` de ${resto}` : ''} vous souhaite une excellente journée.`
}

/** Numéro de la fiche → 225 + 10 chiffres ; null si le format est inconnu. Ne modifie jamais la fiche. */
export function numeroInternational(contact) {
  const chiffres = String(contact ?? '').replace(/\D/g, '')
  if (/^225\d{10}$/.test(chiffres)) return chiffres
  if (/^\d{10}$/.test(chiffres)) return `225${chiffres}`
  return null
}

export const lienWhatsApp = (numero, texte) => `https://wa.me/${numero}?text=${encodeURIComponent(texte)}`

export const lienSms = (numero, texte, ios) => `sms:+${numero}${ios ? '&' : '?'}body=${encodeURIComponent(texte)}`

export function erreurEvenement(form, aujourdhui) {
  if (!String(form.titre ?? '').trim()) return "Indiquez le titre de l'événement."
  if (!form.date_evenement) return 'Choisissez la date.'
  if (!form.chaque_annee && !form.ferie_cle && String(form.date_evenement).slice(0, 10) < aujourdhui) return 'Choisissez une date à venir.'
  return null
}

/** « Enregistré pour le JJ/MM/AAAA. » à partir de la date ISO, sans passer par Date. */
export function texteConfirmation(date) {
  const { a, m, j } = parties(date)
  return `Enregistré pour le ${pad(j)}/${pad(m)}/${a}.`
}

export function champsEvenement(form) {
  return {
    titre: String(form.titre).trim(),
    date_evenement: form.date_evenement,
    note: String(form.note ?? '').trim() || null,
    restaurant_id: form.restaurant_id || null,
    chaque_annee: !!form.chaque_annee,
    alerte_stock: !!form.alerte_stock,
    date_estimee: !!form.date_estimee,
  }
}

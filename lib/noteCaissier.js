// ──────────────────────────────────────────────────────────────────────────────
// Note des caissiers, sur 20, sur les 30 derniers jours.
//
// Jamais le volume de ventes : il dépend du restaurant, pas du caissier. Chaque
// critère est un TAUX, jugé avec les mêmes seuils pour tous (règles validées le
// 2026-10-03) :
//   Justesse de la caisse ....... 7  shifts sans manquant de plus de 500 F
//   Numéros des clients ......... 4  part des livraisons avec le numéro
//   Inventaire et comptage ...... 4  montants imputés par shift
//   Clients et plateformes ...... 3  mauvais avis, erreurs Yango/Glovo, point pas fait à son nom
//   Présence .................... 2  absences non justifiées
//   Bonus ventes additionnelles . +1 ticket moyen au-dessus de celui de son restaurant
//
// Garde-fous : minimum de shifts avant toute note ; un critère qui ne s'applique
// pas est neutre (ses points sont répartis sur les autres) ; ce qui est justifié
// ou annulé dans Vérification ne compte pas ; petite tolérance sur les écarts.
//
// Pur (aucun import React ni Supabase) : testé par lib/noteCaissier.test.mjs.
// Chargement : lib/noteCaissierDb.js. Spéc : docs/superpowers/specs/2026-10-03-note-caissiers-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { decisionEcartShiftPOS } from './ecartPOS.js'

export const BAREME = { caisse: 7, contacts: 4, inventaire: 4, clients: 3, presence: 2, bonus: 1 }
export const TOLERANCE_MANQUANT = 500
export const MIN_SHIFTS = 8
export const MIN_MESURES_CAISSE = 5
export const MIN_LIVRAISONS = 10
export const MIN_COMMANDES_TICKET = 50
export const JOURS_PERIODE = 30

const n = v => Number(v) || 0
const arrondi = (v, pas = 0.5) => Math.round(v / pas) * pas

/** « Gnapi  Bénédicte » → « gnapi benedicte » : pour rapprocher un nom saisi à la main. */
export function normaliserNom(nom) {
  return String(nom || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── Les critères ─────────────────────────────────────────────────────────────

/**
 * Justesse de la caisse : part des shifts mesurés sans manquant au-delà de la
 * tolérance. Le manquant retenu est celui qui reste après les décisions de
 * Vérification (justifié ou annulé = ne compte pas). Un surplus n'est pas une faute.
 */
export function critereCaisse(shifts, regularisations = []) {
  const max = BAREME.caisse
  const mesures = (shifts || []).filter(s => s?.ecart_pos !== null && s?.ecart_pos !== undefined && s?.ecart_pos !== '')
  const manquants = []
  for (const s of mesures) {
    const ecart = n(s.ecart_pos)
    if (ecart >= 0) continue
    const restant = decisionEcartShiftPOS(s, regularisations).restant
    if (restant > TOLERANCE_MANQUANT) manquants.push({ date: s.date, montant: restant })
  }
  if (mesures.length < MIN_MESURES_CAISSE) {
    return { cle: 'caisse', max, applicable: false, points: 0, mesures: mesures.length, manquants,
      resume: `${mesures.length} shift${mesures.length > 1 ? 's' : ''} mesuré${mesures.length > 1 ? 's' : ''} : pas assez pour juger`,
      conseil: null }
  }
  const justes = mesures.length - manquants.length
  const taux = justes / mesures.length
  const points = arrondi(max * taux)
  return {
    cle: 'caisse', max, applicable: true, points, taux, mesures: mesures.length, manquants,
    resume: `${justes} shift${justes > 1 ? 's' : ''} juste${justes > 1 ? 's' : ''} sur ${mesures.length} (${Math.round(taux * 100)} %)`,
    conseil: manquants.length
      ? `${manquants.length} manquant${manquants.length > 1 ? 's' : ''} de plus de ${TOLERANCE_MANQUANT} F, pour ${manquants.reduce((s, m) => s + m.montant, 0).toLocaleString('fr-FR')} F. Recomptez la caisse avant de clôturer.`
      : 'Aucun manquant : bravo.',
  }
}

/** Numéros des clients : part des livraisons (Yango + Glovo) où le numéro est noté. */
export function critereContacts(shifts) {
  const max = BAREME.contacts
  const livraisons = (shifts || []).reduce((s, x) => s + n(x.pos_nb_yango) + n(x.pos_nb_glovo), 0)
  const contacts = (shifts || []).reduce((s, x) => s + n(x.pos_nb_contacts), 0)
  if (livraisons < MIN_LIVRAISONS) {
    return { cle: 'contacts', max, applicable: false, points: 0, livraisons, contacts,
      resume: livraisons ? `${livraisons} livraison${livraisons > 1 ? 's' : ''} : pas assez pour juger` : 'Pas de livraison sur la période',
      conseil: null }
  }
  const taux = Math.min(1, contacts / livraisons)
  const pct = Math.round(taux * 100)
  const points = pct >= 95 ? 4 : pct >= 90 ? 3.5 : pct >= 80 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0
  return {
    cle: 'contacts', max, applicable: true, points, taux, livraisons, contacts,
    resume: `Numéro pris sur ${Math.min(contacts, livraisons)} livraisons sur ${livraisons} (${pct} %)`,
    conseil: pct >= 95 ? 'Numéro pris presque à chaque fois : parfait.'
      : `Il manque ${livraisons - Math.min(contacts, livraisons)} numéros. 4/4 à partir de 95 % des livraisons.`,
  }
}

/** Inventaire et comptage : montants imputés au caissier, ramenés par shift. */
export function critereInventaire({ nbShifts, montantInventaire = 0, montantVerif = 0 }) {
  const max = BAREME.inventaire
  const total = n(montantInventaire) + n(montantVerif)
  const parShift = nbShifts ? Math.round(total / nbShifts) : 0
  const points = parShift <= 300 ? 4 : parShift <= 750 ? 3 : parShift <= 1500 ? 2 : parShift <= 3000 ? 1 : 0
  return {
    cle: 'inventaire', max, applicable: nbShifts > 0, points, total, parShift,
    resume: total ? `${total.toLocaleString('fr-FR')} F imputés, soit ${parShift.toLocaleString('fr-FR')} F par shift` : 'Aucun écart d’inventaire à son nom',
    conseil: points === 4 ? 'Stock tenu : parfait.'
      : `4/4 jusqu’à 300 F par shift. Comptez avec soin et expliquez chaque écart.`,
  }
}

/**
 * Clients et plateformes : incidents à son nom (mauvais avis, erreurs Yango et
 * Glovo, point pas fait), ramenés à 20 shifts. Un bon avis rapporte 0,5 point.
 */
export function critereClients({ nbShifts, incidents = [], bonsAvis = 0 }) {
  const max = BAREME.clients
  const nb = incidents.length
  const pour20 = nbShifts ? (nb * 20) / nbShifts : 0
  const base = nb === 0 ? 3 : pour20 <= 1 ? 2 : pour20 <= 2 ? 1 : 0
  const points = Math.min(max, base + 0.5 * n(bonsAvis))
  return {
    cle: 'clients', max, applicable: nbShifts > 0, points, incidents, bonsAvis,
    resume: nb ? `${nb} incident${nb > 1 ? 's' : ''} à son nom${bonsAvis ? ` · ${bonsAvis} bon${bonsAvis > 1 ? 's' : ''} avis` : ''}`
      : `Aucun incident à son nom${bonsAvis ? ` · ${bonsAvis} bon${bonsAvis > 1 ? 's' : ''} avis` : ''}`,
    conseil: nb ? 'Vérifiez chaque commande de livraison avant de la taper.' : null,
  }
}

/** Présence : absences non justifiées (« Absent » ; malade, congé, permission ne comptent pas). */
export function criterePresence({ connu, absences = 0 }) {
  const max = BAREME.presence
  if (!connu) {
    return { cle: 'presence', max, applicable: false, points: 0, absences: 0,
      resume: 'Fiche employé non reliée : présence non notée', conseil: null }
  }
  const a = n(absences)
  const points = Math.max(0, max - 0.5 * a)
  return {
    cle: 'presence', max, applicable: true, points, absences: a,
    resume: a ? `${a} absence${a > 1 ? 's' : ''} non justifiée${a > 1 ? 's' : ''}` : 'Aucune absence non justifiée',
    conseil: a ? 'Prévenez et justifiez chaque absence (maladie, permission).' : null,
  }
}

/** Bonus : ticket moyen au-dessus de celui de son restaurant (jamais de pénalité). */
export function bonusVentes({ nbCommandes = 0, ticket = 0, ticketRestaurant = 0 }) {
  if (n(nbCommandes) < MIN_COMMANDES_TICKET || !n(ticketRestaurant)) {
    return { cle: 'bonus', max: BAREME.bonus, applicable: false, points: 0, resume: 'Pas assez de commandes pour comparer', ecart: null }
  }
  const ecart = n(ticket) / n(ticketRestaurant) - 1
  const points = ecart >= 0.10 ? 1 : ecart >= 0.05 ? 0.5 : 0
  const pct = Math.round(ecart * 100)
  return {
    cle: 'bonus', max: BAREME.bonus, applicable: true, points, ecart,
    resume: `Ticket moyen ${Math.round(n(ticket)).toLocaleString('fr-FR')} F, ${pct >= 0 ? '+' : ''}${pct} % par rapport au restaurant`,
    conseil: points < 1 ? 'Proposez une boisson ou un supplément : +10 % sur le ticket moyen = 1 point bonus.' : 'Très bonnes ventes additionnelles.',
  }
}

/**
 * Note sur 20 : les points des critères qui s'appliquent, ramenés sur 20, plus
 * le bonus, plafonnée à 20 et arrondie au demi-point.
 */
export function noteSur20(criteres, bonus) {
  const applicables = criteres.filter(c => c.applicable)
  const max = applicables.reduce((s, c) => s + c.max, 0)
  if (!max) return null
  const base = (applicables.reduce((s, c) => s + c.points, 0) / max) * 20
  return Math.min(20, arrondi(base + (bonus?.points || 0)))
}

export function appreciation(note) {
  if (note === null || note === undefined) return { mot: 'Pas encore noté', ton: 'gris' }
  if (note >= 17) return { mot: 'Excellent', ton: 'vert' }
  if (note >= 14) return { mot: 'Très bien', ton: 'vert' }
  if (note >= 12) return { mot: 'Bien', ton: 'bleu' }
  if (note >= 10) return { mot: 'Correct', ton: 'orange' }
  return { mot: 'À accompagner', ton: 'rouge' }
}

/**
 * Notes de tous les caissiers d'une période.
 * donnees = {
 *   shifts,               // points_shifts valides de la période
 *   regularisations,      // décisions de Vérification (points.ecart_regularisations aplaties, avec point_id)
 *   inventaires,          // inventaires_shifts { caissier_id, montant_a_deduire }
 *   verifs,               // deductions_verification { caissier_id, montant, statut }
 *   incidents,            // [{ responsable_id?, responsable_nom, nature, date, bon? }]
 *   absences,             // presences « Absent » { travailleur_id }
 *   utilisateurs,         // { id, nom, travailleur_id }
 *   ventesParService,     // { [pos_service_id]: { nb, ca, caissierPos } } (POS) ou {} : ticket moyen
 * }
 */
export function calculerNotes(donnees) {
  const { shifts = [], regularisations = [], inventaires = [], verifs = [], incidents = [], absences = [], utilisateurs = [], ventesParService = {} } = donnees || {}
  const users = new Map(utilisateurs.map(u => [u.id, u]))

  // Ticket moyen de chaque restaurant sur la période, tous caissiers confondus.
  const parResto = {}
  for (const s of shifts) {
    const v = s.pos_service_id ? ventesParService[s.pos_service_id] : null
    if (!v) continue
    const r = (parResto[s.restaurant_id] ||= { nb: 0, ca: 0 })
    r.nb += n(v.nb); r.ca += n(v.ca)
  }

  const parCaissier = new Map()
  const groupe = (cle, id) => {
    if (!parCaissier.has(cle)) parCaissier.set(cle, { cle, id, noms: new Set(), shifts: [], restos: {}, rapproches: new Set() })
    return parCaissier.get(cle)
  }
  const ajouter = (c, s) => {
    c.shifts.push(s)
    if (s.caissier_nom) c.noms.add(normaliserNom(s.caissier_nom))
    c.restos[s.restaurant_id] = (c.restos[s.restaurant_id] || 0) + 1
  }
  for (const s of shifts) {
    if (s.caissier_id) ajouter(groupe(`id:${s.caissier_id}`, s.caissier_id), s)
  }
  // Shifts arrivés du POS sans compte relié : on les rattache au compte du
  // caissier quand c'est sans ambiguïté, sinon un même caissier serait coupé en
  // deux (et pourrait ne jamais atteindre le minimum de shifts). Prudence :
  // même nom exact, ou tous les mots du compte dans le nom POS, dans le même
  // restaurant et avec un seul candidat. « Zan Lou Marlène Flora » de la
  // Palmeraie n'est donc jamais rattachée à « Flora » du 7E.
  for (const s of shifts) {
    if (s.caissier_id) continue
    const nomPos = normaliserNom(s.caissier_nom)
    const mots = new Set(nomPos.split(' ').filter(Boolean))
    let compte = utilisateurs.find(u => normaliserNom(u.nom) === nomPos)
    if (!compte && mots.size) {
      const candidats = utilisateurs.filter(u => {
        const motsCompte = normaliserNom(u.nom).split(' ').filter(Boolean)
        if (!motsCompte.length || !motsCompte.every(m => mots.has(m))) return false
        const restosDuCompte = new Set([u.restaurant_id, ...Object.keys(parCaissier.get(`id:${u.id}`)?.restos || {})])
        return restosDuCompte.has(s.restaurant_id)
      })
      if (candidats.length === 1) compte = candidats[0]
    }
    if (compte) {
      const c = groupe(`id:${compte.id}`, compte.id)
      ajouter(c, s)
      if (normaliserNom(s.caissier_nom) !== normaliserNom(compte.nom)) c.rapproches.add(String(s.caissier_nom).trim())
    } else {
      ajouter(groupe(`nom:${nomPos}`, null), s)
    }
  }

  return [...parCaissier.values()].map(c => {
    const user = c.id ? users.get(c.id) : null
    if (user?.nom) c.noms.add(normaliserNom(user.nom))
    const nom = (user?.nom || c.shifts.find(s => s.caissier_nom)?.caissier_nom || 'Inconnu').trim()
    const nbShifts = c.shifts.length
    const restaurantPrincipal = Object.entries(c.restos).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    const estLui = (id, nomBrut) => (c.id && id && String(id) === String(c.id)) || (nomBrut && c.noms.has(normaliserNom(nomBrut)))

    const caisse = critereCaisse(c.shifts, regularisations)
    const contacts = critereContacts(c.shifts)
    const inventaire = critereInventaire({
      nbShifts,
      montantInventaire: inventaires.filter(i => c.id && String(i.caissier_id) === String(c.id)).reduce((s, i) => s + n(i.montant_a_deduire), 0),
      montantVerif: verifs.filter(v => estLui(v.caissier_id, v.caissier_nom) && v.statut !== 'annulee').reduce((s, v) => s + n(v.montant), 0),
    })
    const siens = incidents.filter(i => estLui(i.responsable_id, i.responsable_nom))
    const clients = critereClients({ nbShifts, incidents: siens.filter(i => !i.bon), bonsAvis: siens.filter(i => i.bon).length })
    const presence = criterePresence({
      connu: !!user?.travailleur_id,
      absences: user?.travailleur_id ? absences.filter(a => String(a.travailleur_id) === String(user.travailleur_id)).length : 0,
    })

    // Ticket moyen : le sien (ses services de caisse), comparé à celui des
    // restaurants où il a travaillé, pondéré par ses commandes dans chacun.
    let nbCmd = 0, ca = 0, refPondere = 0
    for (const s of c.shifts) {
      const v = s.pos_service_id ? ventesParService[s.pos_service_id] : null
      const r = parResto[s.restaurant_id]
      if (!v || !r?.nb) continue
      nbCmd += n(v.nb); ca += n(v.ca); refPondere += n(v.nb) * (r.ca / r.nb)
    }
    const bonus = bonusVentes({ nbCommandes: nbCmd, ticket: nbCmd ? ca / nbCmd : 0, ticketRestaurant: nbCmd ? refPondere / nbCmd : 0 })

    const criteres = [caisse, contacts, inventaire, clients, presence]
    const assez = nbShifts >= MIN_SHIFTS
    const note = assez ? noteSur20(criteres, bonus) : null
    return {
      cle: c.cle, id: c.id, nom, nbShifts, restaurantId: restaurantPrincipal, criteres, bonus, note, assez, shifts: c.shifts,
      // Noms POS rattachés à ce compte (affichés dans la fiche, pour qu'on puisse vérifier).
      rapproches: [...c.rapproches],
      // Identifiants du caissier dans le POS : pour lui renvoyer sa note à la connexion.
      idsPos: [...new Set(c.shifts.map(x => ventesParService[x.pos_service_id]?.caissierPos).filter(Boolean))],
    }
  }).sort((a, b) => (b.note ?? -1) - (a.note ?? -1) || b.nbShifts - a.nbShifts)
}

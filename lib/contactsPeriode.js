// ──────────────────────────────────────────────────────────────────────────────
// Contacts clients pris sur une période — logique pure (écran Contacts).
//
// Source choisie JOUR PAR JOUR, pas par restaurant : un point dont un shift
// porte `pos_nb_contacts` est compté par le POS ; sinon par les
// `commandes.contact_client` non vides saisies dans Samtrackly. Jamais la somme
// des deux (les jours de transition seraient comptés deux fois). Ainsi les
// journées d'avant la bascule POS gardent leur compte historique, au lieu du
// « non transmis » que donnerait le choix par restaurant
// (cf. contactsViennentDuPOS dans lib/litigeContacts.js).
//
// Taux de prise = contacts ÷ commandes partenaires (Yango + Glovo) : comptées
// par le POS quand il les a transmises, sinon saisies par le gérant.
// Tests : lib/contactsPeriode.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const renseigne = v => v !== null && v !== undefined

/**
 * Une ligne par point (journée d'un restaurant).
 * points    : [{ id, date, restaurant_id, yango_nb_commandes, glovo_nb_commandes }]
 * shifts    : [{ point_id, pos_nb_contacts, pos_nb_yango, pos_nb_glovo }]
 * commandes : [{ point_id, contact_client }]
 */
export function contactsParPoint({ points = [], shifts = [], commandes = [] }) {
  const shiftsParPoint = {}
  for (const s of shifts) (shiftsParPoint[s.point_id] ||= []).push(s)
  const numerosParPoint = {}
  for (const c of commandes) {
    if (c.contact_client && String(c.contact_client).trim() !== '') numerosParPoint[c.point_id] = (numerosParPoint[c.point_id] || 0) + 1
  }

  return points.map(p => {
    const ss = shiftsParPoint[p.id] || []
    const pos = ss.filter(s => renseigne(s.pos_nb_contacts))
    const posCmd = ss.filter(s => renseigne(s.pos_nb_yango) || renseigne(s.pos_nb_glovo))
    const commandesPartenaires = posCmd.length
      ? posCmd.reduce((t, s) => t + (Number(s.pos_nb_yango) || 0) + (Number(s.pos_nb_glovo) || 0), 0)
      : (Number(p.yango_nb_commandes) || 0) + (Number(p.glovo_nb_commandes) || 0)
    return {
      point_id: p.id,
      date: p.date,
      restaurant_id: p.restaurant_id,
      source: pos.length ? 'pos' : 'samtrackly',
      contacts: pos.length ? pos.reduce((t, s) => t + Math.max(0, Number(s.pos_nb_contacts) || 0), 0) : (numerosParPoint[p.id] || 0),
      commandes: commandesPartenaires,
    }
  })
}

export function taux(contacts, commandes) {
  return commandes > 0 ? Math.round((contacts / commandes) * 100) : null
}

/** Totaux d'un ensemble de lignes. taux = null s'il n'y a eu aucune commande partenaire. */
export function totaux(lignes = []) {
  const contacts = lignes.reduce((t, l) => t + l.contacts, 0)
  const commandes = lignes.reduce((t, l) => t + l.commandes, 0)
  return { contacts, commandes, taux: taux(contacts, commandes), jours: new Set(lignes.map(l => l.date)).size }
}

/** Évolution en % de b vers a ; null si b est nul (pas de base de comparaison). */
export function evolution(a, b) {
  if (!b) return null
  return Math.round(((a - b) / b) * 100)
}

/** Classement par restaurant (vue « Tous »), du plus de contacts au moins. */
export function parRestaurant(lignesA = [], lignesB = [], restaurants = []) {
  return restaurants
    .map(r => {
      const a = totaux(lignesA.filter(l => l.restaurant_id === r.id))
      const b = totaux(lignesB.filter(l => l.restaurant_id === r.id))
      return { id: r.id, nom: r.nom, ...a, contactsAvant: b.contacts, evolution: evolution(a.contacts, b.contacts) }
    })
    .filter(r => r.contacts > 0 || r.contactsAvant > 0 || r.commandes > 0)
    .sort((x, y) => y.contacts - x.contacts)
}

const iso = ms => new Date(ms).toISOString().slice(0, 10)

/** Contacts de chaque jour de [debut, fin] (0 les jours sans donnée), dans l'ordre. */
export function parJour(lignes = [], debut, fin) {
  const parDate = {}
  for (const l of lignes) parDate[l.date] = (parDate[l.date] || 0) + l.contacts
  const out = []
  const [a, m, j] = debut.split('-').map(Number)
  for (let t = Date.UTC(a, m - 1, j); iso(t) <= fin; t += 86400000) out.push({ date: iso(t), contacts: parDate[iso(t)] || 0 })
  return out
}

// Types de commande du filtre de l'onglet Clients. Le POS écrit « YANGO »,
// l'ancienne saisie Samtrackly « Yango » : on regroupe. Tout le reste (Samer
// Delivery, Wave, OM…) tombe dans « Autres ».
export const CANAUX_CONTACT = [
  { cle: null, label: 'Tous' },
  { cle: 'yango', label: 'Yango' },
  { cle: 'glovo', label: 'Glovo' },
  { cle: 'autres', label: 'Autres' },
]

export function canalContact(partenaire) {
  const p = String(partenaire || '').toLowerCase()
  if (p.includes('yango')) return 'yango'
  if (p.includes('glovo')) return 'glovo'
  return 'autres'
}

/** « SAMER_DELLY » → « Samer Delly », « YANGO » → « Yango ». */
export function libellePartenaire(partenaire) {
  if (!partenaire) return 'Client'
  return String(partenaire).toLowerCase().split(/[_\s]+/).map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(' ')
}

/**
 * Numéros uniques d'une liste de commandes (onglet Clients), le plus récent
 * d'abord. Un numéro de moins de 8 chiffres est ignoré (saisie incomplète).
 * `canaux` : tous les types par lesquels ce client a commandé (un client
 * passé par Yango puis par Glovo apparaît sous les deux filtres).
 * commandes : [{ contact_client, partenaire, date, restaurant_id }]
 */
export function numerosUniques(commandes = []) {
  const vus = {}
  for (const c of commandes) {
    const num = String(c.contact_client || '').trim()
    if (num.replace(/\D/g, '').length < 8) continue
    const deja = vus[num]
    if (!deja) {
      vus[num] = {
        id: num, numero: num, partenaire: libellePartenaire(c.partenaire), dernier: c.date || '', fois: 1,
        restaurant_id: c.restaurant_id, canaux: [canalContact(c.partenaire)],
      }
    } else {
      deja.fois++
      const canal = canalContact(c.partenaire)
      if (!deja.canaux.includes(canal)) deja.canaux.push(canal)
      if ((c.date || '') > deja.dernier) { deja.dernier = c.date; deja.partenaire = libellePartenaire(c.partenaire) || deja.partenaire }
    }
  }
  return Object.values(vus).sort((a, b) => b.dernier.localeCompare(a.dernier) || b.fois - a.fois)
}

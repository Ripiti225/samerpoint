// ──────────────────────────────────────────────────────────────────────────────
// Analyse des clients — logique pure (onglet Analyse de l'écran Contacts).
//
// Un client = un numéro, ramené à une forme unique (cleNumero) : le même client
// est saisi « 0707070707 », « +225 07 07 07 07 07 » ou « +225+2250707070707 ».
// Tout l'historique compte (commandes Samtrackly d'avant le POS + numéros POS),
// filtré par restaurant si on en choisit un : un client du 7E et de Yop compte
// alors dans chacun.
//
// Les clients analysés sont ceux qui ont commandé pendant la période choisie,
// répartis en quatre groupes (un client peut être dans plusieurs) :
//   perdus   — plus aucune commande depuis DELAI_PERDU jours ;
//   uneFois  — une seule commande dans tout l'historique ;
//   fideles  — au moins SEUIL_FIDELE commandes dans tout l'historique ;
//   nouveaux — leur toute première commande tombe dans la période.
// Tests : lib/analyseClients.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { canalContact, libellePartenaire } from './contactsPeriode.js'

export const DELAI_PERDU = 21
export const SEUIL_FIDELE = 3

export const GROUPES_CLIENTS = [
  { cle: 'perdus', icone: '💤', titre: 'Perdus', sous: `Plus rien depuis ${DELAI_PERDU} jours` },
  { cle: 'uneFois', icone: '1️⃣', titre: 'Une seule commande', sous: 'Jamais revenus' },
  { cle: 'fideles', icone: '⭐', titre: 'Fidèles', sous: `${SEUIL_FIDELE} commandes ou plus` },
  { cle: 'nouveaux', icone: '🆕', titre: 'Nouveaux', sous: 'Première commande sur la période' },
]

/**
 * Forme unique d'un numéro : chiffres seuls, sans « 00 » ni indicatif 225 en
 * tête (répété parfois). null si moins de 8 chiffres (saisie incomplète).
 */
export function cleNumero(numero) {
  let d = String(numero || '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  while (d.startsWith('225') && d.length > 10) d = d.slice(3)
  return d.length >= 8 ? d : null
}

const MS_JOUR = 86400000
const versMs = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
export const joursEntre = (de, a) => Math.round((versMs(a) - versMs(de)) / MS_JOUR)

/**
 * Un profil par client, à partir de toutes ses commandes.
 * commandes : [{ contact_client, partenaire, date, restaurant_id }]
 * → [{ id, numero, fois, premiere, derniere, partenaire, restaurant_id, canaux, dates }]
 * numero / partenaire / restaurant_id : ceux de la commande la plus récente.
 */
export function profilsClients(commandes = []) {
  const parCle = {}
  for (const c of commandes) {
    const cle = cleNumero(c.contact_client)
    if (!cle || !c.date) continue
    const p = parCle[cle]
    const canal = canalContact(c.partenaire)
    if (!p) {
      parCle[cle] = {
        id: cle, numero: String(c.contact_client).trim(), fois: 1, premiere: c.date, derniere: c.date,
        partenaire: libellePartenaire(c.partenaire), restaurant_id: c.restaurant_id || null, canaux: [canal], dates: [c.date],
      }
      continue
    }
    p.fois++
    p.dates.push(c.date)
    if (!p.canaux.includes(canal)) p.canaux.push(canal)
    if (c.date < p.premiere) p.premiere = c.date
    if (c.date >= p.derniere) {
      p.derniere = c.date
      p.numero = String(c.contact_client).trim()
      p.partenaire = libellePartenaire(c.partenaire)
      p.restaurant_id = c.restaurant_id || p.restaurant_id
    }
  }
  return Object.values(parCle)
}

/**
 * Les clients de la période [debut, fin], répartis en groupes.
 * → { total, perdus, uneFois, fideles, nouveaux, perdusPossibles }
 * perdusPossibles = false si la période est trop récente pour qu'un client
 * y ait commandé puis soit resté DELAI_PERDU jours sans revenir.
 */
export function groupesClients(profils = [], { debut, fin, aujourdhui, delaiPerdu = DELAI_PERDU, seuilFidele = SEUIL_FIDELE }) {
  const periode = profils
    .filter(p => p.dates.some(d => d >= debut && d <= fin))
    .map(p => ({ ...p, depuis: joursEntre(p.derniere, aujourdhui) }))
  const recentsDabord = (a, b) => b.derniere.localeCompare(a.derniere) || b.fois - a.fois
  return {
    total: periode.length,
    // Les meilleurs clients perdus d'abord : ce sont eux qu'il faut rappeler.
    perdus: periode.filter(p => p.depuis >= delaiPerdu).sort((a, b) => b.fois - a.fois || b.derniere.localeCompare(a.derniere)),
    uneFois: periode.filter(p => p.fois === 1).sort(recentsDabord),
    fideles: periode.filter(p => p.fois >= seuilFidele).sort((a, b) => b.fois - a.fois || b.derniere.localeCompare(a.derniere)),
    nouveaux: periode.filter(p => p.premiere >= debut && p.premiere <= fin).sort(recentsDabord),
    perdusPossibles: joursEntre(debut, aujourdhui) >= delaiPerdu,
  }
}

/** Part d'un groupe dans les clients de la période, en % arrondi (null si aucun client). */
export function part(n, total) {
  return total > 0 ? Math.round((n / total) * 100) : null
}

/** « aujourd'hui », « hier », « il y a 12 jours ». */
export function ilYa(jours) {
  if (jours <= 0) return "aujourd'hui"
  if (jours === 1) return 'hier'
  return `il y a ${jours} jours`
}

// ──────────────────────────────────────────────────────────────────────────────
// Alertes de stock avant une fête : échéances, hausse réelle, textes,
// destinataires. Logique pure, partagée avec l'Edge Function alertes-stock.
// Jamais de quantité par produit : un chiffre réel de ventes, ou aucun chiffre.
// Conception : docs/superpowers/specs/2026-11-07-jours-feries-alertes-stock-design.md
// Tests : lib/alertesStock.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { construireLignes, dateDansAnnee } from './evenements.js'
import { ajouterJours, joursFeriesAnnee } from './joursFeries.js'
import { venteRetenue } from './venteMachine.js'

export const DELAIS_ALERTE = [7, 2]
export const DELAIS_ACCUEIL = [0, 1, 2, 3, 4, 5, 6, 7]

const ROLES_GROUPE = ['manager', 'directeur', 'rh']
const NB_REFERENCES = 4
const MIN_REFERENCES = 2
const SEUIL = 10

const anneeDe = iso => Number(String(iso).slice(0, 4))

function joursEntre(debut, fin) {
  return Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86400000)
}

export function elementsAlerte(evenements, aujourdhui, delais) {
  const avecAlerte = evenements.filter(e => e.alerte_stock)
  return construireLignes({ travailleurs: [], evenements: avecAlerte, aujourdhui })
    .map(l => ({ evenement: l.evenement, date: l.date, delai: joursEntre(aujourdhui, l.date) }))
    .filter(x => delais.includes(x.delai))
}

/** Date de la dernière édition, seulement si elle est sûre. */
export function editionPrecedente(evenement, date, evenements) {
  if (evenement.ferie_cle) {
    const annee = anneeDe(date) - 1
    const ligne = evenements.find(e => e.ferie_cle === evenement.ferie_cle && e.ferie_annee === annee)
    if (ligne) return ligne.date_estimee ? null : String(ligne.date_evenement).slice(0, 10)
    const reference = joursFeriesAnnee(annee).find(f => f.cle === evenement.ferie_cle)
    return reference && !reference.estimee ? reference.date : null
  }
  return evenement.chaque_annee ? dateDansAnnee(date, anneeDe(date) - 1) : null
}

export function joursReference(date) {
  const annee = anneeDe(date)
  const feries = new Set([...joursFeriesAnnee(annee), ...joursFeriesAnnee(annee - 1)].map(f => f.date))
  return Array.from({ length: NB_REFERENCES }, (_, i) => ajouterJours(date, -7 * (i + 1))).filter(d => !feries.has(d))
}

export function ventesParRestaurant(points) {
  const ventes = {}
  for (const p of points) {
    ventes[p.restaurant_id] = ventes[p.restaurant_id] || {}
    ventes[p.restaurant_id][String(p.date).slice(0, 10)] = venteRetenue(p)
  }
  return ventes
}

function chiffresFete(ventes, date) {
  const fete = ventes[date]
  if (!fete) return null
  const references = joursReference(date).map(d => ventes[d]).filter(v => v > 0)
  if (references.length < MIN_REFERENCES) return null
  return { fete, moyenne: references.reduce((s, v) => s + v, 0) / references.length }
}

const pourcentage = (fete, moyenne) => Math.round(((fete - moyenne) / moyenne) * 100)

export function hausseRestaurant(ventes, date) {
  const c = chiffresFete(ventes, date)
  return c ? pourcentage(c.fete, c.moyenne) : null
}

export function hausseGroupe(ventesParResto, date) {
  const chiffres = Object.values(ventesParResto).map(v => chiffresFete(v, date)).filter(Boolean)
  if (!chiffres.length) return { pct: null, nb: 0 }
  const fete = chiffres.reduce((s, c) => s + c.fete, 0)
  const moyenne = chiffres.reduce((s, c) => s + c.moyenne, 0)
  return { pct: pourcentage(fete, moyenne), nb: chiffres.length }
}

/** Les seules dates de ventes à lire pour calculer les chiffres. */
export function datesUtiles(elements, evenements) {
  const dates = new Set()
  for (const { evenement, date } of elements) {
    const precedente = editionPrecedente(evenement, date, evenements)
    if (!precedente) continue
    dates.add(precedente)
    for (const d of joursReference(precedente)) dates.add(d)
  }
  return [...dates].sort()
}

function delaiEnClair(delai) {
  if (delai === 0) return "aujourd'hui"
  if (delai === 1) return 'demain'
  if (delai === 2) return 'après-demain'
  return `dans ${delai} jours`
}

export function titreAlerte(titre, delai, estimee) {
  return `📦 ${titre} ${delaiEnClair(delai)}${estimee ? ' (date estimée)' : ''}`
}

export function corpsAlerte({ pct, nb }) {
  if (pct === null || pct === undefined) return 'Pensez à vérifier et rehausser le stock.'
  const portee = nb ? ` (${nb} restaurant${nb > 1 ? 's' : ''})` : ''
  if (pct >= SEUIL) return `L'an dernier ce jour-là : +${pct} % de ventes${portee}. Pensez à rehausser le stock.`
  if (pct <= -SEUIL) return `L'an dernier ce jour-là : −${-pct} % de ventes${portee}. Vérifiez votre stock avant de commander.`
  return `L'an dernier ce jour-là : ventes proches d'un jour normal${portee}. Vérifiez votre stock.`
}

function concerne(utilisateur, evenement) {
  if (ROLES_GROUPE.includes(utilisateur.role)) return true
  if (utilisateur.role !== 'gerant' || !utilisateur.restaurant_id) return false
  return !evenement.restaurant_id || evenement.restaurant_id === utilisateur.restaurant_id
}

function chiffrePour(utilisateur, { evenement, date }, { evenements, ventes }) {
  const precedente = editionPrecedente(evenement, date, evenements)
  if (!precedente) return { pct: null }
  const restaurant = evenement.restaurant_id || (utilisateur.role === 'gerant' ? utilisateur.restaurant_id : null)
  return restaurant ? { pct: hausseRestaurant(ventes[restaurant] || {}, precedente) } : hausseGroupe(ventes, precedente)
}

export function itemsPour(utilisateur, contexte) {
  return contexte.elements
    .filter(el => concerne(utilisateur, el.evenement))
    .map(el => ({
      cle: `stock|${el.evenement.id}|${el.date}|${el.delai}|${utilisateur.id}`,
      titre: titreAlerte(el.evenement.titre, el.delai, !!el.evenement.date_estimee),
      corps: corpsAlerte(chiffrePour(utilisateur, el, contexte)),
    }))
}

/** Plusieurs fêtes le même jour : un seul message par personne. */
export function regrouper(items) {
  if (!items.length) return null
  if (items.length === 1) return { titre: items[0].titre, corps: items[0].corps }
  return {
    titre: `📦 ${items.length} fêtes approchent`,
    corps: items.map(i => `${i.titre.replace('📦 ', '')} : ${i.corps}`).join('\n'),
  }
}

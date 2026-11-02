// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — chèques émis sur BACI et SIB. Logique pure.
//
// Un chèque émis et pas encore débité est une prévision : son montant sort de
// la trésorerie nette réelle tout de suite, le solde de la banque ne bouge
// qu'à l'encaissement (coché à la main).
// Depuis le 02/11/2026, un chèque paie plusieurs lignes (c.lignes) :
//  - une ligne d'À payer (loyer, dette, salaire, autre) porte une prévision
//    ordinaire de cette ligne, déjà comptée par totalPrevu ;
//  - un fournisseur administratif (CNPS, ITS, TEE…) n'a pas de prévision ;
//  - ce qui n'est porté par aucune prévision (ordre libre, administratif,
//    prévision disparue) est compté ici, à part.
// Base : supabase_tresorerie_cheques.sql + supabase_tresorerie_cheques_lignes.sql.
// Tests : lib/cheques.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { fmt, formatDateFR, paiementsParDu, resteDu } from './tresorerie.js'

const n = v => Number(v) || 0

export function lendemain(iso) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// cle : 'encaisse' · 'annule' · 'en_retard' · 'aujourdhui' · 'demain' · 'emis'
export function statutCheque(c, aujourdhui) {
  if (c.statut === 'encaisse') return { cle: 'encaisse', message: `Encaissé le ${formatDateFR(c.encaisse_le)}` }
  if (c.statut === 'annule') {
    return { cle: 'annule', message: `Annulé${c.annule_le ? ` le ${formatDateFR(c.annule_le)}` : ''}${c.motif_annulation ? ` · ${c.motif_annulation}` : ''}` }
  }
  const d = c.date_encaissement
  if (d < aujourdhui) return { cle: 'en_retard', message: `Prévu le ${formatDateFR(d)}, pas encore débité` }
  if (d === aujourdhui) return { cle: 'aujourdhui', message: 'Encaissement aujourd\'hui' }
  if (d === lendemain(aujourdhui)) return { cle: 'demain', message: 'Encaissement demain' }
  return { cle: 'emis', message: `Encaissement le ${formatDateFR(d)}` }
}

export const enCirculation = c => c?.statut === 'emis'

// Montant des chèques pas encore débités (d'un compte, ou de tous).
export function montantEnCirculation(cheques = [], compteId = null) {
  return (cheques || []).filter(c => enCirculation(c) && (!compteId || c.compte_id === compteId))
    .reduce((s, c) => s + n(c.montant), 0)
}

// Rattache à chaque chèque ses lignes (table tresorerie_cheques_lignes ; null
// tant que la migration n'est pas passée : les chèques restent tels quels).
export function attacherLignes(cheques, lignes) {
  if (!cheques || !lignes) return cheques
  const parCheque = {}
  for (const l of lignes) (parCheque[l.cheque_id] ||= []).push(l)
  return cheques.map(c => ({ ...c, lignes: parCheque[c.id] || [] }))
}

// Clé d'une ligne payée : 'du:<id>' (À payer) ou 'fo:<id>' (administratif).
export const cleLigne = l => (l.du_id ? `du:${l.du_id}` : `fo:${l.fournisseur_id}`)

// Ce que paie le chèque. Sans lignes rattachées, l'ancien lien unique.
export function lignesDuCheque(c) {
  if (Array.isArray(c?.lignes) && c.lignes.length) return c.lignes
  if (c?.du_id || c?.prevision_id) {
    return [{ du_id: c.du_id || null, fournisseur_id: null, montant: n(c.montant), prevision_id: c.prevision_id || null }]
  }
  return []
}

// Part du chèque qu'aucune prévision vivante ne compte déjà.
export function montantHorsPrevisions(c, previsions = []) {
  const ids = new Set((previsions || []).map(p => p.id))
  const couvert = lignesDuCheque(c).filter(l => l.prevision_id && ids.has(l.prevision_id)).reduce((s, l) => s + n(l.montant), 0)
  return Math.max(0, n(c.montant) - couvert)
}

// Chèques en circulation dont une part n'est comptée par aucune prévision :
// ordre libre, administratif, ou prévision retirée / ligne supprimée entre-temps.
export function chequesHorsPrevisions(cheques = [], previsions = []) {
  return (cheques || []).filter(c => enCirculation(c) && montantHorsPrevisions(c, previsions) > 0)
}

export function totalChequesHorsPrevisions(cheques = [], previsions = []) {
  return chequesHorsPrevisions(cheques, previsions).reduce((s, c) => s + montantHorsPrevisions(c, previsions), 0)
}

// Le chèque qui porte une prévision (null si aucun) : sa prévision ne se paie
// pas et ne se retire pas à la main, tout passe par l'écran Chèques émis.
export function chequeDePrevision(cheques = [], previsionId) {
  if (!previsionId) return null
  return (cheques || []).find(c => c.statut !== 'annule' && lignesDuCheque(c).some(l => l.prevision_id === previsionId)) || null
}

// ── Ce qu'un chèque peut payer ───────────────────────────────────────────────

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const libelleMois = iso => `${MOIS_FR[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}`

export const FILTRES_LIGNES = [
  { valeur: 'loyer', label: 'Loyers' },
  { valeur: 'dette', label: 'Dettes' },
  { valeur: 'salaire', label: 'Salaires' },
  { valeur: 'autre', label: 'Autres' },
  { valeur: 'administratif', label: 'Administratifs' },
]
const RANG_FILTRE = Object.fromEntries(FILTRES_LIGNES.map((f, i) => [f.valeur, i]))
const filtreDu = cat => (['loyer', 'dette', 'salaire'].includes(cat) ? cat : 'autre')
const ETIQUETTE = { loyer: 'Loyer', salaire: 'Salaires', dette: 'Dette', autre: 'Autre charge', admin: 'Charge admin' }

/**
 * Lignes qu'un chèque peut payer, avec leur reste : lignes d'À payer et
 * fournisseurs administratifs actifs qui ont un crédit. `garder` : clés déjà
 * sur le chèque modifié, proposées même soldées. Triées par type, puis par
 * restaurant (ou créancier), puis du mois le plus ancien au plus récent.
 * @returns {Array<{ cle, filtre, du?, fournisseur?, reste }>}
 */
export function lignesPayables({ dus = [], paiements = [], fournisseurs = [], garder = [], nomResto = id => id || '' }) {
  const parDu = paiementsParDu(paiements)
  const garde = new Set(garder || [])
  const out = []
  for (const du of dus || []) {
    const cle = cleLigne({ du_id: du.id })
    const reste = resteDu(du, parDu[du.id])
    if (reste > 0 || garde.has(cle)) out.push({ cle, filtre: filtreDu(du.categorie), du, reste })
  }
  for (const f of fournisseurs || []) {
    if (f.type !== 'administratif') continue
    const cle = cleLigne({ fournisseur_id: f.id })
    const reste = Math.max(0, n(f.credit_actuel))
    if ((f.actif !== false && reste > 0) || garde.has(cle)) out.push({ cle, filtre: 'administratif', fournisseur: f, reste })
  }
  const qui = x => (x.du ? (x.du.categorie === 'dette' ? x.du.creancier || '' : nomResto(x.du.restaurant_id)) : `${x.fournisseur.nom} ${nomResto(x.fournisseur.restaurant_id)}`)
  return out.sort((a, b) => RANG_FILTRE[a.filtre] - RANG_FILTRE[b.filtre]
    || String(qui(a)).localeCompare(String(qui(b)))
    || String(a.du?.mois || '').localeCompare(String(b.du?.mois || '')))
}

/** « Loyer · Palmeraie · février 2026 », « Administratif · CNPS · Palmeraie ». */
export function titreLignePayable({ du, fournisseur }, nomResto, nomGroupe = () => null) {
  if (fournisseur) {
    const ou = fournisseur.restaurant_id ? nomResto(fournisseur.restaurant_id) : nomGroupe(fournisseur.groupe_id)
    return ['Administratif', fournisseur.nom, ou].filter(Boolean).join(' · ')
  }
  const qui = du.categorie === 'dette' ? du.creancier || 'Créancier'
    : ['autre', 'admin'].includes(du.categorie) ? [du.libelle, du.restaurant_id ? nomResto(du.restaurant_id) : 'Groupe'].filter(Boolean).join(' · ')
      : nomResto(du.restaurant_id)
  return [ETIQUETTE[du.categorie] || du.categorie, qui, du.mois ? libelleMois(du.mois) : null].filter(Boolean).join(' · ')
}

// Le chèque dont l'encaissement a créé ce versement (null si aucun).
export function chequeDuPaiement(cheques = [], groupe) {
  if (!groupe) return null
  return (cheques || []).find(c => c.paiement_groupe === groupe) || null
}

// Les plus urgents d'abord (retard, aujourd'hui, demain), puis par date
// d'encaissement ; encaissés et annulés ensuite, du plus récent au plus ancien.
const RANG = { en_retard: 0, aujourdhui: 1, demain: 2, emis: 3, encaisse: 4, annule: 5 }
export function trierCheques(cheques = [], aujourdhui) {
  return [...(cheques || [])].map(c => ({ cheque: c, etat: statutCheque(c, aujourdhui) })).sort((a, b) => {
    const ra = RANG[a.etat.cle]
    const rb = RANG[b.etat.cle]
    if (ra !== rb) return ra - rb
    if (ra <= 3) return a.cheque.date_encaissement.localeCompare(b.cheque.date_encaissement)
    return (b.cheque.encaisse_le || b.cheque.annule_le || '').localeCompare(a.cheque.encaisse_le || a.cheque.annule_le || '')
  })
}

export function libelleCheque(c) {
  return `Chèque n° ${c.numero} ${c.banque}`
}

// Rappels (lib/rappelsTresorerie.js) : à 9 h la veille, le jour même et
// chaque jour de retard ; à 14 h, relance du jour même et des retards.
export function elementsCheques({ moment, aujourdhui, cheques = [] }) {
  const relance = moment === 'apres_midi'
  const out = []
  for (const { cheque: c, etat } of trierCheques((cheques || []).filter(enCirculation), aujourdhui)) {
    if (etat.cle === 'emis' || (relance && etat.cle === 'demain')) continue
    const quand = etat.cle === 'demain' ? 'encaissement demain'
      : etat.cle === 'aujourdhui' ? 'encaissement aujourd\'hui'
        : `prévu le ${formatDateFR(c.date_encaissement)}, pas encore coché`
    out.push({ type: 'cheque', texte: `${libelleCheque(c)} : ${fmt(c.montant)} F à ${c.ordre}, ${quand}` })
  }
  return out
}

// « À l'ordre de » : les noms déjà écrits sur des chèques (puis les créanciers
// des dettes) qui commencent par ce qu'on tape — sur le nom entier ou sur un
// de ses mots, sans tenir compte des majuscules, accents ni points
// (« M. » → « M. Adou », « adou » → « M. Adou »). Les plus utilisés d'abord.
const sansAccents = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const cleNom = s => sansAccents(s).replace(/[^a-z0-9]+/g, ' ').trim()

export function suggestionsOrdre(saisie, { cheques = [], dus = [] } = {}, max = 5) {
  const tape = cleNom(saisie)
  if (!tape) return []
  const noms = new Map() // clé → { nom, fois, dernier }
  const ajouter = (nom, date, poids) => {
    const k = cleNom(nom)
    if (!k) return
    const x = noms.get(k) || { nom: String(nom).trim(), fois: 0, dernier: '' }
    x.fois += poids
    if ((date || '') > x.dernier) { x.dernier = date || ''; if (poids >= 1) x.nom = String(nom).trim() }
    noms.set(k, x)
  }
  for (const c of cheques || []) ajouter(c.ordre, c.created_at || c.date_emission, 1)
  for (const d of dus || []) if (d.categorie === 'dette' && d.creancier) ajouter(d.creancier, '', 0.5)
  return [...noms.entries()]
    .filter(([k]) => k !== tape && (k.startsWith(tape) || k.split(' ').some((_, i, mots) => mots.slice(i).join(' ').startsWith(tape))))
    .sort(([, a], [, b]) => b.fois - a.fois || b.dernier.localeCompare(a.dernier) || a.nom.localeCompare(b.nom))
    .slice(0, max)
    .map(([, x]) => x.nom)
}

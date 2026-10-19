// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — chèques émis sur BACI et SIB. Logique pure.
//
// Un chèque émis et pas encore débité est une prévision : son montant sort de
// la trésorerie nette réelle tout de suite, le solde de la banque ne bouge
// qu'à l'encaissement (coché à la main).
//  - relié à une ligne d'À payer : il porte une prévision ordinaire de cette
//    ligne (prevision_id), déjà comptée par totalPrevu ;
//  - sinon (ordre libre, ou prévision disparue) : compté ici, à part.
// Base : supabase_tresorerie_cheques.sql.
// Tests : lib/cheques.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { fmt, formatDateFR } from './tresorerie.js'

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

// Chèques en circulation que les prévisions ne comptent pas déjà : ordre
// libre, ou prévision retirée / ligne supprimée entre-temps.
export function chequesHorsPrevisions(cheques = [], previsions = []) {
  const ids = new Set((previsions || []).map(p => p.id))
  return (cheques || []).filter(c => enCirculation(c) && !(c.prevision_id && ids.has(c.prevision_id)))
}

export function totalChequesHorsPrevisions(cheques = [], previsions = []) {
  return chequesHorsPrevisions(cheques, previsions).reduce((s, c) => s + n(c.montant), 0)
}

// Le chèque qui porte une prévision (null si aucun) : sa prévision ne se paie
// pas et ne se retire pas à la main, tout passe par l'écran Chèques émis.
export function chequeDePrevision(cheques = [], previsionId) {
  if (!previsionId) return null
  return (cheques || []).find(c => c.prevision_id === previsionId && c.statut !== 'annule') || null
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

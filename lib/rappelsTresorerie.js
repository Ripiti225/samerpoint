// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — rappels de 9 h et relances de 14 h. Logique pure, reprise telle
// quelle par l'Edge Function supabase/functions/rappels-tresorerie.
//
// Ce qui est signalé :
//  - les charges à échéance dont c'est le dernier jour (date limite =
//    aujourd'hui) et qui ne sont pas soldées — à 9 h même si une prévision
//    existe ;
//  - les prévisions passées « à payer » (date atteinte, réception marquée) ;
//  - les emprunts au coffre à rembourser ;
//  - les chèques émis : la veille, le jour de l'encaissement et chaque jour
//    de retard tant qu'ils ne sont pas cochés (leur prévision n'est pas
//    rappelée en double).
// La relance de 14 h ne reprend que ce qui n'a pas bougé : aucun paiement fait
// aujourd'hui sur la ligne et, pour une charge du dernier jour, aucune
// prévision posée.
//
// Spéc : docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md (étape 5)
// Tests : lib/rappelsTresorerie.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { elementsCheques } from './cheques.js'
import { statutEmprunt } from './direction.js'
import { etatPrevision } from './previsions.js'
import { CATEGORIES_TRESORERIE, fmt, niveauTresorerie, paiementsParDu, resteDu, sansChargesAdministratives } from './tresorerie.js'

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const NOMS = { loyer: 'Loyer', salaire: 'Salaires', cnps: 'CNPS', impot: 'Timbre', its: 'ITS', tee: 'TEE', bail: 'Bail' }
const LIMITE_LIGNES = 4

// « Loyer Samer Lavage (sept.) », « Dette Zabad », « Facture électricité Groupe ».
export function nomLigne(du, nomResto) {
  if (du.categorie === 'dette') return `Dette ${du.creancier || ''}`.trim()
  if (du.categorie === 'autre') return `${du.libelle || 'Autre charge'} ${du.restaurant_id ? nomResto(du.restaurant_id) : 'Groupe'}`
  const mois = du.mois ? ` (${MOIS_COURTS[Number(du.mois.slice(5, 7)) - 1]})` : ''
  return `${NOMS[du.categorie] || du.categorie} ${nomResto(du.restaurant_id)}${mois}`
}

// moment : 'matin' (9 h) | 'apres_midi' (14 h, relance).
// Rend [{ type: 'echeance' | 'prevision' | 'emprunt' | 'cheque', texte }].
export function elementsDuJour({
  moment, aujourdhui, dus: tousLesDus = [], paiements = [], previsions = [], receptions = [], emprunts = [], cheques = [], nomResto = () => '',
}) {
  // CNPS, timbre, ITS, TEE, bail : fournisseurs administratifs, plus rappelés ici.
  const dus = sansChargesAdministratives(tousLesDus)
  const relance = moment === 'apres_midi'
  const parDu = paiementsParDu(paiements)
  const payeAujourdhui = id => (parDu[id] || []).some(p => p.date === aujourdhui)
  // La prévision d'un chèque est rappelée par le chèque lui-même.
  const deCheque = new Set((cheques || []).filter(c => c.statut === 'emis' && c.prevision_id).map(c => c.prevision_id))
  const etats = (previsions || []).filter(p => !deCheque.has(p.id)).map(p => {
    const du = (dus || []).find(d => d.id === p.du_id)
    return du ? { p, du, etat: etatPrevision(p, { du, paiementsDu: parDu[du.id] || [], receptions, aujourdhui }) } : null
  }).filter(Boolean)
  const prevue = id => etats.some(x => x.du.id === id && x.etat.statut !== 'realisee')
  // Chèques d'abord : la notification n'affiche que LIMITE_LIGNES lignes, et un
  // chèque à approvisionner ne doit pas finir caché dans « … et N autres ».
  const out = elementsCheques({ moment, aujourdhui, cheques })

  for (const du of dus || []) {
    if (!CATEGORIES_TRESORERIE.includes(du.categorie) || du.echeance !== aujourdhui) continue
    const reste = resteDu(du, parDu[du.id])
    if (reste <= 0) continue
    if (relance && (payeAujourdhui(du.id) || prevue(du.id))) continue
    out.push({ type: 'echeance', texte: `${nomLigne(du, nomResto)} : ${fmt(reste)} F, dernier jour` })
  }
  for (const { du, etat } of etats) {
    if (etat.statut !== 'a_payer') continue
    if (relance && payeAujourdhui(du.id)) continue
    const quand = etat.message.replace(/ : à payer$/, '').replace(/, pas encore payé$/, '')
    out.push({ type: 'prevision', texte: `${quand} : ${nomLigne(du, nomResto)} ${fmt(etat.aPayer)} F` })
  }
  for (const e of emprunts || []) {
    if (statutEmprunt(e, receptions, aujourdhui) !== 'a_rembourser') continue
    out.push({ type: 'emprunt', texte: `Rembourser ${fmt(e.montant)} F au coffre` })
  }
  return out
}

// Comptes actifs ayant un niveau de trésorerie : [{ id, nom, niveau }].
export function destinatairesRappels({ utilisateurs = [], droits = [] }) {
  return (utilisateurs || [])
    .filter(u => u.actif !== false)
    .map(u => ({ id: u.id, nom: u.nom, niveau: niveauTresorerie(u.role, u.id, droits) }))
    .filter(u => ['proprietaire', 'lecture', 'saisie_rh'].includes(u.niveau))
}

// Ce que chacun voit : propriétaire → tout ; lecture → charges et prévisions
// (pas le coffre) ; RH → ses charges du dernier jour. null s'il n'y a rien.
const TYPES_PAR_NIVEAU = {
  proprietaire: ['echeance', 'prevision', 'emprunt', 'cheque'],
  lecture: ['echeance', 'prevision', 'cheque'],
  saisie_rh: ['echeance'],
}

export function messagePour(niveau, elements = [], moment) {
  const lignes = (elements || []).filter(e => TYPES_PAR_NIVEAU[niveau]?.includes(e.type))
  if (!lignes.length) return null
  const n = lignes.length
  const titre = moment === 'apres_midi'
    ? `Rappel · ${n} pas encore ${n > 1 ? 'faits' : 'fait'}`
    : `Trésorerie · ${n} à faire aujourd'hui`
  const corps = lignes.slice(0, LIMITE_LIGNES).map(l => l.texte)
  if (n > LIMITE_LIGNES) corps.push(`… et ${n - LIMITE_LIGNES} autres`)
  return { titre, corps: corps.join('\n') }
}

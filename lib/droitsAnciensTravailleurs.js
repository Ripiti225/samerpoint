// ──────────────────────────────────────────────────────────────────────────────
// Droits des anciens travailleurs (supabase_droits_anciens_travailleurs.sql).
//
// Ce qu'on doit à un travailleur parti : une fiche par travailleur, rangée
// comme un fournisseur administratif (type « administratif », sans échéance)
// et marquée par sa date de départ (`depart_le`). Le montant dû est une
// écriture `ajustement_manager` ; le gérant paie en caisse (Déductions →
// Administratifs), la direction depuis Trésorerie → À payer.
// Résultat net : compté au fil des paiements (lib/creditFournisseursMois.js
// écarte ces fiches de la variation du crédit).
//
// Spéc : docs/superpowers/specs/2026-10-12-droits-anciens-travailleurs-design.md
// Pur : testé par lib/droitsAnciensTravailleurs.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

import { cleRattachement } from './groupes.js'

export const ONGLET_ANCIENS = 'anciens_travailleurs'

const SOURCE_AJUSTEMENT = 'ajustement_manager'
const SOURCE_DIRECTION = 'paiement_direction'

const n = v => Number(v) || 0
const normaliser = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const jourDe = t => t.date_point || String(t.created_at || '').slice(0, 10)
const dateFR = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

export function estDroitAncienTravailleur(f) {
  return !!f?.depart_le
}

// Seul un CDI a des droits de fin de contrat à régler (choix du 12/10/2026).
export function proposerDroits(trav) {
  return trav?.type_contrat === 'CDI'
}

/** « parti le 12/09/2026 · Démission ». */
export function sousTitreDepart(f) {
  const motif = String(f?.depart_motif || '').trim()
  return `parti le ${dateFR(f?.depart_le)}${motif ? ` · ${motif}` : ''}`
}

// Dû = factures − corrections à la baisse ; payé = paiements réels (gérant, direction).
export function resumeDroit(transactions = []) {
  let du = 0
  let paye = 0
  for (const t of transactions || []) {
    du += n(t.facture)
    if (t.source === SOURCE_AJUSTEMENT) du -= n(t.paye)
    else paye += n(t.paye)
  }
  return { du, paye, reste: du - paye }
}

export function paiementsDroit(transactions = []) {
  return (transactions || [])
    .filter(t => t.source !== SOURCE_AJUSTEMENT && n(t.paye) > 0)
    .map(t => ({ id: t.id, date: jourDe(t), montant: n(t.paye), par: t.source === SOURCE_DIRECTION ? 'Direction' : 'Gérant' }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function resumeDroitsParResto(fiches = [], transactions = []) {
  const parFiche = {}
  for (const t of transactions || []) (parFiche[t.fournisseur_id] ||= []).push(t)
  const out = {}
  for (const f of fiches || []) {
    const r = resumeDroit(parFiche[f.id])
    // Restaurant, ou groupe pour une fiche sans restaurant (Zone 4).
    const g = (out[cleRattachement(f)] ||= { fiches: [], du: 0, paye: 0, reste: 0 })
    g.fiches.push({ ...f, ...r, nbPaiements: paiementsDroit(parFiche[f.id]).length, solde: r.reste <= 0 })
    g.du += r.du
    g.paye += r.paye
    g.reste += Math.max(0, r.reste)
  }
  // Restants d'abord, puis le départ le plus récent.
  for (const g of Object.values(out)) {
    g.fiches.sort((a, b) => (a.solde - b.solde) || String(b.depart_le).localeCompare(String(a.depart_le)))
  }
  return out
}

// Les fiches « ANCIEN TRAVAILLEURS » (une par restaurant) et « Salaire ancien »
// d'avant le 12/10/2026, à remplacer par une fiche par travailleur.
const ANCIENNE_FICHE = /ancien travailleur|salaire ancien/
export function estAncienneFicheGlobale(f) {
  return !!f && f.actif !== false && !estDroitAncienTravailleur(f) && ANCIENNE_FICHE.test(normaliser(f.nom))
}

// Déductions gérant : un droit soldé, ou un fournisseur désactivé (ex. l'ancienne
// fiche « ANCIEN TRAVAILLEURS » remplacée), n'encombre plus la liste — sauf
// s'il a déjà une saisie ce jour (sinon elle disparaîtrait de l'écran) ou, pour
// un désactivé, s'il reste un dû ou une avance à suivre.
export function fournisseurAAfficherGerant(f, creditVeille, dejaSaisi) {
  if (dejaSaisi) return true
  if (f?.actif === false) return n(creditVeille) !== 0
  if (estDroitAncienTravailleur(f)) return n(creditVeille) > 0
  return true
}

// ── Prévisions (tresorerie_previsions.fournisseur_id) ────────────────────────
// Pour les prévisions SEULEMENT, chaque droit devient une « ligne » de la
// Trésorerie (même forme qu'un dû) : etatPrevision, totalPrevu et la feuille
// « Prévoir » marchent sans changement. Ces lignes ne vont jamais dans
// donnees.dus (elles seraient comptées deux fois avec les fournisseurs).
// Un droit n'a pas de prevision_id sur ses paiements : tout paiement (gérant ou
// direction) fait à partir du jour d'une prévision la réalise, la plus ancienne
// d'abord, sans dépasser son montant (choix du 12/10/2026).
export const idLigneDroit = fournisseurId => `droit:${fournisseurId}`

export function droitsPourPrevisions(fiches = [], transactions = [], previsions = []) {
  const parFiche = {}
  for (const t of transactions || []) (parFiche[t.fournisseur_id] ||= []).push(t)
  const ids = new Set((fiches || []).map(f => f.id))

  const previsionsOut = []
  const prevParFiche = {}
  for (const p of previsions || []) {
    if (!p.fournisseur_id) { previsionsOut.push(p); continue }
    if (!ids.has(p.fournisseur_id)) continue
    const q = { ...p, du_id: idLigneDroit(p.fournisseur_id) }
    previsionsOut.push(q)
    ;(prevParFiche[p.fournisseur_id] ||= []).push(q)
  }

  const dus = []
  const paiements = []
  for (const f of fiches || []) {
    const r = resumeDroit(parFiche[f.id])
    const id = idLigneDroit(f.id)
    dus.push({
      id, droit: true, fiche: { ...f, ...r }, categorie: ONGLET_ANCIENS, restaurant_id: f.restaurant_id,
      libelle: f.nom, montant_du: r.du,
    })
    const prevs = [...(prevParFiche[f.id] || [])]
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map(p => ({ p, jour: String(p.created_at || '').slice(0, 10), libre: n(p.montant) }))
    for (const pay of [...paiementsDroit(parFiche[f.id])].reverse()) {
      let reste = pay.montant
      for (const x of prevs) {
        if (reste <= 0) break
        if (x.jour > pay.date || x.libre <= 0) continue
        const part = Math.min(reste, x.libre)
        paiements.push({ du_id: id, montant: part, date: pay.date, prevision_id: x.p.id })
        x.libre -= part
        reste -= part
      }
      if (reste > 0) paiements.push({ du_id: id, montant: reste, date: pay.date, prevision_id: null })
    }
  }
  return { dus, paiements, previsions: previsionsOut }
}

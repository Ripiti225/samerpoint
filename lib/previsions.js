// ──────────────────────────────────────────────────────────────────────────────
// Trésorerie — prévisions de paiement. Logique pure.
//
// Une prévision dit combien on compte payer sur une ligne et quand : à une
// date, ou à la prochaine réception d'un partenaire (marquée « reçu » après la
// prévision). Le moment venu elle passe « à payer » (orange) et le reste
// jusqu'au paiement. Son réalisé = les paiements qui la portent
// (prevision_id) : payer moins que prévu laisse le reste prévu. Elle est
// réalisée quand tout est payé, ou quand sa ligne est soldée autrement.
//
// Spéc : docs/superpowers/specs/2026-10-02-nouvelle-tresorerie-design.md (étape 4)
// Tests : lib/previsions.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { formatDateFR, paiementsParDu, resteDu } from './tresorerie.js'

export const PARTENAIRES_PREVISION = [
  { valeur: 'glovo', label: 'Glovo' },
  { valeur: 'yango', label: 'Yango' },
  { valeur: 'wave', label: 'Wave' },
  { valeur: 'om', label: 'Orange Money' },
  { valeur: 'djamo', label: 'Djamo' },
]

export const nomPartenaire = v => PARTENAIRES_PREVISION.find(p => p.valeur === v)?.label || v

const n = v => Number(v) || 0

// statut : 'realisee' · 'a_payer' (orange) · 'prevue'
export function etatPrevision(prevision, { du, paiementsDu = [], receptions = [], aujourdhui }) {
  const realise = (paiementsDu || []).filter(p => p.prevision_id === prevision.id).reduce((s, p) => s + n(p.montant), 0)
  const reste = Math.max(0, n(prevision.montant) - realise)
  const resteLigne = du ? resteDu(du, paiementsDu) : 0
  const aPayer = Math.min(reste, resteLigne)
  const base = { realise, reste, aPayer }

  if (reste === 0 || resteLigne === 0) {
    return { ...base, statut: 'realisee', message: reste === 0 ? 'Payée' : 'Ligne soldée' }
  }
  if (prevision.date_prevue && aujourdhui >= prevision.date_prevue) {
    return {
      ...base, statut: 'a_payer',
      message: aujourdhui === prevision.date_prevue
        ? 'Prévu aujourd\'hui : à payer'
        : `Prévu le ${formatDateFR(prevision.date_prevue)}, pas encore payé`,
    }
  }
  if (prevision.partenaire && (receptions || []).some(r => r.type === 'recu'
    && r.partenaire === prevision.partenaire && r.created_at > prevision.created_at)) {
    return { ...base, statut: 'a_payer', message: `${nomPartenaire(prevision.partenaire)} reçu : à payer` }
  }
  return {
    ...base, statut: 'prevue',
    message: prevision.date_prevue
      ? `prévu le ${formatDateFR(prevision.date_prevue)}`
      : `à la prochaine réception ${nomPartenaire(prevision.partenaire)}`,
  }
}

// Total soustrait de la trésorerie nette : par ligne, les restes des
// prévisions ouvertes, sans jamais dépasser le reste de la ligne.
export function totalPrevu(previsions = [], dus = [], paiements = [], receptions = [], aujourdhui) {
  const parDu = paiementsParDu(paiements)
  const parLigne = {}
  for (const p of previsions || []) {
    const du = (dus || []).find(d => d.id === p.du_id)
    if (!du) continue
    const e = etatPrevision(p, { du, paiementsDu: parDu[du.id] || [], receptions, aujourdhui })
    if (e.statut === 'realisee') continue
    parLigne[du.id] = (parLigne[du.id] || 0) + e.reste
  }
  return Object.entries(parLigne).reduce((s, [id, total]) => {
    const du = dus.find(d => d.id === id)
    return s + Math.min(total, resteDu(du, parDu[id] || []))
  }, 0)
}

// [{ prevision, etat, ... }] : orange d'abord, puis par date ; les réceptions
// (sans date) à la fin, dans l'ordre de création.
export function trierPrevisions(lignes = []) {
  return [...lignes].sort((a, b) => {
    const oa = a.etat.statut === 'a_payer' ? 0 : 1
    const ob = b.etat.statut === 'a_payer' ? 0 : 1
    if (oa !== ob) return oa - ob
    const da = a.prevision.date_prevue || '9999'
    const db = b.prevision.date_prevue || '9999'
    if (da !== db) return da.localeCompare(db)
    return (a.prevision.created_at || '').localeCompare(b.prevision.created_at || '')
  })
}

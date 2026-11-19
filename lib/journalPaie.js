// ──────────────────────────────────────────────────────────────────────────────
// Journal de Paie (PA) : écritures d'un état de salaire VALIDÉ (logique pure).
//
// Une pièce par restaurant et par mois, somme des bulletins (`bulletin.calcul`,
// lib/paie.js → calculerBulletin) :
//   661 brut (+ arrondi du net), 663 transport et tenue, 664 charges patronales
//   CNPS, 6413 taxes patronales — en face 431 CNPS, 447 ITS et taxes, 422 dû au
//   personnel (soldé par les versements : avances et paie en caisse, Trésorerie).
// Règle anti double comptage (clé clePaie) : quand l'état du restaurant et du
// mois est validé, les versements vont en 422 ; sinon en 661 et pas de PA.
// Spec : docs/superpowers/specs/2026-11-19-export-comptable-paie-design.md
// Tests : lib/journalPaie.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { joursDuMois } from './clotureMois.js'
import { ecrivain } from './ecrituresComptables.js'

// Mêmes regroupements que lib/etatSalaire.js (cotisationsBulletin) : ce qui se
// déclare avec l'ITS ; tout le reste de la part patronale va avec la CNPS.
const CODES_TAXES = [500, 520, 530, 531]

const n = v => Number(v) || 0

export const clePaie = (restaurantId, mois) => `${restaurantId}|${String(mois).slice(0, 7)}`

function totaux(lignes) {
  const t = { brut: 0, arrondi: 0, indemnites: 0, cnpsSalarie: 0, its: 0, cnpsPatronal: 0, taxesPatronales: 0, chargesSalariales: 0 }
  for (const l of lignes || []) {
    const c = l?.bulletin?.calcul
    if (!c) continue
    t.brut += n(c.brut)
    t.arrondi += n(c.arrondi)
    t.indemnites += n(c.transport) + n(c.tenue)
    t.cnpsSalarie += n(c.retenues?.cnps) + n(c.retenues?.cmu)
    t.its += n(c.retenues?.its)
    t.chargesSalariales += n(c.chargesSalariales)
    for (const p of c.patronal || []) {
      if (CODES_TAXES.includes(p.code)) t.taxesPatronales += n(p.montant)
      else t.cnpsPatronal += n(p.montant)
    }
  }
  return t
}

export function ecrituresPaie({ mois, restaurant, lignes = [] }) {
  const jours = joursDuMois(mois)
  const out = []
  const ecrire = ecrivain({
    journal: 'PA', date: jours[jours.length - 1],
    piece: `PA-${String(restaurant.court).replace(/\s+/g, '')}-${String(mois).slice(0, 7).replace('-', '')}`,
    restaurant: restaurant.nom, lignes: out,
  })
  const t = totaux(lignes)
  ecrire('personnel', 'Salaires bruts du mois', t.brut + t.arrondi, 'debit')
  ecrire('indemnites', 'Transport et tenue', t.indemnites, 'debit')
  ecrire('chargesSociales', 'Charges patronales CNPS', t.cnpsPatronal, 'debit')
  ecrire('taxesSalaires', 'Taxes patronales sur salaires', t.taxesPatronales, 'debit')
  ecrire('cnps', 'CNPS et CMU (salarié et employeur)', t.cnpsSalarie + t.cnpsPatronal, 'credit')
  ecrire('itsRetenu', 'ITS retenu et taxes patronales', t.its + t.taxesPatronales, 'credit')
  ecrire('salairesDus', 'Dû au personnel (net + avances déjà versées)',
    t.brut + t.arrondi + t.indemnites - t.chargesSalariales, 'credit')
  return out
}

// ──────────────────────────────────────────────────────────────────────────────
// Crédit fournisseurs d'un restaurant au début et à la fin de chaque mois, pour
// corriger le résultat net (règle de M. Zreik, 10/10/2026).
//
// Le résultat net part de l'encaissé, qui ne retire que ce qui a été PAYÉ aux
// fournisseurs. Une marchandise reçue à crédit n'y est pas. Un restaurant qui
// doit 500 000 le 1er et 1 000 000 en fin de mois a reçu 500 000 de marchandise
// sans la payer : son résultat est réduit d'autant. Symétrique : une dette qui
// baisse (vieilles factures payées avec l'argent du mois) remonte le résultat.
//
// Crédit d'un fournisseur à une date = `reste` de sa dernière transaction (même
// ordre que lib/derniersRestesFournisseurs.js et l'écran Crédits fournisseurs).
// Les « fournisseurs » de cotisation (salaire, CNPS, impôt, ITS, TEE, loyer,
// bail) sont écartés : ces charges sont déjà déduites par lib/chargesMois.js,
// les compter ici les compterait deux fois.
//
// Mois ANTÉRIEURS à octobre 2026 : un crédit NÉGATIF compte pour 0 (choix du
// 10/10/2026). « Payé plus que facturé » y est presque toujours une facture
// oubliée, pas une vraie avance : Palmeraie payait sans saisir les factures
// (−2,6 M au 1er septembre) puis a tout rattrapé le 30/09 ; compté tel quel,
// août gagnait 1,9 M et septembre perdait 4,7 M sans aucun achat réel derrière.
// À partir d'octobre 2026 : formule normale, crédit tel quel (négatifs compris).
//
// Tests : lib/creditFournisseursMois.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { choisirDerniersRestes } from './derniersRestesFournisseurs.js'

const normaliser = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const COTISATION = /cotisation|cnps|^its$|^tee$|impot|bail|loyer|salaire/

// Premier mois calculé avec le crédit tel quel ; avant, les négatifs comptent pour 0.
export const MOIS_FORMULE_NORMALE = '2026-10'

/** Faux fournisseur qui porte une charge déjà comptée (cotisation, impôt…). */
export function estFournisseurCharge(nom) {
  return COTISATION.test(normaliser(nom))
}

// Premier jour du mois suivant (borne exclue de la fin de mois).
function moisSuivant(m) {
  const [a, mm] = m.split('-').map(Number)
  return mm === 12 ? `${a + 1}-01-01` : `${a}-${String(mm + 1).padStart(2, '0')}-01`
}

const jourDe = t => t.date_point || String(t.created_at || '').slice(0, 10)

/**
 * fournisseurs : [{ id, restaurant_id, nom }]
 * transactions : [{ fournisseur_id, reste, saisi_par, point_id, date_point, created_at }]
 * Rend { [restaurant_id]: { [AAAA-MM]: { debut, fin, variation } } }.
 */
export function creditFournisseursParRestoMois({ fournisseurs = [], transactions = [], mois = [] }) {
  const restoDe = {}
  for (const f of fournisseurs || []) {
    if (f.restaurant_id && !estFournisseurCharge(f.nom)) restoDe[f.id] = f.restaurant_id
  }
  const retenues = (transactions || []).filter(t => restoDe[t.fournisseur_id])
  const dateParPoint = {}
  for (const t of retenues) if (t.point_id) dateParPoint[t.point_id] = jourDe(t)

  // Crédit par restaurant, toutes transactions datées AVANT la borne.
  const cache = {}
  const creditAvant = (borne, sansNegatifs) => {
    const cle = `${borne}|${sansNegatifs}`
    if (cache[cle]) return cache[cle]
    const derniers = choisirDerniersRestes(retenues.filter(t => jourDe(t) < borne), dateParPoint)
    const parResto = {}
    for (const [fid, d] of Object.entries(derniers)) {
      const reste = Number(d.reste) || 0
      parResto[restoDe[fid]] = (parResto[restoDe[fid]] || 0) + (sansNegatifs ? Math.max(0, reste) : reste)
    }
    return (cache[cle] = parResto)
  }

  const out = {}
  for (const m of mois) {
    // Début et fin d'un même mois toujours avec la même règle.
    const sansNegatifs = m < MOIS_FORMULE_NORMALE
    const debut = creditAvant(`${m}-01`, sansNegatifs)
    const fin = creditAvant(moisSuivant(m), sansNegatifs)
    for (const r of new Set([...Object.keys(debut), ...Object.keys(fin)])) {
      const d = Math.round(debut[r] || 0)
      const f = Math.round(fin[r] || 0)
      ;(out[r] ||= {})[m] = { debut: d, fin: f, variation: f - d }
    }
  }
  return out
}

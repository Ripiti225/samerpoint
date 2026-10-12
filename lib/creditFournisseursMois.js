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
// les compter ici les compterait deux fois. Écartés aussi (choix du 10/10/2026),
// faute de facture saisie à temps ou parce que ce n'est pas de la marchandise :
// PALMCI, Sécurité, Boss, Ancien travailleurs.
//
// Mois ANTÉRIEURS à octobre 2026 : un crédit NÉGATIF compte pour 0 (choix du
// 10/10/2026). « Payé plus que facturé » y est presque toujours une facture
// oubliée, pas une vraie avance : Palmeraie payait sans saisir les factures
// (−2,6 M au 1er septembre) puis a tout rattrapé le 30/09 ; compté tel quel,
// août gagnait 1,9 M et septembre perdait 4,7 M sans aucun achat réel derrière.
// À partir d'octobre 2026 : formule normale, crédit tel quel (négatifs compris),
// MAIS les corrections du manager (« Modifié directement », remise à 0 : source
// `ajustement_manager`) sont retirées de la variation : elles rattrapent des
// factures oubliées des mois d'avant, pas des achats du mois (Lavage, 10/10/2026 :
// 1,5 M de corrections pour 20 650 de vrais mouvements). Pas avant octobre : la
// règle des négatifs à 0 les neutralise déjà, les retirer encore compterait double.
//
// Fournisseurs administratifs (règle de M. Zreik, 12/10/2026 —
// lib/fournisseursAdmin.js), droits des anciens travailleurs compris : écartés
// à partir du mois où ils le sont devenus (administratif_depuis). Le montant dû
// (échéance automatique, montant ajouté par le RH, retard) n'est PAS une charge ;
// seul le paiement l'est, et il est déjà retiré ailleurs : par l'encaissé quand
// le gérant paie avec la caisse, par la dépense direction « administratif »
// quand la direction paie. Avant leur bascule, l'ancienne règle (par le nom) :
// un ODP jusque-là compté le reste pour les mois passés, qui ne bougent pas.
//
// Tests : lib/creditFournisseursMois.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { choisirDerniersRestes } from './derniersRestesFournisseurs.js'
import { estAdministratif } from './fournisseursAdmin.js'
import { estDroitAncienTravailleur } from './droitsAnciensTravailleurs.js'

const normaliser = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const COTISATION = /cotisation|cnps|^its$|^tee$|impot|bail|loyer|salaire/
const HORS_MARCHANDISE = /palmci|securite|^boss$|ancien travailleur/

// Premier mois calculé avec le crédit tel quel ; avant, les négatifs comptent pour 0.
export const MOIS_FORMULE_NORMALE = '2026-10'

/** Faux fournisseur hors calcul : charge déjà comptée (cotisation, impôt…) ou hors marchandise. */
export function estFournisseurCharge(nom) {
  const n = normaliser(nom)
  return COTISATION.test(n) || HORS_MARCHANDISE.test(n)
}

// Premier jour du mois suivant (borne exclue de la fin de mois).
function moisSuivant(m) {
  const [a, mm] = m.split('-').map(Number)
  return mm === 12 ? `${a + 1}-01-01` : `${a}-${String(mm + 1).padStart(2, '0')}-01`
}

const jourDe = t => t.date_point || String(t.created_at || '').slice(0, 10)

export const SOURCE_AJUSTEMENT = 'ajustement_manager'

/**
 * fournisseurs : [{ id, restaurant_id, nom, type?, administratif_depuis? }]
 * transactions : [{ fournisseur_id, reste, facture, paye, source, saisi_par, point_id, date_point, created_at }]
 * Rend { [restaurant_id]: { [AAAA-MM]: { debut, fin, ajustements, variation } } }
 * avec variation = fin − debut − ajustements.
 */
export function creditFournisseursParRestoMois({ fournisseurs = [], transactions = [], mois = [] }) {
  // Mois (AAAA-MM) à partir duquel un fournisseur ne compte plus ('' = jamais).
  const restoDe = {}
  const jusqua = {}
  for (const f of fournisseurs || []) {
    if (!f.restaurant_id) continue
    // Droits d'anciens travailleurs : comptés au fil des paiements, par la
    // sortie de caisse (gérant) ou la dépense direction — jamais par le crédit.
    if (estDroitAncienTravailleur(f)) continue
    if (estAdministratif(f)) {
      // Écarté depuis sa bascule ; avant, seulement s'il comptait déjà (par le nom).
      if (estFournisseurCharge(f.nom) || !f.administratif_depuis) continue
      restoDe[f.id] = f.restaurant_id
      jusqua[f.id] = f.administratif_depuis.slice(0, 7)
    } else if (!estFournisseurCharge(f.nom)) {
      restoDe[f.id] = f.restaurant_id
      jusqua[f.id] = ''
    }
  }
  const compte = (fid, m) => !!restoDe[fid] && (!jusqua[fid] || m < jusqua[fid])
  const retenues = (transactions || []).filter(t => restoDe[t.fournisseur_id])
  const dateParPoint = {}
  for (const t of retenues) if (t.point_id) dateParPoint[t.point_id] = jourDe(t)

  // Dernier reste de chaque fournisseur, toutes transactions datées AVANT la borne.
  const cache = {}
  const derniersAvant = borne => (cache[borne] ||= choisirDerniersRestes(retenues.filter(t => jourDe(t) < borne), dateParPoint))
  // Crédit par restaurant à la borne, avec les fournisseurs qui comptent pour le mois m.
  const creditAvant = (borne, sansNegatifs, m) => {
    const parResto = {}
    for (const [fid, d] of Object.entries(derniersAvant(borne))) {
      if (!compte(fid, m)) continue
      const reste = Number(d.reste) || 0
      parResto[restoDe[fid]] = (parResto[restoDe[fid]] || 0) + (sansNegatifs ? Math.max(0, reste) : reste)
    }
    return parResto
  }

  // Corrections du manager par restaurant et par mois (facture − payé).
  const ajustements = {}
  for (const t of retenues) {
    if (t.source !== SOURCE_AJUSTEMENT) continue
    const m = jourDe(t).slice(0, 7)
    if (!compte(t.fournisseur_id, m)) continue
    const r = restoDe[t.fournisseur_id]
    ;(ajustements[r] ||= {})[m] = (ajustements[r][m] || 0) + (Number(t.facture) || 0) - (Number(t.paye) || 0)
  }

  const out = {}
  for (const m of mois) {
    // Début et fin d'un même mois toujours avec la même règle et les mêmes fournisseurs.
    const sansNegatifs = m < MOIS_FORMULE_NORMALE
    const debut = creditAvant(`${m}-01`, sansNegatifs, m)
    const fin = creditAvant(moisSuivant(m), sansNegatifs, m)
    for (const r of new Set([...Object.keys(debut), ...Object.keys(fin)])) {
      const d = Math.round(debut[r] || 0)
      const f = Math.round(fin[r] || 0)
      const a = sansNegatifs ? 0 : Math.round(ajustements[r]?.[m] || 0)
      ;(out[r] ||= {})[m] = { debut: d, fin: f, ajustements: a, variation: f - d - a }
    }
  }
  return out
}

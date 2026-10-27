// ──────────────────────────────────────────────────────────────────────────────
// Favori « Ventes Yango » — partie app (logique pure).
//
// La fenêtre Samtrackly ouverte par le favori propose une semaine, reçoit les
// lignes (format de l'export) et la pub lue sur le portail. Les lignes passent
// par analyserYango ; ici : les semaines et l'état de la pub.
// Moteur du favori : public/bouton-ventes-yango.js.
// Tests : lib/ventesYangoFavori.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { ajouterJours, periodeDe } from './partenaires.js'
import { codeYango } from './partenairesImport.js'

export const ORIGINE_YANGO = 'https://vendor.yango.com'

// Semaines Yango (vendredi → jeudi) terminées, la plus récente d'abord.
export function semainesProposees(aujourdhui, nb = 5) {
  let p = periodeDe('yango', aujourdhui)
  if (p.fin >= aujourdhui) p = periodeDe('yango', ajouterJours(p.debut, -1))
  const out = []
  for (let i = 0; i < nb; i++) {
    out.push(p)
    p = periodeDe('yango', ajouterJours(p.debut, -1))
  }
  return out
}

// Pub par code restaurant : même règle de nom que les ventes (codeYango).
export function pubParCode(pubs) {
  const out = {}
  for (const p of pubs || []) {
    const code = codeYango(p.nom) || '?'
    out[code] = (out[code] || 0) + Math.round(Number(p.montant) || 0)
  }
  return out
}

// codes : code → restaurant_id | 'ignorer' (choix de l'écran d'import).
// dejaSaisie : total des pubs déjà enregistrées pour cette période.
// La pub n'est enregistrée que si Yango l'a comptée jusqu'au dernier jour :
// jamais un 0 « par défaut » (statistiques Yango arrêtées au 05/10/2026).
export function etatPub({ pubs, pubAJourAu, periode, codes, dejaSaisie }) {
  const parCode = pubParCode(pubs)
  const parResto = {}
  for (const [code, montant] of Object.entries(parCode)) {
    const r = codes[code]
    if (!r || r === 'ignorer' || !montant) continue
    parResto[r] = (parResto[r] || 0) + montant
  }
  const parts = Object.entries(parResto).map(([restaurant_id, montant]) => ({ restaurant_id, montant }))
  const total = parts.reduce((s, x) => s + x.montant, 0)
  let statut = 'a_jour'
  if (dejaSaisie > 0) statut = 'deja_saisie'
  else if (!pubAJourAu || pubAJourAu < periode.fin) statut = 'pas_a_jour'
  else if (!total) statut = 'aucune'
  return { statut, parCode, parts, total }
}

// Seuls les messages du portail Yango, venant de la fenêtre qui a ouvert
// Samtrackly, sont écoutés.
export function messageValide(e, opener) {
  return !!e && !!opener && e.origin === ORIGINE_YANGO && e.source === opener
    && !!e.data && typeof e.data.type === 'string'
}

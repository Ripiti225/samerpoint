// ──────────────────────────────────────────────────────────────────────────────
// Les écarts de caisse mesurés par le POS, ventilés par caissière.
//
// Sur un site basculé, `points.ecart_caisse` (calculé par Samtrackly comme
// « vente des shifts − vente machine ») vaut structurellement 0 : les deux
// nombres deviennent deux vues du même système. Ce n'est pas un bug, mais ça
// veut dire que l'écran Ventes ne doit plus lire celui-là.
//
// Le vrai écart est celui que la caisse a mesuré au comptage à l'aveugle, shift
// par shift, et il est stocké dans `points_shifts.ecart_pos`. Un shift = une
// caissière, donc la ventilation se déduit des shifts du jour sans colonne
// supplémentaire.
//
// Tests : lib/ecartPOS.test.mjs (`npm test`).
// ──────────────────────────────────────────────────────────────────────────────

/** Libellé de repli : on ne fait jamais disparaître un montant faute de nom. */
const CAISSIER_INCONNU = 'Caissier non identifié'

/**
 * Ventile les écarts mesurés d'une journée.
 *
 * Un écart mesuré à **zéro** est une mesure (le tiroir tombait juste), pas une
 * absence de mesure — d'où le test sur `null`/`undefined` et non sur la valeur.
 * Confondre les deux, c'est soit inventer un écart, soit en cacher un.
 *
 * @param {{caissier_nom: string|null, ecart_pos: number|null, explication_ecart?: string|null}[]} shifts
 * @returns {{lignes: {nom: string, ecart: number, explication?: string}[], total: number,
 *            mesures: number, sansMesure: number}}
 */
export function ecartsParCaissier(shifts) {
  const lignes = []
  let total = 0
  let sansMesure = 0

  for (const s of shifts || []) {
    const brut = s?.ecart_pos
    if (brut === null || brut === undefined || brut === '') {
      sansMesure++
      continue
    }
    const ecart = Number(brut)
    if (!Number.isFinite(ecart)) {
      sansMesure++
      continue
    }
    const ligne = { nom: (s.caissier_nom || '').trim() || CAISSIER_INCONNU, ecart }
    const explication = String(s?.explication_ecart ?? '').trim()
    if (explication) ligne.explication = explication
    lignes.push(ligne)
    total += ecart
  }

  return { lignes, total, mesures: lignes.length, sansMesure }
}

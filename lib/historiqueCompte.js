// ──────────────────────────────────────────────────────────────────────────────
// Historique d'un compte de trésorerie (BACI, SIB, Espèces, têtes de fond).
//
// Le solde d'un compte est la somme de ses mouvements (lib/tresorerie.js →
// soldeCompte). Pour l'historique, chaque ligne affiche aussi le solde juste
// après elle : on part du solde actuel et on remonte le temps, en retirant les
// mouvements un à un. Le filtre (entrées / sorties) s'applique APRÈS ce calcul,
// sinon les soldes affichés ne correspondraient plus au compte réel.
// Tests : lib/historiqueCompte.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const n = v => Number(v) || 0

// Plus récent d'abord ; à date égale, l'ordre reçu est conservé.
function recentsDabord(mouvements) {
  return (mouvements || [])
    .map((m, i) => ({ m, i }))
    .sort((a, b) => String(b.m.date || '').localeCompare(String(a.m.date || '')) || a.i - b.i)
    .map(x => x.m)
}

/** Entrées et sorties (montant positif) d'un mois 'AAAA-MM'. */
export function resumeMois(mouvements, mois) {
  let entrees = 0
  let sorties = 0
  for (const m of mouvements || []) {
    if (!String(m.date || '').startsWith(mois)) continue
    const v = n(m.montant)
    if (v >= 0) entrees += v
    else sorties -= v
  }
  return { entrees, sorties }
}

/**
 * Lignes groupées par jour, plus récent d'abord :
 * [{ date, lignes: [{ ...mouvement, soldeApres }] }].
 * filtre : 'tous' | 'entrees' | 'sorties'.
 */
export function historiqueCompte(mouvements, filtre = 'tous') {
  const tries = recentsDabord(mouvements)
  let courant = tries.reduce((s, m) => s + n(m.montant), 0)
  const avecSolde = tries.map(m => {
    const ligne = { ...m, soldeApres: courant }
    courant -= n(m.montant)
    return ligne
  })
  const gardes = avecSolde.filter(m => filtre === 'entrees' ? n(m.montant) >= 0
    : filtre === 'sorties' ? n(m.montant) < 0 : true)
  const jours = []
  for (const m of gardes) {
    const dernier = jours[jours.length - 1]
    if (dernier && dernier.date === m.date) dernier.lignes.push(m)
    else jours.push({ date: m.date, lignes: [m] })
  }
  return jours
}

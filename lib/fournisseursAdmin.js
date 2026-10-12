// ──────────────────────────────────────────────────────────────────────────────
// Fournisseurs administratifs (supabase_fournisseurs_administratifs.sql).
//
// TEE, ITS, Timbre, CNPS, bail, mairie… : un fournisseur par restaurant, de
// type « administratif ». Son crédit monte seul à chaque échéance (mensuelle
// ou annuelle, le 1er du mois) par appliquer_factures_mensuelles(), et le
// gérant le paie avec les espèces (Déductions gérant → Administratifs).
// Ils remplacent les charges TEE / ITS / Timbre / CNPS / Bail de la Trésorerie
// depuis le 12/10/2026.
//
// Pur : testé par lib/fournisseursAdmin.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

export const TYPE_ADMIN = 'administratif'

const n = v => Number(String(v ?? '').replace(/[^\d-]/g, '')) || 0

export function estAdministratif(f) {
  return f?.type === TYPE_ADMIN
}

export function separerFournisseurs(liste = []) {
  const marchandise = []
  const administratifs = []
  for (const f of liste || []) (estAdministratif(f) ? administratifs : marchandise).push(f)
  return { marchandise, administratifs }
}

// Un crédit négatif est une avance, pas une dette.
export function totalDu(liste = []) {
  return (liste || [])
    .filter(f => f.actif !== false && n(f.credit_actuel) > 0)
    .reduce((s, f) => s + n(f.credit_actuel), 0)
}

const premierDu = iso => `${String(iso).slice(0, 7)}-01`
function decaler(moisISO, k) {
  const [a, m] = moisISO.split('-').map(Number)
  const t = a * 12 + (m - 1) + k
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
}

/** Le 1er du mois de la prochaine échéance pas encore facturée, ou null. */
export function prochaineEcheance(f, aujourdhui) {
  if (!(n(f?.facture_mensuelle) > 0)) return null
  const pas = f.facture_periodicite === 'annuel' ? 12 : 1
  const mc = premierDu(aujourdhui)
  let m = premierDu(f.facture_mensuelle_depuis || mc)
  // Le mois courant est déjà facturé (le 1er) : la prochaine est après.
  while (m <= mc) m = decaler(m, pas)
  return m
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const libMois = iso => `${MOIS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
const fmtF = v => Math.round(n(v)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')

/** « 25 000 F / mois · prochaine : novembre 2026 ». */
export function libelleEcheance(f, aujourdhui) {
  const p = prochaineEcheance(f, aujourdhui)
  if (!p) return 'Aucune échéance automatique'
  const par = f.facture_periodicite === 'annuel' ? 'an' : 'mois'
  return `${fmtF(f.facture_mensuelle)} F / ${par} · prochaine : ${libMois(p)}`
}

/** Mois proposés pour la (première) échéance : 2 pour un mensuel, 12 pour un annuel. */
export function choixMoisDepart(periodicite, aujourdhui, actuel = null) {
  const mc = premierDu(aujourdhui)
  const k = periodicite === 'annuel' ? 12 : 2
  const out = Array.from({ length: k }, (_, i) => decaler(mc, i))
  if (actuel) out.push(premierDu(actuel))
  return [...new Set(out)].sort()
}

/** Colonnes de la facture automatique à enregistrer sur la fiche. */
export function champsEcheance({ montant, periodicite, depuis } = {}, aujourdhui) {
  const m = Math.max(0, Math.round(n(montant)))
  return {
    facture_mensuelle: m,
    facture_periodicite: periodicite === 'annuel' ? 'annuel' : 'mensuel',
    facture_mensuelle_depuis: m > 0 ? premierDu(depuis || aujourdhui) : null,
  }
}

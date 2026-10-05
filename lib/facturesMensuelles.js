// ──────────────────────────────────────────────────────────────────────────────
// Factures mensuelles automatiques des fournisseurs (supabase_factures_mensuelles.sql).
//
// Exemple : « App et logiciel » à 20 000 F par mois et par restaurant. Le 1er du
// mois, la facture s'ajoute au reste dû. Il n'y a pas de tâche programmée :
// la fonction SQL appliquer_factures_mensuelles() rattrape les mois dus, et on
// l'appelle avant chaque calcul de crédit veille. Elle est idempotente (un mois
// facturé est noté et jamais refacturé) ; ici on évite seulement de la rappeler
// plus d'une fois par jour et par appareil.
// ──────────────────────────────────────────────────────────────────────────────

let dernierJour = null
let enCours = null

const jourLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Ajoute les factures mensuelles dues. Ne lève jamais : le point du jour ne doit pas bloquer. */
export async function appliquerFacturesMensuelles(supabase) {
  const jour = jourLocal()
  if (dernierJour === jour) return
  if (enCours) return enCours
  enCours = (async () => {
    try {
      const { error } = await supabase.rpc('appliquer_factures_mensuelles')
      if (error) console.error('[facturesMensuelles]', error.message)
      else dernierJour = jour
    } catch (err) {
      console.error('[facturesMensuelles]', err?.message || err)
    } finally {
      enCours = null
    }
  })()
  return enCours
}

/** "2026-10-01" → « octobre 2026 ». */
export function libelleMois(date) {
  const [y, m] = String(date || '').split('-').map(Number)
  if (!y || !m) return ''
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

/** Le 1er du mois courant (décalage 0) ou d'un mois suivant, au format AAAA-MM-01. */
export function premierDuMois(decalage = 0, base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth() + decalage, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

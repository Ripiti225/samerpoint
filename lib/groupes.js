// ──────────────────────────────────────────────────────────────────────────────
// Groupes de restaurants (supabase_groupes_restaurants.sql, 22/10/2026).
// Une fiche administrative appartient à un restaurant OU à un groupe (Groupe
// Samer, Groupe Al Kayan : arriérés CNPS, anciens d'un site fermé). Ces
// helpers donnent une clé et un nom uniques pour les deux cas.
// Pur : testé par lib/groupes.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

const PREFIXE = 'groupe:'

export function cleRattachement(f) {
  if (f?.restaurant_id) return f.restaurant_id
  return f?.groupe_id ? `${PREFIXE}${f.groupe_id}` : null
}

export function nomRattachement(cle, restaurants = [], groupes = []) {
  if (!cle) return '—'
  const c = String(cle)
  if (c.startsWith(PREFIXE)) {
    const id = c.slice(PREFIXE.length)
    return groupes.find(g => g.id === id)?.nom || 'Groupe'
  }
  return String(restaurants.find(r => r.id === c)?.nom || '').trim() || '—'
}

export function estFicheGroupe(f) {
  return !!f?.groupe_id && !f?.restaurant_id
}

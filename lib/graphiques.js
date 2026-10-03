// ──────────────────────────────────────────────────────────────────────────────
// Géométrie des graphiques (courbes, barres, anneaux) — sans React.
// Les composants qui dessinent sont dans components/graphiques.js.
// Testé par lib/graphiques.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────

/** Graduations « rondes » couvrant [min, max] (0 toujours inclus). */
export function bornesJolies(min, max, nbPas = 4) {
  let bas = Math.min(0, Number(min) || 0)
  let haut = Math.max(0, Number(max) || 0)
  if (bas === haut) haut = bas + 1
  const brut = (haut - bas) / nbPas
  const puissance = 10 ** Math.floor(Math.log10(brut))
  const pas = [1, 2, 2.5, 5, 10].map(m => m * puissance).find(p => p >= brut) || brut
  bas = Math.floor(bas / pas) * pas
  haut = Math.ceil(haut / pas) * pas
  const ticks = []
  for (let v = bas; v <= haut + pas / 2; v += pas) ticks.push(Math.round(v * 1e6) / 1e6)
  return { min: bas, max: haut, pas, ticks }
}

/**
 * Courbe lisse qui passe par tous les points sans dépasser (interpolation
 * monotone de Fritsch–Carlson) : une courbe de ventes ne doit jamais inventer
 * un creux ou un pic entre deux jours.
 */
export function cheminLisse(points) {
  const p = (points || []).filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))
  if (!p.length) return ''
  if (p.length === 1) return `M${p[0].x},${p[0].y}`
  const n = p.length
  const dx = [], pente = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = p[i + 1].x - p[i].x
    pente[i] = dx[i] ? (p[i + 1].y - p[i].y) / dx[i] : 0
  }
  const t = [pente[0]]
  for (let i = 1; i < n - 1; i++) t[i] = pente[i - 1] * pente[i] <= 0 ? 0 : (pente[i - 1] + pente[i]) / 2
  t[n - 1] = pente[n - 2]
  for (let i = 0; i < n - 1; i++) {
    if (pente[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / pente[i], b = t[i + 1] / pente[i]
    const s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * pente[i]; t[i + 1] = k * b * pente[i] }
  }
  let d = `M${p[0].x},${p[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${p[i].x + h},${p[i].y + t[i] * h} ${p[i + 1].x - h},${p[i + 1].y - t[i + 1] * h} ${p[i + 1].x},${p[i + 1].y}`
  }
  return d
}

/** La même courbe fermée jusqu'à la ligne de base (pour le dégradé dessous). */
export function cheminAire(points, yBase) {
  const p = (points || []).filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))
  if (p.length < 2) return ''
  return `${cheminLisse(p)} L${p[p.length - 1].x},${yBase} L${p[0].x},${yBase} Z`
}

const hex = c => {
  const s = String(c || '#000000').replace('#', '')
  const v = s.length === 3 ? s.split('').map(x => x + x).join('') : s.slice(0, 6)
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) || 0)
}

/** Mélange deux couleurs (#rrggbb) : t = 0 → a, t = 1 → b. */
export function melangerCouleurs(a, b, t) {
  const k = Math.max(0, Math.min(1, Number(t) || 0))
  const [r1, g1, b1] = hex(a), [r2, g2, b2] = hex(b)
  const m = (x, y) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0')
  return `#${m(r1, r2)}${m(g1, g2)}${m(b1, b2)}`
}

/** Indices des étiquettes à afficher pour en garder au plus `max`. */
export function etiquettesEspacees(nb, max = 7) {
  if (nb <= max) return Array.from({ length: nb }, (_, i) => i)
  const pas = Math.ceil((nb - 1) / (max - 1))
  const out = []
  for (let i = 0; i < nb; i += pas) out.push(i)
  if (out[out.length - 1] !== nb - 1) {
    if (nb - 1 - out[out.length - 1] < pas / 2) out[out.length - 1] = nb - 1
    else out.push(nb - 1)
  }
  return out
}

/** 1 250 000 → « 1,3 M » ; 850 000 → « 850 k » ; 950 → « 950 ». */
export function fmtCourt(v) {
  const x = Number(v) || 0
  const a = Math.abs(x)
  if (a >= 1e6) return `${(x / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: a >= 1e7 ? 0 : 1 })} M`
  if (a >= 1e3) return `${Math.round(x / 1e3).toLocaleString('fr-FR')} k`
  return `${Math.round(x)}`
}

/** Arcs d'un anneau : [{ debut, fin }] en fractions de tour (0 → 1). */
export function arcsAnneau(valeurs) {
  const total = (valeurs || []).reduce((s, v) => s + Math.max(0, Number(v) || 0), 0)
  let cumul = 0
  return (valeurs || []).map(v => {
    const part = total ? Math.max(0, Number(v) || 0) / total : 0
    const arc = { debut: cumul, fin: cumul + part, part }
    cumul += part
    return arc
  })
}

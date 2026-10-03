// ──────────────────────────────────────────────────────────────────────────────
// Vérification des points — tri de la liste et résumé d'un point. Logique pure.
//
//  - Un mois à la fois : compteurs et historique portent sur le mois choisi.
//  - Les points validés mais jamais vérifiés d'un mois précédent restent en tête
//    (« en retard »), quel que soit le mois choisi.
//  - Alertes d'un point : écart de caisse, photos manquantes.
// Tests : lib/verificationListe.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

const n = v => Number(v) || 0
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

// 'AAAA-MM' → { debut: 'AAAA-MM-01', finExclue: 1er du mois suivant }
export function bornesDuMois(mois) {
  const [a, m] = mois.split('-').map(Number)
  const suivant = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
  return { debut: `${mois}-01`, finExclue: `${suivant}-01` }
}

export function moisVoisin(mois, decalage) {
  const [a, m] = mois.split('-').map(Number)
  const t = a * 12 + (m - 1) + decalage
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

export function libelleMoisLong(mois) {
  const [a, m] = mois.split('-').map(Number)
  const nom = MOIS[m - 1] || ''
  return `${nom.charAt(0).toUpperCase()}${nom.slice(1)} ${a}`
}

// points : ceux du mois + les « à vérifier » plus anciens.
// Rend { aVerifier: [{ point, enRetard }], historique, compteurs }.
export function organiserPoints(points = [], mois) {
  const { debut, finExclue } = bornesDuMois(mois)
  const duMois = (points || []).filter(p => p.date >= debut && p.date < finExclue)
  const enRetard = (points || []).filter(p => p.date < debut && p.valide && !p.verifie)
    .sort((a, b) => a.date.localeCompare(b.date))
  const aVerifierMois = duMois.filter(p => p.valide && !p.verifie).sort((a, b) => b.date.localeCompare(a.date))
  return {
    aVerifier: [...enRetard.map(point => ({ point, enRetard: true })), ...aVerifierMois.map(point => ({ point, enRetard: false }))],
    historique: duMois.filter(p => !(p.valide && !p.verifie)).sort((a, b) => b.date.localeCompare(a.date)),
    compteurs: {
      aVerifier: aVerifierMois.length,
      verifies: duMois.filter(p => p.verifie).length,
      enCours: duMois.filter(p => !p.valide).length,
    },
  }
}

// Alertes affichées sur la carte d'un point : [{ texte, ton: 'rouge' | 'orange' | 'vert' }].
export function alertesPoint(point, photosManquantes = []) {
  const out = []
  if (point.ecart_caisse !== null && point.ecart_caisse !== undefined) {
    const e = Math.round(n(point.ecart_caisse))
    out.push(e === 0
      ? { texte: 'Caisse juste', ton: 'vert' }
      : { texte: `Écart ${e > 0 ? '+' : '−'} ${Math.abs(e).toLocaleString('fr-FR').replace(/[  ]/g, ' ')}`, ton: 'rouge' })
  }
  if (photosManquantes.length) {
    out.push({ texte: `${photosManquantes.length} photo${photosManquantes.length > 1 ? 's' : ''} manquante${photosManquantes.length > 1 ? 's' : ''}`, ton: 'orange' })
  }
  return out
}

// Ventes d'un point par canal, de la plus grosse à la plus petite (canaux à 0 retirés).
export function ventesParCanal(point = {}, especes = 0) {
  return [
    { canal: 'Espèces', montant: n(especes) },
    { canal: 'Wave', montant: n(point.wave) },
    { canal: 'Orange Money', montant: n(point.om) },
    { canal: 'Djamo', montant: n(point.djamo) },
    { canal: 'Yango', montant: n(point.yango_tab) },
    { canal: 'Glovo', montant: n(point.glovo_tab) },
  ].filter(c => c.montant > 0).sort((a, b) => b.montant - a.montant)
}

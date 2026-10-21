// ──────────────────────────────────────────────────────────────────────────────
// Commentaire facultatif de la Vérification, envoyé dans la notification.
//
// Le gérant n'a aucun écran qui reprenne un ancien point : la notification est
// le seul endroit où il lit la décision. Elle doit donc porter, en clair,
// l'écart, l'explication donnée par le caissier et le commentaire du
// vérificateur — et rien de vide (« Commentaire : » sans texte).
// Tests : lib/commentaireVerification.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

export const COMMENTAIRE_MAX = 500

export function nettoyerCommentaire(texte) {
  return String(texte ?? '').trim().slice(0, COMMENTAIRE_MAX)
}

/** Message de décision : phrase de base + écart, explication et commentaire s'ils existent. */
export function messageDecision(base, { ecart, explication, commentaire } = {}) {
  const lignes = [String(base || '').trim()]
  const e = String(ecart ?? '').trim()
  if (e) lignes.push(`Écart : ${e}`)
  const x = String(explication ?? '').trim()
  if (x) lignes.push(`Explication du caissier : « ${x} »`)
  const c = nettoyerCommentaire(commentaire)
  if (c) lignes.push(`Commentaire de la vérification : ${c}`)
  return lignes.filter(Boolean).join('\n')
}

/**
 * Qui reçoit une décision de la Vérification. Le gérant toujours ; la direction
 * dès que le vérificateur a écrit un commentaire. Le patron se connecte en
 * « manager » (aucun compte « directeur » n'existe) : sans ce rôle, il ne
 * recevait aucun commentaire (21/10/2026).
 */
export function ciblesVerification(commentaire) {
  return nettoyerCommentaire(commentaire) ? ['gerant', 'manager', 'directeur'] : ['gerant']
}

/** Appréciation globale posée en marquant le point vérifié. null = rien à envoyer. */
export function messagePointVerifie({ restaurant, date, par, commentaire }) {
  const c = nettoyerCommentaire(commentaire)
  if (!c) return null
  const qui = par ? ` par ${par}` : ''
  const ou = restaurant ? `${restaurant} — ` : ''
  return `${ou}point du ${date} vérifié${qui}.\nAppréciation : ${c}`
}

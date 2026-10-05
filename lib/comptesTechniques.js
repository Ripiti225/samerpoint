// ──────────────────────────────────────────────────────────────────────────────
// Comptes techniques : un compte `utilisateurs` créé pour une fiche RH de
// caissier/gérant qui n'a pas de vrai compte Samtrackly. Il sert UNIQUEMENT à
// ce que le pont POS reconnaisse la personne (chaîne fiche RH → compte) ; on
// ne peut pas s'y connecter. Voir supabase_caissiers_sans_compte.sql.
// Tests : lib/comptesTechniques.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

// Jamais égal à un PIN tapé (toujours des chiffres).
export const PIN_SANS_CONNEXION = 'SANS_CONNEXION'

export const estCompteTechnique = u => u?.pin === PIN_SANS_CONNEXION

// Liste de l'écran de connexion : les comptes techniques n'y figurent pas.
export const comptesConnectables = (liste = []) => (liste || []).filter(u => !estCompteTechnique(u))

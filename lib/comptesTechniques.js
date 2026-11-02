// ──────────────────────────────────────────────────────────────────────────────
// Comptes techniques : un compte `utilisateurs` créé pour une fiche RH de
// caissier/gérant qui n'a pas de vrai compte Samtrackly. Il sert UNIQUEMENT à
// ce que le pont POS reconnaisse la personne (chaîne fiche RH → compte) ; on
// ne peut pas s'y connecter. Voir supabase_caissiers_sans_compte.sql.
// Tests : lib/comptesTechniques.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

// Jamais égal à un PIN tapé (toujours des chiffres).
export const PIN_SANS_CONNEXION = 'SANS_CONNEXION'

// Le code n'est plus lu par l'app (02/11/2026) : la colonne sans_connexion le dit.
export const estCompteTechnique = u => u?.sans_connexion === true || u?.pin === PIN_SANS_CONNEXION

// Liste de l'écran de connexion : les comptes techniques n'y figurent pas.
export const comptesConnectables = (liste = []) => (liste || []).filter(u => !estCompteTechnique(u))

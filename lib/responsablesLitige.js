// Liste « Responsable » d'un litige : comptes de connexion du restaurant
// (caissiers, gérant) + toute l'équipe (travailleurs actifs : cuisiniers,
// pizzaïolos, serveurs…), rangés par poste. Un travailleur n'a pas de compte :
// il est enregistré par son nom seul (responsable_id = null, la clé étrangère
// pointe sur utilisateurs).

const GROUPES = ['Caisse', 'Gérance', 'Cuisine', 'Service', 'Autres']

const sansAccent = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const cleNom = (s) => sansAccent(s).replace(/[^a-z0-9]+/g, ' ').trim()
// Même personne quel que soit l'ordre : « KOUASSI NOE » = « Noé Kouassi ».
const clePersonne = (s) => cleNom(s).split(' ').filter(Boolean).sort().join(' ')

/** « Cuisinière » → Cuisine, « Gérant / manager » → Gérance, role 'caissier' → Caisse… */
export function groupePoste(poste) {
  const p = sansAccent(poste)
  if (/caiss/.test(p)) return 'Caisse'
  if (/gerant|manager|direct/.test(p)) return 'Gérance'
  if (/cuisin|chef|pizza|aide|plong/.test(p)) return 'Cuisine'
  if (/serveu|comptoir|barman|livreu/.test(p)) return 'Service'
  return 'Autres'
}

/**
 * utilisateurs : [{ id, nom, role }] ; travailleurs : [{ id, nom, poste }].
 * → [{ groupe, personnes: [{ cle, id, nom, poste }] }] dans l'ordre des GROUPES.
 * Une même personne (compte + fiche travailleur) n'apparaît qu'une fois, avec
 * l'id du compte.
 */
export function personnesParGroupe(utilisateurs = [], travailleurs = [], recherche = '') {
  const vus = new Map()
  for (const u of utilisateurs) {
    const k = clePersonne(u.nom)
    if (k && !vus.has(k)) vus.set(k, { cle: `u:${u.id}`, id: u.id, nom: String(u.nom).trim(), poste: u.role })
  }
  for (const t of travailleurs) {
    const k = clePersonne(t.nom)
    if (!k) continue
    // Déjà là par son compte : le poste de la fiche est plus précis que le rôle.
    if (vus.has(k)) { if (t.poste) vus.get(k).poste = t.poste; continue }
    vus.set(k, { cle: `t:${t.id}`, id: null, nom: String(t.nom).trim(), poste: t.poste })
  }
  const q = cleNom(recherche)
  const groupes = new Map(GROUPES.map(g => [g, []]))
  for (const p of vus.values()) {
    if (q && !cleNom(p.nom).includes(q)) continue
    groupes.get(groupePoste(p.poste)).push(p)
  }
  return GROUPES
    .map(g => ({ groupe: g, personnes: groupes.get(g).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')) }))
    .filter(g => g.personnes.length)
}

/** La personne est-elle celle déjà choisie sur le litige ? (par compte, sinon par nom) */
export function estChoisi(personne, responsableId, responsableNom) {
  if (personne.id && responsableId) return personne.id === responsableId
  return !!responsableNom && clePersonne(personne.nom) === clePersonne(responsableNom)
}

/**
 * Litige automatique dont on change le responsable à la main : on le marque
 * pour que le recalcul ne le remette pas sur le caissier (planEcriture).
 * Renvoie le detail à écrire, ou undefined s'il ne faut pas y toucher.
 */
export function detailApresChoix(litige, responsableId, responsableNom) {
  if (!litige || litige.origine !== 'auto') return undefined
  const change = (litige.responsable_id ?? null) !== (responsableId ?? null)
    || cleNom(litige.responsable_nom) !== cleNom(responsableNom)
  if (!change) return undefined
  return { ...(litige.detail || {}), responsable_manuel: true }
}

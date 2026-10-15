// ──────────────────────────────────────────────────────────────────────────────
// Recherche globale (loupe de l'accueil) — logique pure.
//
// La recherche elle-même tourne en base : fonction SQL recherche_globale
// (supabase_recherche_globale.sql). Ici : extrait surligné, groupes par source,
// chemin « Écran › Onglet », route à ouvrir et droit d'ouverture du gérant.
// Spéc : docs/superpowers/specs/2026-10-12-recherche-globale-design.md
// Tests : lib/rechercheGlobale.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { LIBELLES_ONGLET } from './tresorerie.js'

export const LONGUEUR_MIN = 3
// Résultats renvoyés au plus par source (les plus récents).
export const LIMITE_PAR_SOURCE = 25

// Même règle que rg_norm() en base : minuscules, accents retirés.
export const normaliser = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Libellé de chaque écran que peut ouvrir un résultat.
const LIBELLES_ECRAN = {
  'modifier-point': 'Modifier un point',
  'depenses': 'Dépenses',
  'deductions-gerant': 'Déductions gérant',
  'credits-fournisseurs': 'Crédits fournisseurs',
  'verification': 'Vérification',
  'point-caissier': 'Point caissier',
  'presences': 'Présences',
  'livraisons': 'Livraisons',
  'gestion-stock': 'Stock',
  'equipe': 'Équipe',
  'demandes': 'Demandes',
  'demandes-admin': 'Demandes',
  'demandes-explication': "Demandes d'explication",
  'demandes-explication-admin': "Demandes d'explication",
  'rh': 'RH',
  'contrats': 'Contrats',
  'embauches': 'Nouveaux travailleurs',
  'documents': 'Documents',
  'litiges': 'Litiges',
  'contacts': 'Contacts',
  'avis-plateformes': 'Avis plateformes',
  'charges': 'Charges',
  'tresorerie-a-payer': 'Trésorerie › À payer',
  'tresorerie-restaurant': 'Trésorerie › Restaurant',
  'tresorerie-direction': 'Trésorerie › Direction',
  'tresorerie-partenaires': 'Trésorerie › Partenaires',
  'tresorerie-coffre': 'Trésorerie › Coffre',
  'journal': 'Journal',
}

// Écrans qui s'ouvrent tout seuls au bon endroit (restaurant, date, onglet,
// fiche ou ligne encadrée) : pas de bandeau de rappel pour leurs résultats.
// Gardent le bandeau : livraisons (saisie du shift d'un caissier, pas de
// consultation), depenses et deductions-gerant côté gérant (des totaux seulement).
export const ECRANS_AU_BON_ENDROIT = [
  'modifier-point', 'verification', 'point-caissier', 'credits-fournisseurs', 'equipe',
  'tresorerie-a-payer', 'tresorerie-restaurant', 'tresorerie-partenaires', 'tresorerie-direction',
  'tresorerie-coffre', 'litiges', 'presences', 'gestion-stock', 'contrats', 'documents', 'contacts',
  'avis-plateformes', 'charges', 'journal',
  'demandes', 'demandes-admin', 'demandes-explication', 'demandes-explication-admin',
]

export const besoinBandeau = r => !!r && !ECRANS_AU_BON_ENDROIT.includes(r.ecran)

// Extrait du texte autour de la première occurrence du terme (sans accents ni
// majuscules), en gardant le texte d'origine. Les indices restent alignés : la
// décomposition NFD d'une lettre accentuée retirée de ses accents garde une lettre.
export function extrait(texte, terme, rayon = 40) {
  const t = String(texte ?? '').replace(/\s+/g, ' ').trim()
  const m = normaliser(String(terme ?? '').trim())
  const i = m ? normaliser(t).indexOf(m) : -1
  if (i < 0) {
    return { avant: t.length > 2 * rayon ? t.slice(0, 2 * rayon) + '…' : t, trouve: '', apres: '' }
  }
  const debut = Math.max(0, i - rayon)
  const fin = Math.min(t.length, i + m.length + rayon)
  return {
    avant: (debut > 0 ? '…' : '') + t.slice(debut, i),
    trouve: t.slice(i, i + m.length),
    apres: t.slice(i + m.length, fin) + (fin < t.length ? '…' : ''),
  }
}

// Les champs JSON (détail d'un litige, détails du journal) s'affichent en
// « clé : valeur · … » plutôt qu'en accolades.
export function texteLisible(texte) {
  const t = String(texte ?? '')
  if (!t.startsWith('{')) return t
  try {
    const obj = JSON.parse(t)
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== '')
      .map(([k, v]) => `${k} : ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' · ')
  } catch {
    return t
  }
}

export function grouperParSource(resultats) {
  const groupes = new Map()
  for (const r of resultats || []) {
    if (!groupes.has(r.source)) groupes.set(r.source, [])
    groupes.get(r.source).push(r)
  }
  return [...groupes].map(([source, liste]) => ({ source, resultats: liste }))
}

// Onglets passés en paramètre (Modifier un point, Litiges) : libellé affiché.
const LIBELLES_ONGLET_ECRAN = { glovo: 'Glovo', yango: 'Yango', avis: 'Avis clients', point_pas_fait: 'Point pas fait' }

// Icône (MaterialCommunityIcons) de chaque rubrique de résultats.
const ICONES_SOURCE = {
  'Dépenses du point': 'cash-minus', 'Dépenses gérant': 'wallet-outline', 'Points (journée)': 'calendar-check-outline',
  'Points caissier': 'receipt-text-outline', 'Présences': 'account-clock-outline', 'Commandes livraison': 'moped-outline',
  'Factures fournisseurs': 'file-document-outline', 'Corrections de crédit': 'pencil-box-outline',
  'Paiements fournisseurs': 'cash-check', 'Fournisseurs': 'truck-outline', 'Inventaire': 'package-variant-closed',
  'Déductions vérification': 'magnify-scan', 'Travailleurs': 'account-group-outline', 'Demandes': 'hand-back-right-outline',
  "Demandes d'explication": 'message-question-outline', 'Permissions et congés': 'beach', 'Contrats': 'file-sign',
  'Documents': 'folder-outline', 'Documents travailleur': 'folder-account-outline', 'Litiges Glovo': 'scale-balance',
  'Litiges Yango': 'scale-balance', 'Litiges avis clients': 'scale-balance', 'Point pas fait': 'scale-balance',
  'Contacts clients': 'phone-outline', 'Avis plateformes': 'star-outline', 'Charges': 'home-city-outline',
  'À payer': 'calendar-alert', 'Prévisions de paiement': 'calendar-clock-outline', 'Cotisations reçues': 'piggy-bank-outline',
  'Mouvements restaurant': 'swap-horizontal', 'Transferts de fond': 'bank-transfer', 'Dépenses direction': 'office-building-outline',
  'Partenaires': 'handshake-outline', 'Coffre': 'safe', 'Emprunts au coffre': 'hand-coin-outline', 'Journal': 'history',
}
export const iconeSource = source => ICONES_SOURCE[source] || 'magnify'

// « 42 résultats · 6 rubriques »
export function resumeResultats(groupes) {
  const n = (groupes || []).reduce((s, g) => s + g.resultats.length, 0)
  const k = (groupes || []).length
  return `${n} résultat${n > 1 ? 's' : ''} · ${k} rubrique${k > 1 ? 's' : ''}`
}

// Groupes repliés : à chaque nouvelle recherche tout est fermé, sauf s'il n'y a
// qu'un seul groupe (il s'ouvre tout seul). Plusieurs groupes peuvent être ouverts.
export function ouverturesInitiales(groupes) {
  return groupes?.length === 1 ? { [groupes[0].source]: true } : {}
}

// Liste à plat pour la FlatList : une bannière par groupe, puis — s'il est
// ouvert — ses cartes et la mention « les N plus récents » quand la limite est atteinte.
// `dernier` marque la dernière ligne de chaque groupe (bas arrondi de la carte iOS).
export function lignesAffichees(groupes, ouverts, limite = LIMITE_PAR_SOURCE) {
  return (groupes || []).flatMap(g => {
    const ouvert = !!ouverts?.[g.source]
    const lignes = [
      { cle: `g:${g.source}`, groupe: g, ouvert },
      ...(ouvert ? g.resultats.map(r => ({ cle: `${r.source}:${r.id}`, resultat: r })) : []),
      ...(ouvert && g.resultats.length >= limite ? [{ cle: `l:${g.source}`, limite: true }] : []),
    ]
    lignes[lignes.length - 1] = { ...lignes[lignes.length - 1], dernier: true }
    return lignes
  })
}

export function cheminEcran(r) {
  const ecran = LIBELLES_ECRAN[r.ecran] || r.ecran
  const brut = r.onglet || r.params?.onglet
  const onglet = brut ? (LIBELLES_ONGLET[brut] || LIBELLES_ONGLET_ECRAN[brut] || brut) : null
  return onglet ? `${ecran} › ${onglet}` : ecran
}

export function routePour(r) {
  return { pathname: `/${r.ecran}`, params: r.params || {} }
}

// Le manager ouvre tout ; le gérant seulement les écrans de ses tuiles.
export function peutOuvrir(r, idsTuiles, manager) {
  return !!manager || (idsTuiles || []).includes(r.ecran)
}

export function dateCourte(d) {
  if (!d) return ''
  const [y, m, j] = String(d).slice(0, 10).split('-')
  return `${j}/${m}/${y.slice(2)}`
}

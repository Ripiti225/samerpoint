// ──────────────────────────────────────────────────────────────────────────────
//  RÉPONSES AUX AVIS GLOVO — proposition par motif et vérification
//
//  Le manager valide ou modifie la réponse proposée ; le favori l'envoie.
//  Glovo annule une réponse qui contient un chiffre ou un nom de restaurant,
//  et son champ s'arrête à 250 caractères (relevé le 21/10/2026).
//  Spec : docs/superpowers/specs/2026-10-21-reponses-avis-glovo-design.md
//  Tests : lib/reponsesAvis.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

export const MAX_REPONSE = 250

export const MODELES = {
  manquant_erreur: 'Bonjour, merci pour votre retour et toutes nos excuses pour cette erreur dans votre commande. Nous avons fait le point avec l\'équipe pour que cela ne se reproduise pas. Au plaisir de mieux vous servir.',
  froid_sec: 'Bonjour, merci pour votre retour. Nous sommes désolés que votre commande ne soit pas arrivée chaude et fraîche. Nous revoyons la préparation et la remise au livreur. Au plaisir de mieux vous servir.',
  gout: 'Bonjour, merci d\'avoir pris le temps de nous écrire. Nous sommes désolés que le goût ne vous ait pas plu. Votre remarque est transmise à notre cuisine. Au plaisir de vous régaler la prochaine fois.',
  photo_portion: 'Bonjour, merci pour votre retour. Nous sommes désolés que votre commande ne corresponde pas à vos attentes. Nous veillons à ce que chaque plat soit servi comme présenté. Au plaisir de vous revoir.',
  emballage: 'Bonjour, merci pour votre retour et toutes nos excuses pour l\'état de votre commande à l\'arrivée. Nous renforçons la vérification des emballages avant chaque départ. Au plaisir de mieux vous servir.',
  negatif_autre: 'Bonjour, merci pour votre retour. Nous sommes désolés que votre expérience n\'ait pas été à la hauteur. Votre remarque est transmise à l\'équipe. Au plaisir de mieux vous servir très bientôt.',
  positif: 'Bonjour, merci beaucoup pour votre message ! Toute l\'équipe est ravie que vous ayez apprécié votre commande. À très bientôt !',
  positif_mais: 'Bonjour, merci pour votre message, nous sommes ravis que vous ayez apprécié ! Nous prenons note de votre remarque pour que la prochaine commande soit parfaite. À très bientôt !',
}

export const LIBELLES_MOTIF = {
  manquant_erreur: 'Produit manquant ou erreur',
  froid_sec: 'Froid, sec',
  gout: 'Goût',
  photo_portion: 'Différent de la photo, portion',
  emballage: 'Emballage',
  negatif_autre: 'Avis négatif',
  positif: 'Avis positif',
  positif_mais: 'Positif avec une remarque',
}

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[’`]/g, '\'')

// Étiquettes Glovo (libellés français de THEMES_GLOVO, public/bouton-avis.js).
const PAR_THEME = [
  ['manquant_erreur', ['produits manquants ou incorrects']],
  ['gout', ['mauvais gout']],
  ['photo_portion', ['portion trop petite', 'taille des portions']],
  ['emballage', ['qualite de l\'emballage']],
]

// Mots du client, dans l'ordre de priorité (emballage avant goût : « renversé,
// immangeable » parle de l'emballage).
const PAR_MOTS = [
  ['manquant_erreur', /pas re[cç]u|manqu|oubli|pas (la|le|les) bon|pas celle|pas celui|pas ce que|au lieu|a la place|plutot que|contraire|erreur|tromp|j['\s]?ai demande|y['\s]?(a|avait) pas/],
  ['froid_sec', /froid|tiede|\bsec(he)?s?\b|pas chaud|pas frais|rassis|vieil/],
  ['emballage', /emballage|renvers|couvert|papier alu|\bsac\b|fuite|ecrase|mauvais etat/],
  ['gout', /gout|fade|\bsalee?s?\b|trop de sel|immangeable|pas bon|mauvais(e)? (pizza|pate|qualite)|\bpate\b/],
  ['photo_portion', /photo|portion|trop petit|quantite|pas assez/],
]

const RESERVE = /\bmais\b|\bsauf\b|pas eu de|peut faire mieux|manquait|dommage|livreur|impoli/

function themes(avis) {
  const t = avis?.raw?.raw?.theme
  return (Array.isArray(t) ? t : t ? [t] : []).map(norm)
}

export function detecterMotif(avis) {
  const texte = norm(avis?.comment)
  if (avis?.classification !== 'negatif') return RESERVE.test(texte) ? 'positif_mais' : 'positif'
  // Les mots du client d'abord : ses étiquettes Glovo sont souvent cochées au
  // hasard (« Repas froid » étiqueté « Mauvais goût »).
  for (const [motif, re] of PAR_MOTS) if (re.test(texte)) return motif
  const ts = themes(avis)
  for (const [motif, libelles] of PAR_THEME) if (ts.some(t => libelles.includes(t))) return motif
  return 'negatif_autre'
}

export function proposerReponse(avis) {
  const motif = detecterMotif(avis)
  return { motif, texte: MODELES[motif] }
}

const MARQUES = [['samer', 'Samer'], ['kayan', 'Kayan'], ['yango', 'Yango'], ['glovo', 'Glovo'], ['uber', 'Uber'], ['jumia', 'Jumia'], ['xpress', 'Xpress']]

export function verifierReponse(texte) {
  const t = String(texte ?? '').trim()
  if (!t) return ['Écrivez une réponse.']
  const problemes = []
  if (t.length > MAX_REPONSE) problemes.push(`Trop long : ${t.length} / ${MAX_REPONSE} caractères.`)
  if (/\d/.test(t)) problemes.push('Retirez les chiffres : Glovo refuse les réponses qui en contiennent.')
  const n = norm(t)
  for (const [cle, nom] of MARQUES) {
    if (new RegExp(`\\b${cle}`).test(n)) problemes.push(`Retirez « ${nom} » : pas de nom de restaurant ni de marque.`)
  }
  return problemes
}

/** Avis Glovo écrits, sans réponse ou dont la réponse a été refusée par Glovo. */
export function avisARepondre(avis, reponsesParAvis) {
  return (avis || []).filter(a => {
    if (a.platform !== 'glovo' || !String(a.comment || '').trim()) return false
    const r = reponsesParAvis?.get(a.id)
    return !r || r.statut === 'refusee'
  })
}

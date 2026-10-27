// ──────────────────────────────────────────────────────────────────────────────
//  FAVORI « VENTES YANGO → SAMTRACKLY » — fabrication du lien
//
//  Le moteur (public/bouton-ventes-yango.js) est servi tel quel ; on l'emballe
//  dans un lien `javascript:` avec l'origine Samtrackly, où s'ouvre l'écran
//  d'import. Pas de secret : l'import se fait dans l'app, avec la session.
// ──────────────────────────────────────────────────────────────────────────────

export function construireFavoriVentes(source, { origine }) {
  if (!source || !String(source).includes('function moteurVentesYango()')) {
    throw new Error('Le code du favori est introuvable.')
  }
  const config = JSON.stringify({ origine: String(origine).replace(/\/+$/, '') })
  return 'javascript:' + encodeURIComponent(`(function(){${source}\nmoteurVentesYango().lancer(${config})})()`)
}

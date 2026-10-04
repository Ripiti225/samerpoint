// ──────────────────────────────────────────────────────────────────────────────
//  BOUTON « AVIS → SAMTRACKLY » — fabrication du favori Chrome
//
//  Le moteur (public/bouton-avis.js) est servi tel quel ; on l'emballe ici
//  dans un lien `javascript:` avec l'origine Samtrackly (où vit la page
//  relais) et le secret d'ingestion collé par le manager. Le secret n'est
//  jamais enregistré : il ne vit que dans le favori.
// ──────────────────────────────────────────────────────────────────────────────

/** Le secret d'ingestion : 64 caractères hexadécimaux (openssl rand -hex 32). */
export function secretValide(secret) {
  return /^[0-9a-f]{64}$/i.test(String(secret || '').trim())
}

export function construireFavori(source, { origine, secret }) {
  if (!source || !String(source).includes('function moteurAvis()')) {
    throw new Error('Le code du bouton est introuvable.')
  }
  const config = JSON.stringify({
    origine: String(origine).replace(/\/+$/, ''),
    secret: String(secret).trim(),
  })
  return 'javascript:' + encodeURIComponent(`(function(){${source}\nmoteurAvis().lancer(${config})})()`)
}

// Site À PART https://verif-personnel.vercel.app (projet Vercel « verif-personnel »,
// dossier verif-personnel/ du repo Samtrackly), ouvert par le QR au verso de la
// carte du travailleur (lib/carteTravailleur.js). Adresse gravée sur les cartes :
// ne jamais supprimer ni renommer ce projet. Publier :
//   cd verif-personnel && npx vercel deploy --prod --yes
// Aucune mention de Samtrackly ni de Supabase dans index.html (code visible de tous).
// verifier_carte : migration supabase_cartes_travailleurs.sql.
//
// Fonction serveur : seule à parler à
// Supabase. Le téléphone qui scanne ne voit ni l'adresse de la base, ni sa
// clé, ni l'application Samtrackly : il reçoit uniquement le résultat de
// verifier_carte (nom, poste, restaurant, validité, état) et la photo déjà
// réduite, intégrée à la réponse.
const URL_SUPABASE = 'https://wlwotzxnzowbkbfcpnyi.supabase.co'
const CLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indsd290enhuem93YmtiZmNwbnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjQ1OTEsImV4cCI6MjA5MTQ0MDU5MX0.nioXBAKA05_zRIyTpJmV_d4JY5mCYueOt5cKIlL-NNk'

const entetes = { apikey: CLE, Authorization: `Bearer ${CLE}` }

async function photoIntegree(url) {
  if (!url || !/\/storage\/v1\/object\/public\//.test(url)) return null
  const mini = `${url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}?width=240&height=240&resize=cover`
  for (const essai of [mini, url]) {
    try {
      const r = await fetch(essai)
      if (!r.ok) continue
      const type = r.headers.get('content-type') || 'image/jpeg'
      if (!type.startsWith('image/')) continue
      const octets = Buffer.from(await r.arrayBuffer())
      if (octets.length > 1500000) continue
      return `data:${type};base64,${octets.toString('base64')}`
    } catch { /* essai suivant */ }
  }
  return null
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex')
  const jeton = String((req.query && req.query.c) || '')
  if (!/^[0-9a-f-]{36}$/i.test(jeton)) return res.status(200).json(null)
  try {
    const r = await fetch(`${URL_SUPABASE}/rest/v1/rpc/verifier_carte`, {
      method: 'POST',
      headers: { ...entetes, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_jeton: jeton }),
    })
    if (!r.ok) return res.status(502).json({ erreur: true })
    const d = await r.json()
    if (!d) return res.status(200).json(null)
    return res.status(200).json({
      nom: d.nom, poste: d.poste, restaurant: d.restaurant, couleur: d.couleur,
      valide_jusqua: d.valide_jusqua, etat: d.etat,
      photo: await photoIntegree(d.photo_url),
    })
  } catch {
    return res.status(502).json({ erreur: true })
  }
}

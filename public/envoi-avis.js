// ──────────────────────────────────────────────────────────────────────────────
//  PAGE RELAIS DU BOUTON AVIS — /envoi-avis.html
//
//  Ouverte par le favori depuis le portail Glovo ou Yango. Elle reçoit le
//  secret puis les avis par postMessage et les envoie à ingest-reviews :
//  Yango interdit à ses pages d'appeler un autre site, le relais le fait à
//  sa place. Page statique, hors de l'app (pas de session, pas de garde).
//  N'écoute QUE les deux portails. Tests : lib/envoiAvis.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
function moteurRelais() {
  const PLATEFORMES = { 'https://portal.glovoapp.com': 'glovo', 'https://vendor.yango.com': 'yango' }
  const NOMS = { glovo: 'Glovo', yango: 'Yango' }
  const RESEAU = "L'envoi n'a pas abouti, rien n'est perdu : clique à nouveau dans quelques minutes."

  function plateformeDOrigine(origine) {
    return Object.prototype.hasOwnProperty.call(PLATEFORMES, origine) ? PLATEFORMES[origine] : null
  }

  function messageHttp(status) {
    return status === 401 ? "Le bouton n'est plus à jour : demande au manager de le réinstaller." : RESEAU
  }

  function pluriel(n, un, plusieurs) { return n + ' ' + (n > 1 ? plusieurs : un) }

  function resumeEnvoi(plateforme, r) {
    const nom = NOMS[plateforme] || plateforme
    if (!r.inserted) return nom + ' : aucun nouvel avis depuis le dernier envoi.'
    const parties = [pluriel(r.inserted, 'nouvel avis', 'nouveaux avis'), pluriel(r.litiges_crees || 0, 'litige créé', 'litiges créés')]
    if (r.unmapped) parties.push(r.unmapped + ' à rattacher')
    return nom + ' : ' + parties.join(' · ')
  }

  function demarrer(urlFonction) {
    const etat = document.getElementById('etat')
    function afficher(texte, genre) { etat.textContent = texte; etat.className = genre || '' }

    if (!window.opener) {
      afficher('Cette page s’ouvre toute seule quand on clique sur le bouton avis, depuis le portail Glovo ou Yango.')
      return
    }

    let secret = null
    let plateforme = null

    window.addEventListener('message', async function (e) {
      const p = plateformeDOrigine(e.origin)
      if (!p || e.source !== window.opener || !e.data) return
      const portail = e.source

      if (e.data.type === 'config') {
        secret = String(e.data.secret || '')
        plateforme = p
        afficher('Avis ' + NOMS[p] + ' : lecture en cours sur le portail…')
        try {
          const r = await fetch(urlFonction, { headers: { 'x-ingest-secret': secret } })
          if (!r.ok) {
            const m = messageHttp(r.status)
            afficher(m, 'erreur')
            portail.postMessage({ type: 'derniers', erreur: m }, e.origin)
            return
          }
          const j = await r.json()
          portail.postMessage({ type: 'derniers', derniers: j.derniers || {} }, e.origin)
        } catch (_e) {
          afficher(RESEAU, 'erreur')
          portail.postMessage({ type: 'derniers', erreur: RESEAU }, e.origin)
        }
      } else if (e.data.type === 'avis' && secret && p === plateforme) {
        const avis = Array.isArray(e.data.reviews) ? e.data.reviews : []
        afficher('Envoi de ' + avis.length + ' avis ' + NOMS[p] + ' à Samtrackly…')
        try {
          const envoi = await fetch(urlFonction, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
            body: JSON.stringify({ reviews: avis, finalize: false }),
          })
          if (!envoi.ok) { afficher(messageHttp(envoi.status), 'erreur'); return }
          afficher(resumeEnvoi(p, await envoi.json()), 'ok')
          setTimeout(function () { window.close() }, 8000)
        } catch (_e) {
          afficher(RESEAU, 'erreur')
        }
      } else if (e.data.type === 'erreur') {
        afficher(String(e.data.message || RESEAU), 'erreur')
      }
    })

    window.opener.postMessage({ type: 'pret' }, '*')
  }

  return { plateformeDOrigine: plateformeDOrigine, messageHttp: messageHttp, resumeEnvoi: resumeEnvoi, demarrer: demarrer }
}

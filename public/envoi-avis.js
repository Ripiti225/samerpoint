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
    if (r.litiges_attribues) parties.push(r.litiges_attribues + ' attribué' + (r.litiges_attribues > 1 ? 's' : '') + ' à un caissier')
    return nom + ' : ' + parties.join(' · ')
  }

  function resumeCommandes(plateforme, nb, r) {
    const nom = NOMS[plateforme] || plateforme
    const parties = [pluriel(nb, 'commande lue', 'commandes lues'), r.litiges ? pluriel(r.litiges, 'litige', 'litiges') : 'aucun litige']
    if (r.a_relier) parties.push(pluriel(r.a_relier, 'journée', 'journées') + ' à relier (Litiges → Correspondances)')
    if (r.a_rattacher) parties.push(pluriel(r.a_rattacher, 'commande', 'commandes') + ' d’une boutique non rattachée')
    return nom + ' : ' + parties.join(' · ')
  }

  // Réponses aux avis Glovo envoyées par le favori (validées dans Samtrackly).
  function resumeReponses(resultats) {
    if (!resultats.length) return ''
    const ok = resultats.filter(function (r) { return r.ok }).length
    const ko = resultats.length - ok
    let t = 'Réponses Glovo : ' + ok + ' envoyée' + (ok > 1 ? 's' : '')
    if (ko) t += ' · ' + ko + ' refusée' + (ko > 1 ? 's' : '') + ' par Glovo (à corriger dans Samtrackly)'
    return t
  }

  // urlCommandes : ingest-commandes-plateformes (litiges automatiques).
  function demarrer(urlFonction, urlCommandes) {
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
          // Derniers jours de commandes reçus : si cet appel échoue, les avis
          // passent quand même (le favori relira depuis hier).
          let derniersCommandes = {}
          try {
            const rc = await fetch(urlCommandes, { headers: { 'x-ingest-secret': secret } })
            if (rc.ok) derniersCommandes = (await rc.json()).derniers || {}
          } catch (_e) { /* avis seuls */ }
          portail.postMessage({ type: 'derniers', derniers: j.derniers || {}, commandes: derniersCommandes, reponses: j.reponses || [] }, e.origin)
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
          // La fenêtre reste ouverte : les commandes suivent.
          afficher(resumeEnvoi(p, await envoi.json()) + ' — lecture des commandes en cours…', 'ok')
        } catch (_e) {
          afficher(RESEAU, 'erreur')
        }
      } else if (e.data.type === 'commandes' && secret && p === plateforme) {
        const commandes = Array.isArray(e.data.commandes) ? e.data.commandes : []
        const avant = etat.textContent.replace(/ — lecture des commandes en cours…$/, '')
        afficher(avant + ' — envoi de ' + pluriel(commandes.length, 'commande', 'commandes') + ' et calcul des litiges…')
        try {
          const envoi = await fetch(urlCommandes, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
            body: JSON.stringify({ commandes: commandes }),
          })
          if (!envoi.ok) { afficher(messageHttp(envoi.status), 'erreur'); return }
          afficher(avant + '\n' + resumeCommandes(p, commandes.length, await envoi.json()), 'ok')
          setTimeout(function () { window.close() }, 12000)
        } catch (_e) {
          afficher(RESEAU, 'erreur')
        }
      } else if (e.data.type === 'reponses' && secret && p === plateforme) {
        const resultats = Array.isArray(e.data.resultats) ? e.data.resultats : []
        const zone = document.getElementById('reponses')
        try {
          const envoi = await fetch(urlFonction, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
            body: JSON.stringify({ reponses_resultats: resultats }),
          })
          zone.textContent = envoi.ok ? resumeReponses(resultats) : messageHttp(envoi.status)
          zone.className = envoi.ok ? 'ok' : 'erreur'
        } catch (_e) {
          zone.textContent = RESEAU
          zone.className = 'erreur'
        }
      } else if (e.data.type === 'erreur') {
        afficher(String(e.data.message || RESEAU), 'erreur')
      }
    })

    window.opener.postMessage({ type: 'pret' }, '*')
  }

  return { plateformeDOrigine: plateformeDOrigine, messageHttp: messageHttp, resumeEnvoi: resumeEnvoi, resumeCommandes: resumeCommandes, resumeReponses: resumeReponses, demarrer: demarrer }
}

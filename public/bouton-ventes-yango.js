// ──────────────────────────────────────────────────────────────────────────────
//  MOTEUR DU FAVORI « VENTES YANGO → SAMTRACKLY »
//
//  Servi tel quel (jamais transpilé) : app/bouton-ventes-yango.js l'emballe
//  dans un favori `javascript:` avec l'origine Samtrackly. Cliqué sur
//  vendor.yango.com, il :
//    1. ouvre la fenêtre /tresorerie-partenaires?favori=yango (dans le geste
//       de clic, sinon Chrome la bloque) ;
//    2. reprend la connexion de la page (en-têtes de sa prochaine requête) ;
//    3. à la demande de la fenêtre, lit les commandes et la pub d'une semaine ;
//    4. renvoie les commandes au format exact de l'export Excel, et la pub.
//  Le calcul (coupure, filtres, × 0,77) est fait dans l'app par analyserYango.
//  Seules des commandes et des pubs sortent du portail.
//
//  Tout doit rester DANS moteurVentesYango(). Tests : lib/boutonVentesYango.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
function moteurVentesYango() {
  const JOUR = 86400000
  const RACINE = '/4.0/restapp-front/'
  const PAR_PAGE = 50
  const ENTETES = ['Nom du restaurant', 'Numéro de la commande', 'Montant', 'Statut', 'La commande sera payée', 'Commande confirmée par le restaurant']

  function jourIso(ms) { return new Date(ms).toISOString().slice(0, 10) }
  function decaler(iso, k) { return jourIso(Date.parse(iso + 'T00:00:00Z') + k * JOUR) }

  // Semaine Yango vendredi → jeudi. L'export part du jeudi d'avant : la
  // coupure 22h/21h du premier jour est faite ensuite par analyserYango.
  function bornesLecture(periode) {
    return { from: decaler(periode.debut, -1), to: periode.fin }
  }

  // Colonne « Nom du restaurant » de l'export : « nom (adresse) ».
  function nomBoutique(place) {
    return String(place.name || '').trim() + ' (' + String(place.address || '').trim() + ')'
  }

  // « Commande confirmée par le restaurant » : UTC (= heure d'Abidjan).
  function dateExport(iso) {
    const t = Date.parse(iso)
    return iso && Number.isFinite(t) ? new Date(t).toISOString().slice(0, 19).replace('T', ' ') : ''
  }

  // Correspondance vérifiée le 26/10/2026 sur la semaine du 25/09 : mêmes
  // 500 lignes, mêmes coupures, mêmes totaux par restaurant que l'export.
  function ligneExport(commande, noms) {
    return [
      noms[commande.place_id] || String(commande.place_id),
      String(commande.order_nr),
      Number(commande.sum) || 0,
      commande.status === 'refused' ? 'Annulé' : 'Livré',
      commande.is_reimbursement_to_place === true ? 'Oui' : 'Non',
      dateExport(commande.place_confirmed_at),
    ]
  }

  function lignesExport(commandes, places) {
    const noms = {}
    places.forEach(function (p) { noms[p.id] = nomBoutique(p) })
    return [ENTETES.slice()].concat(commandes.map(function (c) { return ligneExport(c, noms) }))
  }

  // Réponse de reports/v1/place-metrics/get (une boutique, group_by day).
  function lirePub(json) {
    const m = ((json && json.available) || []).find(function (x) { return x.slug === 'cpa_advert_costs' })
    if (!m) return { montant: 0, dernierJour: null, majLe: null }
    let dernierJour = null
    ;(m.points_data || []).forEach(function (p) { if (Number(p.value) > 0) dernierJour = String(p.dt_from).slice(0, 10) })
    return {
      montant: Math.round(Number(m.total_value && m.total_value.value) || 0),
      dernierJour: dernierJour,
      majLe: m.updated_at ? String(m.updated_at).slice(0, 10) : null,
    }
  }

  // Dernier jour compté par Yango. Le 26/10/2026, ses statistiques s'étaient
  // arrêtées au 05/10 (« Mis à jour 6 octobre ») : 0 F chaque jour depuis.
  function pubAJourAu(lectures) {
    let maj = null
    let dernier = null
    lectures.forEach(function (l) {
      if (l.majLe && (!maj || l.majLe > maj)) maj = l.majLe
      if (l.dernierJour && (!dernier || l.dernierJour > dernier)) dernier = l.dernierJour
    })
    return maj ? decaler(maj, -1) : dernier
  }

  // ── Exécution sur le portail ─────────────────────────────────────────────
  const INCOMPLET = "La lecture Yango n'a pas abouti, rien n'est perdu : clique à nouveau dans quelques minutes."
  const SESSION = 'Ta session Yango a expiré : reconnecte-toi au portail puis clique à nouveau sur le favori.'
  const ATTENTE = 'Le portail ne répond pas : clique sur « Commandes » dans le menu du portail, puis à nouveau sur le favori.'
  const ATTENTES_REPRISE = [1000, 2000, 4000, 8000, 16000]
  const SANS = /^(x-idempotency-token|x-yarequestid|content-length)$/i

  function erreurFr(message) { const e = new Error(message); e.messageFr = message; return e }
  function frDate(iso) { const p = iso.split('-'); return p[2] + '/' + p[1] }
  function pause(ms) { return new Promise(function (ok) { setTimeout(ok, ms) }) }

  async function avecReprise(fn, attendre) {
    attendre = attendre || pause
    for (let essai = 0; ; essai++) {
      try { return await fn() } catch (e) {
        if (e && e.definitif) throw e
        if (essai >= ATTENTES_REPRISE.length) throw erreurFr(INCOMPLET)
        await attendre(ATTENTES_REPRISE[essai])
      }
    }
  }

  // On ne regarde que les NOMS d'en-têtes, jamais leur valeur.
  function aConnexion(entetes) {
    return Object.keys(entetes || {}).some(function (k) { return /oauth|authorization/i.test(k) })
  }

  // Attend la prochaine requête de la page vers l'API du portail et copie
  // ses en-têtes (sans ceux propres à une requête). Remet tout en place après.
  function capterConnexion(delaiMs) {
    return new Promise(function (ok, ko) {
      const proto = XMLHttpRequest.prototype
      const ouvrir = proto.open
      const poser = proto.setRequestHeader
      const envoyer = proto.send
      const fetchPage = window.fetch
      let fini = false
      let minuteur = null
      function remettre() {
        fini = true
        clearTimeout(minuteur)
        proto.open = ouvrir
        proto.setRequestHeader = poser
        proto.send = envoyer
        window.fetch = fetchPage
      }
      function garder(h) {
        if (fini || !aConnexion(h)) return
        remettre()
        const out = {}
        Object.keys(h).forEach(function (k) { if (!SANS.test(k)) out[k] = h[k] })
        ok(out)
      }
      proto.open = function (_m, u) {
        this.__ventesYango = String(u || '').indexOf(RACINE) !== -1 ? {} : null
        return ouvrir.apply(this, arguments)
      }
      proto.setRequestHeader = function (k, v) {
        if (this.__ventesYango) this.__ventesYango[k] = v
        return poser.apply(this, arguments)
      }
      proto.send = function () {
        if (this.__ventesYango) garder(this.__ventesYango)
        return envoyer.apply(this, arguments)
      }
      window.fetch = function (entree, init) {
        try {
          const req = entree instanceof Request ? entree : new Request(entree, init)
          if (req.url.indexOf(RACINE) !== -1) {
            const h = {}
            req.headers.forEach(function (v, k) { h[k] = v })
            garder(h)
          }
        } catch (_e) { /* requête illisible : on attend la suivante */ }
        return fetchPage.apply(this, arguments)
      }
      minuteur = setTimeout(function () {
        if (fini) return
        remettre()
        ko(erreurFr(ATTENTE))
      }, delaiMs)
    })
  }

  async function appel(entetes, chemin, params, corps) {
    const u = new URL(RACINE + chemin, location.origin)
    Object.keys(params || {}).forEach(function (k) { u.searchParams.set(k, params[k]) })
    const r = await fetch(u.toString(), {
      method: corps ? 'POST' : 'GET', headers: entetes, credentials: 'include',
      body: corps ? JSON.stringify(corps) : undefined,
    })
    if (r.status === 401 || r.status === 403) { const e = erreurFr(SESSION); e.definitif = true; throw e }
    if (!r.ok) throw erreurFr(INCOMPLET)
    return r.json()
  }

  async function lireSemaine(periode, entetes, etape) {
    const j = await avecReprise(function () {
      return appel(entetes, 'places/v2/search', { limit: 999, sort: 'rating', ascending: 'true', filter: 'all' })
    })
    const places = j.places || []
    const ids = places.map(function (p) { return p.id })
    const b = bornesLecture(periode)
    let commandes = []
    let curseur = null
    for (let page = 0; page < 200; page++) {
      const params = { limit: PAR_PAGE }
      if (curseur) params.cursor = curseur
      const lot = await avecReprise(function () {
        return appel(entetes, 'eats-restapp-orders/v2/history', params, { from: b.from, to: b.to, place_ids: ids })
      })
      commandes = commandes.concat(lot.orders || [])
      etape('Commandes Yango lues : ' + commandes.length)
      if (!lot.meta || !lot.meta.can_fetch_next || !lot.meta.cursor) break
      curseur = lot.meta.cursor
    }
    const lectures = []
    for (const p of places) {
      const rep = await avecReprise(function () {
        return appel(entetes, 'reports/v1/place-metrics/get', null, {
          filters: {
            places: [p.id], begin: periode.debut + 'T00:00:00.000Z', end: periode.fin + 'T23:59:59.999Z',
            group_by: 'day', additional: { service: 'eda' },
          },
          metrics: ['cpa_advert_costs'],
        })
      })
      lectures.push(Object.assign({ nom: nomBoutique(p) }, lirePub(rep)))
      etape('Pub Yango : ' + lectures.length + '/' + places.length + ' boutiques')
    }
    return {
      periode: periode,
      lignes: lignesExport(commandes, places),
      pubs: lectures.filter(function (l) { return l.montant > 0 }).map(function (l) { return { nom: l.nom, montant: l.montant } }),
      pubAJourAu: pubAJourAu(lectures),
    }
  }

  function bandeau() {
    const ancien = document.getElementById('ventes-yango-bandeau')
    if (ancien) ancien.remove()
    const div = document.createElement('div')
    div.id = 'ventes-yango-bandeau'
    div.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:14px 16px;'
      + 'background:#1f2937;color:#fff;font:14px/1.4 system-ui,sans-serif;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35)'
    document.body.appendChild(div)
    return function (texte, fermerApresMs) {
      div.textContent = '🛵 ' + texte
      if (fermerApresMs) setTimeout(function () { div.remove() }, fermerApresMs)
    }
  }

  function lancer(cfg) {
    if (location.hostname !== 'vendor.yango.com') {
      alert('Ouvre le portail Yango (vendor.yango.com), puis clique à nouveau sur le favori.')
      return
    }
    const fen = window.open(cfg.origine + '/tresorerie-partenaires?favori=yango', 'ventes-yango')
    if (!fen) {
      alert('Chrome a bloqué la fenêtre Samtrackly : autorise les fenêtres pour ce site, puis clique à nouveau.')
      return
    }
    const info = bandeau()
    info('Ventes Yango : connexion au portail… Si rien ne bouge, clique sur « Commandes » dans le menu du portail.')
    let entetes = null
    const connexion = capterConnexion(60000).then(function (h) {
      entetes = h
      info('Ventes Yango : choisis la semaine dans la fenêtre Samtrackly.')
    })
    connexion.catch(function (e) { info(e.messageFr, 15000) })

    // Un second clic remplace l'écoute du premier.
    if (window.__ventesYangoEcoute) window.removeEventListener('message', window.__ventesYangoEcoute)
    let occupe = false
    window.__ventesYangoEcoute = async function (e) {
      if (e.source !== fen || e.origin !== cfg.origine || !e.data) return
      const envoyer = function (m) { try { fen.postMessage(m, cfg.origine) } catch (_) { /* fenêtre fermée */ } }
      if (e.data.type === 'pret') { envoyer({ type: 'favori' }); return }
      if (e.data.type !== 'lire' || occupe) return
      const iso = /^\d{4}-\d{2}-\d{2}$/
      if (!iso.test(e.data.debut) || !iso.test(e.data.fin)) return
      occupe = true
      const etape = function (t) { info(t); envoyer({ type: 'progression', texte: t }) }
      try {
        await connexion
        const periode = { debut: e.data.debut, fin: e.data.fin }
        etape('Lecture de la semaine du ' + frDate(periode.debut) + ' au ' + frDate(periode.fin) + '…')
        envoyer(Object.assign({ type: 'ventes' }, await lireSemaine(periode, entetes, etape)))
        info('Semaine envoyée : vérifie puis importe dans la fenêtre Samtrackly.', 10000)
      } catch (err) {
        const m = (err && err.messageFr) || INCOMPLET
        envoyer({ type: 'erreur', message: m })
        info(m, 15000)
      } finally {
        occupe = false
      }
    }
    window.addEventListener('message', window.__ventesYangoEcoute)
  }

  return {
    ENTETES: ENTETES,
    bornesLecture: bornesLecture,
    nomBoutique: nomBoutique,
    dateExport: dateExport,
    ligneExport: ligneExport,
    lignesExport: lignesExport,
    lirePub: lirePub,
    pubAJourAu: pubAJourAu,
    avecReprise: avecReprise,
    aConnexion: aConnexion,
    lancer: lancer,
  }
}

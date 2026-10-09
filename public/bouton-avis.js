// ──────────────────────────────────────────────────────────────────────────────
//  MOTEUR DU BOUTON « AVIS → SAMTRACKLY » (favori Chrome)
//
//  Servi tel quel (jamais transpilé) : l'écran app/bouton-avis.js le lit et
//  l'emballe dans un favori `javascript:` avec l'origine Samtrackly et le
//  secret d'ingestion. Le favori tourne SUR le portail Glovo ou Yango :
//    1. ouvre tout de suite la fenêtre relais /envoi-avis.html (encore dans
//       le geste de clic, sinon Chrome la bloque) ;
//    2. reçoit du relais la date du dernier avis connu ;
//    3. lit les avis de la période avec la connexion du portail ;
//    4. les transmet au relais, qui les envoie à ingest-reviews.
//  Aucun jeton du portail ne sort de la page : seuls des avis sont transmis.
//
//  Tout doit rester DANS moteurAvis() : le favori n'embarque que cette
//  fonction. Tests : lib/boutonAvis.test.mjs.
// ──────────────────────────────────────────────────────────────────────────────
function moteurAvis() {
  let JOUR = 86400000
  let MARGE_JOURS = 3
  // Jours relus au plus. Yango refuse une période de plus de 5 semaines
  // (« invalid_period », constaté le 04/10/2026) : 30 jours pour lui.
  const PLAFOND_JOURS = { glovo: 45, yango: 30 }
  let PAR_PAGE = 50
  let URL_GLOVO = 'https://vrs-api.eu.prd.portal.restaurant/v1/reviews'

  // Mêmes libellés que les avis du 05/09 et du rattrapage du 04/10.
  let THEMES_GLOVO = {
    TASTY: 'Bon goût',
    GOOD_VALUE: 'Bon rapport qualité-prix',
    PORTION_SIZE: 'Taille des portions',
    PACKAGING_QUALITY: "Qualité de l'emballage",
    SPEED_AND_RELIABILITY: 'Rapidité et fiabilité',
    MISSING_OR_MISTAKEN_ITEMS: 'Produits manquants ou incorrects',
    SMALL_PORTION_SIZE: 'Portion trop petite',
    TASTED_BAD: 'Mauvais goût',
    EXPENSIVE: 'Cher',
  }

  // Les 9 boutiques Glovo du groupe. Une nouvelle boutique doit être ajoutée
  // ici (et rattachée dans Samtrackly) pour que ses avis soient lus.
  let NOMS_GLOVO = {
    'GV_CI;109742': 'Al Kayan (Annaneraie) [YOP]',
    'GV_CI;315921': 'Al Kayan - ABN - Remblais',
    'GV_CI;109738': 'Chez Samer (21 BP915 21) [YOP]',
    'GV_CI;775202': 'Chez Samer (C323+24J) [ABN]',
    'GV_CI;219425': 'Chez Samer (L 155 - Voie de la 7e Tranche) [ABN]',
    'GV_CI;84806': 'Chez Samer (Riviéra Palmeraie Abidjan CI) [ABN]',
    'GV_CI;145792': 'Chez Samer (S 584) [YOP]',
    'GV_CI;121904': 'Chez Samer (S CI) [YOP]',
    'GV_CI;867368': 'Resto Xpress',
  }

  let NOMS = { glovo: 'Glovo', yango: 'Yango' }

  function jourIso(ms) { return new Date(ms).toISOString().slice(0, 10) }

  function periodeLecture(derniereDate, maintenant, plafondJours = PLAFOND_JOURS.glovo) {
    let plancher = jourIso(maintenant - plafondJours * JOUR)
    let debut = plancher
    if (derniereDate) {
      let d = jourIso(Date.parse(derniereDate + 'T00:00:00Z') - MARGE_JOURS * JOUR)
      if (d > plancher) debut = d
    }
    return { debut: debut, fin: jourIso(maintenant) }
  }

  function convertirGlovo(r) {
    let raw = { glovo_vendor_id: r.globalVendorCode, store_name: NOMS_GLOVO[r.globalVendorCode] || r.globalVendorCode }
    let themes = (r.vendor_pills || []).map(function (p) { return THEMES_GLOVO[p] || p })
    if (themes.length) raw.theme = themes
    let plats = (r.product_ratings || []).map(function (p) { return p.name }).filter(Boolean)
    if (plats.length) raw.dish = plats.length === 1 ? plats[0] : plats
    return {
      platform: 'glovo',
      external_store_label: r.globalVendorCode,
      external_ref: String(r.orderId),
      classification: r.thumbs_up ? 'bon' : 'negatif',
      comment: r.text || '',
      review_date: String(r.date).slice(0, 10),
      rating_raw: null,
      raw: raw,
    }
  }

  function convertirYango(f) {
    let avis = f.order_feedback || {}
    let tags = (avis.predefined_comments || []).map(function (c) { return c.comment }).filter(Boolean)
    let raw = { yango_place_id: String(f.order.place_id), yango_feedback_id: avis.id }
    if (tags.length) raw.tag = tags
    let note = Number(avis.rating)
    return {
      platform: 'yango',
      external_store_label: String(f.order.place_id),
      external_ref: f.order.order_nr,
      rating_raw: note,
      rating_scale: 5,
      classification: note < 3 ? 'negatif' : 'bon',
      comment: avis.comment || '',
      review_date: String(avis.feedback_filled_at).slice(0, 10),
      raw: raw,
    }
  }

  // ── Commandes (litiges automatiques) ─────────────────────────────────
  // Repérage des portails : docs/superpowers/specs/2026-10-09-portails-commandes-notes.md
  // Premier passage : depuis hier. Ensuite 2 jours de marge avant le dernier
  // jour reçu (une commande peut changer de statut le lendemain).
  function periodeCommandes(dernierJour, maintenant, plafondJours) {
    let plancher = jourIso(maintenant - plafondJours * JOUR)
    let debut = dernierJour ? jourIso(Date.parse(dernierJour + 'T00:00:00Z') - 2 * JOUR) : jourIso(maintenant - JOUR)
    if (debut < plancher) debut = plancher
    return { debut: debut, fin: jourIso(maintenant) }
  }

  function entier(v) { let n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0 }

  function lignesValides(lignes) {
    return lignes.filter(function (l) { return l.nom && l.quantite > 0 })
  }

  // Liste : ListOrders (retenues dans orderIssuesDetails) ; détail :
  // GetOrderDetails (plats). Un menu est une seule ligne, ses options
  // (boisson choisie) sont ignorées.
  function convertirCommandeGlovo(brut) {
    let l = brut.liste || {}
    let d = brut.detail && brut.detail.order
    let rembourse = 0, attente = 0
    ;(l.orderIssuesDetails || []).forEach(function (i) {
      ;(i.metadata || []).forEach(function (m) {
        if (i.orderIssue === 'ORDER_WITH_DEDUCTION' && /refund/.test(String(m.reason))) rembourse += entier(m.amount)
        if (i.orderIssue === 'AVOIDABLE_WAIT_TIME') attente += entier(m.fee)
      })
    })
    let statut = l.orderStatus === 'DELIVERED' ? 'livree' : l.orderStatus === 'CANCELLED' ? 'annulee' : 'autre'
    return {
      plateforme: 'glovo',
      numero: String(l.orderId),
      boutique: l.globalEntityId + ';' + l.vendorId,
      commande_le: new Date(l.placedTimestamp).toISOString(),
      statut: statut,
      montant_paye: l.billing && l.billing.netRevenue != null ? entier(l.billing.netRevenue) : null,
      rembourse: rembourse,
      penalite_attente: attente,
      lignes: lignesValides(((d && d.items) || []).map(function (p) {
        return { nom: String(p.name || '').trim(), quantite: entier(p.quantity), prix_unitaire: entier(p.unitPrice) }
      })),
    }
  }

  // Liste : v2/history ; détail : v1/history/order. `is_reimbursement_to_place`
  // = pastille « Sera payée » : une annulée payée compte comme vendue.
  // Yango ne donne ni remboursement ni pénalité d'attente.
  function convertirCommandeYango(brut) {
    let l = brut.liste || {}
    let d = brut.detail
    let paye = l.is_reimbursement_to_place === true
    return {
      plateforme: 'yango',
      numero: String(l.order_nr),
      boutique: String(l.place_id),
      commande_le: new Date((d && d.created_at) || l.place_confirmed_at).toISOString(),
      statut: l.status === 'released' ? 'livree' : l.status === 'refused' ? 'annulee' : 'autre',
      montant_paye: paye ? entier(l.sum) : 0,
      rembourse: 0,
      penalite_attente: 0,
      lignes: lignesValides(((d && d.items) || []).map(function (p) {
        return { nom: String(p.name || '').trim(), quantite: entier(p.quantity), prix_unitaire: entier(p.sum) }
      })),
    }
  }

  function plateformeDuSite(hote) {
    if (hote === 'portal.glovoapp.com') return 'glovo'
    if (hote === 'vendor.yango.com') return 'yango'
    return null
  }

  function isoValide(v) {
    const t = Date.parse(v)
    return v && Number.isFinite(t) ? new Date(t).toISOString() : null
  }

  function heureGlovo(json) {
    const o = json && json.data && json.data.orders && json.data.orders.order && json.data.orders.order.order
    return o ? isoValide(o.placedTimestamp) : null
  }

  function heureYango(json) {
    return json ? isoValide(json.created_at) : null
  }

  // Applique fn à chaque élément, n à la fois, en gardant l'ordre.
  async function enParallele(elements, n, fn) {
    const resultats = new Array(elements.length)
    let suivant = 0
    async function ouvrier() {
      while (suivant < elements.length) {
        const i = suivant++
        resultats[i] = await fn(elements[i], i)
      }
    }
    await Promise.all(Array.from({ length: Math.min(n, elements.length) }, ouvrier))
    return resultats
  }

  // ── Exécution sur le portail ─────────────────────────────────────────────
  function erreurFr(message) { let e = new Error(message); e.messageFr = message; return e }

  function frDate(iso) { let p = iso.split('-'); return p[2] + '/' + p[1] }

  function bandeau() {
    let div = document.createElement('div')
    div.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:14px 16px;'
      + 'background:#1f2937;color:#fff;font:14px/1.4 system-ui,sans-serif;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35)'
    document.body.appendChild(div)
    return function (texte, fermerApresMs) {
      div.textContent = '⭐ ' + texte
      if (fermerApresMs) setTimeout(function () { div.remove() }, fermerApresMs)
    }
  }

  function attendreMessage(fen, origine, type, delaiMs) {
    return new Promise(function (ok, ko) {
      let minuteur = setTimeout(function () {
        window.removeEventListener('message', ecoute)
        ko(erreurFr("La fenêtre d'envoi ne répond pas : clique à nouveau sur le bouton avis."))
      }, delaiMs)
      function ecoute(e) {
        if (e.source !== fen || e.origin !== origine || !e.data || e.data.type !== type) return
        clearTimeout(minuteur)
        window.removeEventListener('message', ecoute)
        ok(e.data)
      }
      window.addEventListener('message', ecoute)
    })
  }

  function jetonGlovo() {
    try {
      let racine = JSON.parse(localStorage.getItem('persist:root'))
      let t = JSON.parse(racine.authentication).accessToken
      return typeof t === 'string' && t.charAt(0) === '"' ? JSON.parse(t) : t
    } catch (_e) { return null }
  }

  async function lireGlovo(periode, info) {
    let expire = 'Ta session Glovo a expiré : reconnecte-toi au portail puis clique à nouveau.'
    let jeton = jetonGlovo()
    if (!jeton) throw erreurFr(expire)
    let tous = []
    let apres = null
    for (let page = 0; page < 200; page++) {
      let corps = {
        global_vendor_codes: Object.keys(NOMS_GLOVO), include_stats: false,
        pagination: { perPage: PAR_PAGE },
        filter: { ratingMin: 1, ratingMax: 5, hasText: false,
          startDate: periode.debut + 'T00:00:00.000Z', endDate: periode.fin + 'T23:59:59.999Z' },
      }
      if (apres) { corps.pagination.afterId = apres.id; corps.pagination.afterTimestamp = apres.date }
      let r = await fetch(URL_GLOVO, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + jeton },
        body: JSON.stringify(corps),
      })
      if (r.status === 401 || r.status === 403) throw erreurFr(expire)
      if (!r.ok) throw erreurFr("Glovo n'a pas répondu : clique à nouveau dans quelques minutes.")
      let lot = (await r.json()).reviews || []
      tous = tous.concat(lot.map(convertirGlovo))
      info('Lecture des avis Glovo… ' + tous.length + ' lus')
      if (lot.length < PAR_PAGE) break
      let dernier = lot[lot.length - 1]
      apres = { id: dernier.id, date: new Date(dernier.date).toISOString() }
    }
    return tous
  }

  // Yango : on ne touche pas à la connexion. On laisse la page émettre sa
  // propre demande d'avis (bouton « Afficher plus ») et on la réutilise en ne
  // changeant que la période et le curseur.
  function capturerRequeteYango(info) {
    return new Promise(function (ok, ko) {
      let fetchPage = window.fetch
      let fini = false
      let minuteur = setTimeout(function () {
        if (fini) return
        fini = true
        window.fetch = fetchPage
        ko(erreurFr('Fais défiler la liste des avis Yango jusqu’en bas, clique sur « Afficher plus », puis clique à nouveau sur le bouton avis.'))
      }, 20000)
      window.fetch = function (entree) {
        if (!fini && entree instanceof Request && entree.url.indexOf('places-order-feedbacks') !== -1) {
          fini = true
          clearTimeout(minuteur)
          window.fetch = fetchPage
          ok(entree.clone())
        }
        return fetchPage.apply(this, arguments)
      }
      let bouton = Array.prototype.slice.call(document.querySelectorAll('button'))
        .find(function (b) { return b.textContent.trim() === 'Afficher plus' })
      if (bouton) bouton.click()
      else info('Clique sur « Afficher plus » en bas de la liste des avis…')
    })
  }

  async function lireYango(periode, info) {
    if (location.pathname.indexOf('/feedback') !== 0) {
      throw erreurFr('Ouvre la page Avis du portail Yango (filtre « Tous les restaurants »), puis clique à nouveau sur le bouton avis.')
    }
    let modele = await capturerRequeteYango(info)
    let base = JSON.parse(await modele.clone().text())
    let tous = []
    let curseur = null
    for (let page = 0; page < 200; page++) {
      let corps = Object.assign({}, base, {
        limit: PAR_PAGE, from: periode.debut + 'T00:00:00Z', to: periode.fin + 'T23:59:59Z',
      })
      if (curseur) corps.cursor = curseur
      else delete corps.cursor
      let r = await fetch(new Request(modele, { body: JSON.stringify(corps) }))
      if (r.status === 401 || r.status === 403) throw erreurFr('Ta session Yango a expiré : reconnecte-toi au portail puis clique à nouveau.')
      if (!r.ok) throw erreurFr("Yango n'a pas répondu : clique à nouveau dans quelques minutes.")
      let j = await r.json()
      let lot = j.feedbacks || []
      tous = tous.concat(lot.map(convertirYango))
      info('Lecture des avis Yango… ' + tous.length + ' lus')
      if (!lot.length || !j.cursor) break
      curseur = j.cursor
    }
    tous.modele = modele
    tous.placeIds = base.place_ids || []
    return tous
  }

  const URL_GLOVO_COMMANDE = 'https://vagw-api.eu.prd.portal.restaurant/query'
  const REQUETE_GLOVO = 'query GetOrderDetails($params: OrderReq!) { orders { order(input: $params) { order { orderId placedTimestamp } } } }'

  function lecteurHeureGlovo() {
    const jeton = jetonGlovo()
    return async function (avis) {
      const vendeur = String(avis.external_store_label).split(';')
      const r = await fetch(URL_GLOVO_COMMANDE, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + jeton },
        body: JSON.stringify({
          operationName: 'GetOrderDetails',
          variables: { params: { orderId: avis.external_ref, GlobalVendorCode: { globalEntityId: vendeur[0], vendorId: vendeur[1] },
            isBillingDataFlagEnabled: false, useRefundStreamIssueSource: false } },
          query: REQUETE_GLOVO,
        }),
      })
      return r.ok ? heureGlovo(await r.json()) : null
    }
  }

  function lecteurHeureYango(modele) {
    return async function (avis) {
      const u = new URL('/4.0/restapp-front/eats-restapp-orders/v1/order', location.origin)
      u.searchParams.set('order_nr', avis.external_ref)
      const r = await fetch(new Request(u.toString(), { method: 'GET', headers: modele.headers, credentials: 'include' }))
      return r.ok ? heureYango(await r.json()) : null
    }
  }

  // ── Lecture des commandes ────────────────────────────────────────────
  // Un détail qui ne répond pas est retenté une fois, puis la lecture
  // s'arrête : une commande livrée envoyée sans ses plats ferait croire à
  // un tapé +.
  const LECTURE_INCOMPLETE = 'Les avis sont partis, mais la lecture des commandes n’a pas abouti : clique à nouveau dans quelques minutes.'

  async function avecReprise(fn) {
    try { return await fn() } catch (_e) {
      try { return await fn() } catch (_e2) { throw erreurFr(LECTURE_INCOMPLETE) }
    }
  }

  const REQUETE_GLOVO_LISTE = 'query ListOrders($params: ListOrdersReq!) { orders { listOrders(input: $params) { nextPageToken orders { orderId globalEntityId vendorId orderStatus placedTimestamp subtotal billing { netRevenue } orderIssuesDetails { orderIssue metadata { reason amount deduction fee } } } } } }'
  const REQUETE_GLOVO_PLATS = 'query GetOrderDetails($params: OrderReq!) { orders { order(input: $params) { order { orderId placedTimestamp items { name quantity unitPrice } } } } }'

  async function appelGlovo(jeton, corps) {
    let r = await fetch(URL_GLOVO_COMMANDE, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + jeton },
      body: JSON.stringify(corps),
    })
    if (r.status === 401 || r.status === 403) throw erreurFr('Ta session Glovo a expiré : reconnecte-toi au portail puis clique à nouveau.')
    if (!r.ok) throw erreurFr(LECTURE_INCOMPLETE)
    let j = await r.json()
    if (!j.data || !j.data.orders) throw erreurFr(LECTURE_INCOMPLETE)
    return j.data.orders
  }

  async function lireCommandesGlovo(periode, info) {
    let jeton = jetonGlovo()
    if (!jeton) throw erreurFr('Ta session Glovo a expiré : reconnecte-toi au portail puis clique à nouveau.')
    let codes = Object.keys(NOMS_GLOVO).map(function (c) { let p = c.split(';'); return { globalEntityId: p[0], vendorId: p[1] } })
    let liste = []
    let jetonPage = null
    for (let page = 0; page < 200; page++) {
      let pagination = { pageSize: PAR_PAGE }
      if (jetonPage) pagination.pageToken = jetonPage
      let lo = (await avecReprise(function () {
        return appelGlovo(jeton, {
          operationName: 'ListOrders',
          variables: { params: { pagination: pagination, timeFrom: periode.debut + 'T00:00:00.000Z', timeTo: periode.fin + 'T23:59:59.999Z',
            globalVendorCodes: codes, useRefundStreamIssueSource: false } },
          query: REQUETE_GLOVO_LISTE,
        })
      })).listOrders
      let lot = (lo && lo.orders) || []
      liste = liste.concat(lot)
      info('Lecture des commandes Glovo… ' + liste.length + ' lues')
      if (!lo || !lo.nextPageToken || !lot.length) break
      jetonPage = lo.nextPageToken
    }
    let faits = 0
    let bruts = await enParallele(liste, 4, async function (l) {
      let detail = null
      if (l.orderStatus === 'DELIVERED') {
        detail = (await avecReprise(function () {
          return appelGlovo(jeton, {
            operationName: 'GetOrderDetails',
            variables: { params: { orderId: l.orderId, GlobalVendorCode: { globalEntityId: l.globalEntityId, vendorId: l.vendorId },
              placedTimestamp: new Date(l.placedTimestamp).toISOString(), isBillingDataFlagEnabled: false, useRefundStreamIssueSource: false } },
            query: REQUETE_GLOVO_PLATS,
          })
        })).order
      }
      faits++
      if (faits % 20 === 0 || faits === liste.length) info('Plats des commandes Glovo : ' + faits + '/' + liste.length)
      return { liste: l, detail: detail }
    })
    return bruts.map(convertirCommandeGlovo)
  }

  // Yango : mêmes en-têtes que la requête d'avis captée sur la page (on ne
  // lit jamais le jeton), mêmes boutiques (place_ids de cette requête).
  async function appelYango(modele, chemin, options) {
    let u = new URL(chemin, location.origin)
    Object.keys(options.params || {}).forEach(function (k) { u.searchParams.set(k, options.params[k]) })
    let r = await fetch(new Request(u.toString(), {
      method: options.corps ? 'POST' : 'GET', headers: modele.headers, credentials: 'include',
      body: options.corps ? JSON.stringify(options.corps) : undefined,
    }))
    if (r.status === 401 || r.status === 403) throw erreurFr('Ta session Yango a expiré : reconnecte-toi au portail puis clique à nouveau.')
    if (!r.ok) throw erreurFr(LECTURE_INCOMPLETE)
    return r.json()
  }

  async function lireCommandesYango(periode, info, modele, placeIds) {
    let liste = []
    let curseur = null
    for (let page = 0; page < 200; page++) {
      let params = { limit: PAR_PAGE }
      if (curseur) params.cursor = curseur
      let j = await avecReprise(function () {
        return appelYango(modele, '/4.0/restapp-front/eats-restapp-orders/v2/history', {
          params: params, corps: { from: periode.debut, to: periode.fin, place_ids: placeIds },
        })
      })
      liste = liste.concat(j.orders || [])
      info('Lecture des commandes Yango… ' + liste.length + ' lues')
      if (!j.meta || !j.meta.can_fetch_next || !j.meta.cursor) break
      curseur = j.meta.cursor
    }
    let faits = 0
    let bruts = await enParallele(liste, 4, async function (l) {
      let detail = null
      // Plats utiles seulement pour les commandes qui comptent comme vendues.
      if (l.status === 'released' || l.is_reimbursement_to_place === true) {
        detail = await avecReprise(function () {
          return appelYango(modele, '/4.0/restapp-front/eats-restapp-orders/v1/history/order', { params: { order_nr: l.order_nr } })
        })
      }
      faits++
      if (faits % 20 === 0 || faits === liste.length) info('Plats des commandes Yango : ' + faits + '/' + liste.length)
      return { liste: l, detail: detail }
    })
    return bruts.map(convertirCommandeYango)
  }

  async function ajouterHeures(avis, lireHeure, info, nom) {
    let faits = 0
    let introuvables = 0
    await enParallele(avis, 4, async function (a) {
      let iso = null
      try { iso = await lireHeure(a) } catch (_e) { iso = null }
      if (iso) a.commande_le = iso
      else introuvables++
      faits++
      if (faits % 10 === 0 || faits === avis.length) info('Heures de commande ' + nom + ' : ' + faits + '/' + avis.length)
    })
    return introuvables
  }

  async function lancer(cfg) {
    let plateforme = plateformeDuSite(location.hostname)
    if (!plateforme) {
      alert('Ouvre le portail Glovo ou la page Avis de Yango, puis clique à nouveau sur le bouton avis.')
      return
    }
    let fen = window.open(cfg.origine + '/envoi-avis.html', 'envoi-avis', 'width=440,height=320')
    if (!fen) {
      alert("Chrome a bloqué la fenêtre d'envoi : autorise les fenêtres pour ce site, puis clique à nouveau.")
      return
    }
    let info = bandeau()
    let nom = NOMS[plateforme]
    info('Avis ' + nom + ' : préparation…')
    try {
      await attendreMessage(fen, cfg.origine, 'pret', 20000)
      fen.postMessage({ type: 'config', secret: cfg.secret }, cfg.origine)
      let reponse = await attendreMessage(fen, cfg.origine, 'derniers', 20000)
      if (reponse.erreur) throw erreurFr(reponse.erreur)
      let dernier = reponse.derniers && reponse.derniers[plateforme]
      let periode = periodeLecture(dernier ? dernier.review_date : null, Date.now(), PLAFOND_JOURS[plateforme])
      info('Lecture des avis ' + nom + ' du ' + frDate(periode.debut) + ' au ' + frDate(periode.fin) + '…')
      let avis = plateforme === 'glovo' ? await lireGlovo(periode, info) : await lireYango(periode, info)
      const lireHeure = plateforme === 'glovo' ? lecteurHeureGlovo() : lecteurHeureYango(avis.modele)
      const introuvables = await ajouterHeures(avis, lireHeure, info, nom)
      fen.postMessage({ type: 'avis', reviews: Array.prototype.slice.call(avis) }, cfg.origine)
      info(avis.length + ' avis ' + nom + ' transmis'
        + (introuvables ? ' (' + introuvables + ' heure' + (introuvables > 1 ? 's' : '') + ' introuvable' + (introuvables > 1 ? 's' : '') + ')' : '')
        + '. Lecture des commandes…')

      // Commandes → litiges automatiques. Un échec ici n'annule pas les avis.
      try {
        let dernierCmd = reponse.commandes && reponse.commandes[plateforme]
        let periodeCmd = periodeCommandes(dernierCmd ? dernierCmd.jour : null, Date.now(), PLAFOND_JOURS[plateforme])
        info('Lecture des commandes ' + nom + ' du ' + frDate(periodeCmd.debut) + ' au ' + frDate(periodeCmd.fin) + '…')
        let commandes = plateforme === 'glovo'
          ? await lireCommandesGlovo(periodeCmd, info)
          : await lireCommandesYango(periodeCmd, info, avis.modele, avis.placeIds)
        fen.postMessage({ type: 'commandes', commandes: commandes }, cfg.origine)
        info(avis.length + ' avis et ' + commandes.length + ' commandes ' + nom + ' transmis : le résultat s’affiche dans la petite fenêtre.', 12000)
      } catch (e) {
        let message = e && e.messageFr ? e.messageFr : LECTURE_INCOMPLETE
        try { fen.postMessage({ type: 'erreur', message: message }, cfg.origine) } catch (_) { /* fenêtre fermée */ }
        info(message, 15000)
      }
    } catch (e) {
      let message = e && e.messageFr ? e.messageFr
        : "La lecture des avis n'a pas abouti, rien n'est perdu : clique à nouveau dans quelques minutes."
      try { fen.postMessage({ type: 'erreur', message: message }, cfg.origine) } catch (_) { /* fenêtre fermée */ }
      info(message, 15000)
    }
  }

  return {
    periodeLecture: periodeLecture,
    convertirGlovo: convertirGlovo,
    convertirYango: convertirYango,
    plateformeDuSite: plateformeDuSite,
    periodeCommandes: periodeCommandes,
    convertirCommandeGlovo: convertirCommandeGlovo,
    convertirCommandeYango: convertirCommandeYango,
    heureGlovo: heureGlovo,
    heureYango: heureYango,
    enParallele: enParallele,
    lancer: lancer,
  }
}

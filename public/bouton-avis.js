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
  let PLAFOND_JOURS = 45
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

  function periodeLecture(derniereDate, maintenant) {
    let plancher = jourIso(maintenant - PLAFOND_JOURS * JOUR)
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

  function plateformeDuSite(hote) {
    if (hote === 'portal.glovoapp.com') return 'glovo'
    if (hote === 'vendor.yango.com') return 'yango'
    return null
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
    return tous
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
      let periode = periodeLecture(dernier ? dernier.review_date : null, Date.now())
      info('Lecture des avis ' + nom + ' du ' + frDate(periode.debut) + ' au ' + frDate(periode.fin) + '…')
      let avis = plateforme === 'glovo' ? await lireGlovo(periode, info) : await lireYango(periode, info)
      fen.postMessage({ type: 'avis', reviews: avis }, cfg.origine)
      info(avis.length + ' avis ' + nom + ' transmis : le résultat s’affiche dans la petite fenêtre.', 10000)
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
    lancer: lancer,
  }
}

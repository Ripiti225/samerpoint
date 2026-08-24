// ─────────────────────────────────────────────────────────────────────────
//  ERREURS TECHNIQUES → EXPLICATION EN FRANÇAIS
//
//  La table `erreurs_client` stocke des messages bruts, en anglais, souvent
//  suivis d'une trace de pile : « TypeError: Network request failed at
//  anonymous (index.android.bundle:1:495773) ». Illisible pour un gérant.
//
//  Ce module traduit le couple (contexte, message) en trois éléments :
//    • quoi   — ce que la personne était en train de faire
//    • cause  — pourquoi ça a échoué, en français simple
//    • action — quoi faire, quand il y a quelque chose à faire
//
//  Le message technique reste disponible dans l'écran, replié.
// ─────────────────────────────────────────────────────────────────────────

// ── Ce que l'utilisateur faisait, d'après le contexte ────────────────────

const QUOI = {
  'deductionsGerant.sauvegarder':            { icone: '💸', quoi: "Enregistrement des déductions gérant" },
  'saveTransactionsFournisseurs.insert':     { icone: '🧾', quoi: "Enregistrement des factures fournisseurs" },
  'saveTransactionsFournisseurs.historique': { icone: '🧾', quoi: "Historique des crédits fournisseurs" },
  'saveOneTransactionFournisseur.rpc':       { icone: '🧾', quoi: "Enregistrement d'une facture fournisseur" },
  'saveOneTransactionFournisseur.insert_fallback': { icone: '🧾', quoi: "Enregistrement d'une facture fournisseur" },
  'saveOnePresence.upsert_caissier':         { icone: '👥', quoi: "Enregistrement d'un pointage" },
  'saveOnePresence.insert_fallback':         { icone: '👥', quoi: "Enregistrement d'un pointage" },
  'saveOnePresence.update':                  { icone: '👥', quoi: "Modification d'un pointage" },
  'saveInventaireShift':                     { icone: '📦', quoi: "Enregistrement de l'inventaire" },
  'uploadPhoto':                             { icone: '📷', quoi: "Envoi d'une photo" },
  'uploadPhoto.exception':                   { icone: '📷', quoi: "Envoi d'une photo" },
  'uploadFichier':                           { icone: '📎', quoi: "Envoi d'un fichier" },
  'uploadFichier.exception':                 { icone: '📎', quoi: "Envoi d'un fichier" },
  'getOrCreatePoint':                        { icone: '📅', quoi: "Ouverture de la journée" },
  'getRestaurants':                          { icone: '🏪', quoi: "Chargement des restaurants" },
}

// ── Pourquoi ça a échoué, d'après le message ─────────────────────────────
//  L'ordre compte : la première règle qui correspond gagne.

const CAUSES = [
  {
    test: /network request failed|failed to fetch|networkerror|load failed/i,
    cause: "La connexion internet a été perdue pendant l'opération.",
    action: "Vérifiez la connexion et recommencez. Rien n'a été enregistré.",
  },
  {
    test: /presences_caissier_unique/i,
    cause: "Ce pointage existait déjà pour ce caissier et cette journée.",
    action: "L'application le met désormais à jour automatiquement. Si le montant affiché est faux, ressaisissez-le.",
  },
  {
    test: /unique_facture_fournisseur_point/i,
    cause: "Cette facture était déjà enregistrée pour ce fournisseur sur cette journée.",
    action: "Vérifiez l'écran Fournisseurs avant de ressaisir, pour éviter un doublon.",
  },
  {
    test: /duplicate key value violates unique constraint/i,
    cause: "Cette information existait déjà en base : l'enregistrement ferait un doublon.",
    action: "Vérifiez si la saisie n'a pas déjà été faite.",
  },
  {
    test: /violates foreign key constraint/i,
    cause: "L'élément lié n'existe plus (journée, restaurant ou fournisseur supprimé).",
    action: "Rechargez l'écran, puis recommencez.",
  },
  {
    test: /could not find the '([^']+)' column|column [^ ]+ does not exist/i,
    cause: "Une colonne attendue est absente de la base de données.",
    action: "Une mise à jour de la base n'a pas encore été appliquée. À signaler.",
  },
  {
    test: /violates row-level security|permission denied/i,
    cause: "Les droits d'accès ont refusé cette opération.",
    action: "À signaler : il s'agit d'un réglage de la base de données.",
  },
  {
    test: /error code: 5\d\d|502|503|504|522|timeout|timed out/i,
    cause: "Le serveur n'a pas répondu à temps.",
    action: "C'est presque toujours temporaire. Réessayez dans une minute.",
  },
  {
    test: /400 bad request/i,
    cause: "Le serveur a refusé le contenu envoyé — souvent une photo trop lourde ou abîmée.",
    action: "Reprenez la photo, puis renvoyez-la.",
  },
  {
    test: /jwt|token|expired/i,
    cause: "La session a expiré.",
    action: "Déconnectez-vous puis reconnectez-vous.",
  },
  {
    test: /is not a function/i,
    cause: "Un défaut interne de l'application.",
    action: "À signaler : cela demande une correction du code.",
  },
]

/** Le message brut, débarrassé de sa trace de pile. */
export function messageCourt(message) {
  if (!message) return ''
  return String(message)
    .split('\n')[0]
    .replace(/\s+at\s+.*$/, '')
    .replace(/^(TypeError|Error|AbortError):\s*/, '')
    .trim()
}

/**
 * Traduit une erreur technique en explication lisible.
 * Renvoie toujours un objet — jamais null — pour que l'écran n'ait pas
 * à gérer de cas particulier.
 */
export function expliquerErreur(contexte, message, details) {
  const surface = QUOI[contexte] || { icone: '⚠️', quoi: contexte || 'Opération inconnue' }
  const texte = `${message || ''} ${details || ''}`
  const regle = CAUSES.find(c => c.test.test(texte))

  return {
    icone: surface.icone,
    quoi: surface.quoi,
    cause: regle ? regle.cause : "Cause inconnue — le détail technique est ci-dessous.",
    action: regle ? regle.action : null,
    connue: !!regle,
    technique: messageCourt(message),
  }
}

/** Regroupe des erreurs identiques pour éviter des listes de 40 lignes jumelles. */
export function regrouperErreurs(erreurs) {
  const paquets = new Map()
  erreurs.forEach(e => {
    const info = expliquerErreur(e.contexte, e.message, e.details)
    // Regroupement sur ce que VOIT l'utilisateur : deux contextes techniques
    // distincts (upsert puis insert de repli) décrivent la même opération
    // ratée et ne doivent pas apparaître deux fois à l'identique.
    const cle = `${info.quoi}|${info.cause}`
    const existant = paquets.get(cle)
    if (existant) {
      existant.nb += 1
      if (e.created_at > existant.derniere) existant.derniere = e.created_at
      if (e.created_at < existant.premiere) existant.premiere = e.created_at
    } else {
      paquets.set(cle, {
        cle, info, nb: 1,
        derniere: e.created_at,
        premiere: e.created_at,
        exemple: e,
      })
    }
  })
  return [...paquets.values()].sort((a, b) => (a.derniere < b.derniere ? 1 : -1))
}

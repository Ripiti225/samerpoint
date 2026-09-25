// ─────────────────────────────────────────────────────────────────────────
//  POURQUOI UNE SUPPRESSION A ÉCHOUÉ — EN FRANÇAIS
//
//  Les comptes, restaurants et fournisseurs sont référencés par l'historique
//  (points_shifts, presences, inventaires_shifts, litiges…). PostgreSQL refuse
//  alors la suppression : erreur 23503, « violates foreign key constraint ».
//  C'est voulu — effacer un compte effacerait la trace de ses shifts.
//
//  L'écran Paramètres ignorait cette erreur : la liste se rechargeait à
//  l'identique et la suppression semblait simplement ne rien faire. Ce module
//  transforme l'erreur en phrase utile, et dit quand proposer la désactivation.
// ─────────────────────────────────────────────────────────────────────────

const ELEMENTS = {
  utilisateurs: { nom: 'Ce compte', liens: 'des shifts, des pointages ou des inventaires' },
  restaurants: { nom: 'Ce restaurant', liens: 'des journées, des shifts ou des factures' },
  fournisseurs: { nom: 'Ce fournisseur', liens: 'des factures ou des crédits' },
}

function element(table) {
  return ELEMENTS[table] || { nom: 'Cet élément', liens: 'des enregistrements' }
}

function texteErreur(erreur) {
  return `${erreur?.code || ''} ${erreur?.message || ''} ${erreur?.details || ''}`
}

function estContrainteHistorique(erreur) {
  const texte = texteErreur(erreur)
  return erreur?.code === '23503' || /violates foreign key constraint/i.test(texte)
}

export function expliquerEchecSuppression(table, erreur) {
  if (!erreur) return null
  const { nom, liens } = element(table)
  const texte = texteErreur(erreur)

  if (estContrainteHistorique(erreur)) {
    return {
      titre: 'Suppression impossible',
      texte: `${nom} a déjà de l'historique dans l'application : ${liens}. `
        + `Le supprimer effacerait ces enregistrements, la base l'interdit.\n\n`
        + `Voulez-vous le désactiver ? Il disparaît des listes et des connexions, `
        + `et tout son historique reste intact.`,
      proposerDesactivation: true,
    }
  }

  if (erreur?.code === '42501' || /row-level security|permission denied/i.test(texte)) {
    return {
      titre: 'Suppression impossible',
      texte: 'Les droits d\'accès de la base ont refusé cette suppression. '
        + 'Ce n\'est pas une erreur de manipulation : à signaler.',
      proposerDesactivation: false,
    }
  }

  if (/network request failed|failed to fetch|networkerror|load failed/i.test(texte)) {
    return {
      titre: 'Suppression impossible',
      texte: 'La connexion a été perdue pendant l\'opération. Rien n\'a été supprimé : '
        + 'vérifiez la connexion et recommencez.',
      proposerDesactivation: false,
    }
  }

  return {
    titre: 'Suppression impossible',
    texte: `La base a refusé la suppression :\n\n${String(erreur?.message || erreur).split('\n')[0]}`,
    proposerDesactivation: false,
  }
}

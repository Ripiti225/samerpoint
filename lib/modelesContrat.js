// ──────────────────────────────────────────────────────────────────────────────
// Modèles de contrat : CDD, CDI et Stage — textes fixes.
//
// Sources (validées par l'utilisateur le 14/10/2026) :
//   • CDD   : contrat Al Kayan « GBADIE Gogre Tanguy » du 30/04/2026, 10 articles,
//             sans « net à payer » ;
//   • CDI   : le même texte sans date de fin, sans renouvellement et sans
//             l'article « indemnité de fin de contrat » — À FAIRE RELIRE PAR UN
//             JURISTE avant usage ;
//   • Stage : contrat de stage de qualification Chez Samer, 9 articles.
// L'en-tête (établissement, siège, logo, cachet) suit la marque du restaurant ;
// le représentant est toujours « M. ZREIK SAMER, Gérant ».
//
// construireContrat() renvoie une liste de blocs, rendue à l'identique à
// l'écran (components/contrats/ApercuContrat.js) et dans le PDF
// (lib/pdfContrat.js) : un seul texte, deux rendus.
//
// Module pur : aucune lecture de la base ni de l'horloge.
// ──────────────────────────────────────────────────────────────────────────────

export const MARQUES_CONTRAT = {
  samer: {
    id: 'samer',
    etablissement: 'CHEZ SAMER',
    siege: 'COCODY RIVIERA PALMERAIE SODECI',
    adresse_postale: '21 BP 915 ABIDJAN 21',
    telephone: '22 49 75 12',
    representant: 'M. ZREIK SAMER',
    qualite: 'Gérant',
  },
  alkayan: {
    id: 'alkayan',
    etablissement: 'AL KAYAN',
    siege: 'YOPOUGON MAROC',
    adresse_postale: '21 BP 915 ABIDJAN 21',
    telephone: '01 51 11 11 91',
    representant: 'M. ZREIK SAMER',
    qualite: 'Gérant',
  },
}

/** Marque d'un modèle de contrat, ou null (À la Braise : pas encore de modèle). */
export function marqueContrat(marqueId) {
  return MARQUES_CONTRAT[marqueId] || null
}

// ── Nombres, durées, dates, montants ────────────────────────────────────────

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize']
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante']

// 0 à 99. `final` : « quatre-vingts » ne prend son s qu'en fin de nombre.
function moinsDeCent(n, final) {
  if (n <= 16) return UNITES[n]
  if (n < 20) return `dix-${UNITES[n - 10]}`
  if (n < 70) {
    const d = Math.floor(n / 10)
    const u = n % 10
    if (u === 0) return DIZAINES[d]
    return u === 1 ? `${DIZAINES[d]} et un` : `${DIZAINES[d]}-${UNITES[u]}`
  }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${moinsDeCent(n - 60, true)}`
  if (n === 80) return final ? 'quatre-vingts' : 'quatre-vingt'
  return `quatre-vingt-${moinsDeCent(n - 80, true)}`
}

// 0 à 999. `final` : « cents » et « quatre-vingts » prennent leur s seulement
// en fin de nombre (« deux cents » mais « deux cent mille »).
function moinsDeMille(n, final) {
  const c = Math.floor(n / 100)
  const r = n % 100
  if (c === 0) return moinsDeCent(r, final)
  const cents = c === 1 ? 'cent' : `${UNITES[c]} cent${r === 0 && final ? 's' : ''}`
  return r === 0 ? cents : `${cents} ${moinsDeCent(r, final)}`
}

/** 0 à 999 999, orthographe traditionnelle. */
export function nombreEnLettres(nombre) {
  const n = Math.floor(Math.abs(Number(nombre) || 0))
  if (n < 1000) return moinsDeMille(n, true)
  const milliers = Math.floor(n / 1000)
  const reste = n % 1000
  const tete = milliers === 1 ? 'mille' : `${moinsDeMille(milliers, false)} mille`
  return reste === 0 ? tete : `${tete} ${moinsDeMille(reste, true)}`
}

/** 3 → « trois mois (03 mois) », comme sur les contrats papier. */
export function dureeEnLettres(mois) {
  const n = Number(mois) || 0
  return `${nombreEnLettres(n)} mois (${String(n).padStart(2, '0')} mois)`
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre',
  'octobre', 'novembre', 'décembre']

/** '2026-05-01' → « 1er mai 2026 ». Lecture en chaîne : aucun décalage de fuseau. */
export function dateEnLettres(iso) {
  if (!iso) return ''
  const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number)
  if (!a || !m || !j) return ''
  return `${j === 1 ? '1er' : j} ${MOIS[m - 1]} ${a}`
}

/** 75000 → « 75 000 F CFA ». Espace simple : les espaces fines cassent jsPDF. */
export function montantFCFA(valeur) {
  const n = Math.round(Number(valeur) || 0)
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} F CFA`
}

const vide = v => v === null || v === undefined || String(v).trim() === ''
const MAJ = v => String(v ?? '').trim().toUpperCase()

/** « CNI N° CI007879705 ; NNI 11919240401 », selon ce qui est connu. */
export function pieceIdentite(d) {
  return [
    vide(d?.cni_numero) ? null : `CNI N° ${String(d.cni_numero).trim()}`,
    vide(d?.nni_numero) ? null : `NNI ${String(d.nni_numero).trim()}`,
  ].filter(Boolean).join(' ; ')
}

// ── Champs requis ───────────────────────────────────────────────────────────

const REQUIS_IDENTITE = [
  ['civilite', 'Civilité'], ['nom_famille', 'Nom'], ['prenoms', 'Prénoms'],
  ['date_naissance', 'Date de naissance'], ['lieu_naissance', 'Lieu de naissance'],
  ['nationalite', 'Nationalité'], ['piece', "Pièce d'identité"], ['lieu_residence', 'Lieu de résidence'],
  ['telephone', 'Téléphone'], ['date_debut', 'Date de début'],
]

export const CHAMPS_REQUIS = {
  CDD: [...REQUIS_IDENTITE, ['poste', 'Poste'], ['categorie', 'Catégorie'], ['duree_mois', 'Durée'],
    ['date_fin', 'Date de fin'], ['salaire_categoriel', 'Salaire catégoriel'], ['prime_tenue', 'Prime de tenue'],
    ['indemnite_transport', 'Indemnité de transport']],
  CDI: [...REQUIS_IDENTITE, ['poste', 'Poste'], ['categorie', 'Catégorie'],
    ['salaire_categoriel', 'Salaire catégoriel'], ['prime_tenue', 'Prime de tenue'],
    ['indemnite_transport', 'Indemnité de transport']],
  Stage: [...REQUIS_IDENTITE, ['duree_mois', 'Durée'], ['date_fin', 'Date de fin'],
    ['prime_journaliere', 'Prime journalière']],
}

/** Libellés de ce qui manque pour générer ce type de contrat. */
export function champsManquantsContrat(type, d) {
  const donnees = d || {}
  const manquants = []
  if (!marqueContrat(donnees.marque)) manquants.push('Modèle du restaurant')
  for (const [cle, libelle] of CHAMPS_REQUIS[type] || []) {
    const absent = cle === 'piece'
      ? vide(donnees.cni_numero) && vide(donnees.nni_numero)
      : vide(donnees[cle])
    if (absent) manquants.push(libelle)
  }
  return manquants
}

// ── Construction des blocs ──────────────────────────────────────────────────
//
// Types de blocs :
//   entete      logo + nom de l'établissement (dessiné par le moteur de rendu)
//   titre       titre centré
//   para        paragraphe
//   champs      lignes « Libellé : VALEUR » (valeur en gras)
//   puces       liste à puces
//   article     intitulé d'article (gras souligné)
//   sous        sous-titre d'article
//   fait        « Fait … à Abidjan le … », aligné à droite
//   signatures  les deux cadres de signature

function accords(civilite) {
  const f = civilite === 'Mme'
  return {
    titre: f ? 'Madame' : 'Monsieur',
    e: f ? 'e' : '',
    il: f ? 'elle' : 'il',
    soumis: f ? 'soumise' : 'soumis',
  }
}

function blocsEmployeur(m) {
  return [
    { t: 'para', texte: 'Entre' },
    {
      t: 'champs', items: [
        ["L'établissement", m.etablissement],
        ['Dont le siège social est situé à', m.siege],
        ['Adresse postale', m.adresse_postale],
        ['Tél', m.telephone],
        ['Représenté par', `${m.representant}, ${m.qualite}`],
      ],
    },
    { t: 'para', texte: "Désigné Employeur d'une part," },
    { t: 'para', texte: 'Et' },
  ]
}

function blocsTravailleur(d) {
  const naissance = [dateEnLettres(d.date_naissance), vide(d.lieu_naissance) ? null : `à ${MAJ(d.lieu_naissance)}`]
    .filter(Boolean).join(' ')
  const items = [
    ['Nom', MAJ(d.nom_famille)],
    ['Prénoms', MAJ(d.prenoms)],
    ['Date et lieu de naissance', naissance],
    ['Nationalité', MAJ(d.nationalite)],
  ]
  if (!vide(d.situation_famille)) items.push(['Situation de famille', MAJ(d.situation_famille)])
  items.push(["N° pièce d'identité", pieceIdentite(d)])
  items.push(['Lieu de résidence', MAJ(d.lieu_residence)])
  items.push(['Contact téléphonique', String(d.telephone ?? '').trim()])
  return [{ t: 'champs', items }]
}

function blocFait(d) {
  return { t: 'fait', texte: `Fait en double exemplaire à Abidjan le ${d.date_signature ? dateEnLettres(d.date_signature) : '____________'}` }
}

function contratCddOuCdi(d, m, cdi) {
  const a = accords(d.civilite)
  const qui = `${a.titre} ${MAJ(d.nom_famille)} ${MAJ(d.prenoms)}`.trim()
  const etab = m.etablissement
  const blocs = [
    { t: 'entete' },
    { t: 'titre', texte: cdi ? 'CONTRAT DE TRAVAIL A DUREE INDETERMINEE' : 'CONTRAT DE TRAVAIL A DUREE DETERMINEE' },
    ...blocsEmployeur(m),
    ...blocsTravailleur(d),
    { t: 'para', texte: `Désigné${a.e} Travailleur d'autre part,` },
    { t: 'para', texte: 'Il a été conclu le présent contrat conformément aux dispositions de :' },
    {
      t: 'puces', items: [
        "La loi n° 2015-532 du 20 juillet 2015 portant code du travail en Côte d'Ivoire",
        "Les décrets d'application du code du travail",
        'La convention collective interprofessionnelle du 20 juillet 1977',
        `Le règlement intérieur du restaurant ${etab}`,
      ],
    },
    { t: 'para', texte: "Que les parties ci-dessus nommées s'engagent à respecter." },

    { t: 'article', texte: 'ARTICLE 1 : OBJET DU CONTRAT' },
    { t: 'para', texte: `${qui} est engagé${a.e} en qualité de ${MAJ(d.poste)} à la catégorie ${String(d.categorie ?? '').trim()} du secteur d'activité dont fait partie l'Entité. A savoir, le secteur de la RESTAURATION.` },

    { t: 'article', texte: 'ARTICLE 2 : DUREE DU CONTRAT' },
    cdi
      ? { t: 'para', texte: `Le présent contrat est conclu pour une durée indéterminée et prend effet à compter du ${dateEnLettres(d.date_debut)}.` }
      : { t: 'para', texte: `Le présent contrat est conclu pour une durée de ${dureeEnLettres(d.duree_mois)} et prend effet à compter du ${dateEnLettres(d.date_debut)} au ${dateEnLettres(d.date_fin)}. Il est renouvelable dans la limite maximale de deux ans (02 ans), sauf volonté contraire manifestée par l'une des parties avant l'expiration de la période en cours par écrit.` },

    { t: 'article', texte: 'ARTICLE 3 : OBLIGATIONS PROFESSIONNELLES' },
    { t: 'para', texte: `Le travailleur s'engage expressément à exécuter toutes les obligations qui lui seront prescrites par l'entité ${etab} dans l'exercice de ses fonctions.` },

    { t: 'article', texte: 'ARTICLE 4 : REMUNERATION ET AVANTAGES' },
    { t: 'para', texte: 'Pendant la durée du contrat, le travailleur percevra le salaire suivant, selon la catégorie sus-indiquée :' },
    { t: 'champs', items: [['Salaire catégoriel', montantFCFA(d.salaire_categoriel)], ['Prime de tenue', montantFCFA(d.prime_tenue)]] },
    { t: 'para', texte: `En outre, ${a.il} bénéficie d'une indemnité légale de transport, conformément aux dispositions légales, de ${montantFCFA(d.indemnite_transport)}.` },

    { t: 'article', texte: 'ARTICLE 5 : HORAIRE DE TRAVAIL' },
    { t: 'para', texte: "L'horaire de travail est de 8 heures et est réparti en fonction des directives du restaurant." },
    { t: 'para', texte: "En tout état de cause, l'employeur se réserve le droit de modifier les horaires de travail en fonction des intérêts du restaurant. Ces modifications se feront dans le respect des dispositions légales et réglementaires." },

    { t: 'article', texte: 'ARTICLE 6 : RUPTURE DU CONTRAT' },
    cdi
      ? { t: 'para', texte: "Conformément aux dispositions réglementaires en vigueur, le présent contrat peut être rompu par l'une ou l'autre des parties dans le respect du préavis légal, ou sans préavis en cas de force majeure ou de faute lourde." }
      : { t: 'para', texte: "Conformément aux dispositions réglementaires en vigueur, le présent contrat prend fin à l'arrivée du terme (article 15.1) et peut être rompu en cas de force majeure ou de faute lourde." },
  ]

  if (!cdi) {
    blocs.push(
      { t: 'article', texte: 'ARTICLE 7 : INDEMNITE DE FIN DE CONTRAT' },
      { t: 'para', texte: "Conformément aux dispositions de l'article 15.8 du code du travail, en cas de fin de contrat de travail à durée déterminée, le travailleur a droit à une indemnité de fin de contrat dont le taux est de 3 %. Ce taux est applicable sur la somme des salaires bruts perçus pendant la durée de son contrat de travail." },
      { t: 'para', texte: "Cependant, cette indemnité n'est pas due, premièrement en cas de rupture anticipée du fait du travailleur et deuxièmement, en cas d'embauche à la fin du contrat à durée déterminée." },
    )
  }

  const n = cdi ? 7 : 8
  blocs.push(
    { t: 'article', texte: `ARTICLE ${n} : REGLEMENT INTERIEUR` },
    { t: 'para', texte: `Durant l'exécution du présent contrat, le travailleur est tenu de respecter le règlement intérieur ainsi que les différentes notes de service de ${etab}, de même que celui des autres restaurants ${etab} répartis sur l'étendue du territoire national ivoirien qu'${a.il} peut être amené${a.e} à rejoindre dans le cadre de l'exécution de son contrat de travail.` },

    { t: 'article', texte: `ARTICLE ${n + 1} : CLAUSE DE CONFIDENTIALITE` },
    { t: 'para', texte: "Le titulaire s'oblige à respecter le secret professionnel le plus absolu sur toutes les affaires d'ordre technique, commercial, financier ou autres, relatives à l'entreprise ou à l'un de ses partenaires, qui auraient été portées à sa connaissance du fait ou à l'occasion de l'exécution du présent contrat." },
    { t: 'para', texte: "Le secret professionnel devra être respecté à l'égard des personnes étrangères à l'entreprise, sauf nécessité de service ; à l'intérieur même de l'entreprise, une certaine réserve dans les propos et dans la communication d'informations sera de rigueur. Cette clause de confidentialité s'applique pendant toute la durée du contrat." },

    { t: 'article', texte: `ARTICLE ${n + 2} : MALADIES - ACCIDENTS - ABSENCES - SECURITE SOCIALE` },
    { t: 'sous', texte: 'Accident de travail' },
    { t: 'para', texte: "En cas d'accident de travail et de maladie professionnelle, les droits et obligations de chacune des parties seront réglés conformément aux textes en vigueur en la matière en Côte d'Ivoire." },
    { t: 'sous', texte: 'Absences - maladie' },
    { t: 'para', texte: "Le titulaire devra informer l'entreprise dans les plus brefs délais et si possible par téléphone de toute absence, même de courte durée. Les absences pour maladie doivent donner lieu à l'envoi d'un certificat médical." },
    { t: 'sous', texte: 'Sécurité sociale' },
    { t: 'para', texte: "Les parties conviennent de s'affilier à l'institut de sécurité sociale dénommé Caisse Nationale de Prévoyance Sociale (CNPS)." },

    blocFait(d),
    { t: 'signatures' },
  )
  return { titre: blocs[1].texte, blocs }
}

function contratStage(d, m) {
  const a = accords(d.civilite)
  const qui = `${a.titre} ${MAJ(d.nom_famille)} ${MAJ(d.prenoms)}`.trim()
  const debut = dateEnLettres(d.date_debut)
  const blocs = [
    { t: 'entete' },
    { t: 'titre', texte: 'CONTRAT DE STAGE DE QUALIFICATION' },
    { t: 'para', texte: 'Entre les soussignés :' },
    ...blocsEmployeur(m).slice(1),
    ...blocsTravailleur(d),
    { t: 'para', texte: `Désigné${a.e} ${a.e ? 'la' : 'le'} stagiaire d'autre part,` },
    { t: 'para', texte: "Il a été conclu entre les soussignés, désignés les deux parties, un contrat dit contrat de stage, et ils ont décidé des clauses suivantes :" },

    { t: 'article', texte: 'ARTICLE PREMIER : TEXTE REGISSANT LE PRESENT CONTRAT' },
    { t: 'para', texte: "Le présent contrat a été conclu conformément aux dispositions de l'article 13.14 de la loi n° 2015-532 du 20 juillet 2015 portant code du travail de la République de Côte d'Ivoire." },

    { t: 'article', texte: 'ARTICLE DEUXIEME : ENGAGEMENT' },
    { t: 'para', texte: `A compter du ${debut}, ${qui} est engagé${a.e} en qualité de STAGIAIRE pour un stage de qualification. En outre, ${a.il} s'engage à se soumettre au règlement intérieur de l'entreprise.` },

    { t: 'article', texte: 'ARTICLE TROISIEME : HORAIRE DE TRAVAIL' },
    { t: 'para', texte: `${qui} est ${a.soumis} aux horaires de la société ${m.etablissement}.` },

    { t: 'article', texte: 'ARTICLE QUATRIEME : LA DUREE DU CONTRAT' },
    { t: 'para', texte: `Le présent contrat est conclu pour une période de ${dureeEnLettres(d.duree_mois)} renouvelable, à partir du ${debut} jusqu'au ${dateEnLettres(d.date_fin)}. Cependant, l'ensemble des renouvellements ne devra pas dépasser douze (12) mois.` },

    { t: 'article', texte: 'ARTICLE CINQUIEME : LA REMUNERATION' },
    { t: 'para', texte: `${qui} percevra une prime journalière de stage de ${montantFCFA(d.prime_journaliere)}.` },

    { t: 'article', texte: 'ARTICLE SIXIEME : LE CHAMP GEOGRAPHIQUE' },
    { t: 'para', texte: "Par le présent contrat de stage, le stagiaire s'engage à exercer ses activités en tout lieu géographique où la société a des intérêts d'ordre professionnel." },

    { t: 'article', texte: 'ARTICLE SEPTIEME : LA DISCIPLINE' },
    {
      t: 'puces', items: [
        "Le travailleur ne devra en aucun cas abandonner son poste de travail s'il n'a pas obtenu une permission de son employeur ;",
        'Le travailleur doit respecter son employeur et lui obéir dans le cadre du travail ;',
        "Le travailleur ne doit pas voler ou détourner d'une façon quelconque tout bien appartenant à son employeur : il n'utilisera en aucun cas le matériel de travail à ses propres fins, ni ne le dérobera ;",
        'Il ne doit pas divulguer les secrets professionnels ;',
        'Il ne doit livrer à son employeur aucune concurrence déloyale ;',
        'Il ne doit pas se rendre au travail drogué ou ivre ;',
        'Le travailleur ne doit en aucun cas se bagarrer ni se disputer avec un collègue ou une tierce personne sur le lieu de travail ;',
        "Le travailleur est obligé de respecter les mesures d'hygiène et de sécurité de l'entreprise ;",
        "Le travailleur doit absolument veiller sur les intérêts de l'entreprise ;",
        "Le travailleur a l'obligation de respecter sans réserve les règlements intérieurs de l'entreprise.",
      ],
    },
    { t: 'para', texte: "Les parties déclarent qu'elles exécuteront de bonne foi et sans réserve les clauses du présent contrat." },

    { t: 'article', texte: 'ARTICLE HUITIEME : LA RUPTURE' },
    { t: 'para', texte: `Le présent contrat de stage de ${qui} pourra être résilié sans préavis et sans que l'une ou l'autre des parties puisse prétendre à des indemnités.` },

    { t: 'article', texte: 'ARTICLE NEUVIEME : ENTREE EN VIGUEUR' },
    { t: 'para', texte: `Le présent contrat de stage prend effet à compter du ${debut}.` },
    { t: 'para', texte: 'Signature du travailleur précédée de la mention « Lu et approuvé ».' },

    blocFait(d),
    { t: 'signatures' },
  ]
  return { titre: blocs[1].texte, blocs }
}

/**
 * Texte complet d'un contrat. `donnees.marque` doit avoir un modèle
 * (voir champsManquantsContrat) : sinon on retombe sur Chez Samer pour ne
 * jamais planter, mais la génération est bloquée en amont.
 */
export function construireContrat(donnees) {
  const d = donnees || {}
  const m = marqueContrat(d.marque) || MARQUES_CONTRAT.samer
  if (d.type === 'Stage') return contratStage(d, m)
  return contratCddOuCdi(d, m, d.type === 'CDI')
}

const enMontant = v => (v === null || v === undefined || String(v).trim() === '' ? null : Number(v))

/**
 * Données figées d'un contrat, à partir de la fiche du travailleur et des
 * choix de la RH. Le téléphone de la fiche s'appelle `contact`.
 * choix : { type, duree_mois, date_debut, date_fin, montants }
 */
export function donneesDepuisFiche(travailleur, marque, choix) {
  const t = travailleur || {}
  const { type, duree_mois, date_debut, date_fin, montants = {} } = choix || {}
  const remuneration = type === 'Stage'
    ? { prime_journaliere: enMontant(montants.prime_journaliere) }
    : {
      categorie: String(montants.categorie ?? '').trim(),
      salaire_categoriel: enMontant(montants.salaire_categoriel),
      prime_tenue: enMontant(montants.prime_tenue),
      indemnite_transport: enMontant(montants.indemnite_transport),
    }
  return {
    type,
    marque,
    civilite: t.civilite || null,
    nom_famille: t.nom_famille || null,
    prenoms: t.prenoms || null,
    date_naissance: t.date_naissance || null,
    lieu_naissance: t.lieu_naissance || null,
    nationalite: t.nationalite || null,
    situation_famille: t.situation_famille || null,
    cni_numero: t.cni_numero || null,
    nni_numero: t.nni_numero || null,
    lieu_residence: t.lieu_residence || null,
    telephone: t.contact || null,
    poste: t.poste || null,
    date_debut: date_debut || null,
    date_fin: type === 'CDI' ? null : (date_fin || null),
    duree_mois: type === 'CDI' ? null : (Number(duree_mois) || null),
    ...remuneration,
    date_signature: null,
  }
}

/** Tout le texte du contrat, à plat (tests, recherche). */
export function texteContrat(contrat) {
  return (contrat?.blocs || []).map(b => {
    if (b.t === 'champs') return b.items.map(([l, v]) => `${l} : ${v}`).join('\n')
    if (b.t === 'puces') return b.items.join('\n')
    if (b.t === 'signatures') return 'LE TRAVAILLEUR (Lu et approuvé)\nL\'EMPLOYEUR'
    return b.texte || ''
  }).join('\n')
}

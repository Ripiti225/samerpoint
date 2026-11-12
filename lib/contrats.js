// ──────────────────────────────────────────────────────────────────────────────
// Contrats de travail : Stage, CDD, CDI.
//
// Module pur — aucune fonction ne lit l'horloge : la date du jour est toujours
// passée en paramètre. C'est ce qui rend la désactivation automatique testable,
// et donc sûre : elle archive des gens.
//
// Les dates circulent en chaînes 'AAAA-MM-JJ'. Les comparer en chaîne est exact
// pour ce format, et évite le décalage d'un jour que provoque un objet Date lu
// dans le fuseau du navigateur.
// ──────────────────────────────────────────────────────────────────────────────

export const TYPES_CONTRAT = ['Stage', 'CDD', 'CDI']
export const DUREES_MOIS = [1, 2, 3, 6, 12]
export const DUREE_MIN = 1
export const DUREE_MAX = 60
export const MOTIFS_RUPTURE = ['Démission', 'Renvoi', 'Fin anticipée', 'Autre']
// Alertes de fin : une semaine avant, 3 jours avant, la veille.
export const PALIERS_ALERTE = [7, 3, 1]

// Circuit d'un contrat généré par l'application. Un contrat saisi à
// l'ancienne (photo d'un papier) est directement « signe ».
export const STATUTS_SIGNATURE = ['a_signer', 'signe_a_verifier', 'signe', 'refuse', 'annule']

// Seul un contrat signé fait foi (jauge, alertes, désactivation). Les lignes
// d'avant la migration n'ont pas de statut : ce sont des contrats papier.
export function contratsSignes(contrats) {
  return (contrats || []).filter(c => !c.statut || c.statut === 'signe')
}

export function estGenere(contrat) {
  return !!contrat?.modele
}

const JOUR_MS = 24 * 60 * 60 * 1000

function versUTC(iso) {
  const [a, m, j] = String(iso).split('-').map(Number)
  return Date.UTC(a, m - 1, j)
}

export function aujourdhuiISO() {
  return new Date().toISOString().slice(0, 10)
}

export function ajouterJours(iso, n) {
  return new Date(versUTC(iso) + n * JOUR_MS).toISOString().slice(0, 10)
}

// Un contrat de n mois finit la VEILLE du même jour, n mois plus tard : du
// 25/01 au 24/07 pour 6 mois (règle de l'utilisateur, 12/11/2026). Le contrat
// suivant commence donc le lendemain, sans chevaucher le précédent.
// Si ce jour n'existe pas dans le mois d'arrivée (un 31 avril), le contrat
// finit le dernier jour de ce mois.
export function calculerDateFin(dateDebut, dureeMois) {
  if (!dateDebut || !dureeMois) return ''
  const [a, m, j] = String(dateDebut).split('-').map(Number)
  const total = (m - 1) + dureeMois
  const annee = a + Math.floor(total / 12)
  const mois = (total % 12) + 1
  const dernierJour = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  if (j > dernierJour) return `${annee}-${String(mois).padStart(2, '0')}-${String(dernierJour).padStart(2, '0')}`
  return ajouterJours(`${annee}-${String(mois).padStart(2, '0')}-${String(j).padStart(2, '0')}`, -1)
}

// Garde-fou : 60 contrats d'un mois couvrent déjà 5 ans.
const PERIODES_MAX = 60

// Un stage qui a commencé il y a longtemps est découpé en contrats successifs
// de la durée choisie, jusqu'à celui qui couvre aujourd'hui (ou qui est à venir) :
// embauche le 25/01, 6 mois, le 12/11 → du 25/01 au 24/07 (passé), puis du
// 25/07 au 24/01 (en cours).
export function decouperEnPeriodes(dateDebut, dureeMois, aujourdhui) {
  if (!dateDebut || !dureeMois) return []
  const periodes = []
  let debut = dateDebut
  while (periodes.length < PERIODES_MAX) {
    const fin = calculerDateFin(debut, dureeMois)
    const passe = fin < aujourdhui
    periodes.push({ date_debut: debut, date_fin: fin, passe })
    if (!passe) break
    debut = ajouterJours(fin, 1)
  }
  return periodes
}

// Le texte du stage limite l'ensemble des renouvellements à 12 mois.
export const STAGE_MOIS_MAX = 12

export function stageDepasseDouzeMois(debutStage, finDernierContrat) {
  if (!debutStage || !finDernierContrat) return false
  return finDernierContrat > calculerDateFin(debutStage, STAGE_MOIS_MAX)
}

// Une rupture anticipée prime toujours sur la date prévue.
export function finEffective(contrat) {
  if (!contrat) return null
  return contrat.cloture_le || contrat.date_fin || null
}

export function statutContrat(contrat, aujourdhui) {
  if (!contrat) return null
  if (aujourdhui < contrat.date_debut) return 'a_venir'
  const fin = finEffective(contrat)
  if (!fin) return 'en_cours'
  if (aujourdhui <= fin) return 'en_cours'
  return contrat.cloture_le ? 'rompu' : 'expire'
}

export function contratEnCours(contrats, aujourdhui) {
  return (contrats || []).find(c => statutContrat(c, aujourdhui) === 'en_cours') || null
}

export function joursRestants(contrat, aujourdhui) {
  const fin = finEffective(contrat)
  if (!fin) return null
  return Math.round((versUTC(fin) - versUTC(aujourdhui)) / JOUR_MS)
}

// Le palier applicable le plus haut non encore envoyé. Un contrat saisi à 5
// jours de sa fin reçoit J-7 tout de suite, au lieu d'attendre J-3.
export function palierAEnvoyer(contrat, aujourdhui) {
  if (!contrat || contrat.cloture_le || !contrat.date_fin) return null
  const restants = joursRestants(contrat, aujourdhui)
  if (restants === null || restants < 0) return null
  const envoyes = contrat.rappels_envoyes || []
  for (const palier of [...PALIERS_ALERTE].reverse()) {
    if (restants <= palier && !envoyes.includes(palier)) return palier
  }
  return null
}

// Trois verrous : il faut au moins un contrat (sinon le premier passage du cron
// archiverait les 130 travailleurs actifs), aucun contrat couvrant aujourd'hui,
// et aucun contrat à venir — le RH qui saisit le suivant avec trois jours de
// battement a signalé la continuité.
export function doitEtreDesactive(contrats, aujourdhui) {
  const liste = contrats || []
  if (liste.length === 0) return false
  if (contratEnCours(liste, aujourdhui)) return false
  if (liste.some(c => statutContrat(c, aujourdhui) === 'a_venir')) return false
  return true
}

export function validerFormulaireContrat(form) {
  const ko = erreur => ({ ok: false, erreur })
  if (!form?.type || !TYPES_CONTRAT.includes(form.type)) return ko('Choisis le type de contrat.')
  if (!form.date_debut) return ko('Indique la date de début du contrat.')
  if (!form.photo_url) return ko('La photo du contrat signé est obligatoire.')

  if (form.type === 'CDI') {
    if (form.date_fin) return ko("Un CDI n'a pas de date de fin.")
    return { ok: true, erreur: null }
  }
  if (!form.date_fin) return ko('Indique la durée, ou la date de fin du contrat.')
  if (form.date_fin < form.date_debut) return ko('La date de fin doit être après la date de début.')
  return { ok: true, erreur: null }
}

export function formatFR(iso) {
  if (!iso) return ''
  const [a, m, j] = String(iso).split('-')
  return `${j}/${m}/${a}`
}

export function ordinalFR(n) {
  return n === 1 ? '1er' : `${n}e`
}

// Le rang se compte PAR TYPE : trois stages d'affilée sont 1er, 2e et 3e
// contrat de stage, et le premier CDD qui suit repart à 1.
export function rangParType(contrats, contrat) {
  if (!contrat) return 0
  const memeType = (contrats || [])
    .filter(c => c.type === contrat.type)
    .sort((a, b) => (a.date_debut < b.date_debut ? -1 : a.date_debut > b.date_debut ? 1 : 0))
  const i = memeType.findIndex(c => c.id === contrat.id)
  return i === -1 ? 0 : i + 1
}

// Le contrat qui représente le travailleur dans la liste. L'ordre compte :
// un contrat terminé passe AVANT un contrat à venir, pour qu'un travailleur
// dont le CDD s'est fini reste visible dans « Expirés » tant que le suivant
// n'a pas démarré.
export function contratAffiche(contrats, aujourdhui) {
  const liste = contrats || []
  if (liste.length === 0) return null

  const enCours = contratEnCours(liste, aujourdhui)
  if (enCours) return enCours

  const termines = liste
    .filter(c => ['expire', 'rompu'].includes(statutContrat(c, aujourdhui)))
    .sort((a, b) => (finEffective(a) < finEffective(b) ? 1 : -1))
  if (termines.length > 0) return termines[0]

  const aVenir = liste
    .filter(c => statutContrat(c, aujourdhui) === 'a_venir')
    .sort((a, b) => (a.date_debut < b.date_debut ? -1 : 1))
  return aVenir[0] || null
}

// La base a le dernier mot (contrainte contrat_cloture_coherente), mais valider
// ici permet de citer les vraies bornes du contrat dans le message.
export function validerCloture(contrat, dateCloture, motif) {
  const ko = erreur => ({ ok: false, erreur })
  if (!contrat) return ko('Contrat introuvable.')
  if (contrat.cloture_le) return ko('Ce contrat est déjà rompu.')
  if (!dateCloture) return ko('Indique la date de rupture.')
  if (!motif || !String(motif).trim()) return ko('Indique le motif de la rupture.')
  if (dateCloture < contrat.date_debut) {
    return ko(`La date de rupture ne peut pas être avant le début du contrat, le ${formatFR(contrat.date_debut)}.`)
  }
  if (contrat.date_fin && dateCloture > contrat.date_fin) {
    return ko(`La date de rupture doit être comprise entre le ${formatFR(contrat.date_debut)} et le ${formatFR(contrat.date_fin)}.`)
  }
  return { ok: true, erreur: null }
}

export function validerDureeLibre(valeur) {
  const ko = erreur => ({ ok: false, erreur, mois: null })
  const txt = String(valeur ?? '').trim()
  if (!txt) return ko('Indique la durée en mois.')
  if (!/^\d+$/.test(txt)) return ko('La durée doit être un nombre de mois.')
  const mois = Number(txt)
  if (mois < DUREE_MIN || mois > DUREE_MAX) {
    return ko(`La durée doit être comprise entre ${DUREE_MIN} et ${DUREE_MAX} mois.`)
  }
  return { ok: true, erreur: null, mois }
}

// ── Écran Contrats : compteurs et barre de progression ──────────────────────

export const SEUIL_EXPIRE_BIENTOT = 30

// Jours restants si le contrat en cours finit dans les 30 jours (0 = dernier
// jour), sinon null. Un CDI ou un contrat rompu n'expire pas « bientôt ».
export function expireBientot(contrat, aujourdhui) {
  if (!contrat || contrat.cloture_le || !contrat.date_fin) return null
  if (statutContrat(contrat, aujourdhui) !== 'en_cours') return null
  const restants = joursRestants(contrat, aujourdhui)
  if (restants === null || restants < 0 || restants > SEUIL_EXPIRE_BIENTOT) return null
  return restants
}

/**
 * Filtres de l'écran, dans l'ordre des compteurs. Un travailleur peut compter
 * dans plusieurs (« Expire bientôt » est aussi « En cours »).
 */
export const FILTRES_CONTRAT = [
  { cle: 'tous', label: 'Travailleurs' },
  { cle: 'bientot', label: 'Expirent bientôt' },
  { cle: 'en_cours', label: 'En cours' },
  { cle: 'expires', label: 'Expirés' },
  { cle: 'sans', label: 'Sans contrat' },
]

export function correspondFiltreContrat(cle, contrat, aujourdhui) {
  if (cle === 'tous') return true
  if (cle === 'sans') return !contrat
  if (!contrat) return false
  const s = statutContrat(contrat, aujourdhui)
  if (cle === 'en_cours') return s === 'en_cours' || s === 'a_venir'
  if (cle === 'expires') return s === 'expire' || s === 'rompu'
  if (cle === 'bientot') return expireBientot(contrat, aujourdhui) !== null
  return false
}

/** lignes : [{ contrat }] → { tous, bientot, en_cours, expires, sans } */
export function compterContrats(lignes, aujourdhui) {
  const out = {}
  for (const f of FILTRES_CONTRAT) out[f.cle] = lignes.filter(l => correspondFiltreContrat(f.cle, l.contrat, aujourdhui)).length
  return out
}

/**
 * Avancement d'un contrat à date de fin, de 0 à 100 %. null pour un CDI
 * (pas de fin) ; 0 avant le début ; 100 une fois terminé ou rompu.
 */
export function progressionContrat(contrat, aujourdhui) {
  const fin = finEffective(contrat)
  if (!contrat || !fin) return null
  const total = versUTC(fin) - versUTC(contrat.date_debut)
  if (total <= 0) return 100
  const fait = versUTC(aujourdhui) - versUTC(contrat.date_debut)
  return Math.max(0, Math.min(100, Math.round((fait / total) * 100)))
}

/**
 * Résumé pour la jauge et le bandeau de l'accueil, sur les travailleurs actifs
 * (non archivés) :
 *   sousContrat  un contrat valable aujourd'hui, ou qui débute bientôt
 *   pct          sousContrat / total, de 0 à 100
 *   bientot      contrats qui finissent dans les 30 jours ; plusProche = jours
 *                restants du plus urgent (null s'il n'y en a pas)
 *   sans         aucun contrat enregistré
 *   aRenouveler  dernier contrat terminé ou rompu, sans suite prévue
 */
export function resumeContrats(travailleurs, contrats, aujourdhui) {
  const parTrav = {}
  for (const c of contrats || []) (parTrav[c.travailleur_id] ||= []).push(c)

  const r = { total: 0, sousContrat: 0, pct: 0, bientot: 0, plusProche: null, sans: 0, aRenouveler: 0 }
  for (const t of travailleurs || []) {
    if (t.actif === false || t.statut === 'archive') continue
    r.total++
    const siens = parTrav[t.id] || []
    if (siens.length === 0) { r.sans++; continue }
    const statuts = siens.map(c => statutContrat(c, aujourdhui))
    if (statuts.includes('en_cours') || statuts.includes('a_venir')) r.sousContrat++
    else r.aRenouveler++
    for (const c of siens) {
      const j = expireBientot(c, aujourdhui)
      if (j === null) continue
      r.bientot++
      if (r.plusProche === null || j < r.plusProche) r.plusProche = j
    }
  }
  r.pct = r.total > 0 ? Math.round((r.sousContrat / r.total) * 100) : 0
  return r
}

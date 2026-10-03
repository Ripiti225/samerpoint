// ──────────────────────────────────────────────────────────────────────────────
// Jour de repos des travailleurs — logique pure.
//
// Le POS ne transmet que les présences : un jour non pointé est soit une
// absence, soit le jour de repos. On déduit le jour de repos hebdomadaire de
// chaque travailleur sur les 12 dernières semaines : le jour de la semaine où
// il manque au moins 3 fois sur 4, alors qu'il est là la plupart des autres
// jours. Pas assez de semaines ou pas de jour net → on ne touche à rien.
//
// Puis, à l'affichage (rien n'est écrit dans `presences`), chaque jour
// d'ouverture non pointé devient « Repos » (son jour), « Absent » (un autre
// jour) ou « Non pointé » (jour de repos encore inconnu, hors taux).
// Tests : lib/joursRepos.test.mjs
// ──────────────────────────────────────────────────────────────────────────────

export const FENETRE_JOURS = 84 // 12 semaines
export const MIN_SEMAINES = 6 // chaque jour de la semaine observé au moins 6 fois
export const SEUIL_REPOS = 0.75 // absent au moins 3 semaines sur 4 ce jour-là
export const SEUIL_AUTRES = 0.5 // et absent moins d'une fois sur 2 le 2e jour le plus manqué

export const JOURS_SEMAINE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
export const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

/** 1 = lundi … 7 = dimanche, pour une date AAAA-MM-JJ. */
export function jourIso(date) {
  const j = new Date(`${date}T00:00:00Z`).getUTCDay()
  return j === 0 ? 7 : j
}

export function nomJour(jour) {
  return jour >= 1 && jour <= 7 ? JOURS_SEMAINE[jour - 1] : ''
}

const iso = d => d.toISOString().split('T')[0]

/** Fenêtre d'analyse : les 12 semaines qui finissent hier. */
export function fenetreAnalyse(aujourdhui = new Date()) {
  const fin = new Date(aujourdhui); fin.setUTCDate(fin.getUTCDate() - 1)
  const debut = new Date(fin); debut.setUTCDate(debut.getUTCDate() - (FENETRE_JOURS - 1))
  return { debut: iso(debut), fin: iso(fin) }
}

/**
 * Analyse d'un travailleur.
 * joursOuverts : dates où son restaurant a ouvert (un point existe).
 * presents     : Set des dates où il est pointé « Présent ».
 * debutSuivi   : première date où il apparaît dans les présences (avant, il
 *                n'était pas encore là : ses jours ne comptent pas).
 * → { jour, taux, semaines, parJour } ou { jour: null, raison, parJour }
 */
export function analyserJourRepos({ joursOuverts, presents, debutSuivi }) {
  const parJour = {}
  for (let j = 1; j <= 7; j++) parJour[j] = { ouverts: 0, absents: 0 }
  if (!debutSuivi) return { jour: null, raison: 'jamais_pointe', parJour }

  for (const date of joursOuverts) {
    if (date < debutSuivi) continue
    const c = parJour[jourIso(date)]
    c.ouverts++
    if (!presents.has(date)) c.absents++
  }

  const semaines = Math.min(...Object.values(parJour).map(c => c.ouverts))
  if (semaines < MIN_SEMAINES) return { jour: null, raison: 'pas_assez', semaines, parJour }

  const classes = Object.entries(parJour)
    .map(([j, c]) => ({ jour: Number(j), taux: c.absents / c.ouverts }))
    .sort((a, b) => b.taux - a.taux)
  const [premier, second] = classes
  if (premier.taux < SEUIL_REPOS || second.taux >= SEUIL_AUTRES) {
    return { jour: null, raison: second.taux >= SEUIL_REPOS ? 'rarement_pointe' : 'pas_de_jour_net', semaines, parJour }
  }
  return { jour: premier.jour, taux: premier.taux, semaines, parJour }
}

/**
 * Analyse de toute l'équipe.
 * travailleurs : [{ id, restaurant_id, jour_repos, jour_repos_source }]
 * points       : [{ date, restaurant_id }] de la fenêtre
 * presences    : [{ travailleur_id, statut, date, restaurant_id }] de la fenêtre
 * → une ligne par travailleur : { id, resultat, action } où action vaut
 *   'manuel' (choix à la main, intouchable), 'nouveau', 'change', 'confirme' ou 'aucune'.
 */
export function analyserEquipe({ travailleurs, points, presences }) {
  const joursParResto = {}
  for (const p of points) (joursParResto[p.restaurant_id] ||= new Set()).add(p.date)

  // Suivi limité au restaurant actuel : un travailleur transféré n'est jugé
  // que sur ses jours dans son nouveau restaurant.
  const parTrav = {}
  for (const p of presences) {
    const t = (parTrav[`${p.travailleur_id}|${p.restaurant_id}`] ||= { presents: new Set(), premier: null })
    if (p.statut === 'Présent') t.presents.add(p.date)
    if (!t.premier || p.date < t.premier) t.premier = p.date
  }

  return travailleurs.map(t => {
    const suivi = parTrav[`${t.id}|${t.restaurant_id}`]
    const resultat = analyserJourRepos({
      joursOuverts: [...(joursParResto[t.restaurant_id] || [])].sort(),
      presents: suivi?.presents || new Set(),
      debutSuivi: suivi?.premier || null,
    })
    let action = 'aucune'
    if (t.jour_repos_source === 'manuel') action = 'manuel'
    else if (resultat.jour && !t.jour_repos) action = 'nouveau'
    else if (resultat.jour && resultat.jour !== t.jour_repos) action = 'change'
    else if (resultat.jour) action = 'confirme'
    return { id: t.id, resultat, action }
  })
}

/**
 * Complète les présences d'une période avec les jours non pointés.
 * Pour chaque travailleur actif et chaque jour d'ouverture de son restaurant
 * (avant aujourd'hui, après son embauche) sans aucune ligne de présence :
 *   son jour de repos → « Repos » ; un autre jour → « Absent » ;
 *   jour de repos inconnu → « Non pointé » (exclu du taux).
 * Les lignes ajoutées portent `deduit: true` et une paie nulle.
 */
export function completerPresences({ presences, travailleurs, points, aujourdhui }) {
  const deja = new Set(presences.map(p => `${p.travailleur_id}|${p.date}`))
  const pointsParResto = {}
  for (const p of points) (pointsParResto[p.restaurant_id] ||= []).push(p)

  const ajouts = []
  for (const t of travailleurs) {
    if (!t.actif || t.statut === 'archive') continue
    const debut = [t.date_embauche, t.created_at?.split('T')[0]].filter(Boolean).sort().at(-1) || ''
    for (const p of pointsParResto[t.restaurant_id] || []) {
      if (p.date >= aujourdhui || p.date < debut || deja.has(`${t.id}|${p.date}`)) continue
      const statut = !t.jour_repos ? 'Non pointé' : jourIso(p.date) === t.jour_repos ? 'Repos' : 'Absent'
      ajouts.push({
        travailleur_id: t.id, travailleur_nom: t.nom, point_id: p.id, date: p.date,
        restaurant_id: t.restaurant_id, statut, paye: 0, deduit: true,
      })
    }
  }
  return presences.concat(ajouts)
}

// ──────────────────────────────────────────────────────────────────────────────
// Calendrier : les dates saisies ailleurs dans l'application (chèques, échéances,
// prévisions, coffre, charges administratives, contrats, congés, tâches).
// Lues à l'affichage, jamais copiées. Logique pure.
// Conception : docs/superpowers/specs/2026-11-07-calendrier-dates-design.md
// Tests : lib/calendrierDates.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { typesAutorises } from './accesCalendrier.js'
import { lignesDuCheque, libelleCheque } from './cheques.js'
import { contratsSignes } from './contrats.js'
import { voitToutLeGroupe } from './evenements.js'
import { estAdministratif, prochaineEcheance } from './fournisseursAdmin.js'
import { etatPrevision } from './previsions.js'
import { tacheOuverte } from './supervision.js'
import { LIBELLES_CATEGORIE, categoriesVisibles, formatDateFR, niveauTresorerie, paiementsParDu, resteDu } from './tresorerie.js'

export const SANS_TRESORERIE = { cheques: false, coffre: false, charges: false, echeances: false, previsions: false, categories: [], dettes: false }

/** Le réglage décide ; un gérant n'est jamais propriétaire ici, même avec une ligne de droits. */
export function droitsDates(role, userId, droits = [], config = {}) {
  const groupe = voitToutLeGroupe(role)
  const proprietaire = groupe && niveauTresorerie(role, userId, droits) === 'proprietaire'
  const types = typesAutorises(role, { proprietaire, config })
  const a = k => types.includes(k)
  const lireDus = a('echeances') || a('previsions') || a('echeances_retard')
  return {
    proprietaire,
    cheques: a('cheques'),
    coffre: a('coffre'),
    charges: a('charges'),
    echeances: a('echeances'),
    previsions: a('previsions'),
    dettes: a('echeances_retard'),
    categories: lireDus ? categoriesVisibles('proprietaire').filter(c => c !== 'dette' || a('echeances_retard')) : [],
    contrats: a('contrats'),
    conges: a('conges'),
    taches: a('taches'),
    anniversaires: a('anniversaires'),
    age: a('age'),
    anciennete: a('anciennete'),
    evenements: a('evenements'),
  }
}

/** Les lignes qui ne viennent pas de lignesDates suivent aussi le réglage. */
export function filtrerParDroits(lignes, droits) {
  const permis = { anniversaire: droits.anniversaires, anciennete: droits.anciennete, calendrier: droits.evenements }
  return lignes.filter(l => !(l.type in permis) || permis[l.type])
}

const n = v => Number(v) || 0
const pluriel = (k, mot, motPluriel = `${mot}s`) => `${k} ${k > 1 ? motPluriel : mot}`

export function lignesDates(d, { aujourdhui, droits, restaurantId, groupe }) {
  const nomResto = id => d.restaurants.find(r => r.id === id)?.nom || null
  const ligne = (cle, famille, sousType, date, titre, detail, route, restaurant_id = null, montant = null) => ({
    cle, type: 'date', famille, sousType, date, retard: date < aujourdhui, titre, detail, montant, route, restaurant_id,
  })
  // Garde-fou : un gérant n'a que son restaurant, jamais ce qui n'en a aucun.
  const dansLeResto = id => (groupe ? (!restaurantId || !id || id === restaurantId) : !!id && id === restaurantId)
  const sortie = []

  if (droits.cheques) {
    for (const c of d.cheques) {
      if (c.statut !== 'emis' || !c.date_encaissement) continue
      sortie.push(ligne(`cheque-${c.id}`, 'tresorerie', 'cheque', c.date_encaissement, libelleCheque(c),
        c.ordre ? `À l'ordre de ${c.ordre}` : 'Chèque à encaisser', '/tresorerie-cheques', null, n(c.montant)))
    }
  }

  const parDu = paiementsParDu(d.paiements)
  const dusVisibles = d.dus.filter(x => droits.categories.includes(x.categorie) && dansLeResto(x.restaurant_id))
  const enRetard = []
  for (const du of dusVisibles) {
    const reste = resteDu(du, parDu[du.id] || [])
    if (!du.echeance || reste <= 0) continue
    if (du.echeance < aujourdhui) { enRetard.push({ du, reste }); continue }
    if (droits.echeances) {
      sortie.push(ligne(`du-${du.id}`, 'tresorerie', 'echeance', du.echeance,
        du.libelle || du.creancier || LIBELLES_CATEGORIE[du.categorie] || 'Échéance',
        nomResto(du.restaurant_id) || 'Groupe', '/tresorerie-a-payer', du.restaurant_id, reste))
    }
  }
  if (droits.dettes && enRetard.length) {
    const plusAncienne = enRetard.map(x => x.du.echeance).sort()[0]
    sortie.push(ligne('echeances-retard', 'tresorerie', 'echeances_retard', plusAncienne,
      `${pluriel(enRetard.length, 'échéance')} en retard`, 'À régler dans À payer', '/tresorerie-a-payer', null,
      enRetard.reduce((s, x) => s + x.reste, 0)))
  }

  if (droits.previsions) {
    const deCheque = new Set(d.cheques.filter(c => c.statut === 'emis').flatMap(c => lignesDuCheque(c).map(l => l.prevision_id)).filter(Boolean))
    for (const p of d.previsions) {
      if (!p.date_prevue || deCheque.has(p.id)) continue
      const du = dusVisibles.find(x => x.id === p.du_id)
      if (!du) continue
      const etat = etatPrevision(p, { du, paiementsDu: parDu[du.id] || [], receptions: [], aujourdhui })
      if (etat.statut === 'realisee') continue
      sortie.push(ligne(`prevision-${p.id}`, 'tresorerie', 'prevision', p.date_prevue,
        `Paiement prévu : ${du.libelle || du.creancier || LIBELLES_CATEGORIE[du.categorie] || 'échéance'}`,
        nomResto(du.restaurant_id) || 'Groupe', '/tresorerie-a-payer', du.restaurant_id, etat.aPayer))
    }
  }

  if (droits.coffre) {
    for (const e of d.emprunts) {
      if (e.rembourse_le || !e.rembourser_le) continue
      sortie.push(ligne(`coffre-${e.id}`, 'tresorerie', 'coffre', e.rembourser_le, 'Remboursement du coffre',
        e.note || 'Emprunt à rembourser', '/tresorerie-coffre', null, n(e.montant)))
    }
  }

  if (droits.charges) {
    const parDate = {}
    for (const f of d.fournisseurs) {
      if (!estAdministratif(f) || f.actif === false || !dansLeResto(f.restaurant_id)) continue
      const date = prochaineEcheance(f, aujourdhui)
      if (!date) continue
      parDate[date] = parDate[date] || { nb: 0, total: 0 }
      parDate[date].nb += 1
      parDate[date].total += n(f.facture_mensuelle)
    }
    for (const [date, { nb, total }] of Object.entries(parDate)) {
      sortie.push(ligne(`charges-${date}`, 'tresorerie', 'charges', date, pluriel(nb, 'charge administrative', 'charges administratives'),
        'CNPS, ITS, TEE, Timbre, Bail…', '/credits-fournisseurs', null, total))
    }
  }

  if (droits.contrats) {
    for (const c of contratsSignes(d.contrats)) {
      if (c.cloture_le || !c.date_fin || c.date_fin < aujourdhui || !dansLeResto(c.restaurant_id)) continue
      sortie.push(ligne(`contrat-${c.id}`, 'personnel', 'contrat', c.date_fin, `Fin de contrat : ${c.travailleurs?.nom || 'travailleur'}`,
        [c.type, nomResto(c.restaurant_id)].filter(Boolean).join(' · '), '/contrats', c.restaurant_id))
    }
  }

  if (droits.conges) {
    const absences = [
      ...d.demandes.filter(a => a.statut === 'validee').map(a => ({ a, prefixe: 'conge' })),
      ...d.permissions.map(a => ({ a, prefixe: 'permission' })),
    ]
    for (const { a, prefixe } of absences) {
      if (!a.date_debut || !a.date_fin || a.date_fin < aujourdhui || !dansLeResto(a.restaurant_id)) continue
      const date = a.date_debut > aujourdhui ? a.date_debut : aujourdhui
      const periode = `Du ${formatDateFR(a.date_debut)} au ${formatDateFR(a.date_fin)}`
      sortie.push(ligne(`${prefixe}-${a.id}`, 'personnel', 'conge', date, `${a.type || 'Absence'} : ${a.travailleur_nom || 'travailleur'}`,
        [periode, nomResto(a.restaurant_id)].filter(Boolean).join(' · '), groupe ? '/demandes-admin' : '/demandes', a.restaurant_id))
    }
  }

  if (droits.taches) {
    for (const t of d.taches) {
      if (!tacheOuverte(t) || !t.echeance || !dansLeResto(t.restaurant_id)) continue
      sortie.push(ligne(`tache-${t.id}`, 'taches', 'tache', t.echeance, t.titre,
        [nomResto(t.restaurant_id), t.responsable_nom].filter(Boolean).join(' · '), '/supervision', t.restaurant_id))
    }
  }

  return sortie
}

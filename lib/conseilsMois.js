// ──────────────────────────────────────────────────────────────────────────────
// Rapport mensuel — analyse et conseils pour le mois suivant (logique pure).
//
// Règles chiffrées seules (choix du 02/11/2026) : chaque constat et chaque
// conseil vient d'un calcul sur les chiffres du mois (Samtrackly + caisses POS),
// jamais d'un texte inventé. Les gains sont des estimations PRUDENTES de l'effet
// sur le résultat (marge, pas chiffre d'affaires), sur une partie de l'écart
// seulement : ils servent à classer les conseils, pas à promettre un montant.
//
// Entrée d'un restaurant : entreeResto() ; règles : analyserResto() ; groupe :
// analyserGroupe(). Tests : lib/conseilsMois.test.mjs
// ──────────────────────────────────────────────────────────────────────────────
import { joursForts, mixCanaux } from './statsPOS.js'

const n = v => Number(v) || 0
const pct = (a, b) => (n(b) ? Math.round((n(a) / n(b)) * 1000) / 10 : null)
const fmt = v => `${Math.round(n(v)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} F`
const arrondir = (v, pas) => Math.round(n(v) / pas) * pas
const fmtM = v => `${(n(v) / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }).replace(/[\u202f\u00a0]/g, ' ')} M`
const mediane = l => {
  const t = l.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b)
  if (!t.length) return null
  const m = Math.floor(t.length / 2)
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2
}

// Seuils (en % sauf mention) : réglés sur octobre 2026, le premier mois complet des POS.
export const SEUILS = {
  annulations: 5, annulationsCible: 3,
  offerts: 3, offertsCible: 2,
  livraisonPart: 25, ticketLivraisonRatio: 0.85,
  achatsEcart: 5,
  depenses: 80,
  creux: 12, nuit: 15,
  jourFaible: 0.7,
  ticketRatio: 0.9,
  baisse: -5, forteBaisse: -10,
  litiges: 1, inventaire: 0.5,
  ecartEspeces: -50000,
  noteCaissiers: 15,
  platsMorts: 10,
}

/**
 * Données d'un restaurant pour les règles.
 * resto : ligne de rapport.restaurants ; ligne : analyse.lignes ;
 * pos / posPrec : stats_dashboard du mois et du mois précédent ; plats : stats_plats.
 */
export function entreeResto({ resto, ligne = null, pos = null, posPrec = null, plats = null }) {
  return {
    id: resto.id,
    nom: String(resto.nom || '').trim(),
    ca: n(resto.ca),
    caPrec: ligne?.caPrec ?? null,
    varCa: ligne?.varCa ?? null,
    net: ligne?.net ?? null,
    netPrec: ligne?.netPrec ?? null,
    objectif: resto.objectif || null,
    tauxObjectif: resto.tauxObjectif ?? null,
    achats: n(resto.fournisseurs?.facture),
    depenses: n(resto.depenses),
    depensesParCategorie: resto.depensesParCategorie || [],
    commission: n(resto.livraisons?.totalCommission),
    litiges: n(resto.litiges?.total),
    litigesParType: resto.litiges?.parType || [],
    inventaireDeduit: n(resto.inventaireDetail?.totalDeduit),
    ecartEspeces: resto.ecartEspeces ?? null,
    noteCaissiers: ligne?.noteCaissiers ?? null,
    pos, posPrec, plats,
  }
}

// Indicateurs tirés des caisses (null sans POS).
function indicateursPOS(e) {
  const p = e.pos
  if (!p?.totaux || !n(p.totaux.nb)) return null
  const nb = n(p.totaux.nb)
  const caPos = n(p.totaux.ca)
  const canaux = mixCanaux(p.par_type)
  const canal = cle => canaux.find(c => c.cle === cle) || { nb: 0, ca: 0 }
  const liv = ['glovo', 'yango', 'samer_delly', 'autre'].map(canal).reduce((s, c) => ({ nb: s.nb + c.nb, ca: s.ca + c.ca }), { nb: 0, ca: 0 })
  const caEntre = (de, a) => (p.par_heure || []).filter(h => n(h.h) >= de && n(h.h) < a).reduce((s, h) => s + n(h.ca), 0)
  const paiements = p.paiements || []
  const totalPaye = paiements.reduce((s, x) => s + n(x.montant), 0)
  const mobile = paiements.filter(x => ['WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV', 'DJAMO'].includes(x.mode)).reduce((s, x) => s + n(x.montant), 0)
  return {
    nb, caPos,
    ticket: Math.round(caPos / nb),
    annulees: n(p.totaux.annulees),
    offerts: n(p.totaux.offerts),
    canaux,
    surPlace: canal('sur_place'),
    livraison: liv,
    caCreux: caEntre(15, 18),
    partCreux: pct(caEntre(15, 18), caPos),
    partNuit: pct(caEntre(0, 6), caPos),
    jours: joursForts(p.semaine).parJour,
    partMobile: pct(mobile, totalPaye),
  }
}

/**
 * Repères du groupe pour comparer un restaurant aux autres. Les restaurants
 * trop petits (ventes sous 30 % de la médiane, ex. À la Braise) n'y entrent pas :
 * ils ne sont pas comparables.
 */
export function referencesGroupe(entrees = []) {
  const caMediane = mediane(entrees.map(e => e.ca).filter(v => v > 0)) || 0
  const comparables = entrees.filter(e => e.ca > 0 && e.ca >= 0.3 * caMediane)
  const ip = comparables.map(e => ({ e, i: indicateursPOS(e) }))
  const tauxAchats = comparables.filter(e => e.achats > 0).map(e => ({ nom: e.nom, taux: pct(e.achats, e.ca) }))
  const meilleurAchats = tauxAchats.sort((a, b) => a.taux - b.taux)[0] || null
  return {
    achatsMediane: mediane(tauxAchats.map(x => x.taux)),
    meilleurAchats,
    ticketMediane: mediane(ip.filter(x => x.i).map(x => x.i.ticket)),
  }
}

// Marge brute retenue pour convertir un supplément de ventes en résultat.
const margeBrute = e => {
  const t = e.ca ? e.achats / e.ca : 0.45
  return Math.min(0.7, Math.max(0.4, 1 - t))
}

/**
 * Constats, conseils (classés par gain estimé) et objectifs proposés d'un restaurant.
 * Constat : { ton: 'alerte' | 'bon' | 'info', texte }.
 * Conseil : { cle, priorite: 1 | 2 | 3, titre, action, gain }.
 */
export function analyserResto(e, ref = referencesGroupe([e])) {
  const constats = []
  const conseils = []
  const i = indicateursPOS(e)
  const marge = margeBrute(e)
  const tauxAchats = pct(e.achats, e.ca)

  // ── Résultat et tendance ──
  if (e.net != null) {
    const mn = pct(e.net, e.ca)
    if (e.net < 0) constats.push({ ton: 'alerte', texte: `En perte : résultat net de ${fmt(e.net)} pour ${fmt(e.ca)} de ventes.` })
    else constats.push({ ton: mn >= 10 ? 'bon' : 'info', texte: `Résultat net de ${fmt(e.net)}, soit ${mn} % des ventes${e.netPrec != null ? ` (mois précédent ${fmt(e.netPrec)})` : ''}.` })
  }
  if (e.varCa != null) {
    if (e.varCa <= SEUILS.baisse) {
      let detail = ''
      if (i && e.posPrec?.par_type) {
        const avant = mixCanaux(e.posPrec.par_type)
        const deltas = i.canaux.map(c => ({ c, d: c.ca - n(avant.find(x => x.cle === c.cle)?.ca) }))
          .concat(avant.filter(x => !i.canaux.some(c => c.cle === x.cle)).map(x => ({ c: x, d: -x.ca })))
          .sort((a, b) => a.d - b.d)
        const pire = deltas[0]
        if (pire && pire.d < 0) {
          detail = ` Le canal qui recule le plus : ${pire.c.nom} (${fmt(pire.d)}).`
          conseils.push({
            cle: 'tendance', priorite: e.varCa <= SEUILS.forteBaisse ? 1 : 2,
            titre: `Relancer ${pire.c.nom}`,
            action: `${pire.c.nom} a perdu ${fmt(-pire.d)} de ventes en un mois. Chercher la cause (plats manquants, attente, avis clients) et fixer une cible par semaine.`,
            gain: Math.round(0.3 * -pire.d * marge),
          })
        }
      }
      constats.push({ ton: 'alerte', texte: `Ventes en baisse de ${Math.abs(e.varCa)} % par rapport au mois précédent.${detail}` })
    } else if (e.varCa >= 5) {
      constats.push({ ton: 'bon', texte: `Ventes en hausse de ${e.varCa} % par rapport au mois précédent.` })
    }
  }
  if (e.tauxObjectif != null) {
    constats.push({ ton: e.tauxObjectif >= 100 ? 'bon' : e.tauxObjectif >= 90 ? 'info' : 'alerte', texte: `Objectif atteint à ${e.tauxObjectif} %.` })
  }

  // ── Caisse : annulations, offerts, écarts ──
  if (i) {
    const totalCmd = i.nb + i.annulees
    const tAnn = pct(i.annulees, totalCmd)
    if (tAnn >= SEUILS.annulations && i.annulees >= 20) {
      const enJeu = i.annulees * i.ticket
      constats.push({ ton: 'alerte', texte: `${i.annulees} commandes annulées pour ${i.nb} payées (${tAnn} %), soit environ ${fmt(enJeu)} au ticket moyen.` })
      conseils.push({
        cle: 'annulations', priorite: tAnn >= 10 ? 1 : 2,
        titre: 'Contrôler les annulations',
        action: `Exiger le code du manager et un motif pour toute annulation ; revoir chaque matin les annulations de la veille, caissier par caissier. Viser moins de ${SEUILS.annulationsCible} % (aujourd'hui ${tAnn} %).`,
        gain: Math.round(0.3 * Math.max(0, i.annulees - (SEUILS.annulationsCible / 100) * totalCmd) * i.ticket),
      })
    }
    const tOff = pct(i.offerts, i.nb)
    if (tOff >= SEUILS.offerts && i.offerts >= 10) {
      const cout = i.offerts * i.ticket * (1 - marge)
      constats.push({ ton: 'alerte', texte: `${i.offerts} commandes offertes (${tOff} % des commandes), soit environ ${fmt(cout)} de marchandise.` })
      conseils.push({
        cle: 'offerts', priorite: tOff >= 8 ? 1 : 2,
        titre: 'Encadrer les produits offerts',
        action: `Fixer qui a le droit d'offrir et dans quels cas (geste client, erreur cuisine), avec un motif obligatoire ; contrôler chaque semaine. Viser moins de ${SEUILS.offertsCible} % des commandes.`,
        gain: Math.round(Math.max(0, i.offerts - (SEUILS.offertsCible / 100) * i.nb) * i.ticket * (1 - marge)),
      })
    }
  }
  if (e.ecartEspeces != null && e.ecartEspeces <= SEUILS.ecartEspeces) {
    constats.push({ ton: 'alerte', texte: `Écart d'espèces cumulé de ${fmt(e.ecartEspeces)} sur le mois.` })
    conseils.push({
      cle: 'especes', priorite: 2, titre: 'Réduire les écarts de caisse',
      action: 'Comptage contradictoire à chaque fin de shift (caissier + gérant), retenue systématique des manquants, et suivi des caissiers qui reviennent souvent en écart.',
      gain: Math.round(0.5 * -e.ecartEspeces),
    })
  }

  // ── Livraison ──
  if (i && i.livraison.nb > 0) {
    const partLiv = pct(i.livraison.ca, i.caPos)
    if (partLiv >= SEUILS.livraisonPart && e.commission > 0) {
      constats.push({ ton: 'info', texte: `La livraison (Glovo, Yango) fait ${partLiv} % des ventes et coûte ${fmt(e.commission)} de commissions.` })
      conseils.push({
        cle: 'livraison', priorite: e.net != null && pct(e.net, e.ca) < 5 ? 1 : 2,
        titre: 'Ramener des clients livraison vers l\'emporter',
        action: 'Glisser dans chaque sac de livraison un bon « -10 % à emporter » et afficher le numéro de commande directe : chaque commande qui passe en direct économise la commission.',
        gain: Math.round(0.1 * e.commission),
      })
    }
    const tLiv = Math.round(i.livraison.ca / i.livraison.nb)
    if (i.surPlace.nb > 0 && tLiv < SEUILS.ticketLivraisonRatio * (i.surPlace.ca / i.surPlace.nb)) {
      const tSp = Math.round(i.surPlace.ca / i.surPlace.nb)
      constats.push({ ton: 'info', texte: `Le panier moyen en livraison (${fmt(tLiv)}) est plus bas que sur place (${fmt(tSp)}).` })
      conseils.push({
        cle: 'panier_livraison', priorite: 3, titre: 'Monter le panier livraison',
        action: 'Mettre en avant sur Glovo et Yango des menus (plat + boisson + dessert) et un montant minimum de commande.',
        gain: Math.round(300 * i.livraison.nb * 0.7 * marge),
      })
    }
  }

  // ── Coûts ──
  if (tauxAchats != null && ref.achatsMediane != null && tauxAchats > ref.achatsMediane + SEUILS.achatsEcart) {
    const meilleur = ref.meilleurAchats && ref.meilleurAchats.nom !== e.nom ? ` (${ref.meilleurAchats.nom} : ${ref.meilleurAchats.taux} %)` : ''
    constats.push({ ton: 'alerte', texte: `Achats fournisseurs à ${tauxAchats} % des ventes, contre ${ref.achatsMediane} % en moyenne dans le groupe${meilleur}. Des achats pour faire du stock gonflent aussi ce chiffre.` })
    conseils.push({
      cle: 'achats', priorite: 1, titre: 'Baisser le coût des achats',
      action: 'Comparer prix et quantités avec le restaurant le moins cher du groupe, vérifier chaque livraison à la réception (poids, nombre), contrôler portions et pertes.',
      gain: Math.round(((tauxAchats - ref.achatsMediane) / 100) * e.ca * 0.3),
    })
  }
  const tDep = pct(e.depenses, e.ca)
  if (tDep != null && tDep >= SEUILS.depenses) {
    const top = [...e.depensesParCategorie].sort((a, b) => n(b.montant) - n(a.montant))[0]
    constats.push({ ton: 'alerte', texte: `Les dépenses du point font ${tDep} % des ventes${top ? ` ; premier poste : ${top.categorie} (${fmt(top.montant)})` : ''}.` })
    if (!conseils.some(c => c.cle === 'achats')) {
      conseils.push({
        cle: 'depenses', priorite: 2, titre: `Surveiller ${top ? `le poste « ${top.categorie} »` : 'les dépenses'}`,
        action: 'Fixer un budget par semaine pour ce poste, exiger la photo de chaque reçu et comparer les prix du marché entre restaurants.',
        gain: Math.round(0.03 * e.depenses),
      })
    }
  }
  const tLit = pct(e.litiges, e.ca)
  if (tLit != null && tLit >= SEUILS.litiges) {
    const top = [...e.litigesParType].sort((a, b) => n(b.montant) - n(a.montant))[0]
    constats.push({ ton: 'alerte', texte: `Litiges : ${fmt(e.litiges)} (${tLit} % des ventes)${top ? `, surtout ${String(top.type).toLowerCase()}` : ''}.` })
    conseils.push({
      cle: 'litiges', priorite: 2, titre: 'Réduire les litiges',
      action: top ? `Cibler « ${top.type} » : rappel des règles à l'équipe, contrôle avant chaque envoi de commande, et retenue sur salaire du responsable quand elle est justifiée.` : 'Contrôler chaque commande avant l\'envoi et désigner un responsable par litige.',
      gain: Math.round(0.5 * e.litiges),
    })
  }
  const tInv = pct(e.inventaireDeduit, e.ca)
  if (tInv != null && tInv >= SEUILS.inventaire) {
    constats.push({ ton: 'alerte', texte: `Écarts d'inventaire déduits : ${fmt(e.inventaireDeduit)} (${tInv} % des ventes).` })
    conseils.push({
      cle: 'inventaire', priorite: 2, titre: 'Fermer les écarts de stock',
      action: 'Comptage des produits sensibles à chaque changement d\'équipe, et décision sur chaque écart dans les 48 heures.',
      gain: Math.round(0.5 * e.inventaireDeduit),
    })
  }

  // ── Heures, jours, ticket ──
  if (i) {
    if (i.partCreux != null && i.partCreux < SEUILS.creux) {
      constats.push({ ton: 'info', texte: `L'après-midi (15 h – 18 h) ne fait que ${i.partCreux} % des ventes.` })
      conseils.push({
        cle: 'creux', priorite: 3, titre: 'Remplir l\'après-midi',
        action: 'Lancer une offre de 15 h à 18 h (boisson offerte ou petit prix sur un plat), annoncée sur WhatsApp aux clients du restaurant.',
        gain: Math.round(0.15 * i.caCreux * marge),
      })
    }
    if (i.partNuit != null && i.partNuit >= SEUILS.nuit) {
      constats.push({ ton: 'info', texte: `La nuit (0 h – 6 h) pèse ${i.partNuit} % des ventes : un service à garder et à sécuriser (caisse, effectif).` })
    }
    const jours = i.jours.filter(j => j.nb > 0)
    if (jours.length >= 5) {
      const moyenne = jours.reduce((s, j) => s + j.nb, 0) / jours.length
      const faible = [...jours].sort((a, b) => a.nb - b.nb)[0]
      const fort = [...jours].sort((a, b) => b.nb - a.nb)[0]
      if (faible.nb < SEUILS.jourFaible * moyenne) {
        constats.push({ ton: 'info', texte: `Le ${faible.long} est le jour le plus faible (${faible.nb} commandes sur le mois, contre ${fort.nb} le ${fort.long}).` })
        conseils.push({
          cle: 'jour_faible', priorite: 3, titre: `Animer le ${faible.long}`,
          action: `Créer une offre propre au ${faible.long} (menu du jour, prix spécial famille) et l'annoncer la veille aux clients.`,
          gain: Math.round(0.25 * (moyenne - faible.nb) * i.ticket * marge),
        })
      }
    }
    if (ref.ticketMediane && i.ticket < SEUILS.ticketRatio * ref.ticketMediane) {
      constats.push({ ton: 'info', texte: `Ticket moyen de ${fmt(i.ticket)}, sous la moyenne du groupe (${fmt(ref.ticketMediane)}).` })
      conseils.push({
        cle: 'ticket', priorite: 2, titre: 'Proposer systématiquement boisson et dessert',
        action: 'À chaque commande, le caissier propose une boisson et un dessert (ou le menu complet) ; suivre le ticket moyen de chaque caissier dans la note des caissiers.',
        gain: Math.round(200 * i.nb * marge),
      })
    }
    if (i.partMobile != null && i.partMobile < 5) {
      constats.push({ ton: 'info', texte: `Paiements mobiles (Wave, Orange Money…) : seulement ${i.partMobile} % des encaissements.` })
    }
  }
  if (e.noteCaissiers != null && e.noteCaissiers < SEUILS.noteCaissiers) {
    constats.push({ ton: 'alerte', texte: `Note moyenne des caissiers : ${e.noteCaissiers}/20.` })
    conseils.push({
      cle: 'caissiers', priorite: 3, titre: 'Former les caissiers les moins bien notés',
      action: 'Une demi-heure de formation sur leur point faible (écarts, saisie, ventes additionnelles) et un suivi de la note la semaine suivante.',
      gain: 0,
    })
  }

  // ── Carte ──
  const plats = Array.isArray(e.plats) ? e.plats : null
  if (plats && plats.length >= 10) {
    const morts = plats.filter(p => n(p.qte) === 0)
    const partMorts = pct(morts.length, plats.length)
    if (partMorts >= SEUILS.platsMorts) {
      constats.push({ ton: 'info', texte: `${morts.length} plats sur ${plats.length} n'ont rien vendu du mois : ${morts.slice(0, 6).map(p => p.nom).join(', ')}${morts.length > 6 ? '…' : ''}.` })
      conseils.push({
        cle: 'carte', priorite: 3, titre: 'Alléger la carte',
        action: `Retirer ou remplacer les plats qui ne se vendent pas : moins de produits à stocker, moins de pertes, une cuisine plus rapide. Commencer par : ${morts.slice(0, 4).map(p => p.nom).join(', ')}.`,
        gain: 0,
      })
    }
    const vendus = plats.filter(p => n(p.qte) > 0)
    const totalQte = vendus.reduce((s, p) => s + n(p.qte), 0)
    const premier = [...vendus].sort((a, b) => n(b.qte) - n(a.qte))[0]
    if (premier && pct(premier.qte, totalQte) >= 25) {
      constats.push({ ton: 'info', texte: `${premier.nom} fait à lui seul ${pct(premier.qte, totalQte)} % des articles vendus : ne jamais en manquer, et s'en servir pour vendre le reste (menu, supplément).` })
    }
  }

  conseils.sort((a, b) => a.priorite - b.priorite || b.gain - a.gain)
  return { constats, conseils: conseils.slice(0, 5), objectifs: objectifsProposes(e, i, ref), gainTotal: conseils.slice(0, 5).reduce((s, c) => s + c.gain, 0) }
}

/** Objectifs proposés pour le mois suivant (l'utilisateur garde la main). */
export function objectifsProposes(e, i = indicateursPOS(e), ref = {}) {
  const out = []
  if (e.ca > 0) {
    const g = e.varCa == null ? 0.05 : e.varCa > 0 ? 0.08 : e.varCa <= SEUILS.baisse ? 0.03 : 0.05
    const vise = arrondir(e.ca * (1 + g), 100000)
    out.push({ cle: 'ventes', libelle: 'Ventes', valeur: fmt(vise), detail: `+${Math.round(g * 100)} %${e.objectif ? ` · objectif actuel ${fmtM(e.objectif)}` : ''}` })
  }
  if (i) {
    const t = arrondir(i.ticket + Math.max(150, i.ticket * 0.03), 50)
    out.push({ cle: 'ticket', libelle: 'Ticket moyen', valeur: fmt(t), detail: `aujourd'hui ${fmt(i.ticket)}` })
    const tAnn = pct(i.annulees, i.nb + i.annulees)
    if (tAnn > SEUILS.annulationsCible) out.push({ cle: 'annulations', libelle: 'Annulations', valeur: `< ${SEUILS.annulationsCible} %`, detail: `aujourd'hui ${tAnn} %` })
    const tOff = pct(i.offerts, i.nb)
    if (tOff > SEUILS.offertsCible) out.push({ cle: 'offerts', libelle: 'Offerts', valeur: `< ${SEUILS.offertsCible} %`, detail: `aujourd'hui ${tOff} %` })
  }
  const tAch = pct(e.achats, e.ca)
  if (tAch != null && ref.achatsMediane != null && tAch > ref.achatsMediane + SEUILS.achatsEcart) {
    out.push({ cle: 'achats', libelle: 'Achats / ventes', valeur: `${Math.round(Math.max(ref.achatsMediane, tAch - 4))} %`, detail: `aujourd'hui ${tAch} %` })
  }
  if (e.net != null) {
    out.push(e.net < 0
      ? { cle: 'net', libelle: 'Résultat net', valeur: '≥ 0 F', detail: `aujourd'hui ${fmtM(e.net)}` }
      : { cle: 'net', libelle: 'Résultat net', valeur: fmt(arrondir(e.net * 1.1, 50000)), detail: `+10 % (ce mois ${fmtM(e.net)})` })
  }
  return out
}

/** Synthèse du groupe : repères, conseils les plus rentables, gain total visé. */
export function analyserGroupe(entrees = []) {
  const ref = referencesGroupe(entrees)
  const parResto = entrees.map(e => ({ e, a: analyserResto(e, ref) }))
  const tous = parResto.flatMap(({ e, a }) => a.conseils.map(c => ({ ...c, restaurant: e.nom })))
  const top = [...tous].sort((a, b) => b.gain - a.gain || a.priorite - b.priorite).slice(0, 6)
  const constats = []
  const avecNet = entrees.filter(e => e.net != null)
  const enPerte = avecNet.filter(e => e.net < 0)
  if (enPerte.length) constats.push({ ton: 'alerte', texte: `${enPerte.length} restaurant${enPerte.length > 1 ? 's' : ''} en perte : ${enPerte.map(e => `${e.nom} (${fmt(e.net)})`).join(', ')}.` })
  if (ref.meilleurAchats) constats.push({ ton: 'info', texte: `Achats fournisseurs : ${ref.achatsMediane} % des ventes en moyenne ; le plus bas : ${ref.meilleurAchats.nom} (${ref.meilleurAchats.taux} %).` })
  if (ref.ticketMediane) constats.push({ ton: 'info', texte: `Ticket moyen du groupe : ${fmt(ref.ticketMediane)} (moyenne des restaurants).` })
  const commission = entrees.reduce((s, e) => s + e.commission, 0)
  if (commission > 0) constats.push({ ton: 'info', texte: `Commissions de livraison payées sur le mois : ${fmt(commission)}.` })
  const parCle = {}
  for (const c of tous) parCle[c.cle] = (parCle[c.cle] || 0) + 1
  const recurrent = Object.entries(parCle).filter(([, k]) => k >= 3).sort((a, b) => b[1] - a[1])[0]
  if (recurrent) {
    const titre = tous.find(c => c.cle === recurrent[0]).titre
    constats.push({ ton: 'alerte', texte: `Sujet commun à ${recurrent[1]} restaurants : « ${titre} ». À traiter comme une règle du groupe.` })
  }
  const ventesVisees = parResto.reduce((s, { a }) => s + n(String(a.objectifs.find(o => o.cle === 'ventes')?.valeur || '').replace(/\D/g, '')), 0)
  const ventes = entrees.reduce((s, e) => s + e.ca, 0)
  const objectifs = ventesVisees ? [{ cle: 'ventes', libelle: 'Ventes du groupe', valeur: fmt(ventesVisees), detail: `somme des restaurants · ce mois ${fmtM(ventes)}` }] : []
  return { ref, parResto, conseils: top, constats, objectifs, gainTotal: tous.reduce((s, c) => s + c.gain, 0) }
}

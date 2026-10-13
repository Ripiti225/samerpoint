import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
    ActivityIndicator,
    Alert,
    Modal,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text, TextInput, TouchableOpacity,
    View
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import BarreComparaison, { MODE_PERIODES, MODE_RESTOS } from '../components/BarreComparaison'
import { Anneau, Barres, BarresHorizontales, CarteChaleur, CarteGraphique, CourbeAire } from '../components/graphiques'
import LigneComparee from '../components/LigneComparee'
import { useTheme } from '../context/ThemeContext'
import { getDepensesPeriode, getFournisseursPeriodePaye, getPaiesGerantPeriode, getPresencesPeriode } from '../lib/api'
import { ecarts as calculerEcarts, formaterEcart, POLARITE, synthese, UNITE } from '../lib/comparaisonDashboard'
import { CANAUX, couleurResto, courtNom, detailFondRecu, fmtFCFA, tauxRenta, vueGlobale } from '../lib/dashboardGlobal'
import { bandeauDeuxPeriodes, estMoisEntier, moisCouverts, periodePrecedente } from '../lib/periodeComparee'
import { chargerChargesMois } from '../lib/chargesMois'
import { chargerLitigesRestaurant } from '../lib/litigesGlobal'
import { resumeLitiges } from '../lib/litigesResume'
import { fmtCourt, melangerCouleurs } from '../lib/graphiques'
import { progressionObjectif, variation } from '../lib/objectifs'
import { venteRetenue, venteTheorique } from '../lib/venteMachine'
import VenteDouble, { TexteTheorique } from '../components/ui/VenteDouble'
import {
  JOURS_COURTS, ORDRE_HEURES, canauxParHeure, faitsMarquants, grilleSemaine, heurePic, heuresDuService, joursForts,
  libelleCreneau, mixCanaux, mixPaiements, ticketMoyen,
} from '../lib/statsPOS'
import { POS_NON_INSTALLE, chargerStatsPOS } from '../lib/statsPOSDb'
import { supabase } from '../lib/supabase'


// Les colonnes de `points` que cet écran lit — une seule liste, trois requêtes.
const CHAMPS_POINTS = 'id, date, restaurant_id, vente_total, vente_machine, depense_total, benefice_sc, yango_cse, yango_tab, glovo_cse, glovo_tab, wave, om, djamo, fond_recu, fc_compte'

// Alertes et Litiges sont des listes d'événements déjà datables, pas des
// agrégats à confronter : ils restent en lecture simple sur le terme A.
const PILIERS_COMPARABLES = ['apercu', 'couts', 'clients']

const RAISON_CHARGES = 'charges du mois entier — non comparable sur une période partielle'

const PERIODES = [
  { label: "Aujourd'hui", key: 'today' },
  { label: '7 jours', key: '7days' },
  { label: 'Ce mois', key: 'month' },
  { label: 'Mois préc.', key: 'lastmonth' },
  { label: 'Période', key: 'custom', icone: 'calendar-range' },
]

const PILIERS = [
  { key: 'apercu', label: 'Aperçu', icone: 'chart-areaspline' },
  { key: 'activite', label: 'Activité POS', icone: 'clock-time-eight-outline' },
  { key: 'couts', label: 'Coûts', icone: 'chart-donut' },
  { key: 'clients', label: 'Canaux', icone: 'moped' },
  { key: 'alertes', label: 'Alertes', icone: 'alert-outline' },
  { key: 'litiges', label: 'Litiges', icone: 'scale-balance' },
]

const PIE_COLORS = ['#EF9F27', '#3B6D11', '#185FA5', '#993C1D', '#534AB7', '#888']

export default function DashboardGlobalScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [periodeKey, setPeriodeKey] = useState('7days')
  // Restaurant dont le détail jour par jour du fond reçu est déplié (onglet Coûts).
  const [fondOuvert, setFondOuvert] = useState(null)
  const [points, setPoints] = useState({})
  const [loading, setLoading] = useState(false)
  const [modalCalendrier, setModalCalendrier] = useState(false)
  const [dateDebut, setDateDebut] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [etapeCalendrier, setEtapeCalendrier] = useState('debut')
  const [restaurants, setRestaurants] = useState([])

  // Navigation par piliers
  const [pilier, setPilier] = useState('apercu')
  const [depensesGlobal, setDepensesGlobal] = useState({})
  const [presencesGlobal, setPresencesGlobal] = useState({})
  const [chargesGlobal, setChargesGlobal] = useState([])
  const [fournisseursGlobal, setFournisseursGlobal] = useState({})
  const [paiesGerantGlobal, setPaiesGerantGlobal] = useState({})
  const [chargementCouts, setChargementCouts] = useState(false)
  const [restoFiltre, setRestoFiltre] = useState(null)

  // ── Comparaison A / B ──
  const [comparaisonActive, setComparaisonActive] = useState(false)
  const [modeComparaison, setModeComparaison] = useState(MODE_RESTOS)
  const [termeA, setTermeA] = useState(null)
  const [termeB, setTermeB] = useState(null)
  // L'état du filtre restaurant tel qu'il était avant la comparaison : le mode
  // « 2 périodes » s'en sert comme sélecteur, la fermeture doit le rendre intact.
  const [restoFiltreAvant, setRestoFiltreAvant] = useState(null)
  const [pointsB, setPointsB] = useState({})
  const [coutsB, setCoutsB] = useState(null)
  const [chargementB, setChargementB] = useState(false)
  const [cleCoutsB, setCleCoutsB] = useState('')
  const [clePointsB, setClePointsB] = useState('')

  // Période précédente de même durée : sert aux variations des chiffres du haut.
  const [pointsPrec, setPointsPrec] = useState({})
  // Bornes réellement chargées (déclenchent la lecture des statistiques POS).
  const [rangeCharge, setRangeCharge] = useState(null)
  const [statsPOS, setStatsPOS] = useState(null)        // { stats } | { erreur }
  const [chargementPOS, setChargementPOS] = useState(false)
  // Mois en cours, quelle que soit la période : objectifs et effectifs.
  const [moisEnCours, setMoisEnCours] = useState({ ventes: {}, ventesTheo: {}, employes: {} })
  const [objectifsVisibles, setObjectifsVisibles] = useState(false)   // feuille « Fixer les objectifs »
  const [objectifsSaisis, setObjectifsSaisis] = useState({})          // { restaurantId: texte }
  const [objectifEnCours, setObjectifEnCours] = useState(false)
  // Litiges de la période (mêmes calculs que l'écran Litiges), chargés à l'ouverture de l'onglet.
  const [litigesDash, setLitigesDash] = useState(null)   // { cle, donnees }
  const [chargementLitiges, setChargementLitiges] = useState(false)

  useEffect(() => { chargerRestaurants(); chargerMoisEnCours() }, [])

  useEffect(() => {
    if (!rangeCharge?.debut || !rangeCharge?.fin) return
    let vivant = true
    setChargementPOS(true)
    chargerStatsPOS({ debut: rangeCharge.debut, fin: rangeCharge.fin, restaurantId: restoFiltre })
      .then(res => { if (vivant) { setStatsPOS(res); setChargementPOS(false) } })
    return () => { vivant = false }
  }, [rangeCharge, restoFiltre])

  useEffect(() => {
    if (pilier !== 'litiges' || !rangeCharge?.debut || !rangeCharge?.fin || !restaurants.length) return
    const cle = `${rangeCharge.debut}|${rangeCharge.fin}|${restoFiltre || 'tous'}`
    if (litigesDash?.cle === cle) return
    let vivant = true
    const cibles = restoFiltre ? restaurants.filter(r => r.id === restoFiltre) : restaurants
    setChargementLitiges(true)
    Promise.all(cibles.map(r => chargerLitigesRestaurant(r, rangeCharge.debut, rangeCharge.fin)))
      .then(donnees => { if (vivant) setLitigesDash({ cle, donnees }) })
      .catch(e => console.warn('[Dashboard] litiges :', e?.message))
      .finally(() => { if (vivant) setChargementLitiges(false) })
    return () => { vivant = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pilier, rangeCharge, restoFiltre, restaurants])

  useEffect(() => {
    if (restaurants.length > 0 && periodeKey !== 'custom') {
      chargerPoints(restaurants)
    }
  }, [periodeKey, restaurants])

  async function chargerRestaurants() {
    // `objectif_mensuel` vient de supabase_rapport_mensuel.sql : sans la
    // colonne, on recharge sans plutôt que de laisser l'écran vide.
    let { data, error } = await supabase.from('restaurants').select('id, nom, couleur, objectif_mensuel').order('nom')
    if (error) ({ data } = await supabase.from('restaurants').select('id, nom, couleur').order('nom'))
    if (data?.length) setRestaurants(data)
  }

  async function chargerMoisEnCours() {
    const auj = new Date()
    const debut = `${auj.getFullYear()}-${String(auj.getMonth() + 1).padStart(2, '0')}-01`
    const [{ data: pts }, { data: trav }] = await Promise.all([
      supabase.from('points').select('restaurant_id, vente_total, vente_machine').gte('date', debut),
      supabase.from('travailleurs').select('restaurant_id').eq('actif', true),
    ])
    // Objectif : vente machine (lib/venteMachine.js), la théorique en comparatif.
    const ventes = {}, ventesTheo = {}, employes = {}
    ;(pts || []).forEach(p => {
      ventes[p.restaurant_id] = (ventes[p.restaurant_id] || 0) + venteRetenue(p)
      ventesTheo[p.restaurant_id] = (ventesTheo[p.restaurant_id] || 0) + venteTheorique(p)
    })
    ;(trav || []).forEach(t => { employes[t.restaurant_id] = (employes[t.restaurant_id] || 0) + 1 })
    setMoisEnCours({ ventes, ventesTheo, employes })
  }

  function grouperParResto(data, list) {
    const resultats = {}
    list.forEach(r => { resultats[r.id] = [] })
    ;(data || []).forEach(p => {
      if (resultats[p.restaurant_id] !== undefined) resultats[p.restaurant_id].push(p)
    })
    return resultats
  }

  // La période juste avant, de même durée (7 jours → les 7 jours d'avant).
  async function chargerPrecedente(range, list) {
    const prec = periodePrecedente(range.debut, range.fin)
    if (!prec) { setPointsPrec({}); return }
    const { data } = await supabase.from('points').select(CHAMPS_POINTS).gte('date', prec.debut).lte('date', prec.fin)
    setPointsPrec(grouperParResto(data, list))
  }

  function ouvrirObjectifs() {
    setObjectifsSaisis(Object.fromEntries(restaurants.map(r => [r.id, r.objectif_mensuel == null ? '' : String(Math.round(r.objectif_mensuel))])))
    setObjectifsVisibles(true)
  }

  // Enregistre les objectifs modifiés (vide = pas d'objectif).
  async function enregistrerObjectifs() {
    const changes = []
    for (const r of restaurants) {
      const brut = (objectifsSaisis[r.id] || '').replace(/[\s.]/g, '').trim()
      const montant = brut === '' ? null : Number(brut)
      if (montant !== null && (!Number.isFinite(montant) || montant < 0)) {
        Alert.alert('Montant invalide', `${r.nom} : saisissez un nombre positif, ou laissez vide pour retirer l'objectif.`)
        return
      }
      const avant = r.objectif_mensuel == null ? null : Number(r.objectif_mensuel)
      if (montant !== avant) changes.push({ id: r.id, montant })
    }
    if (!changes.length) { setObjectifsVisibles(false); return }
    setObjectifEnCours(true)
    for (const c of changes) {
      const { error } = await supabase.from('restaurants').update({ objectif_mensuel: c.montant }).eq('id', c.id)
      if (error) {
        setObjectifEnCours(false)
        Alert.alert('Enregistrement impossible', /objectif_mensuel/.test(error.message)
          ? "La colonne « objectif_mensuel » n'existe pas encore. Passez le script supabase_rapport_mensuel.sql dans Supabase, puis réessayez."
          : error.message)
        return
      }
    }
    const parId = Object.fromEntries(changes.map(c => [c.id, c.montant]))
    setRestaurants(liste => liste.map(x => (x.id in parId ? { ...x, objectif_mensuel: parId[x.id] } : x)))
    setObjectifEnCours(false)
    setObjectifsVisibles(false)
  }

  function getDateRange() {
    const today = new Date()
    const fmt = d => d.toISOString().split('T')[0]
    if (periodeKey === 'today') return { debut: fmt(today), fin: fmt(today) }
    if (periodeKey === '7days') { const d = new Date(today); d.setDate(d.getDate() - 6); return { debut: fmt(d), fin: fmt(today) } }
    if (periodeKey === 'month') { const d = new Date(today.getFullYear(), today.getMonth(), 1); return { debut: fmt(d), fin: fmt(today) } }
    if (periodeKey === 'lastmonth') { const debut = new Date(today.getFullYear(), today.getMonth() - 1, 1); const fin = new Date(today.getFullYear(), today.getMonth(), 0); return { debut: fmt(debut), fin: fmt(fin) } }
    if (periodeKey === 'custom') return { debut: dateDebut, fin: dateFin }
    return null
  }

  async function chargerPoints(restoList) {
    const list = restoList || restaurants
    if (!list.length) return
    setLoading(true)
    const range = getDateRange()
    if (!range) { setLoading(false); return }

    const { data: allPoints, error } = await supabase
      .from('points')
      .select(CHAMPS_POINTS)
      .gte('date', range.debut)
      .lte('date', range.fin)

    if (error) { console.error('[Dashboard]', error.message); setLoading(false); return }

    setPoints(grouperParResto(allPoints, list))
    setRangeCharge(range)
    setLoading(false)
    chargerPrecedente(range, list)
  }

  useEffect(() => {
    if ((pilier === 'couts' || pilier === 'alertes') && restaurants.length > 0 && periodeKey !== 'today') {
      chargerCoutsGlobal()
    }
  }, [pilier, periodeKey, restaurants, points])

  async function chargerCoutsGlobal() {
    const range = getDateRange()
    if (!range || !range.debut || !range.fin) return
    setChargementCouts(true)
    const resultats = await Promise.all(restaurants.map(async r => {
      const [dep, pres, fourn, paiesGerant] = await Promise.all([
        getDepensesPeriode(r.id, range.debut, range.fin),
        getPresencesPeriode(r.id, range.debut, range.fin),
        getFournisseursPeriodePaye(r.id, range.debut, range.fin),
        getPaiesGerantPeriode(r.id, range.debut, range.fin),
      ])
      return { id: r.id, depenses: dep, presences: pres, fournisseurs: fourn, paiesGerant }
    }))
    const dep = {}, pres = {}, fourn = {}, paies = {}
    resultats.forEach(r => { dep[r.id] = r.depenses; pres[r.id] = r.presences; fourn[r.id] = r.fournisseurs; paies[r.id] = r.paiesGerant })
    setDepensesGlobal(dep)
    setPresencesGlobal(pres)
    setFournisseursGlobal(fourn)
    setPaiesGerantGlobal(paies)

    const moisListe = [...new Set(Object.values(points).flat().map(p => (p.date || '').slice(0, 7)))].filter(Boolean)
    if (moisListe.length) {
      setChargesGlobal(await chargerChargesMois(supabase, moisListe))
    } else {
      setChargesGlobal([])
    }
    setChargementCouts(false)
  }

  const restosVus = useMemo(
    () => (restoFiltre ? restaurants.filter(r => r.id === restoFiltre) : restaurants),
    [restaurants, restoFiltre]
  )

  const coutsA = useMemo(() => ({
    depenses: depensesGlobal, presences: presencesGlobal, fournisseurs: fournisseursGlobal,
    paiesGerant: paiesGerantGlobal, charges: chargesGlobal,
  }), [depensesGlobal, presencesGlobal, fournisseursGlobal, paiesGerantGlobal, chargesGlobal])

  // La vue du terme A — et la vue de l'écran quand la comparaison est fermée.
  // Un seul calcul, partagé : c'est ce qui garantit que A et B disent la même
  // chose du même chiffre (lib/dashboardGlobal.js).
  const vue = useMemo(
    () => vueGlobale({ points, restaurants: restosVus, couts: coutsA }),
    [points, restosVus, coutsA]
  )
  const { classement, classementCouts, serieJours, total } = vue

  const axisLabelJour = (d) => {
    if (!d) return ''
    const [, m, dd] = d.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(dd)} ${mois[parseInt(m) - 1]}`
  }

  // ── Le terme B : chargement, bornes, libellés ─────────────────────────────
  const rangeA = getDateRange()
  const debutA = rangeA?.debut || ''
  const finA = rangeA?.fin || ''
  const rangeB = useMemo(() => (debutA && finA ? periodePrecedente(debutA, finA) : null), [debutA, finA])
  const bandeau = useMemo(
    () => (debutA && finA ? bandeauDeuxPeriodes(debutA, finA, titrePeriode()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debutA, finA, periodeKey]
  )

  // Mode « 2 restaurants » : aucune requête de plus, les deux termes se
  // dérivent de `points`, déjà chargé pour TOUS les restaurants.
  // Mode « 2 périodes » : le même chargement, une seconde fois, sur les bornes
  // de B. `points` n'est pas dans les dépendances — changer de pilier ne
  // relance rien tant que la période A et le mode ne changent pas.
  useEffect(() => {
    if (!comparaisonActive || modeComparaison !== MODE_PERIODES) { setPointsB({}); setClePointsB(''); return }
    chargerPointsB()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparaisonActive, modeComparaison, debutA, finA, restaurants])

  useEffect(() => {
    if (!comparaisonActive || modeComparaison !== MODE_PERIODES) return
    if (pilier !== 'couts' || periodeKey === 'today') return
    chargerCoutsB()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparaisonActive, modeComparaison, pilier, periodeKey, debutA, finA, restoFiltre, restaurants])

  async function chargerPointsB() {
    if (!rangeB) { setPointsB({}); return }
    setChargementB(true)
    const { data, error } = await supabase
      .from('points')
      .select(CHAMPS_POINTS)
      .gte('date', rangeB.debut)
      .lte('date', rangeB.fin)
    if (error) { console.error('[Dashboard B]', error.message); setChargementB(false); return }
    const resultats = {}
    restaurants.forEach(r => { resultats[r.id] = [] })
    ;(data || []).forEach(p => {
      if (resultats[p.restaurant_id] !== undefined) resultats[p.restaurant_id].push(p)
    })
    setPointsB(resultats)
    setClePointsB(`${rangeB.debut}|${rangeB.fin}`)
    setChargementB(false)
  }

  // Le cas coûteux : 4 appels par restaurant, une seconde fois. Trois mesures —
  // seulement à l'entrée dans le pilier Coûts, seulement pour les restaurants
  // affichés, et jamais deux fois pour la même période.
  async function chargerCoutsB() {
    if (!rangeB) return
    const cibles = restoFiltre ? restaurants.filter(r => r.id === restoFiltre) : restaurants
    const cle = `${rangeB.debut}|${rangeB.fin}|${cibles.map(r => r.id).join(',')}`
    if (cle === cleCoutsB) return
    setChargementB(true)
    const resultats = await Promise.all(cibles.map(async r => {
      const [dep, pres, fourn, paiesGerant] = await Promise.all([
        getDepensesPeriode(r.id, rangeB.debut, rangeB.fin),
        getPresencesPeriode(r.id, rangeB.debut, rangeB.fin),
        getFournisseursPeriodePaye(r.id, rangeB.debut, rangeB.fin),
        getPaiesGerantPeriode(r.id, rangeB.debut, rangeB.fin),
      ])
      return { id: r.id, depenses: dep, presences: pres, fournisseurs: fourn, paiesGerant }
    }))
    const depenses = {}, presences = {}, fournisseurs = {}, paiesGerant = {}
    resultats.forEach(r => {
      depenses[r.id] = r.depenses; presences[r.id] = r.presences
      fournisseurs[r.id] = r.fournisseurs; paiesGerant[r.id] = r.paiesGerant
    })
    // Les mois viennent des bornes, pas des points saisis : un mois sans aucun
    // point garderait sinon un loyer invisible.
    const mois = moisCouverts(rangeB.debut, rangeB.fin)
    let charges = []
    if (mois.length) {
      charges = await chargerChargesMois(supabase, mois)
    }
    setCoutsB({ depenses, presences, fournisseurs, paiesGerant, charges })
    setCleCoutsB(cle)
    setChargementB(false)
  }

  function ouvrirComparaison() {
    setRestoFiltreAvant(restoFiltre)
    if (restaurants.length >= 2) {
      const a = restoFiltre || restaurants[0].id
      const b = (restaurants.find(r => r.id !== a) || {}).id
      setTermeA(a); setTermeB(b)
      setModeComparaison(MODE_RESTOS)
    } else {
      setModeComparaison(MODE_PERIODES)
    }
    setComparaisonActive(true)
  }

  // La sortie rend l'écran à son état d'origine, filtre restaurant compris.
  function fermerComparaison() {
    setComparaisonActive(false)
    setRestoFiltre(restoFiltreAvant)
    setPointsB({}); setCoutsB(null); setCleCoutsB(''); setClePointsB('')
  }

  // Choisir pour B la valeur de A échange les deux termes au lieu de les
  // confondre : une comparaison d'un restaurant avec lui-même n'apprend rien.
  function choisirA(id) { if (id === termeB) setTermeB(termeA); setTermeA(id) }
  function choisirB(id) { if (id === termeA) setTermeA(termeB); setTermeB(id) }

  const compar = useMemo(() => {
    if (!comparaisonActive) return null
    if (modeComparaison === MODE_RESTOS) {
      const rA = restaurants.find(r => r.id === termeA)
      const rB = restaurants.find(r => r.id === termeB)
      if (!rA || !rB) return null
      return {
        mode: MODE_RESTOS,
        vueA: vueGlobale({ points, restaurants: [rA], couts: coutsA }),
        vueB: vueGlobale({ points, restaurants: [rB], couts: coutsA }),
        libelleA: rA.nom, libelleB: rB.nom,
        // Chacun garde SA couleur, celle qu'il porte partout ailleurs dans l'app.
        couleurA: couleurResto(rA.couleur), couleurB: couleurResto(rB.couleur),
        opaciteB: 1,
        nbJours: bandeau?.a?.nbJours || 0,
        chargesComparables: estMoisEntier(debutA, finA),
      }
    }
    if (!rangeB || !bandeau) return null
    // C'est le même restaurant : A prend sa couleur pleine, B la même atténuée.
    const couleur = restoFiltre
      ? couleurResto(restaurants.find(r => r.id === restoFiltre)?.couleur)
      : '#EF9F27'
    return {
      mode: MODE_PERIODES,
      vueA: vue,
      vueB: vueGlobale({ points: pointsB, restaurants: restosVus, couts: coutsB || {} }),
      libelleA: bandeau.a.titre || bandeau.a.dates,
      libelleB: bandeau.b.titre,
      couleurA: couleur, couleurB: couleur, opaciteB: 0.45,
      nbJours: bandeau.a.nbJours,
      chargesComparables: estMoisEntier(debutA, finA) && estMoisEntier(rangeB.debut, rangeB.fin),
    }
  }, [comparaisonActive, modeComparaison, restaurants, termeA, termeB, points, pointsB,
      coutsA, coutsB, vue, restosVus, restoFiltre, bandeau, rangeB, debutA, finA])

  function montantCanal(v, cle) {
    return v.mixCanaux.find(c => c.cle === cle)?.montant || 0
  }

  /** Les indicateurs d'un pilier, prêts pour lib/comparaisonDashboard.ecart. */
  function specsPilier(clePilier, cmp, commun) {
    const A = cmp.vueA.total
    const B = cmp.vueB.total
    if (clePilier === 'apercu') return [
      { cle: 'ventes', libelle: 'Vente machine', a: A.ventes, b: B.ventes, ...commun,
        phraseZeroA: `${cmp.libelleA} n’a rien vendu sur cette période` },
      { cle: 'depenses', libelle: 'Dépenses', a: A.depenses, b: B.depenses, polarite: POLARITE.MAUVAIS, ...commun },
      { cle: 'benefice', libelle: 'Bénéfice SC', a: A.benefice, b: B.benefice, ...commun },
      { cle: 'renta', libelle: 'Taux de rentabilité', a: A.renta, b: B.renta, unite: UNITE.POURCENT, ...commun },
    ]
    if (clePilier === 'couts') return [
      { cle: 'foodPct', libelle: 'Coût matières', a: A.foodPct, b: B.foodPct, unite: UNITE.POURCENT, polarite: POLARITE.MAUVAIS, ...commun },
      { cle: 'foodMt', libelle: 'Coût matières — montant', a: A.foodMt, b: B.foodMt, polarite: POLARITE.MAUVAIS, ...commun },
      { cle: 'laborPct', libelle: 'Coût du salaire', a: A.laborPct, b: B.laborPct, unite: UNITE.POURCENT, polarite: POLARITE.MAUVAIS, ...commun },
      { cle: 'laborMt', libelle: 'Coût du salaire — montant', a: A.laborMt, b: B.laborMt, polarite: POLARITE.MAUVAIS, ...commun },
      { cle: 'primePct', libelle: 'Coût primaire', a: A.primePct, b: B.primePct, unite: UNITE.POURCENT, polarite: POLARITE.MAUVAIS, ...commun },
      // Les charges fixes sont mensuelles : sur une période partielle, l'écart
      // ne mesurerait que la différence de loyer entre deux mois (§ 6.2).
      { cle: 'chargesFixesPct', libelle: 'Charges fixes', a: A.chargesFixesPct, b: B.chargesFixesPct,
        unite: UNITE.POURCENT, polarite: POLARITE.MAUVAIS, ...commun,
        comparable: cmp.chargesComparables ? undefined : false, raison: RAISON_CHARGES },
    ]
    return [
      { cle: 'livraisonMt', libelle: 'Montant livraison', a: A.livraisonMt, b: B.livraisonMt, ...commun },
      { cle: 'surPlaceMt', libelle: 'Montant sur place', a: A.surPlaceMt, b: B.surPlaceMt, ...commun },
      // Un mix n'est ni bon ni mauvais : jamais de couleur sur cette ligne.
      { cle: 'pctLivraison', libelle: 'Part livraison', a: A.pctLivraison, b: B.pctLivraison,
        unite: UNITE.POURCENT, polarite: POLARITE.NEUTRE, ...commun },
      ...CANAUX
        .map(c => ({ cle: c.cle, libelle: c.nom, a: montantCanal(cmp.vueA, c.cle), b: montantCanal(cmp.vueB, c.cle), ...commun }))
        .filter(e => e.a > 0 || e.b > 0),
    ]
  }

  // Les lignes affichées viennent du pilier courant ; la synthèse, elle, range
  // les indicateurs des TROIS piliers — c'est le sens du § 7.
  const ecartsCompar = useMemo(() => {
    if (!compar) return null
    const commun = {
      libelleA: compar.libelleA, libelleB: compar.libelleB,
      nbJoursA: compar.vueA.total.nbJours, nbJoursB: compar.vueB.total.nbJours,
    }
    return {
      lignes: calculerEcarts(specsPilier(pilier, compar, commun)),
      synth: synthese(
        calculerEcarts(PILIERS_COMPARABLES.flatMap(k => specsPilier(k, compar, commun))),
        { nbJours: compar.nbJours }
      ),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compar, pilier])

  const fmt = fmtFCFA

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  // « lun. 6 oct 2025 » : le jour de la semaine aide à lire un détail jour par jour.
  function formatDateLongue(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-').map(Number)
    const jours = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
    return `${jours[new Date(y, m - 1, d).getDay()]} ${formatDate(dateStr)}`
  }

  function ouvrirCalendrier() {
    setDateDebut(''); setDateFin(''); setEtapeCalendrier('debut'); setModalCalendrier(true)
  }

  function choisirDate(day) {
    if (etapeCalendrier === 'debut') { setDateDebut(day.dateString); setEtapeCalendrier('fin') }
    else { if (day.dateString < dateDebut) { setDateDebut(day.dateString) } else { setDateFin(day.dateString) } }
  }

  async function confirmerPeriode() {
    if (!dateDebut || !dateFin) return
    setModalCalendrier(false); setPeriodeKey('custom'); setLoading(true)

    const { data: allPoints, error } = await supabase
      .from('points')
      .select(CHAMPS_POINTS)
      .gte('date', dateDebut)
      .lte('date', dateFin)

    if (error) { console.error('[Dashboard]', error.message); setLoading(false); return }

    setPoints(grouperParResto(allPoints, restaurants)); setLoading(false)
    setRangeCharge({ debut: dateDebut, fin: dateFin })
    chargerPrecedente({ debut: dateDebut, fin: dateFin }, restaurants)
  }

  function markedDates() {
    const marked = {}
    if (dateDebut) marked[dateDebut] = { selected: true, selectedColor: colors.primary, startingDay: true }
    if (dateFin) marked[dateFin] = { selected: true, selectedColor: colors.primary, endingDay: true }
    if (dateDebut && dateFin) {
      let current = new Date(dateDebut); current.setDate(current.getDate() + 1)
      while (current < new Date(dateFin)) {
        const str = current.toISOString().split('T')[0]
        marked[str] = { selected: true, selectedColor: colors.primaryLight, selectedTextColor: colors.primary }
        current.setDate(current.getDate() + 1)
      }
    }
    return marked
  }

  function titrePeriode() {
    if (periodeKey === 'today') return "Aujourd'hui"
    if (periodeKey === '7days') return '7 derniers jours'
    if (periodeKey === 'month') return 'Ce mois'
    if (periodeKey === 'lastmonth') return 'Mois précédent'
    if (periodeKey === 'custom' && dateDebut && dateFin) return `${formatDate(dateDebut)} → ${formatDate(dateFin)}`
    return 'Période personnalisée'
  }


  // ---- Piliers Coûts et Clients : les mêmes agrégats, lus dans la vue ----
  const caGlobal = total.ventes
  const foodCostGlobalMt = total.foodMt
  const laborCostGlobalMt = total.laborMt
  const chargesFixesGlobalMt = total.chargesFixesMt
  const foodCostGlobalPct = total.foodPct
  const laborCostGlobalPct = total.laborPct
  const primeCostGlobalPct = total.primePct
  const chargesFixesGlobalPct = total.chargesFixesPct
  const aDesChargesConfigurees = total.aDesCharges

  const livraisonGlobalMt = total.livraisonMt
  const surPlaceGlobalMt = total.surPlaceMt
  const pctLivraisonGlobal = total.pctLivraison

  const dataMixCanauxGlobal = vue.mixCanaux.map(c => ({ x: c.canal, y: c.montant }))

  // ---- Pilier 9 — Alertes (consolidé) ----
  function calculerAlertesGlobal() {
    const alertes = []
    classementCouts.forEach(r => {
      if (r.ventes > 0 && (r.foodPct > 0 || r.laborPct > 0) && r.primePct > 60) {
        alertes.push({
          type: 'danger', icon: 'alert-octagon-outline', titre: `${r.nom} — Coût primaire élevé`,
          message: `Coût primaire à ${r.primePct.toFixed(1)}% (Matières ${r.foodPct.toFixed(1)}% + Salaire ${r.laborPct.toFixed(1)}%) — au-dessus du seuil de 60%`
        })
      }
    })
    classement.forEach(r => {
      if (r.nbJours > 0 && r.benefice < 0) {
        alertes.push({
          type: 'danger', icon: 'trending-down', titre: `${r.nom} — Bénéfice négatif`,
          message: `Bénéfice SC de ${fmt(r.benefice)} sur la période`
        })
      }
    })
    if (classement.length && classement[0].benefice > 0) {
      alertes.push({
        type: 'ok', icon: 'trophy-outline', titre: 'Meilleur restaurant',
        message: `${classement[0].nom} en tête avec ${fmt(classement[0].benefice)} de bénéfice SC`
      })
    }
    if (!alertes.length) {
      alertes.push({ type: 'ok', icon: 'check-circle-outline', titre: 'Aucune alerte', message: 'Aucun seuil critique franchi sur cette période.' })
    }
    return alertes
  }

  const ALERTE_COLORS = {
    danger: { bg: colors.errorLight, txt: colors.errorDark },
    warning: { bg: colors.warningLight, txt: colors.warningDark },
    ok: { bg: colors.successLight, txt: colors.successDark },
    info: { bg: colors.surfaceAlt, txt: colors.textSecondary },
  }


  // ── Le rendu de la comparaison ────────────────────────────────────────────
  function renderComparaison() {
    if (!compar) {
      return (
        <View style={styles.emptyBox}>
          <MaterialCommunityIcons name="compare-horizontal" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTxt}>Choisissez les deux termes à comparer</Text>
        </View>
      )
    }
    const pointsBAttendus = compar.mode === MODE_PERIODES && rangeB
      && clePointsB !== `${rangeB.debut}|${rangeB.fin}`
    const coutsBAttendus = compar.mode === MODE_PERIODES && pilier === 'couts'
      && periodeKey !== 'today' && !coutsB
    if (chargementB || pointsBAttendus || coutsBAttendus) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingTxt}>Chargement du second terme...</Text>
        </View>
      )
    }
    if (pilier === 'couts' && chargementCouts) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingTxt}>Chargement des coûts...</Text>
        </View>
      )
    }
    // Comportement conservé de l'écran : « Aujourd'hui » n'affiche pas de coûts.
    if (pilier === 'couts' && periodeKey === 'today') {
      return (
        <View style={styles.emptyBox}>
          <MaterialCommunityIcons name="chart-donut" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTxt}>Les coûts ne sont pas calculés sur la seule journée d’aujourd’hui</Text>
        </View>
      )
    }
    const { lignes, synth } = ecartsCompar
    return (<>
      <View style={styles.syntheseCard}>
        {!!synth.phrase && <Text style={styles.synthesePhrase}>{synth.phrase}</Text>}
        {synth.lignes.map(l => (
          <View key={l.cle} style={styles.syntheseLigne}>
            <Text style={styles.syntheseLibelle} numberOfLines={1}>• {l.libelle}</Text>
            <Text style={[
              styles.syntheseEcart,
              l.couleur === 'bon' && { color: colors.successDark },
              l.couleur === 'mauvais' && { color: colors.error },
            ]}>{formaterEcart(l)}</Text>
          </View>
        ))}
      </View>

      {lignes.map(e => (
        <LigneComparee
          key={e.cle}
          ecart={e}
          couleurA={compar.couleurA}
          couleurB={compar.couleurB}
          opaciteB={compar.opaciteB}
        />
      ))}

      {pilier === 'apercu' && renderCourbesComparees()}
      {renderClassementCompare()}
    </>)
  }

  // Les deux séries se superposent jour 1 contre jour 1 : A et B ont la même
  // durée, et les séries indexent les jours en position, pas en date (§ 4.2).
  function renderCourbesComparees() {
    const sA = compar.vueA.serieJours
    const sB = compar.vueB.serieJours
    if (sA.length < 2 && sB.length < 2) return null
    const n = Math.max(sA.length, sB.length)
    const etiquettes = Array.from({ length: n }, (_, i) => `J${i + 1}`)
    const val = (serie, champ) => serie.map(p => Number(p[champ]) || 0)
    const renta = serie => serie.map(p => (p.vente ? (p.benefice_sc / p.vente) * 100 : 0))
    const courbes = [
      { cle: 'ventes', icone: 'chart-areaspline', titre: 'Vente machine par jour', a: val(sA, 'vente'), b: val(sB, 'vente'), format: fmtCourt, detail: fmt },
      { cle: 'benefice', icone: 'cash-plus', titre: 'Bénéfice SC par jour', a: val(sA, 'benefice_sc'), b: val(sB, 'benefice_sc'), format: fmtCourt, detail: fmt },
      { cle: 'renta', icone: 'percent-outline', titre: 'Rentabilité par jour', a: renta(sA), b: renta(sB), format: v => `${Math.round(v)}%`, detail: v => `${v.toFixed(1)} %` },
    ]
    return courbes.map(c => (
      <CarteGraphique key={c.cle} icone={c.icone} couleur={compar.couleurA} titre={c.titre}
        sous={`Jour 1 contre jour 1 — ${compar.nbJours} jour(s) de part et d’autre`}
        legende={[
          { nom: `A · ${compar.libelleA}`, couleur: compar.couleurA },
          { nom: `B · ${compar.libelleB}`, couleur: compar.couleurB, opacite: compar.opaciteB, pointille: true },
        ]}>
        {l => (
          <CourbeAire largeur={l} etiquettes={etiquettes} format={c.format} formatDetail={c.detail} series={[
            { nom: `A · ${compar.libelleA}`, valeurs: c.a, couleur: compar.couleurA, aire: true },
            { nom: `B · ${compar.libelleB}`, valeurs: c.b, couleur: compar.couleurB, pointille: true, opacite: Math.max(0.6, compar.opaciteB) },
          ]} />
        )}
      </CarteGraphique>
    ))
  }

  function renderClassementCompare() {
    if (compar.mode === MODE_RESTOS) {
      const deux = [compar.vueA.lignes[0], compar.vueB.lignes[0]]
        .filter(Boolean)
        .sort((x, y) => y.benefice - x.benefice)
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitre}>Classement des deux termes</Text>
          <View style={styles.classementCard}>
            {deux.map((r, i) => (
              <View key={r.id} style={[styles.classementRow, i === deux.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.classementLeft}>
                  <View style={[styles.rangBadge, i === 0 && styles.rangOr]}>
                    <Text style={[styles.rangTxt, i === 0 && { color: '#FFFFFF' }]}>{i + 1}</Text>
                  </View>
                  <View style={styles.classementInfo}>
                    <Text style={styles.classementNom}>{r.nom}</Text>
                    <Text style={styles.classementJours}>
                      {r.nbJours > 0 ? `${r.nbJours}j validé(s)` : 'aucun point saisi'}
                    </Text>
                  </View>
                </View>
                <View style={styles.classementRight}>
                  <Text style={[styles.classementBenefice, { color: r.benefice >= 0 ? colors.successDark : colors.error }]}>{fmt(r.benefice)}</Text>
                  <Text style={styles.classementVentes}>{fmt(r.ventes)}</Text>
                  <Text style={styles.classementRenta}>{r.renta.toFixed(1)}%</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )
    }
    // Mode « 2 périodes » sur un seul restaurant : classer une ligne ne dit rien.
    if (restoFiltre) return null
    const rangsB = new Map(compar.vueB.classement.map((r, i) => [r.id, i + 1]))
    const rangs = compar.vueA.classement.map((r, i) => ({ ...r, rangA: i + 1, rangB: rangsB.get(r.id) || null }))
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitre}>Rang par bénéfice — de B vers A</Text>
        <View style={styles.classementCard}>
          {rangs.map((r, i) => {
            const bouge = r.rangB === null ? 0 : r.rangB - r.rangA
            return (
              <View key={r.id} style={[styles.classementRow, i === rangs.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.classementLeft}>
                  <View style={[styles.restoDot, { width: 10, height: 10, borderRadius: 5, backgroundColor: r.couleur }]} />
                  <Text style={styles.classementNom}>{r.nom}</Text>
                </View>
                <Text style={styles.classementRangCompare}>
                  {r.rangB === null ? '—' : `B #${r.rangB}`} → A #{r.rangA}
                  {bouge > 0 ? '  ▲' : bouge < 0 ? '  ▼' : ''}
                </Text>
              </View>
            )
          })}
        </View>
      </View>
    )
  }

  // ── Petits éléments d'affichage ──────────────────────────────────────────
  const vuePrec = vueGlobale({ points: pointsPrec, restaurants: restosVus, couts: {} })
  const avecVariation = periodeKey !== 'today' && Object.values(pointsPrec).some(l => l.length)
  const varVentes = avecVariation ? variation(total.ventes, vuePrec.total.ventes) : null
  const varBenefice = avecVariation ? variation(total.benefice, vuePrec.total.benefice) : null
  const varDepenses = avecVariation ? variation(total.depenses, vuePrec.total.depenses) : null
  const etiquettesJours = serieJours.map(p => axisLabelJour(p.date))
  const nbJoursVus = serieJours.length || 1

  const pos = statsPOS?.stats || null
  const posAbsent = statsPOS?.erreur === POS_NON_INSTALLE
  const posErreur = statsPOS?.erreur && !posAbsent ? statsPOS.erreur : null
  const posAvecDonnees = !!(pos && Number(pos.totaux?.nb))
  const picPOS = posAvecDonnees ? heurePic(pos.par_heure) : null
  const ticketPOS = posAvecDonnees ? ticketMoyen(pos.totaux) : 0

  const aujourdhui = new Date()
  const joursDuMois = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() + 1, 0).getDate()
  const nomMoisCourant = aujourdhui.toLocaleDateString('fr-FR', { month: 'long' })

  function pastille(icone, couleur, taille = 34) {
    return (
      <View style={{ width: taille, height: taille, borderRadius: Math.round(taille * 0.32), alignItems: 'center', justifyContent: 'center', backgroundColor: `${couleur}1F` }}>
        <MaterialCommunityIcons name={icone} size={Math.round(taille * 0.52)} color={couleur} />
      </View>
    )
  }

  // « ▲ 12 % » vert si c'est une bonne nouvelle (inverse : une hausse est mauvaise).
  function pastilleVariation(v, { inverse = false, surFond = false } = {}) {
    if (v === null || v === undefined) return null
    const bon = inverse ? v <= 0 : v >= 0
    const couleur = surFond ? '#FFFFFF' : bon ? colors.successDark : colors.error
    const fond = surFond ? 'rgba(255,255,255,0.2)' : bon ? colors.successLight : colors.errorLight
    return (
      <View style={[styles.variation, { backgroundColor: fond }]}>
        <MaterialCommunityIcons name={v >= 0 ? 'arrow-up' : 'arrow-down'} size={12} color={couleur} />
        <Text style={[styles.variationTxt, { color: couleur }]}>{Math.abs(v)} %</Text>
      </View>
    )
  }

  function tuile({ icone, couleur, label, valeur, sous, v, inverse }) {
    return (
      <View style={styles.tuile}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {pastille(icone, couleur)}
          {pastilleVariation(v, { inverse })}
        </View>
        <Text style={styles.tuileLabel}>{label}</Text>
        <Text style={styles.tuileValeur} numberOfLines={1} adjustsFontSizeToFit>{valeur}</Text>
        {sous ? <Text style={styles.tuileSous} numberOfLines={1}>{sous}</Text> : null}
      </View>
    )
  }

  function titreSection(icone, titre, droite) {
    return (
      <View style={styles.titreSection}>
        {pastille(icone, colors.primary, 28)}
        <Text style={styles.titreSectionTxt}>{titre}</Text>
        {droite ? <Text style={styles.titreSectionDroite}>{droite}</Text> : null}
      </View>
    )
  }

  function legendeDetaillee(lignes) {
    return (
      <View style={{ flex: 1, gap: 8 }}>
        {lignes.map(l => (
          <View key={l.nom} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: l.couleur }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.text }} numberOfLines={1}>{l.nom}</Text>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>{l.sous}</Text>
            </View>
            <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>{l.part} %</Text>
          </View>
        ))}
      </View>
    )
  }

  // ── Pilier Aperçu ────────────────────────────────────────────────────────
  function renderApercu() {
    const parVentes = [...classement].sort((a, b) => b.ventes - a.ventes)
    const familles = ['Samer', 'Al Kayan'].map(f => {
      const rs = classement.filter(r => r.famille === f)
      const ventes = rs.reduce((x, r) => x + r.ventes, 0)
      const benefice = rs.reduce((x, r) => x + r.benefice, 0)
      return { nom: f, ventes, benefice, couleur: f === 'Samer' ? '#EF9F27' : '#2D7D46', nb: rs.length }
    })
    const totalFamilles = familles.reduce((x, f) => x + f.ventes, 0) || 1
    return (<>
      {/* Carte principale */}
      <View style={styles.hero}>
        <View style={[styles.heroRond, { top: -70, right: -50, width: 190, height: 190 }]} />
        <View style={[styles.heroRond, { bottom: -80, left: -40, width: 150, height: 150, opacity: 0.5 }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={styles.heroIcone}><MaterialCommunityIcons name="chart-areaspline" size={18} color="#FFFFFF" /></View>
          <Text style={styles.heroLbl} numberOfLines={1}>Vente machine · {titrePeriode()}</Text>
        </View>
        <VenteDouble machine={total.ventes} theorique={total.ventesTheo} colors={colors} taille={13}
          couleur="rgba(255,255,255,0.8)" couleurValeur="#FFFFFF">
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <Text style={styles.heroValeur} numberOfLines={1} adjustsFontSizeToFit>{fmt(total.ventes)}</Text>
            {varVentes !== null ? <View style={{ marginBottom: 8 }}>{pastilleVariation(varVentes, { surFond: true })}</View> : null}
          </View>
        </VenteDouble>
        <Text style={styles.heroSous}>
          {varVentes !== null ? 'par rapport à la période précédente de même durée' : `${serieJours.length} jour${serieJours.length > 1 ? 's' : ''} de points validés`}
        </Text>
        <View style={styles.heroCases}>
          {[
            { label: 'Bénéfice SC', valeur: fmtCourt(total.benefice), point: '#A7F3D0' },
            { label: 'Dépenses', valeur: fmtCourt(total.depenses), point: '#FCA5A5' },
            { label: 'Rentabilité', valeur: `${total.renta.toFixed(1)} %`, point: '#FDE68A' },
          ].map(c => (
            <View key={c.label} style={styles.heroCase}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.point }} />
                <Text style={styles.heroCaseLbl}>{c.label}</Text>
              </View>
              <Text style={styles.heroCaseVal} numberOfLines={1} adjustsFontSizeToFit>{c.valeur}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.tuiles}>
        {tuile({ icone: 'calendar-today', couleur: '#EF9F27', label: 'Ventes par jour', valeur: fmtCourt(total.ventes / nbJoursVus), sous: 'moyenne de la période' })}
        {tuile({ icone: 'cash-plus', couleur: '#10B981', label: 'Bénéfice SC', valeur: fmtCourt(total.benefice), v: varBenefice, sous: 'vs période précédente' })}
        {tuile({ icone: 'receipt-text-outline', couleur: '#0EA5E9', label: 'Ticket moyen', valeur: posAvecDonnees ? `${ticketPOS.toLocaleString('fr-FR')} F` : '—', sous: posAvecDonnees ? `${Number(pos.totaux.nb).toLocaleString('fr-FR')} commandes (POS)` : 'données du POS' })}
        {tuile({ icone: 'fire', couleur: '#E11D48', label: 'Heure de pointe', valeur: picPOS ? libelleCreneau(picPOS.h) : '—', sous: picPOS ? `${picPOS.nb} commandes à cette heure` : 'données du POS' })}
      </View>
      {varDepenses !== null ? (
        <Text style={styles.noteVariation}>
          Dépenses {varDepenses >= 0 ? 'en hausse' : 'en baisse'} de {Math.abs(varDepenses)} % par rapport à la période précédente.
        </Text>
      ) : null}

      {serieJours.length > 1 && (<>
        <CarteGraphique icone="chart-areaspline" couleur="#EF9F27" titre="Ventes et bénéfice par jour"
          sous="Le point le plus haut est signalé"
          legende={[{ nom: 'Vente machine', couleur: '#EF9F27' }, { nom: 'Théorique', couleur: colors.textMuted, pointille: true }, { nom: 'Bénéfice SC', couleur: '#10B981' }]}>
          {l => (
            <CourbeAire largeur={l} hauteur={210} etiquettes={etiquettesJours} formatDetail={fmt} series={[
              { nom: 'Vente machine', valeurs: serieJours.map(p => Number(p.vente) || 0), couleur: '#EF9F27', aire: true },
              { nom: 'Théorique', valeurs: serieJours.map(p => Number(p.vente_theorique) || 0), couleur: colors.textMuted, pointille: true, opacite: 0.8 },
              { nom: 'Bénéfice SC', valeurs: serieJours.map(p => Number(p.benefice_sc) || 0), couleur: '#10B981', aire: true },
            ]} />
          )}
        </CarteGraphique>

        <CarteGraphique icone="chart-bar" couleur="#EF4444" titre="Ventes et dépenses par jour"
          legende={[{ nom: 'Vente machine', couleur: '#EF9F27' }, { nom: 'Dépenses', couleur: '#EF4444' }]}>
          {l => (
            <Barres largeur={l} etiquettes={etiquettesJours} formatDetail={fmt} series={[
              { nom: 'Vente machine', valeurs: serieJours.map(p => Number(p.vente) || 0), couleur: '#EF9F27' },
              { nom: 'Dépenses', valeurs: serieJours.map(p => Number(p.depense_total) || 0), couleur: '#EF4444' },
            ]} />
          )}
        </CarteGraphique>

        <CarteGraphique icone="percent-outline" couleur="#6C63E0" titre="Rentabilité par jour" sous="Ligne pointillée : seuil de 20 %">
          {l => (
            <CourbeAire largeur={l} etiquettes={etiquettesJours} format={v => `${Math.round(v)}%`} formatDetail={v => `${v.toFixed(1)} %`}
              seuil={{ valeur: 20, libelle: 'seuil 20 %', couleur: '#F59E0B' }}
              series={[{ nom: 'Rentabilité', valeurs: serieJours.map(p => (p.vente ? (p.benefice_sc / p.vente) * 100 : 0)), couleur: '#6C63E0', aire: true }]} />
          )}
        </CarteGraphique>

        <CarteGraphique icone="cash-plus" couleur="#10B981" titre="Bénéfice SC par jour" sous="Vert : gagné · rouge : perdu">
          {l => (
            <Barres largeur={l} etiquettes={etiquettesJours} formatDetail={fmt} series={[{
              nom: 'Bénéfice', valeurs: serieJours.map(p => Number(p.benefice_sc) || 0),
              couleur: '#10B981', couleurs: serieJours.map(p => ((p.benefice_sc || 0) >= 0 ? '#10B981' : '#EF4444')),
            }]} />
          )}
        </CarteGraphique>
      </>)}

      <CarteGraphique icone="podium" couleur="#EF9F27" titre="Vente machine par restaurant" sous={titrePeriode()}>
        {() => (
          <BarresHorizontales rangs format={fmtCourt} donnees={parVentes.map(r => ({
            cle: r.id, nom: r.nom, valeur: r.ventes, couleur: r.couleur,
            sous: `Théorique ${fmtCourt(r.ventesTheo)} · Bénéfice ${fmtCourt(r.benefice)} · ${tauxRenta(r.ventes, r.benefice).toFixed(1)} %`,
          }))} />
        )}
      </CarteGraphique>

      {/* Objectifs du mois : le groupe, puis chaque restaurant */}
      {(() => {
        const lignesObj = restosVus.map(r => {
          const ventes = moisEnCours.ventes[r.id] || 0
          return { r, ventes, prog: progressionObjectif({ ventes, objectif: r.objectif_mensuel, jour: aujourdhui.getDate(), joursMois: joursDuMois }) }
        })
        const avecObj = lignesObj.filter(l => l.prog)
        const objGroupe = avecObj.reduce((x, l) => x + Number(l.r.objectif_mensuel || 0), 0)
        const ventesGroupe = avecObj.reduce((x, l) => x + l.ventes, 0)
        const progGroupe = progressionObjectif({ ventes: ventesGroupe, objectif: objGroupe, jour: aujourdhui.getDate(), joursMois: joursDuMois })
        return (
          <View style={styles.objectifsCarte}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {pastille('target', '#10B981', 36)}
              <View style={{ flex: 1 }}>
                <Text style={styles.objectifsTitre}>Objectifs de {nomMoisCourant}</Text>
                <Text style={styles.restoSous}>Jour {aujourdhui.getDate()} sur {joursDuMois} · mois en cours, quelle que soit la période</Text>
              </View>
              <TouchableOpacity style={styles.objectifsBtn} onPress={ouvrirObjectifs} accessibilityRole="button">
                <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.primary} />
                <Text style={styles.objectifsBtnTxt}>Fixer</Text>
              </TouchableOpacity>
            </View>
            {progGroupe ? (
              <View style={{ marginTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <Text style={styles.objectifsGrand}>{progGroupe.pct} %</Text>
                  <Text style={styles.restoSous}>{fmtCourt(ventesGroupe)} sur {fmtCourt(objGroupe)}</Text>
                </View>
                <View style={[styles.objectifPiste, { height: 12, borderRadius: 6, marginTop: 6 }]}>
                  <View style={[styles.objectifRempli, { height: 12, borderRadius: 6, width: `${Math.min(100, progGroupe.pct)}%`, backgroundColor: progGroupe.enAvance ? colors.success : colors.warning }]} />
                  <View style={[styles.repereJour, { left: `${Math.round((aujourdhui.getDate() / joursDuMois) * 100)}%` }]} />
                </View>
                <Text style={[styles.restoSous, { marginTop: 6 }]}>
                  Au rythme actuel : {fmtCourt(progGroupe.projection)} à la fin du mois ({progGroupe.pctProjete} %). Le trait marque où il faudrait être aujourd'hui.
                </Text>
              </View>
            ) : (
              <Text style={[styles.restoSous, { marginTop: 10 }]}>Aucun objectif fixé pour {nomMoisCourant}. Appuyez sur « Fixer ».</Text>
            )}
            {avecObj.length > 0 && (
              <View style={{ marginTop: 12, gap: 9 }}>
                {[...avecObj].sort((a2, b2) => b2.prog.pct - a2.prog.pct).map(({ r, prog }) => (
                  <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={[styles.restoDot, { backgroundColor: couleurResto(r.couleur) }]} />
                    <Text style={styles.objectifMiniNom} numberOfLines={1}>{courtNom(r.nom)}</Text>
                    <View style={[styles.objectifPiste, { flex: 1 }]}>
                      <View style={[styles.objectifRempli, { width: `${Math.min(100, prog.pct)}%`, backgroundColor: prog.enAvance ? colors.success : colors.warning }]} />
                    </View>
                    <Text style={[styles.objectifMiniPct, { color: prog.enAvance ? colors.successDark : colors.warningDark }]}>{prog.pct} %</Text>
                  </View>
                ))}
              </View>
            )}
            {lignesObj.length > avecObj.length && avecObj.length > 0 && (
              <Text style={[styles.restoSous, { marginTop: 8 }]}>
                {lignesObj.length - avecObj.length} restaurant{lignesObj.length - avecObj.length > 1 ? 's' : ''} sans objectif.
              </Text>
            )}
          </View>
        )
      })()}

      {titreSection('storefront-outline', 'Les restaurants', titrePeriode())}
      {classement.map((r, i) => {
        const resto = restaurants.find(x => x.id === r.id) || {}
        const renta = tauxRenta(r.ventes, r.benefice)
        const ventesMois = moisEnCours.ventes[r.id] || 0
        const prog = progressionObjectif({ ventes: ventesMois, objectif: resto.objectif_mensuel, jour: aujourdhui.getDate(), joursMois: joursDuMois })
        const posResto = pos?.par_resto?.find(x => x.id === r.id)
        return (
          <View key={r.id} style={[styles.restoCarte, { borderLeftColor: r.couleur }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[styles.rang, i < 3 && { backgroundColor: ['#F59E0B', '#94A3B8', '#B45309'][i] }]}>
                <Text style={[styles.rangTxt, i < 3 && { color: '#FFFFFF' }]}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.restoNom} numberOfLines={1}>{r.nom}</Text>
                <Text style={styles.restoSous}>
                  {r.famille} · {r.nbJours > 0 ? `${r.nbJours} j validé${r.nbJours > 1 ? 's' : ''}` : 'aucun point'}
                  {moisEnCours.employes[r.id] ? ` · ${moisEnCours.employes[r.id]} employés` : ''}
                </Text>
              </View>
              <View style={[styles.rentaPilule, { backgroundColor: renta >= 20 ? colors.successLight : colors.errorLight }]}>
                <Text style={[styles.rentaTxt, { color: renta >= 20 ? colors.successDark : colors.errorDark }]}>{renta.toFixed(1)} %</Text>
              </View>
            </View>
            <View style={styles.restoChiffres}>
              <View style={styles.restoChiffre}><Text style={styles.restoChiffreLbl}>Vente machine</Text><Text style={styles.restoChiffreVal}>{fmtCourt(r.ventes)}</Text></View>
              <View style={styles.restoChiffre}><Text style={styles.restoChiffreLbl}>Bénéfice</Text><Text style={[styles.restoChiffreVal, { color: r.benefice >= 0 ? colors.successDark : colors.error }]}>{fmtCourt(r.benefice)}</Text></View>
              <View style={styles.restoChiffre}><Text style={styles.restoChiffreLbl}>Ticket</Text><Text style={styles.restoChiffreVal}>{posResto?.nb ? fmtCourt(posResto.ca / posResto.nb) : '—'}</Text></View>
              <View style={styles.restoChiffre}><Text style={styles.restoChiffreLbl}>Pic</Text><Text style={styles.restoChiffreVal}>{posResto?.pic != null ? `${posResto.pic}h` : '—'}</Text></View>
            </View>
            {r.nbJours > 0 && <TexteTheorique machine={r.ventes} theorique={r.ventesTheo} colors={colors} style={{ marginTop: 6 }} />}
            <TouchableOpacity style={styles.objectif} activeOpacity={0.7}
              onPress={ouvrirObjectifs}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: prog ? 6 : 0 }}>
                <MaterialCommunityIcons name="target" size={15} color={prog ? (prog.enAvance ? colors.successDark : colors.warningDark) : colors.textMuted} />
                <Text style={styles.objectifTxt} numberOfLines={1}>
                  {prog ? `${fmtCourt(ventesMois)} sur ${fmtCourt(resto.objectif_mensuel)} · ${prog.pct} % (vente machine)` : `Objectif de ${nomMoisCourant} à définir`}
                </Text>
                <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.primary} />
              </View>
              {prog ? (
                <>
                  <View style={styles.objectifPiste}>
                    <View style={[styles.objectifRempli, { width: `${Math.min(100, prog.pct)}%`, backgroundColor: prog.enAvance ? colors.success : colors.warning }]} />
                  </View>
                  <Text style={[styles.restoSous, { marginTop: 4 }]}>
                    Au rythme actuel : {fmtCourt(prog.projection)} à la fin du mois ({prog.pctProjete} %)
                  </Text>
                </>
              ) : null}
            </TouchableOpacity>
          </View>
        )
      })}

      <CarteGraphique icone="family-tree" couleur="#2D7D46" titre="Samer et Al Kayan" sous="Part des ventes de chaque famille">
        {() => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Anneau taille={130} epaisseur={18} centreValeur={fmtCourt(total.ventes)} centreLibelle="ventes"
              segments={familles.map(f => ({ nom: f.nom, valeur: f.ventes, couleur: f.couleur }))} />
            {legendeDetaillee(familles.map(f => ({
              nom: f.nom, couleur: f.couleur, part: Math.round((f.ventes / totalFamilles) * 100),
              sous: `${fmtCourt(f.ventes)} · bénéfice ${fmtCourt(f.benefice)} · ${tauxRenta(f.ventes, f.benefice).toFixed(1)} %`,
            })))}
          </View>
        )}
      </CarteGraphique>
    </>)
  }

  // ── Pilier Activité POS ──────────────────────────────────────────────────
  function renderActivite() {
    if (chargementPOS && !pos) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingTxt}>Lecture des commandes du POS…</Text>
        </View>
      )
    }
    if (posAbsent) {
      return (
        <View style={styles.infoCarte}>
          {pastille('database-cog-outline', colors.primary, 48)}
          <Text style={styles.infoTitre}>Statistiques du POS à activer</Text>
          <Text style={styles.infoTxt}>
            Passez le fichier pos_cloud_stats_dashboard.sql dans le SQL Editor du projet « pos-samer-cloud » (le POS, pas Samtrackly).
            Ensuite, cet onglet affiche les heures de pointe, les jours forts, les canaux, les paiements et les plats les plus vendus.
          </Text>
        </View>
      )
    }
    if (posErreur) {
      return (
        <View style={styles.infoCarte}>
          {pastille('wifi-off', colors.error, 48)}
          <Text style={styles.infoTitre}>Le POS ne répond pas</Text>
          <Text style={styles.infoTxt}>{posErreur}</Text>
        </View>
      )
    }
    if (!posAvecDonnees) {
      return (
        <View style={styles.infoCarte}>
          {pastille('cash-register', colors.textMuted, 48)}
          <Text style={styles.infoTitre}>Aucune commande au POS sur cette période</Text>
        </View>
      )
    }
    const heures = heuresDuService(pos.par_heure)
    const maxH = Math.max(1, ...heures.map(h => h.nb))
    const iPic = picPOS ? heures.findIndex(h => h.h === picPOS.h) : null
    const canauxHeure = canauxParHeure(pos.par_heure_type)
    const { grille, max: maxGrille } = grilleSemaine(pos.semaine)
    const { parJour, meilleur } = joursForts(pos.semaine)
    const canaux = mixCanaux(pos.par_type)
    const paiements = mixPaiements(pos.paiements, pos.par_type)
    const parJourPOS = pos.par_jour || []
    const t = pos.totaux
    const annulCuisine = pos.annulations_cuisine || { nb: 0, montant: 0 }
    return (<>
      <View style={styles.hero}>
        <View style={[styles.heroRond, { top: -70, right: -50, width: 190, height: 190 }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={styles.heroIcone}><MaterialCommunityIcons name="cash-register" size={18} color="#FFFFFF" /></View>
          <Text style={styles.heroLbl} numberOfLines={1}>Commandes · {titrePeriode()}</Text>
        </View>
        <Text style={[styles.heroValeur, { marginTop: 10 }]}>{Number(t.nb).toLocaleString('fr-FR')}</Text>
        <Text style={styles.heroSous}>commandes payées à la caisse · journées de 6 h à 6 h</Text>
        <View style={styles.heroCases}>
          {[
            { label: 'Encaissé POS', valeur: fmtCourt(t.ca), point: '#FDE68A' },
            { label: 'Ticket moyen', valeur: `${ticketPOS.toLocaleString('fr-FR')} F`, point: '#BAE6FD' },
            { label: 'Pic', valeur: picPOS ? `${picPOS.h}h` : '—', point: '#FCA5A5' },
          ].map(c => (
            <View key={c.label} style={styles.heroCase}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.point }} />
                <Text style={styles.heroCaseLbl}>{c.label}</Text>
              </View>
              <Text style={styles.heroCaseVal} numberOfLines={1} adjustsFontSizeToFit>{c.valeur}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.faitsCarte}>
        {faitsMarquants(pos).map(f => (
          <View key={f.texte} style={styles.fait}>
            {pastille(f.icone, colors.primary, 30)}
            <Text style={styles.faitTxt}>{f.texte}</Text>
          </View>
        ))}
      </View>

      <CarteGraphique icone="fire" couleur="#E11D48" titre="Heures de pointe" sous="Commandes par heure, de 6 h du matin à 5 h">
        {l => (
          <Barres largeur={l} hauteur={pos.par_heure_type ? 270 : 200} format={v => `${Math.round(v)}`}
            etiquettes={heures.map(h => `${h.h}h`)} surligne={iPic} attenuer={false} valeurSurligne={picPOS ? `${picPOS.nb} cmd` : null}
            detail={i => ({
              titre: libelleCreneau(heures[i].h),
              lignes: [
                { couleur: melangerCouleurs('#FDE68A', '#DC2626', heures[i].nb / maxH), label: 'Commandes', valeur: heures[i].nb.toLocaleString('fr-FR') },
                { label: 'Encaissé', valeur: fmt(heures[i].ca) },
                { label: 'Ticket moyen', valeur: heures[i].nb ? `${Math.round(heures[i].ca / heures[i].nb).toLocaleString('fr-FR')} F` : '—' },
                { label: 'Part de la journée', valeur: `${Math.round((heures[i].nb / Math.max(1, Number(t.nb))) * 100)} %` },
                ...(canauxHeure[heures[i].h]?.length ? [{ label: 'Par canal', valeur: '' }] : []),
                ...(canauxHeure[heures[i].h] || []).map(c => ({
                  couleur: c.couleur, label: c.nom, valeur: `${c.nb} cmd · ${fmt(c.ca)}`,
                })),
              ],
            })}
            series={[{ nom: 'Commandes', valeurs: heures.map(h => h.nb), couleur: '#E11D48',
              couleurs: heures.map(h => melangerCouleurs('#FDE68A', '#DC2626', h.nb / maxH)) }]} />
        )}
      </CarteGraphique>

      <CarteGraphique icone="calendar-week" couleur="#EA580C" titre="Semaine × heures" sous="Plus la case est foncée, plus il y a de commandes">
        {l => (
          <CarteChaleur largeur={l} grille={grille} max={maxGrille} lignes={JOURS_COURTS}
            colonnes={ORDRE_HEURES.map(h => `${h}h`)} couleur="#EA580C" />
        )}
      </CarteGraphique>

      <CarteGraphique icone="calendar-star" couleur="#6C63E0" titre="Jours de la semaine"
        sous={meilleur?.nb ? `Le ${meilleur.long} est le plus chargé` : null}>
        {l => (
          <Barres largeur={l} hauteur={180} format={v => `${Math.round(v)}`} etiquettes={parJour.map(j => j.court)}
            surligne={meilleur ? meilleur.j - 1 : null}
            detail={i => ({
              titre: parJour[i].long.charAt(0).toUpperCase() + parJour[i].long.slice(1),
              lignes: [
                { couleur: '#6C63E0', label: 'Commandes', valeur: parJour[i].nb.toLocaleString('fr-FR') },
                { label: 'Part de la semaine', valeur: `${Math.round((parJour[i].nb / Math.max(1, parJour.reduce((x, j) => x + j.nb, 0))) * 100)} %` },
              ],
            })}
            series={[{ nom: 'Commandes', valeurs: parJour.map(j => j.nb), couleur: '#6C63E0' }]} />
        )}
      </CarteGraphique>

      {parJourPOS.length > 1 && (
        <CarteGraphique icone="receipt-text-outline" couleur="#0EA5E9" titre="Ticket moyen par jour" sous="Encaissé ÷ nombre de commandes">
          {l => (
            <CourbeAire largeur={l} etiquettes={parJourPOS.map(d => axisLabelJour(d.d))} format={fmtCourt}
              formatDetail={v => `${Math.round(v).toLocaleString('fr-FR')} F`}
              series={[{ nom: 'Ticket moyen', valeurs: parJourPOS.map(d => (d.nb ? Math.round(d.ca / d.nb) : 0)), couleur: '#0EA5E9', aire: true }]} />
          )}
        </CarteGraphique>
      )}

      <CarteGraphique icone="moped" couleur="#F59E0B" titre="Canaux de vente" sous="Part de l'encaissé">
        {() => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Anneau taille={130} epaisseur={18} centreValeur={String(canaux.length)} centreLibelle="canaux"
              segments={canaux.map(c => ({ nom: c.nom, valeur: c.ca, couleur: c.couleur }))} />
            {legendeDetaillee(canaux.map(c => ({ nom: c.nom, couleur: c.couleur, part: c.part, sous: `${fmtCourt(c.ca)} · ${c.nb} cmd` })))}
          </View>
        )}
      </CarteGraphique>

      <CarteGraphique icone="credit-card-outline" couleur="#10B981" titre="Modes de paiement" sous="Comment les clients paient">
        {() => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Anneau taille={130} epaisseur={18}
              centreValeur={`${paiements.find(p => p.cle === 'ESPECES')?.part ?? 0} %`} centreLibelle="espèces"
              segments={paiements.map(p => ({ nom: p.nom, valeur: p.montant, couleur: p.couleur }))} />
            {legendeDetaillee(paiements.map(p => ({ nom: p.nom, couleur: p.couleur, part: p.part, sous: fmtCourt(p.montant) })))}
          </View>
        )}
      </CarteGraphique>

      <CarteGraphique icone="silverware-fork-knife" couleur="#EF9F27" titre="Plats les plus vendus" sous="Par quantité">
        {() => (
          <BarresHorizontales rangs donnees={(pos.top || []).map((p, i, arr) => ({
            cle: p.nom, nom: p.nom, valeur: Number(p.qte) || 0,
            couleur: melangerCouleurs('#FCD34D', '#EA580C', arr.length > 1 ? 1 - i / (arr.length - 1) : 1),
            droite: `${Number(p.qte).toLocaleString('fr-FR')} vendus`, sous: fmt(Number(p.ca) || 0),
          }))} />
        )}
      </CarteGraphique>

      {titreSection('alert-circle-outline', 'Annulations et gestes commerciaux')}
      <View style={styles.tuiles}>
        {tuile({ icone: 'close-circle-outline', couleur: colors.error, label: 'Commandes annulées', valeur: String(t.annulees || 0), sous: `sur ${Number(t.nb).toLocaleString('fr-FR')} payées` })}
        {tuile({ icone: 'food-off-outline', couleur: '#EA580C', label: 'Retirés après cuisine', valeur: String(annulCuisine.nb || 0), sous: annulCuisine.montant ? fmt(annulCuisine.montant) : 'aucun montant' })}
        {tuile({ icone: 'gift-outline', couleur: '#7C3AED', label: 'Commandes offertes', valeur: String(t.offerts || 0), sous: 'KDO' })}
        {tuile({ icone: 'ticket-percent-outline', couleur: '#0EA5E9', label: 'Remises et promos', valeur: fmtCourt((Number(t.remises) || 0) + (Number(t.promos) || 0)), sous: `${t.nb_remises || 0} remise(s) manuelle(s)` })}
      </View>
      <Text style={styles.noteSource}>Source : caisse POS des restaurants. Les chiffres du haut de l'écran viennent des points validés.</Text>
    </>)
  }

  // ── Pilier Litiges (résumé) ──────────────────────────────────────────────
  function renderLitiges() {
    const boutonDetail = (
      <TouchableOpacity style={styles.boutonLarge} onPress={() => router.push('/litiges')}>
        <MaterialCommunityIcons name="scale-balance" size={18} color="#FFFFFF" />
        <Text style={styles.boutonPleinTxt}>Voir tout le détail des litiges</Text>
        <MaterialCommunityIcons name="arrow-right" size={18} color="#FFFFFF" />
      </TouchableOpacity>
    )
    if (!litigesDash) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingTxt}>Calcul des litiges de la période…</Text>
        </View>
      )
    }
    const r = resumeLitiges(litigesDash.donnees)
    const positives = r.categories.filter(c => c.montant > 0)
    const sommePos = positives.reduce((x, c) => x + c.montant, 0) || 1
    return (<>
      {chargementLitiges ? (
        <View style={styles.bandeauMaj}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.bandeauMajTxt}>Mise à jour pour la nouvelle période…</Text>
        </View>
      ) : null}
      <View style={styles.hero}>
        <View style={[styles.heroRond, { top: -70, right: -50, width: 190, height: 190 }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={styles.heroIcone}><MaterialCommunityIcons name="scale-balance" size={18} color="#FFFFFF" /></View>
          <Text style={styles.heroLbl} numberOfLines={1}>Litiges · {titrePeriode()}</Text>
        </View>
        <Text style={[styles.heroValeur, { marginTop: 10 }]} numberOfLines={1} adjustsFontSizeToFit>{fmt(r.total)}</Text>
        <Text style={styles.heroSous}>
          {r.nbConcernes
            ? `${r.nbConcernes} restaurant${r.nbConcernes > 1 ? 's' : ''} concerné${r.nbConcernes > 1 ? 's' : ''} · montants à la charge des équipes`
            : 'Aucun litige sur la période'}
        </Text>
        {r.categories.length > 0 && (
          <View style={styles.heroCases}>
            {r.categories.slice(0, 3).map(c => (
              <View key={c.cle} style={styles.heroCase}>
                <Text style={styles.heroCaseLbl} numberOfLines={1}>{c.nom}</Text>
                <Text style={styles.heroCaseVal} numberOfLines={1} adjustsFontSizeToFit>{fmtCourt(c.montant)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {r.contactsEnAttente > 0 && (
        <View style={[styles.alerteCard, { backgroundColor: colors.warningLight }]}>
          <MaterialCommunityIcons name="timer-sand" size={20} color={colors.warningDark} />
          <Text style={[styles.alerteMsg, { flex: 1, color: colors.warningDark, fontWeight: '600' }]}>
            {r.contactsEnAttente} journée{r.contactsEnAttente > 1 ? 's' : ''} : le comptage des contacts du POS n'est pas encore arrivé (rien n'est facturé en attendant).
          </Text>
        </View>
      )}

      {positives.length > 0 && (
        <CarteGraphique icone="chart-donut" couleur="#DC2626" titre="Par type de litige" sous="D'où viennent les montants">
          {() => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <Anneau taille={130} epaisseur={18} centreValeur={fmtCourt(r.total)} centreLibelle="à déduire"
                segments={positives.map(c => ({ nom: c.nom, valeur: c.montant, couleur: c.couleur }))} />
              {legendeDetaillee(positives.map(c => ({ nom: c.nom, couleur: c.couleur, part: Math.round((c.montant / sommePos) * 100), sous: fmt(c.montant) })))}
            </View>
          )}
        </CarteGraphique>
      )}

      {r.parResto.length > 0 && !restoFiltre && (
        <CarteGraphique icone="storefront-outline" couleur="#EA580C" titre="Par restaurant" sous="Du plus touché au moins touché">
          {() => (
            <BarresHorizontales rangs format={fmtCourt} donnees={r.parResto.map(x => ({
              cle: x.id, nom: x.nom, valeur: x.total, couleur: couleurResto(x.couleur), droite: fmt(x.total),
              couleurValeur: x.total > 0 ? colors.error : colors.successDark,
              sous: x.principale?.montant > 0 ? `surtout : ${x.principale.nom.toLowerCase()}` : null,
            }))} />
          )}
        </CarteGraphique>
      )}

      {r.personnes.length > 0 && (
        <View style={styles.faitsCarte}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 }}>
            {pastille('account-alert-outline', '#DC2626', 34)}
            <View style={{ flex: 1 }}>
              <Text style={styles.objectifsTitre}>Personnes les plus concernées</Text>
              <Text style={styles.restoSous}>Montants imputés sur la période, toutes catégories</Text>
            </View>
          </View>
          {r.personnes.map((p, i) => (
            <View key={p.nom} style={styles.personneLigne}>
              <View style={[styles.personneAvatar, { backgroundColor: i === 0 ? colors.errorLight : colors.surfaceAlt }]}>
                <Text style={[styles.personneInitiales, { color: i === 0 ? colors.errorDark : colors.textSecondary }]}>
                  {p.nom.split(/\s+/).filter(Boolean).slice(0, 2).map(m => m[0]).join('').toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.personneNom} numberOfLines={1}>{p.nom}</Text>
                <Text style={styles.restoSous} numberOfLines={1}>{p.restaurant} · {p.nb} ligne{p.nb > 1 ? 's' : ''}</Text>
              </View>
              <Text style={[styles.personneMontant, { color: colors.error }]}>{fmt(p.montant)}</Text>
            </View>
          ))}
        </View>
      )}

      {boutonDetail}
      <Text style={styles.noteSource}>Mêmes calculs que l'écran Litiges : avis, Yango, Glovo, contacts, points non faits, écarts et comptages.</Text>
    </>)
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLigne}>
          <TouchableOpacity onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/accueil') }}
            style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Retour">
            <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerCentre}>
            <View style={styles.headerIcone}><MaterialCommunityIcons name="chart-box" size={18} color="#FFFFFF" /></View>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.headerTitre}>Dashboard global</Text>
              <Text style={styles.headerSub} numberOfLines={1}>
                {compar
                  ? `${compar.libelleA} contre ${compar.libelleB}`
                  : `${restoFiltre ? (restaurants.find(r => r.id === restoFiltre)?.nom || '…') : 'Tous les restaurants'} · ${titrePeriode()}`}
              </Text>
            </View>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.periodes}>
          {PERIODES.map(p => {
            const actif = periodeKey === p.key
            return (
              <TouchableOpacity key={p.key} style={[styles.periodeBtn, actif && styles.periodeBtnActive]}
                onPress={() => (p.key === 'custom' ? ouvrirCalendrier() : setPeriodeKey(p.key))}>
                {p.icone ? <MaterialCommunityIcons name={p.icone} size={14} color={actif ? colors.headerBg : '#FFFFFF'} /> : null}
                <Text style={[styles.periodeTxt, actif && styles.periodeTxtActive]}>{p.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.pillsBar, { flexGrow: 0 }]}
        contentContainerStyle={{ paddingHorizontal: 14, gap: 8, alignItems: 'center' }}>
        {PILIERS.map(p => {
          const actif = pilier === p.key
          return (
            <TouchableOpacity key={p.key} style={[styles.pill, actif && styles.pillActive]} onPress={() => setPilier(p.key)}>
              <MaterialCommunityIcons name={p.icone} size={16} color={actif ? '#FFFFFF' : colors.primary} />
              <Text style={[styles.pillTxt, actif && styles.pillTxtActive]}>{p.label}</Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* Le filtre restaurant. En mode « 2 restaurants » il cède la place aux
          sélecteurs A / B ; en mode « 2 périodes » il reste, car c'est LUI qui
          désigne le restaurant comparé à lui-même. */}
      {!(comparaisonActive && modeComparaison === MODE_RESTOS) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.restoFiltreBar, { flexGrow: 0 }]}
          contentContainerStyle={{ paddingHorizontal: 14, gap: 6, alignItems: 'center' }}>
          <TouchableOpacity style={[styles.restoFiltreBtn, !restoFiltre && styles.restoFiltreBtnActive]} onPress={() => setRestoFiltre(null)}>
            <MaterialCommunityIcons name="earth" size={13} color={!restoFiltre ? colors.primary : colors.textMuted} />
            <Text style={[styles.restoFiltreTxt, !restoFiltre && styles.restoFiltreTxtActive]}>Tous</Text>
          </TouchableOpacity>
          {restaurants.map(r => {
            const actif = restoFiltre === r.id
            return (
              <TouchableOpacity key={r.id}
                style={[styles.restoFiltreBtn, actif && styles.restoFiltreBtnActive, actif && { borderColor: couleurResto(r.couleur) }]}
                onPress={() => setRestoFiltre(r.id)}>
                <View style={[styles.restoDot, { backgroundColor: couleurResto(r.couleur) }]} />
                <Text style={[styles.restoFiltreTxt, actif && styles.restoFiltreTxtActive]}>{courtNom(r.nom)}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}

      <BarreComparaison
        actif={comparaisonActive}
        mode={modeComparaison}
        restaurants={restaurants}
        termeA={termeA}
        termeB={termeB}
        bandeau={bandeau}
        nomRestoPeriodes={restoFiltre ? (restaurants.find(r => r.id === restoFiltre)?.nom || '…') : 'Tous les restaurants'}
        onOuvrir={ouvrirComparaison}
        onFermer={fermerComparaison}
        onMode={setModeComparaison}
        onChoisirA={choisirA}
        onChoisirB={choisirB}
      />

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingTxt}>Chargement de tous les restaurants…</Text>
        </View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {comparaisonActive && PILIERS_COMPARABLES.includes(pilier) && renderComparaison()}
          {comparaisonActive && !PILIERS_COMPARABLES.includes(pilier) && (
            <View style={styles.comparNote}>
              <MaterialCommunityIcons name="information-outline" size={18} color={colors.primary} />
              <Text style={styles.comparNoteTxt}>
                Cet onglet n’est pas comparé : il reste en lecture simple, sur la période A et le filtre restaurant courant.
              </Text>
            </View>
          )}

          {pilier === 'apercu' && !comparaisonActive && renderApercu()}
          {pilier === 'activite' && renderActivite()}

          {/* Pilier Coûts (consolidé) */}
          {pilier === 'couts' && !comparaisonActive && (
            chargementCouts ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingTxt}>Chargement des coûts…</Text>
              </View>
            ) : caGlobal <= 0 ? (
              <View style={styles.infoCarte}>
                {pastille('chart-donut', colors.textMuted, 48)}
                <Text style={styles.infoTitre}>Aucune donnée de vente sur cette période</Text>
              </View>
            ) : (
              <>
                {titreSection('chart-donut', 'Structure des coûts', restoFiltre ? null : 'tous restaurants')}
                <View style={styles.carte}>
                  <JaugeCout label="Coût matières" pct={foodCostGlobalPct} montant={foodCostGlobalMt} seuil={30} colors={colors} fmt={fmt} />
                  <JaugeCout label="Coût du salaire" pct={laborCostGlobalPct} montant={laborCostGlobalMt} seuil={30} colors={colors} fmt={fmt} />
                  <JaugeCout label="Coût primaire" pct={primeCostGlobalPct} montant={foodCostGlobalMt + laborCostGlobalMt} seuil={60} colors={colors} fmt={fmt} accent />
                  {aDesChargesConfigurees ? (
                    <JaugeCout label="Charges fixes" pct={chargesFixesGlobalPct} montant={chargesFixesGlobalMt} seuil={20} colors={colors} fmt={fmt} dernier />
                  ) : (
                    <TouchableOpacity style={styles.chargesEmptyRow} onPress={() => router.push('/tresorerie-a-payer')}>
                      <Text style={styles.chargesEmptyTxt}>Charges fixes non saisies pour cette période (Trésorerie → À payer)</Text>
                      <Text style={styles.chargesEmptyLink}>Configurer ›</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <CarteGraphique icone="podium" couleur="#EF4444" titre="Coût primaire par restaurant" sous="Matières + salaires, en % des ventes · seuil 60 %">
                  {() => (
                    <BarresHorizontales rangs format={v => `${v.toFixed(1)} %`} donnees={classementCouts.map(r => ({
                      cle: r.id, nom: r.nom, valeur: r.ventes > 0 ? r.primePct : 0,
                      couleur: r.primePct > 60 ? '#EF4444' : '#10B981',
                      couleurValeur: r.primePct > 60 ? colors.error : colors.successDark,
                      droite: r.ventes > 0 ? `${r.primePct.toFixed(1)} %` : '—',
                      sous: `Matières ${r.foodPct.toFixed(1)} % · Salaire ${r.laborPct.toFixed(1)} %`,
                    }))} />
                  )}
                </CarteGraphique>

                {titreSection('cash-refund', 'Fond de caisse reçu', fmt(total.fondRecu))}
                <View style={styles.carte}>
                  {[...vue.lignes].sort((a, b) => b.fondRecu - a.fondRecu).map(r => {
                    const ouvert = fondOuvert === r.id
                    const deroulable = r.joursFondRecu > 0
                    return (
                      <View key={r.id}>
                        <TouchableOpacity style={styles.resultRow} disabled={!deroulable} onPress={() => setFondOuvert(ouvert ? null : r.id)}>
                          <View style={[styles.restoDot, { backgroundColor: r.couleur, width: 9, height: 9, borderRadius: 5 }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.resultLabel}>{r.nom}</Text>
                            <Text style={styles.restoSous}>
                              {r.nbJours === 0 ? 'Aucun point saisi' : `${r.joursFondRecu} jour${r.joursFondRecu > 1 ? 's' : ''} sur ${r.nbJours}`}
                            </Text>
                          </View>
                          <Text style={[styles.resultValue, { color: colors.primary }]}>{r.nbJours === 0 ? '—' : fmt(r.fondRecu)}</Text>
                          {deroulable ? <MaterialCommunityIcons name={ouvert ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} /> : null}
                        </TouchableOpacity>
                        {ouvert && detailFondRecu(points[r.id]).map(j => (
                          <View key={j.date} style={[styles.resultRow, { paddingLeft: 22 }]}>
                            <Text style={[styles.resultLabel, { flex: 1, fontWeight: '500' }]}>{formatDateLongue(j.date)}</Text>
                            <Text style={[styles.resultValue, { color: colors.primary }]}>{fmt(j.montant)}</Text>
                          </View>
                        ))}
                      </View>
                    )
                  })}
                </View>
              </>
            )
          )}

          {/* Pilier Canaux (points validés) */}
          {pilier === 'clients' && !comparaisonActive && (
            caGlobal <= 0 ? (
              <View style={styles.infoCarte}>
                {pastille('moped', colors.textMuted, 48)}
                <Text style={styles.infoTitre}>Aucune donnée de vente sur cette période</Text>
              </View>
            ) : (
              <>
                <CarteGraphique icone="moped" couleur="#EF9F27" titre="Livraison et sur place" sous="D'après les points validés">
                  {() => (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                      <Anneau taille={130} epaisseur={18} centreValeur={`${pctLivraisonGlobal.toFixed(0)} %`} centreLibelle="livraison"
                        segments={[
                          { nom: 'Livraison', valeur: livraisonGlobalMt, couleur: '#EF9F27' },
                          { nom: 'Sur place', valeur: surPlaceGlobalMt, couleur: '#6C63E0' },
                        ]} />
                      {legendeDetaillee([
                        { nom: 'Livraison (Yango, Glovo)', couleur: '#EF9F27', part: Math.round(pctLivraisonGlobal), sous: fmt(livraisonGlobalMt) },
                        { nom: 'Sur place et autres', couleur: '#6C63E0', part: Math.round(100 - pctLivraisonGlobal), sous: fmt(surPlaceGlobalMt) },
                      ])}
                    </View>
                  )}
                </CarteGraphique>
                {dataMixCanauxGlobal.length > 0 && (
                  <CarteGraphique icone="chart-bar" couleur="#0EA5E9" titre="Mix des canaux de vente" sous={titrePeriode()}>
                    {() => (
                      <BarresHorizontales format={fmtCourt} donnees={dataMixCanauxGlobal.map((d, i) => ({
                        cle: d.x, nom: d.x, valeur: d.y, couleur: PIE_COLORS[i % PIE_COLORS.length],
                        sous: `${total.ventes ? Math.round((d.y / total.ventes) * 100) : 0} % des ventes`,
                      }))} />
                    )}
                  </CarteGraphique>
                )}
                <TouchableOpacity style={styles.lienCarte} onPress={() => setPilier('activite')}>
                  {pastille('clock-time-eight-outline', colors.primary, 34)}
                  <Text style={styles.lienCarteTxt}>Heures de pointe, paiements et plats : onglet Activité POS</Text>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.primary} />
                </TouchableOpacity>
              </>
            )
          )}

          {/* Pilier Alertes (consolidé) */}
          {pilier === 'alertes' && (
            <>
              {titreSection('alert-outline', 'Alertes', titrePeriode())}
              {calculerAlertesGlobal().map((a, i) => {
                const c = ALERTE_COLORS[a.type] || ALERTE_COLORS.info
                return (
                  <View key={i} style={[styles.alerteCard, { backgroundColor: c.bg }]}>
                    <MaterialCommunityIcons name={a.icon} size={22} color={c.txt} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.alerteTitre, { color: c.txt }]}>{a.titre}</Text>
                      <Text style={styles.alerteMsg}>{a.message}</Text>
                    </View>
                  </View>
                )
              })}
            </>
          )}

          {/* Pilier Litiges — résumé, le détail complet est dans l'écran Litiges */}
          {pilier === 'litiges' && renderLitiges()}
        </ScrollView>
      )}

      {/* Objectifs du mois de tous les restaurants (lus aussi par Rapports → Mensuel) */}
      <Modal visible={objectifsVisibles} transparent animationType="slide" onRequestClose={() => setObjectifsVisibles(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { maxHeight: '88%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitre}>Objectifs de {nomMoisCourant}</Text>
              <TouchableOpacity onPress={() => setObjectifsVisibles(false)} style={styles.fermerBtn} accessibilityLabel="Fermer">
                <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.restoSous, { marginBottom: 12 }]}>
              Chiffre d'affaires visé pour le mois, par restaurant. Vide = pas d'objectif. Le rapport mensuel les lit aussi.
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
              {restaurants.map(r => (
                <View key={r.id} style={styles.objectifLigne}>
                  <View style={[styles.restoDot, { backgroundColor: couleurResto(r.couleur), width: 10, height: 10, borderRadius: 5 }]} />
                  <Text style={styles.objectifNom} numberOfLines={1}>{r.nom}</Text>
                  <TextInput
                    style={styles.objectifInput} value={objectifsSaisis[r.id] ?? ''}
                    onChangeText={v => setObjectifsSaisis(o => ({ ...o, [r.id]: v.replace(/[^\d]/g, '') }))}
                    keyboardType="numeric" placeholder="Aucun" placeholderTextColor={colors.textPlaceholder}
                    editable={!objectifEnCours}
                  />
                </View>
              ))}
            </ScrollView>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setObjectifsVisibles(false)}>
                <Text style={styles.modalCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalConfirm, objectifEnCours && { opacity: 0.5 }]} onPress={enregistrerObjectifs} disabled={objectifEnCours}>
                <Text style={styles.modalConfirmTxt}>{objectifEnCours ? 'Enregistrement…' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={modalCalendrier} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitre}>Choisir une période</Text>
              <TouchableOpacity onPress={() => setModalCalendrier(false)} style={styles.fermerBtn} accessibilityLabel="Fermer">
                <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.etapeRow}>
              <View style={[styles.etapeBadge, etapeCalendrier === 'debut' && styles.etapeBadgeActive]}>
                <Text style={[styles.etapeTxt, etapeCalendrier === 'debut' && styles.etapeTxtActive]}>1. Date début</Text>
              </View>
              <View style={styles.etapeLine} />
              <View style={[styles.etapeBadge, etapeCalendrier === 'fin' && styles.etapeBadgeActive]}>
                <Text style={[styles.etapeTxt, etapeCalendrier === 'fin' && styles.etapeTxtActive]}>2. Date fin</Text>
              </View>
            </View>
            <View style={styles.selectedDates}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Début</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: dateDebut ? colors.text : colors.textPlaceholder }}>
                  {dateDebut ? formatDate(dateDebut) : 'Non sélectionné'}
                </Text>
              </View>
              <MaterialCommunityIcons name="arrow-right" size={18} color={colors.primary} style={{ marginHorizontal: 8 }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Fin</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: dateFin ? colors.text : colors.textPlaceholder }}>
                  {dateFin ? formatDate(dateFin) : 'Non sélectionné'}
                </Text>
              </View>
            </View>
            <Calendar
              onDayPress={choisirDate}
              markedDates={markedDates()}
              markingType="period"
              maxDate={new Date().toISOString().split('T')[0]}
              theme={{
                calendarBackground: colors.surface,
                selectedDayBackgroundColor: colors.primary,
                selectedDayTextColor: '#fff',
                todayTextColor: colors.primary,
                dayTextColor: colors.text,
                textDisabledColor: colors.textPlaceholder,
                arrowColor: colors.primary,
                monthTextColor: colors.text,
              }}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setModalCalendrier(false)}>
                <Text style={styles.modalCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, (!dateDebut || !dateFin) && { opacity: 0.4 }]}
                onPress={confirmerPeriode}
                disabled={!dateDebut || !dateFin}
              >
                <Text style={styles.modalConfirmTxt}>Voir les résultats</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function JaugeCout({ label, pct, montant, seuil, colors, fmt, accent, dernier }) {
  const ok = pct <= seuil
  const couleur = ok ? colors.success : accent ? colors.error : colors.warning
  const largeur = Math.min(pct, 100)
  return (
    <View style={[jaugeStyles.row, { borderBottomColor: colors.borderLight }, dernier && { borderBottomWidth: 0 }]}>
      <View style={jaugeStyles.head}>
        <Text style={[jaugeStyles.label, { color: colors.text }]}>{label}</Text>
        <Text style={[jaugeStyles.value, { color: ok ? colors.successDark : accent ? colors.error : colors.warningDark }]}>
          {pct.toFixed(1)} % · {fmt(montant)}
        </Text>
      </View>
      <View style={[jaugeStyles.barBg, { backgroundColor: colors.surfaceAlt }]}>
        <View style={[jaugeStyles.barFill, { width: `${largeur}%`, backgroundColor: couleur }]} />
        <View style={[jaugeStyles.seuilTrait, { left: `${Math.min(seuil, 100)}%`, backgroundColor: colors.textMuted }]} />
      </View>
      <Text style={[jaugeStyles.seuil, { color: colors.textMuted }]}>Seuil indicatif : {seuil} %</Text>
    </View>
  )
}

const jaugeStyles = StyleSheet.create({
  row: { paddingVertical: 12, borderBottomWidth: 1 },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  value: { fontSize: 13, fontWeight: '800' },
  barBg: { height: 10, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  seuilTrait: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  seuil: { fontSize: 11, marginTop: 5 },
})

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.headerBg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 14, gap: 12,
    borderBottomLeftRadius: 22, borderBottomRightRadius: 22, zIndex: 2,
    shadowColor: colors.headerBg, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
  },
  headerLigne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  enteteBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  headerCentre: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  headerIcone: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  headerTitre: { fontSize: 18, fontWeight: '800', color: colors.headerText, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: colors.primaryText, fontWeight: '600', marginTop: 1 },
  periodes: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 4, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)' },
  periodeBtn: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 9, borderRadius: 11 },
  periodeBtnActive: { backgroundColor: '#FFFFFF' },
  periodeTxt: { fontSize: 12.5, color: '#FFFFFF', fontWeight: '700' },
  periodeTxtActive: { color: colors.headerBg, fontWeight: '800' },
  pillsBar: { maxHeight: 60, marginTop: 12 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
  },
  pillActive: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 3,
  },
  pillTxt: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  pillTxtActive: { color: '#FFFFFF', fontWeight: '800' },
  restoFiltreBar: { maxHeight: 48, marginTop: 8 },
  restoFiltreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, minHeight: 34,
    borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
  },
  restoFiltreBtnActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 1.5 },
  restoDot: { width: 8, height: 8, borderRadius: 4 },
  restoFiltreTxt: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  restoFiltreTxtActive: { fontWeight: '800', color: colors.text },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },

  hero: {
    backgroundColor: colors.headerBg, borderRadius: 24, padding: 18, marginBottom: 14, overflow: 'hidden',
    shadowColor: colors.headerBg, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 18, elevation: 6,
  },
  heroRond: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  heroIcone: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  heroLbl: { flex: 1, fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 1 },
  heroValeur: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  heroSous: { fontSize: 12.5, color: 'rgba(255,255,255,0.8)', marginTop: 2, fontWeight: '600' },
  heroCases: { flexDirection: 'row', gap: 8, marginTop: 14 },
  heroCase: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 9 },
  heroCaseLbl: { flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: '700' },
  heroCaseVal: { fontSize: 15, color: '#FFFFFF', fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] },
  variation: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  variationTxt: { fontSize: 11.5, fontWeight: '800' },
  noteVariation: { fontSize: 12, color: colors.textSecondary, marginTop: -4, marginBottom: 14, marginHorizontal: 4 },

  tuiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  tuile: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  tuileLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 10 },
  tuileValeur: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 2, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  tuileSous: { fontSize: 11.5, color: colors.textMuted, marginTop: 2 },

  titreSection: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 10 },
  titreSectionTxt: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text, letterSpacing: -0.2 },
  titreSectionDroite: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },

  restoCarte: {
    backgroundColor: colors.surface, borderRadius: 18, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: colors.borderLight, borderLeftWidth: 5,
  },
  rang: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  rangTxt: { fontSize: 13, fontWeight: '800', color: colors.textSecondary },
  restoNom: { fontSize: 15.5, fontWeight: '800', color: colors.text },
  restoSous: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  rentaPilule: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  rentaTxt: { fontSize: 12, fontWeight: '800' },
  restoChiffres: { flexDirection: 'row', marginTop: 12, backgroundColor: colors.surfaceAlt, borderRadius: 12, paddingVertical: 9 },
  restoChiffre: { flex: 1, alignItems: 'center' },
  restoChiffreLbl: { fontSize: 10.5, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  restoChiffreVal: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 2, fontVariant: ['tabular-nums'] },
  objectif: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  objectifTxt: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
  objectifPiste: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  objectifRempli: { height: 8, borderRadius: 4 },

  objectifsCarte: {
    backgroundColor: colors.surface, borderRadius: 20, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  objectifsTitre: { fontSize: 15.5, fontWeight: '800', color: colors.text },
  objectifsBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primaryLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, minHeight: 36 },
  objectifsBtnTxt: { fontSize: 13, fontWeight: '800', color: colors.primary },
  objectifsGrand: { fontSize: 28, fontWeight: '800', color: colors.text, letterSpacing: -0.6 },
  repereJour: { position: 'absolute', top: -3, bottom: -3, width: 2, borderRadius: 1, backgroundColor: colors.text, opacity: 0.6 },
  objectifMiniNom: { width: 78, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  objectifMiniPct: { width: 44, textAlign: 'right', fontSize: 12, fontWeight: '800' },
  objectifLigne: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  objectifNom: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  objectifInput: {
    width: 140, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, fontWeight: '700', color: colors.text, textAlign: 'right',
  },
  boutonLarge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary,
    borderRadius: 16, paddingVertical: 15, marginBottom: 12, minHeight: 52,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 3,
  },
  bandeauMaj: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primaryLight, borderRadius: 12, padding: 10, marginBottom: 10 },
  bandeauMajTxt: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  personneLigne: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  personneAvatar: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  personneInitiales: { fontSize: 13, fontWeight: '800' },
  personneNom: { fontSize: 14, fontWeight: '700', color: colors.text },
  personneMontant: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  faitsCarte: { backgroundColor: colors.surface, borderRadius: 20, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.borderLight, gap: 10 },
  fait: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  faitTxt: { flex: 1, fontSize: 13.5, color: colors.text, fontWeight: '600', lineHeight: 19 },
  noteSource: { fontSize: 11.5, color: colors.textMuted, textAlign: 'center', marginBottom: 10 },

  infoCarte: {
    backgroundColor: colors.surface, borderRadius: 20, padding: 22, marginBottom: 14, alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  infoTitre: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center' },
  infoTxt: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  boutonPlein: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 22, marginTop: 4 },
  boutonPleinTxt: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  lienCarte: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.primaryLight,
    borderRadius: 16, padding: 12, marginBottom: 14,
  },
  lienCarteTxt: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.primary },

  carte: { backgroundColor: colors.surface, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 4, marginBottom: 14, borderWidth: 1, borderColor: colors.borderLight },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  resultLabel: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  resultValue: { fontSize: 13.5, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  chargesEmptyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  chargesEmptyTxt: { fontSize: 12, color: colors.textMuted, flex: 1, marginRight: 8 },
  chargesEmptyLink: { fontSize: 12, fontWeight: '800', color: colors.primary },

  alerteCard: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderRadius: 16, padding: 14, marginBottom: 10 },
  alerteTitre: { fontSize: 14, fontWeight: '800', marginBottom: 3 },
  alerteMsg: { fontSize: 12.5, color: colors.textSecondary, lineHeight: 18 },

  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '600', textAlign: 'center' },

  // ── Comparaison A / B ──
  section: { marginBottom: 14 },
  sectionTitre: { fontSize: 12, fontWeight: '800', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
  classementCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: colors.borderLight },
  classementRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  classementLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rangBadge: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rangOr: { backgroundColor: '#F59E0B' },
  classementInfo: { flex: 1 },
  classementNom: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 2 },
  classementJours: { fontSize: 11, color: colors.textMuted },
  classementRight: { alignItems: 'flex-end' },
  classementBenefice: { fontSize: 14, fontWeight: '800' },
  classementVentes: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  classementRenta: { fontSize: 11, marginTop: 1, color: colors.textSecondary },
  classementRangCompare: { fontSize: 12, fontWeight: '700', color: colors.text },
  syntheseCard: {
    backgroundColor: colors.surface, borderRadius: 18, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: colors.borderLight, borderLeftWidth: 5, borderLeftColor: colors.primary,
  },
  synthesePhrase: { fontSize: 14, fontWeight: '700', color: colors.text, lineHeight: 20, marginBottom: 8 },
  syntheseLigne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  syntheseLibelle: { fontSize: 12.5, color: colors.textSecondary, flex: 1, marginRight: 8 },
  syntheseEcart: { fontSize: 12.5, fontWeight: '800', color: colors.textMuted },
  comparNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: 14, padding: 12, marginBottom: 14 },
  comparNoteTxt: { flex: 1, fontSize: 12.5, color: colors.primary, lineHeight: 18, fontWeight: '600' },

  // ── Fenêtres ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitre: { fontSize: 19, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  fermerBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  input: {
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 14,
    padding: 14, fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center',
  },
  etapeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  etapeBadge: { flex: 1, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  etapeBadgeActive: { backgroundColor: colors.primary },
  etapeTxt: { fontSize: 12.5, color: colors.textMuted, fontWeight: '700' },
  etapeTxtActive: { color: '#FFFFFF' },
  etapeLine: { width: 20, height: 1, backgroundColor: colors.borderLight, marginHorizontal: 4 },
  selectedDates: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: 14, padding: 12, marginBottom: 14 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 14, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: colors.textSecondary, fontWeight: '700' },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
}) }

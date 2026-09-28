import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
    ActivityIndicator,
    Dimensions,
    Modal,
    SafeAreaView, ScrollView,
    StyleSheet,
    Text, TouchableOpacity,
    View
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import {
  VictoryArea, VictoryAxis, VictoryBar,
  VictoryChart, VictoryLine, VictoryTheme,
} from 'victory-native'
import BarreComparaison, { MODE_PERIODES, MODE_RESTOS } from '../components/BarreComparaison'
import LigneComparee from '../components/LigneComparee'
import { useTheme } from '../context/ThemeContext'
import { getDepensesPeriode, getFournisseursPeriodePaye, getPaiesGerantPeriode, getPresencesPeriode } from '../lib/api'
import { ecarts as calculerEcarts, formaterEcart, POLARITE, synthese, UNITE } from '../lib/comparaisonDashboard'
import { CANAUX, couleurResto, courtNom, detailFondRecu, fmtFCFA, tauxRenta, vueGlobale } from '../lib/dashboardGlobal'
import { bandeauDeuxPeriodes, estMoisEntier, moisCouverts, periodePrecedente } from '../lib/periodeComparee'
import { supabase } from '../lib/supabase'

const { width } = Dimensions.get('window')
const CHART_WIDTH = width - 48

// Les colonnes de `points` que cet écran lit — une seule liste, trois requêtes.
const CHAMPS_POINTS = 'id, date, restaurant_id, vente_total, depense_total, benefice_sc, yango_cse, yango_tab, glovo_cse, glovo_tab, wave, om, djamo, fond_recu, fc_compte'

// Alertes et Litiges sont des listes d'événements déjà datables, pas des
// agrégats à confronter : ils restent en lecture simple sur le terme A.
const PILIERS_COMPARABLES = ['apercu', 'couts', 'clients']

const RAISON_CHARGES = 'charges du mois entier — non comparable sur une période partielle'

const PERIODES = [
  { label: "Aujourd'hui", key: 'today' },
  { label: '7 jours', key: '7days' },
  { label: 'Ce mois', key: 'month' },
  { label: 'Mois préc.', key: 'lastmonth' },
  { label: '📅 Période', key: 'custom' },
]

const PILIERS = [
  { key: 'apercu', label: '📈 Aperçu' },
  { key: 'couts', label: '📊 Coûts' },
  { key: 'clients', label: '🛵 Clients' },
  { key: 'alertes', label: '⚠️ Alertes' },
  { key: 'litiges', label: '⚖️ Litiges' },
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

  useEffect(() => { chargerRestaurants() }, [])

  useEffect(() => {
    if (restaurants.length > 0 && periodeKey !== 'custom') {
      chargerPoints(restaurants)
    }
  }, [periodeKey, restaurants])

  async function chargerRestaurants() {
    const { data } = await supabase.from('restaurants').select('id, nom, couleur').order('nom')
    if (data?.length) setRestaurants(data)
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

    const resultats = {}
    list.forEach(r => { resultats[r.id] = [] })
    ;(allPoints || []).forEach(p => {
      if (resultats[p.restaurant_id] !== undefined) resultats[p.restaurant_id].push(p)
    })
    setPoints(resultats)
    setLoading(false)
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
      const { data: ch } = await supabase
        .from('charges')
        .select('restaurant_id, libelle, montant, mois')
        .in('mois', moisListe)
      setChargesGlobal(ch || [])
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
  // Les séries indexent les jours en `x: i + 1`, pas en date : deux périodes de
  // même durée se superposent alors jour 1 contre jour 1 (§ 4.2).
  const serieMilliers = (serie, champ) => serie.map((p, i) => ({ x: i + 1, y: (p[champ] || 0) / 1000 }))
  const serieRenta = (serie) => serie.map((p, i) => ({ x: i + 1, y: p.vente_total ? (p.benefice_sc / p.vente_total * 100) : 0 }))
  const dataVentesEvo = serieMilliers(serieJours, 'vente_total')
  const dataBeneficeEvo = serieMilliers(serieJours, 'benefice_sc')
  const dataRentaEvo = serieRenta(serieJours)

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
      const { data: ch } = await supabase
        .from('charges')
        .select('restaurant_id, libelle, montant, mois')
        .in('mois', mois)
      charges = ch || []
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
      { cle: 'ventes', libelle: 'Ventes', a: A.ventes, b: B.ventes, ...commun,
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
  function fmtK(n) { return (Math.round(n) / 1000).toFixed(0) + 'k' }

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

    const resultats = {}
    restaurants.forEach(r => { resultats[r.id] = [] })
    ;(allPoints || []).forEach(p => {
      if (resultats[p.restaurant_id] !== undefined) resultats[p.restaurant_id].push(p)
    })
    setPoints(resultats); setLoading(false)
  }

  function markedDates() {
    const marked = {}
    if (dateDebut) marked[dateDebut] = { selected: true, selectedColor: '#534AB7', startingDay: true }
    if (dateFin) marked[dateFin] = { selected: true, selectedColor: '#534AB7', endingDay: true }
    if (dateDebut && dateFin) {
      let current = new Date(dateDebut); current.setDate(current.getDate() + 1)
      while (current < new Date(dateFin)) {
        const str = current.toISOString().split('T')[0]
        marked[str] = { selected: true, selectedColor: '#EEEDFE', selectedTextColor: '#3C3489' }
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

  const maxVentes = Math.max(...classement.map(r => r.ventes), 1)
  const maxBenefice = Math.max(...classement.map(r => Math.abs(r.benefice)), 1)

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
  const maxMixCanaux = Math.max(...dataMixCanauxGlobal.map(d => d.y), 1)

  // ---- Pilier 9 — Alertes (consolidé) ----
  function calculerAlertesGlobal() {
    const alertes = []
    classementCouts.forEach(r => {
      if (r.ventes > 0 && (r.foodPct > 0 || r.laborPct > 0) && r.primePct > 60) {
        alertes.push({
          type: 'danger', icon: '🔴', titre: `${r.nom} — Coût primaire élevé`,
          message: `Coût primaire à ${r.primePct.toFixed(1)}% (Matières ${r.foodPct.toFixed(1)}% + Salaire ${r.laborPct.toFixed(1)}%) — au-dessus du seuil de 60%`
        })
      }
    })
    classement.forEach(r => {
      if (r.nbJours > 0 && r.benefice < 0) {
        alertes.push({
          type: 'danger', icon: '🔴', titre: `${r.nom} — Bénéfice négatif`,
          message: `Bénéfice SC de ${fmt(r.benefice)} sur la période`
        })
      }
    })
    if (classement.length && classement[0].benefice > 0) {
      alertes.push({
        type: 'info', icon: '🏆', titre: 'Meilleur restaurant',
        message: `${classement[0].nom} en tête avec ${fmt(classement[0].benefice)} de bénéfice SC`
      })
    }
    if (!alertes.length) {
      alertes.push({ type: 'info', icon: 'ℹ️', titre: 'Aucune alerte', message: 'Aucun seuil critique franchi sur cette période.' })
    }
    return alertes
  }

  const ALERTE_COLORS = {
    danger: { bg: '#A32D2D15', border: '#A32D2D', txt: '#A32D2D' },
    warning: { bg: '#BA751715', border: '#BA7517', txt: '#854F0B' },
    ok: { bg: '#3B6D1115', border: '#3B6D11', txt: '#3B6D11' },
    info: { bg: colors.bg, border: colors.borderLight, txt: colors.textMuted },
  }


  // ── Le rendu de la comparaison ────────────────────────────────────────────
  function renderComparaison() {
    if (!compar) {
      return (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>⚖</Text>
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
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.loadingTxt}>Chargement du second terme...</Text>
        </View>
      )
    }
    if (pilier === 'couts' && chargementCouts) {
      return (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.loadingTxt}>Chargement des coûts...</Text>
        </View>
      )
    }
    // Comportement conservé de l'écran : « Aujourd'hui » n'affiche pas de coûts.
    if (pilier === 'couts' && periodeKey === 'today') {
      return (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📊</Text>
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
              l.couleur === 'bon' && { color: '#3B6D11' },
              l.couleur === 'mauvais' && { color: '#A32D2D' },
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
    const ticks = Array.from({ length: n }, (_, i) => i + 1)
    const pas = Math.max(1, Math.ceil(n / 8))
    const labels = ticks.map(t => (pas === 1 || t % pas === 1 ? `J${t}` : ''))
    const courbes = [
      { cle: 'ventes', titre: '📈 Ventes par jour (en milliers FCFA)', a: serieMilliers(sA, 'vente_total'), b: serieMilliers(sB, 'vente_total') },
      { cle: 'benefice', titre: '💰 Bénéfice SC par jour (en milliers FCFA)', a: serieMilliers(sA, 'benefice_sc'), b: serieMilliers(sB, 'benefice_sc') },
      { cle: 'renta', titre: '📉 Rentabilité par jour (%)', a: serieRenta(sA), b: serieRenta(sB) },
    ]
    return courbes.map(c => {
      // Une échelle commune aux deux courbes, sinon la comparaison est fausse.
      const ys = [...c.a, ...c.b].map(pt => pt.y)
      const bas = Math.min(0, ...ys)
      const haut = Math.max(1, ...ys)
      return (
        <View key={c.cle} style={styles.graphCard}>
          <Text style={styles.graphTitre}>{c.titre}</Text>
          <VictoryChart
            width={CHART_WIDTH} height={200} theme={VictoryTheme.material}
            padding={{ top: 20, bottom: 40, left: 50, right: 20 }}
            domain={{ y: [bas, haut] }}
          >
            <VictoryAxis tickValues={ticks} tickFormat={labels} style={{ tickLabels: { fontSize: 8, fill: '#888' } }} />
            <VictoryAxis dependentAxis style={{ tickLabels: { fontSize: 8, fill: '#888' } }} />
            <VictoryLine data={c.a} style={{ data: { stroke: compar.couleurA, strokeWidth: 2.5 } }} interpolation="monotoneX" />
            <VictoryLine data={c.b} style={{ data: { stroke: compar.couleurB, strokeWidth: 2, strokeDasharray: '4,4', opacity: compar.opaciteB } }} interpolation="monotoneX" />
          </VictoryChart>
          <View style={styles.legende}>
            <View style={styles.legendeItem}>
              <View style={[styles.legendeColor, { backgroundColor: compar.couleurA }]} />
              <Text style={styles.legendeTxt}>A · {compar.libelleA}</Text>
            </View>
            <View style={styles.legendeItem}>
              <View style={[styles.legendeColor, { backgroundColor: compar.couleurB, opacity: compar.opaciteB }]} />
              <Text style={styles.legendeTxt}>B · {compar.libelleB}</Text>
            </View>
          </View>
          <Text style={styles.graphNote}>Jour 1 contre jour 1 — {compar.nbJours} jour(s) de part et d’autre</Text>
        </View>
      )
    })
  }

  function renderClassementCompare() {
    if (compar.mode === MODE_RESTOS) {
      const deux = [compar.vueA.lignes[0], compar.vueB.lignes[0]]
        .filter(Boolean)
        .sort((x, y) => y.benefice - x.benefice)
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitre}>🏆 Classement des deux termes</Text>
          <View style={styles.classementCard}>
            {deux.map((r, i) => (
              <View key={r.id} style={[styles.classementRow, i === deux.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.classementLeft}>
                  <View style={[styles.rangBadge, i === 0 && styles.rangOr]}>
                    <Text style={styles.rangTxt}>{i === 0 ? '🥇' : '#2'}</Text>
                  </View>
                  <View style={styles.classementInfo}>
                    <Text style={styles.classementNom}>{r.nom}</Text>
                    <Text style={styles.classementJours}>
                      {r.nbJours > 0 ? `${r.nbJours}j validé(s)` : 'aucun point saisi'}
                    </Text>
                  </View>
                </View>
                <View style={styles.classementRight}>
                  <Text style={[styles.classementBenefice, { color: r.benefice >= 0 ? '#3B6D11' : '#A32D2D' }]}>{fmt(r.benefice)}</Text>
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
        <Text style={styles.sectionTitre}>🏆 Rang par bénéfice — de B vers A</Text>
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

  // Graphique barres horizontal custom
  function GraphiqueBarres({ data, max, couleurFn, labelFn, titre, unite }) {
    return (
      <View style={styles.graphCard}>
        <Text style={styles.graphTitre}>{titre}</Text>
        {data.map((item, i) => {
          const pct = max > 0 ? (Math.abs(item.valeur) / max) * 100 : 0
          return (
            <View key={i} style={styles.barRow}>
              <Text style={styles.barLabel}>{item.nom}</Text>
              <View style={styles.barTrack}>
                <View style={[
                  styles.barFill,
                  { width: `${pct}%`, backgroundColor: couleurFn(item) }
                ]} />
              </View>
              <Text style={styles.barValeur}>{labelFn(item.valeur)}</Text>
            </View>
          )
        })}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/accueil') }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Dashboard Global</Text>
          <Text style={styles.headerSub}>
            {compar
              ? `${compar.libelleA} contre ${compar.libelleB}`
              : (restoFiltre ? (restaurants.find(r => r.id === restoFiltre)?.nom || '…') : 'Tous les restaurants')}
          </Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.periodeBar}>
        {PERIODES.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodeBtn, periodeKey === p.key && styles.periodeBtnActive]}
            onPress={() => p.key === 'custom' ? ouvrirCalendrier() : setPeriodeKey(p.key)}
          >
            <Text style={[styles.periodeTxt, periodeKey === p.key && styles.periodeTxtActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.periodeBanner}>
        <Text style={styles.periodeBannerTxt}>📅 {titrePeriode()}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillsBar} contentContainerStyle={{ paddingHorizontal: 14 }}>
        {PILIERS.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.pill, pilier === p.key && styles.pillActive]}
            onPress={() => setPilier(p.key)}
          >
            <Text style={[styles.pillTxt, pilier === p.key && styles.pillTxtActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Le filtre restaurant. En mode « 2 restaurants » il cède la place aux
          sélecteurs A / B ; en mode « 2 périodes » il reste, car c'est LUI qui
          désigne le restaurant comparé à lui-même. */}
      {!(comparaisonActive && modeComparaison === MODE_RESTOS) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.restoFiltreBar} contentContainerStyle={{ paddingHorizontal: 14, alignItems: 'center' }}>
          <TouchableOpacity
            style={[styles.restoFiltreBtn, !restoFiltre && styles.restoFiltreBtnActive]}
            onPress={() => setRestoFiltre(null)}
          >
            <Text style={[styles.restoFiltreTxt, !restoFiltre && styles.restoFiltreTxtActive]}>Tous</Text>
          </TouchableOpacity>
          {restaurants.map(r => (
            <TouchableOpacity
              key={r.id}
              style={[styles.restoFiltreBtn, restoFiltre === r.id && styles.restoFiltreBtnActive, restoFiltre === r.id && { borderColor: couleurResto(r.couleur) }]}
              onPress={() => setRestoFiltre(r.id)}
            >
              <View style={[styles.restoDot, { backgroundColor: couleurResto(r.couleur) }]} />
              <Text style={[styles.restoFiltreTxt, restoFiltre === r.id && styles.restoFiltreTxtActive]}>{courtNom(r.nom)}</Text>
            </TouchableOpacity>
          ))}
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
          <ActivityIndicator size="large" color="#534AB7" />
          <Text style={styles.loadingTxt}>Chargement de tous les restaurants...</Text>
        </View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {comparaisonActive && PILIERS_COMPARABLES.includes(pilier) && renderComparaison()}
          {comparaisonActive && !PILIERS_COMPARABLES.includes(pilier) && (
            <View style={styles.comparNote}>
              <Text style={styles.comparNoteTxt}>
                Ce pilier est une liste d’événements datés, pas un total à confronter :
                il reste en lecture simple, sur la période A et le filtre restaurant courant.
              </Text>
            </View>
          )}

          {pilier === 'apercu' && !comparaisonActive && (<>
          {/* KPIs */}
          <View style={styles.kpiGrid}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Ventes totales</Text>
              <Text style={[styles.kpiValue, { color: '#BA7517' }]}>{fmt(total.ventes)}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Dépenses totales</Text>
              <Text style={[styles.kpiValue, { color: '#A32D2D' }]}>{fmt(total.depenses)}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Bénéfice SC global</Text>
              <Text style={[styles.kpiValue, { color: '#3B6D11' }]}>{fmt(total.benefice)}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Rentabilité moy.</Text>
              <Text style={[styles.kpiValue, { color: '#534AB7' }]}>
                {total.renta.toFixed(1)}%
              </Text>
            </View>
          </View>

          {/* ── ÉVOLUTION DANS LE TEMPS (courbes comme le portail gérant) — AJOUT ── */}
          {serieJours.length > 1 && (<>
            <View style={styles.graphCard}>
              <Text style={styles.graphTitre}>📈 Évolution des ventes (en milliers FCFA)</Text>
              <VictoryChart width={CHART_WIDTH} height={200} theme={VictoryTheme.material} padding={{ top: 20, bottom: 40, left: 50, right: 20 }}>
                <VictoryAxis tickValues={serieJours.map((_, i) => i + 1)} tickFormat={serieJours.map(p => axisLabelJour(p.date))} style={{ tickLabels: { fontSize: 8, fill: '#888', angle: -30 } }} />
                <VictoryAxis dependentAxis style={{ tickLabels: { fontSize: 8, fill: '#888' } }} />
                <VictoryLine data={dataVentesEvo} style={{ data: { stroke: '#EF9F27', strokeWidth: 2.5 } }} interpolation="monotoneX" />
                <VictoryLine data={dataBeneficeEvo} style={{ data: { stroke: '#3B6D11', strokeWidth: 2, strokeDasharray: '4,4' } }} interpolation="monotoneX" />
              </VictoryChart>
              <View style={styles.legende}>
                <View style={styles.legendeItem}><View style={[styles.legendeColor, { backgroundColor: '#EF9F27' }]} /><Text style={styles.legendeTxt}>Ventes</Text></View>
                <View style={styles.legendeItem}><View style={[styles.legendeColor, { backgroundColor: '#3B6D11' }]} /><Text style={styles.legendeTxt}>Bénéfice SC</Text></View>
              </View>
            </View>

            <View style={styles.graphCard}>
              <Text style={styles.graphTitre}>📊 Ventes vs Dépenses (en milliers FCFA)</Text>
              <VictoryChart width={CHART_WIDTH} height={200} theme={VictoryTheme.material} padding={{ top: 20, bottom: 40, left: 50, right: 20 }} domainPadding={{ x: 20 }}>
                <VictoryAxis tickValues={serieJours.map((_, i) => i + 1)} tickFormat={serieJours.map(p => axisLabelJour(p.date))} style={{ tickLabels: { fontSize: 8, fill: '#888', angle: -30 } }} />
                <VictoryAxis dependentAxis style={{ tickLabels: { fontSize: 8, fill: '#888' } }} />
                <VictoryBar data={serieJours.map((p, i) => ({ x: i + 1 - 0.2, y: (p.vente_total || 0) / 1000 }))} style={{ data: { fill: '#EF9F27', width: 8 } }} />
                <VictoryBar data={serieJours.map((p, i) => ({ x: i + 1 + 0.2, y: (p.depense_total || 0) / 1000 }))} style={{ data: { fill: '#A32D2D', width: 8, opacity: 0.7 } }} />
              </VictoryChart>
              <View style={styles.legende}>
                <View style={styles.legendeItem}><View style={[styles.legendeColor, { backgroundColor: '#EF9F27' }]} /><Text style={styles.legendeTxt}>Ventes</Text></View>
                <View style={styles.legendeItem}><View style={[styles.legendeColor, { backgroundColor: '#A32D2D' }]} /><Text style={styles.legendeTxt}>Dépenses</Text></View>
              </View>
            </View>

            <View style={styles.graphCard}>
              <Text style={styles.graphTitre}>📉 Évolution de la rentabilité (%)</Text>
              <VictoryChart width={CHART_WIDTH} height={200} theme={VictoryTheme.material} padding={{ top: 20, bottom: 40, left: 50, right: 20 }}>
                <VictoryAxis tickValues={serieJours.map((_, i) => i + 1)} tickFormat={serieJours.map(p => axisLabelJour(p.date))} style={{ tickLabels: { fontSize: 8, fill: '#888', angle: -30 } }} />
                <VictoryAxis dependentAxis style={{ tickLabels: { fontSize: 8, fill: '#888' } }} />
                <VictoryArea data={dataRentaEvo} style={{ data: { fill: '#185FA520', stroke: '#185FA5', strokeWidth: 2 } }} interpolation="monotoneX" />
              </VictoryChart>
            </View>

            <View style={styles.graphCard}>
              <Text style={styles.graphTitre}>🏆 Bénéfice SC par jour (en milliers FCFA)</Text>
              <VictoryChart width={CHART_WIDTH} height={200} theme={VictoryTheme.material} padding={{ top: 20, bottom: 40, left: 50, right: 20 }} domainPadding={{ x: 15 }}>
                <VictoryAxis tickValues={serieJours.map((_, i) => i + 1)} tickFormat={serieJours.map(p => axisLabelJour(p.date))} style={{ tickLabels: { fontSize: 8, fill: '#888', angle: -30 } }} />
                <VictoryAxis dependentAxis style={{ tickLabels: { fontSize: 8, fill: '#888' } }} />
                <VictoryBar data={serieJours.map((p, i) => ({ x: i + 1, y: (p.benefice_sc || 0) / 1000, fill: (p.benefice_sc || 0) >= 0 ? '#3B6D11' : '#A32D2D' }))} style={{ data: { fill: ({ datum }) => datum.fill, width: 12 } }} />
              </VictoryChart>
            </View>
          </>)}

          {/* GRAPHIQUE 1 — Ventes par restaurant */}
          <GraphiqueBarres
            titre="📊 Ventes par restaurant"
            data={classement.map(r => ({ nom: r.court, valeur: r.ventes, couleur: r.couleur }))}
            max={maxVentes}
            couleurFn={item => item.couleur}
            labelFn={v => fmtK(v)}
            unite="FCFA"
          />

          {/* GRAPHIQUE 2 — Bénéfice SC par restaurant */}
          <GraphiqueBarres
            titre="💰 Bénéfice SC par restaurant"
            data={classement.map(r => ({ nom: r.court, valeur: r.benefice, positif: r.benefice >= 0 }))}
            max={maxBenefice}
            couleurFn={item => item.positif ? '#3B6D11' : '#A32D2D'}
            labelFn={v => fmtK(v)}
            unite="FCFA"
          />

          {/* GRAPHIQUE 3 — Rentabilité par restaurant */}
          <View style={styles.graphCard}>
            <Text style={styles.graphTitre}>📈 Rentabilité par restaurant</Text>
            {classement.map((r, i) => {
              const renta = tauxRenta(r.ventes, r.benefice)
              const pct = Math.min(renta, 100)
              return (
                <View key={i} style={styles.barRow}>
                  <Text style={styles.barLabel}>{r.court}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: renta >= 20 ? '#3B6D11' : '#A32D2D' }]} />
                    <View style={[styles.barMark, { left: '20%' }]} />
                  </View>
                  <Text style={[styles.barValeur, { color: renta >= 20 ? '#3B6D11' : '#A32D2D' }]}>{renta.toFixed(1)}%</Text>
                </View>
              )
            })}
            <Text style={styles.graphNote}>Ligne = seuil 20%</Text>
            <View style={styles.legende}>
              <View style={styles.legendeItem}>
                <View style={[styles.legendeColor, { backgroundColor: '#3B6D11' }]} />
                <Text style={styles.legendeTxt}>≥ 20%</Text>
              </View>
              <View style={styles.legendeItem}>
                <View style={[styles.legendeColor, { backgroundColor: '#A32D2D' }]} />
                <Text style={styles.legendeTxt}>{'< 20%'}</Text>
              </View>
            </View>
          </View>

          {/* GRAPHIQUE 4 — Comparaison Samer vs Al Kayan */}
          <View style={styles.graphCard}>
            <Text style={styles.graphTitre}>⚖️ Samer vs Al Kayan</Text>
            {['Samer', 'Al Kayan'].map(famille => {
              const restos = classement.filter(r => r.famille === famille)
              const totalBenef = restos.reduce((s, r) => s + r.benefice, 0)
              const totalVent = restos.reduce((s, r) => s + r.ventes, 0)
              const renta = tauxRenta(totalVent, totalBenef)
              const couleur = famille === 'Samer' ? '#EF9F27' : '#2D7D46'
              const maxGlobal = Math.max(
                classement.filter(r => r.famille === 'Samer').reduce((s, r) => s + r.benefice, 0),
                classement.filter(r => r.famille === 'Al Kayan').reduce((s, r) => s + r.benefice, 0),
                1
              )
              const pct = (Math.abs(totalBenef) / maxGlobal) * 100
              return (
                <View key={famille} style={styles.familleGraphRow}>
                  <View style={[styles.famillePuce, { backgroundColor: couleur }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.familleGraphNom}>{famille}</Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: couleur }]} />
                    </View>
                    <Text style={styles.familleGraphSub}>
                      BSC: {fmt(totalBenef)} | Renta: {renta.toFixed(1)}%
                    </Text>
                  </View>
                </View>
              )
            })}
          </View>

          {/* Classement */}
          <View style={styles.section}>
            <Text style={styles.sectionTitre}>🏆 Classement par bénéfice SC</Text>
            <View style={styles.classementCard}>
              {classement.map((r, i) => (
                <View key={r.id} style={[styles.classementRow, i === classement.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={styles.classementLeft}>
                    <View style={[styles.rangBadge, i === 0 && styles.rangOr, i === 1 && styles.rangArgent, i === 2 && styles.rangBronze]}>
                      <Text style={styles.rangTxt}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</Text>
                    </View>
                    <View style={styles.classementInfo}>
                      <Text style={styles.classementNom}>{r.nom}</Text>
                      <View style={styles.classementBadgeRow}>
                        <View style={[styles.familleBadge, { backgroundColor: r.famille === 'Samer' ? '#FAEEDA' : '#EAF3DE' }]}>
                          <Text style={[styles.familleTxt, { color: r.famille === 'Samer' ? '#854F0B' : '#3B6D11' }]}>{r.famille}</Text>
                        </View>
                        <Text style={styles.classementJours}>{r.nbJours}j validé(s)</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.classementRight}>
                    <Text style={[styles.classementBenefice, { color: r.benefice >= 0 ? '#3B6D11' : '#A32D2D' }]}>{fmt(r.benefice)}</Text>
                    <Text style={styles.classementVentes}>{fmt(r.ventes)}</Text>
                    <Text style={[styles.classementRenta, { color: tauxRenta(r.ventes, r.benefice) >= 20 ? '#3B6D11' : '#888' }]}>
                      {tauxRenta(r.ventes, r.benefice).toFixed(1)}%
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* Comparaison familles */}
          <View style={styles.section}>
            <Text style={styles.sectionTitre}>Récapitulatif par famille</Text>
            <View style={styles.familleCompare}>
              <View style={[styles.familleBox, { borderColor: '#FAC775' }]}>
                <Text style={styles.familleTitre}>🟡 Samer</Text>
                <Text style={styles.familleValeur}>
                  {fmt(classement.filter(r => r.famille === 'Samer').reduce((sum, r) => sum + r.benefice, 0))}
                </Text>
                <Text style={styles.familleSub}>Bénéfice SC</Text>
                <Text style={styles.familleVenteVal}>
                  {fmt(classement.filter(r => r.famille === 'Samer').reduce((sum, r) => sum + r.ventes, 0))}
                </Text>
                <Text style={styles.familleSub}>Ventes</Text>
              </View>
              <View style={[styles.familleBox, { borderColor: '#C0DD97' }]}>
                <Text style={styles.familleTitre}>🟢 Al Kayan</Text>
                <Text style={[styles.familleValeur, { color: '#3B6D11' }]}>
                  {fmt(classement.filter(r => r.famille === 'Al Kayan').reduce((sum, r) => sum + r.benefice, 0))}
                </Text>
                <Text style={styles.familleSub}>Bénéfice SC</Text>
                <Text style={styles.familleVenteVal}>
                  {fmt(classement.filter(r => r.famille === 'Al Kayan').reduce((sum, r) => sum + r.ventes, 0))}
                </Text>
                <Text style={styles.familleSub}>Ventes</Text>
              </View>
            </View>
          </View>

          {/* Récapitulatif global */}
          <View style={styles.section}>
            <Text style={styles.sectionTitre}>Récapitulatif global</Text>
            <View style={styles.recapCard}>
              <View style={styles.recapRow}><Text style={styles.recapLabel}>Total ventes</Text><Text style={styles.recapValue}>{fmt(total.ventes)}</Text></View>
              <View style={styles.recapRow}><Text style={styles.recapLabel}>Total dépenses</Text><Text style={[styles.recapValue, { color: '#A32D2D' }]}>{fmt(total.depenses)}</Text></View>
              <View style={[styles.recapRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.recapLabel, { fontWeight: '600', color: '#1a1a1a' }]}>Bénéfice SC global</Text>
                <Text style={[styles.recapValue, { color: '#3B6D11', fontWeight: '600', fontSize: 16 }]}>{fmt(total.benefice)}</Text>
              </View>
            </View>
          </View>
          </>)}

          {/* Pilier 2 — Structure des coûts (consolidé) */}
          {pilier === 'couts' && !comparaisonActive && (
            chargementCouts ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color="#534AB7" />
                <Text style={styles.loadingTxt}>Chargement des coûts...</Text>
              </View>
            ) : caGlobal <= 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyIcon}>📊</Text>
                <Text style={styles.emptyTxt}>Aucune donnée de vente sur cette période</Text>
              </View>
            ) : (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitre}>Structure des coûts — tous restaurants</Text>
                  <View style={styles.resultCard}>
                    <JaugeCout label="Coût matières" pct={foodCostGlobalPct} montant={foodCostGlobalMt} seuil={30} colors={colors} fmt={fmt} />
                    <JaugeCout label="Coût du salaire" pct={laborCostGlobalPct} montant={laborCostGlobalMt} seuil={30} colors={colors} fmt={fmt} />
                    <JaugeCout label="Coût primaire" pct={primeCostGlobalPct} montant={foodCostGlobalMt + laborCostGlobalMt} seuil={60} colors={colors} fmt={fmt} accent />
                    {aDesChargesConfigurees ? (
                      <JaugeCout label="Charges fixes" pct={chargesFixesGlobalPct} montant={chargesFixesGlobalMt} seuil={20} colors={colors} fmt={fmt} dernier />
                    ) : (
                      <TouchableOpacity style={styles.chargesEmptyRow} onPress={() => router.push('/charges')}>
                        <Text style={styles.chargesEmptyTxt}>Charges fixes non configurées pour cette période</Text>
                        <Text style={styles.chargesEmptyLink}>Configurer ›</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitre}>🏆 Classement par Coût primaire</Text>
                  <View style={styles.classementCard}>
                    {classementCouts.map((r, i) => (
                      <View key={r.id} style={[styles.classementRow, i === classementCouts.length - 1 && { borderBottomWidth: 0 }]}>
                        <View style={styles.classementLeft}>
                          <View style={styles.rangBadge}>
                            <Text style={styles.rangTxt}>#{i + 1}</Text>
                          </View>
                          <View style={styles.classementInfo}>
                            <Text style={styles.classementNom}>{r.nom}</Text>
                            <Text style={styles.classementJours}>Matières {r.foodPct.toFixed(1)}% · Salaire {r.laborPct.toFixed(1)}%</Text>
                          </View>
                        </View>
                        <Text style={[styles.classementBenefice, { color: r.primePct > 60 ? '#A32D2D' : '#3B6D11' }]}>
                          {r.ventes > 0 ? `${r.primePct.toFixed(1)}%` : '—'}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitre}>💵 Fond de caisse reçu — {titrePeriode()}</Text>
                  <View style={styles.resultCard}>
                    {[...vue.lignes].sort((a, b) => b.fondRecu - a.fondRecu).map(r => {
                      const ouvert = fondOuvert === r.id
                      const deroulable = r.joursFondRecu > 0
                      return (
                        <View key={r.id}>
                          <TouchableOpacity
                            style={styles.resultRow}
                            disabled={!deroulable}
                            onPress={() => setFondOuvert(ouvert ? null : r.id)}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.resultLabel}>{deroulable ? (ouvert ? '▾ ' : '▸ ') : ''}{r.nom}</Text>
                              <Text style={styles.classementJours}>
                                {r.nbJours === 0 ? 'Aucun point saisi' : `${r.joursFondRecu} jour${r.joursFondRecu > 1 ? 's' : ''} sur ${r.nbJours}`}
                              </Text>
                            </View>
                            <Text style={[styles.resultValue, { color: '#534AB7' }]}>
                              {r.nbJours === 0 ? '—' : fmt(r.fondRecu)}
                            </Text>
                          </TouchableOpacity>
                          {ouvert && detailFondRecu(points[r.id]).map(j => (
                            <View key={j.date} style={[styles.resultRow, { paddingLeft: 16 }]}>
                              <Text style={styles.resultLabel}>{formatDateLongue(j.date)}</Text>
                              <Text style={[styles.resultValue, { color: '#534AB7' }]}>{fmt(j.montant)}</Text>
                            </View>
                          ))}
                        </View>
                      )
                    })}
                    <View style={[styles.resultRow, { borderBottomWidth: 0 }]}>
                      <Text style={[styles.resultLabel, { fontWeight: '600', color: colors.text }]}>Total</Text>
                      <Text style={[styles.resultValue, { color: '#534AB7', fontWeight: '700' }]}>{fmt(total.fondRecu)}</Text>
                    </View>
                  </View>
                </View>
              </>
            )
          )}

          {/* Pilier 7 — Comportement clients (consolidé) */}
          {pilier === 'clients' && !comparaisonActive && (
            caGlobal <= 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyIcon}>🛵</Text>
                <Text style={styles.emptyTxt}>Aucune donnée de vente sur cette période</Text>
              </View>
            ) : (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitre}>Livraison vs sur place — tous restaurants</Text>
                  <View style={styles.resultCard}>
                    <View style={styles.resultRow}>
                      <Text style={styles.resultLabel}>🛵 Livraison (Yango/Glovo)</Text>
                      <Text style={[styles.resultValue, { color: '#EF9F27' }]}>
                        {fmt(livraisonGlobalMt)} ({pctLivraisonGlobal.toFixed(0)}%)
                      </Text>
                    </View>
                    <View style={[styles.resultRow, { borderBottomWidth: 0 }]}>
                      <Text style={styles.resultLabel}>🍽️ Sur place / autres canaux</Text>
                      <Text style={[styles.resultValue, { color: '#185FA5' }]}>
                        {fmt(surPlaceGlobalMt)} ({(100 - pctLivraisonGlobal).toFixed(0)}%)
                      </Text>
                    </View>
                  </View>
                </View>

                {dataMixCanauxGlobal.length > 0 && (
                  <GraphiqueBarres
                    titre={`🥧 Mix des canaux de vente — ${titrePeriode()}`}
                    data={dataMixCanauxGlobal.map((d, i) => ({ nom: d.x, valeur: d.y, couleur: PIE_COLORS[i] }))}
                    max={maxMixCanaux}
                    couleurFn={item => item.couleur}
                    labelFn={v => fmtK(v)}
                  />
                )}
              </>
            )
          )}

          {/* Pilier 9 — Alertes (consolidé) */}
          {pilier === 'alertes' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitre}>Alertes — {titrePeriode()}</Text>
              {calculerAlertesGlobal().map((a, i) => {
                const c = ALERTE_COLORS[a.type]
                return (
                  <View key={i} style={[styles.alerteCard, { backgroundColor: c.bg, borderColor: c.border }]}>
                    <Text style={styles.alerteIcon}>{a.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.alerteTitre, { color: c.txt }]}>{a.titre}</Text>
                      <Text style={styles.alerteMsg}>{a.message}</Text>
                    </View>
                  </View>
                )
              })}
            </View>
          )}

          {/* Pilier Litiges — carte récap */}
          {pilier === 'litiges' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitre}>Litiges & écarts</Text>
              <View style={styles.litigesCard}>
                <Text style={styles.litigesIcon}>⚖️</Text>
                <Text style={styles.litigesTxt}>
                  Le rapport complet des litiges (avis clients, Yango, Glovo, points non faits, écarts de caisse),
                  consolidé pour tous les restaurants avec filtres par période et export PDF, est disponible
                  dans l&apos;écran dédié.
                </Text>
                <TouchableOpacity style={styles.litigesBtn} onPress={() => router.push('/litiges')}>
                  <Text style={styles.litigesBtnTxt}>Voir le rapport complet ›</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={{ height: 30 }} />
        </ScrollView>
      )}

      <Modal visible={modalCalendrier} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitre}>Choisir une période</Text>
              <TouchableOpacity onPress={() => setModalCalendrier(false)}>
                <Text style={styles.modalClose}>✕</Text>
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
                <Text style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Début</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: dateDebut ? '#1a1a1a' : '#ccc' }}>
                  {dateDebut ? formatDate(dateDebut) : 'Non sélectionné'}
                </Text>
              </View>
              <Text style={{ fontSize: 16, color: '#534AB7', marginHorizontal: 8 }}>→</Text>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>Fin</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: dateFin ? '#1a1a1a' : '#ccc' }}>
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
                selectedDayBackgroundColor: '#534AB7',
                selectedDayTextColor: '#fff',
                todayTextColor: '#534AB7',
                dayTextColor: '#1a1a1a',
                textDisabledColor: '#ccc',
                arrowColor: '#534AB7',
                monthTextColor: '#1a1a1a',
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
  const couleur = accent ? (ok ? '#3B6D11' : '#A32D2D') : (ok ? '#3B6D11' : '#BA7517')
  const largeur = Math.min(pct, 100)
  return (
    <View style={[jaugeStyles.row, dernier && { borderBottomWidth: 0 }]}>
      <View style={jaugeStyles.head}>
        <Text style={[jaugeStyles.label, { color: colors.text }]}>{label}</Text>
        <Text style={[jaugeStyles.value, { color: couleur }]}>
          {pct.toFixed(1)}% · {fmt(montant)}
        </Text>
      </View>
      <View style={[jaugeStyles.barBg, { backgroundColor: colors.bg }]}>
        <View style={[jaugeStyles.barFill, { width: `${largeur}%`, backgroundColor: couleur }]} />
      </View>
      <Text style={[jaugeStyles.seuil, { color: colors.textMuted }]}>Seuil indicatif : {seuil}%</Text>
    </View>
  )
}

const jaugeStyles = StyleSheet.create({
  row: { paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#88888830' },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  value: { fontSize: 12, fontWeight: '600' },
  barBg: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  seuil: { fontSize: 10, marginTop: 4 },
})

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface, textAlign: 'center' },
  headerSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
  periodeBar: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  periodeBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  periodeBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  periodeTxt: { fontSize: 13, color: colors.textMuted },
  periodeTxtActive: { color: colors.primary, fontWeight: '600' },
  periodeBanner: { backgroundColor: colors.primaryLight, padding: 10, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: colors.primaryText },
  periodeBannerTxt: { fontSize: 13, color: colors.primaryDark, fontWeight: '500' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  kpiCard: { width: (width - 44) / 2, backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: colors.borderLight },
  kpiLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 6 },
  kpiValue: { fontSize: 14, fontWeight: '600' },
  graphCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: colors.borderLight },
  graphTitre: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 12 },
  graphNote: { fontSize: 10, color: '#aaa', textAlign: 'center', marginTop: 4 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  barLabel: { fontSize: 11, color: colors.textSecondary, width: 60 },
  barTrack: { flex: 1, height: 14, backgroundColor: colors.bg, borderRadius: 7, overflow: 'hidden', marginHorizontal: 8, position: 'relative' },
  barFill: { height: '100%', borderRadius: 7 },
  barMark: { position: 'absolute', top: 0, bottom: 0, width: 1.5, backgroundColor: '#ccc' },
  barValeur: { fontSize: 11, fontWeight: '600', color: colors.text, width: 40, textAlign: 'right' },
  legende: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 8 },
  legendeItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendeColor: { width: 12, height: 12, borderRadius: 3 },
  legendeTxt: { fontSize: 11, color: colors.textMuted },
  familleGraphRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  famillePuce: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  familleGraphNom: { fontSize: 12, fontWeight: '600', color: colors.text, marginBottom: 4 },
  familleGraphSub: { fontSize: 10, color: colors.textMuted, marginTop: 4 },
  section: { marginBottom: 14 },
  sectionTitre: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  classementCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: colors.borderLight },
  classementRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: colors.bg },
  classementLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rangBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  rangOr: { backgroundColor: '#FFF3CC' },
  rangArgent: { backgroundColor: colors.borderLight },
  rangBronze: { backgroundColor: '#FAE8DC' },
  rangTxt: { fontSize: 14 },
  classementInfo: { flex: 1 },
  classementNom: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 3 },
  classementBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  familleBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  familleTxt: { fontSize: 9, fontWeight: '500' },
  classementJours: { fontSize: 10, color: '#bbb' },
  classementRight: { alignItems: 'flex-end' },
  classementBenefice: { fontSize: 14, fontWeight: '600' },
  classementVentes: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  classementRenta: { fontSize: 10, marginTop: 1 },
  familleCompare: { flexDirection: 'row', gap: 10 },
  familleBox: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1.5, alignItems: 'center' },
  familleTitre: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8 },
  familleValeur: { fontSize: 15, fontWeight: '600', color: '#BA7517' },
  familleSub: { fontSize: 10, color: colors.textMuted, marginBottom: 6 },
  familleVenteVal: { fontSize: 13, fontWeight: '500', color: colors.text },
  recapCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: colors.borderLight },
  recapRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.bg },
  recapLabel: { fontSize: 13, color: colors.textMuted },
  recapValue: { fontSize: 13, fontWeight: '500', color: colors.text },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitre: { fontSize: 18, fontWeight: '600', color: colors.text },
  modalClose: { fontSize: 18, color: colors.textMuted },
  etapeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  etapeBadge: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: colors.bg, alignItems: 'center' },
  etapeBadgeActive: { backgroundColor: colors.primary },
  etapeTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  etapeTxtActive: { color: colors.surface },
  etapeLine: { width: 20, height: 1, backgroundColor: colors.borderLight, marginHorizontal: 4 },
  selectedDates: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderRadius: 12, padding: 12, marginBottom: 14 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: colors.textMuted },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: colors.surface },

  pillsBar: { backgroundColor: colors.bg, maxHeight: 44 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, marginRight: 8, marginVertical: 6,
    backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.borderLight
  },
  pillActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  pillTxt: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  pillTxtActive: { color: '#fff', fontWeight: '700' },

  restoFiltreBar: { backgroundColor: colors.bg, maxHeight: 40, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  restoFiltreBtn: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 14, marginRight: 6, marginVertical: 5,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
  },
  restoFiltreBtnActive: { backgroundColor: colors.bg, borderWidth: 1.5 },
  restoDot: { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  restoFiltreTxt: { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  restoFiltreTxtActive: { fontWeight: '700', color: colors.text },

  syntheseCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 14,
    borderLeftWidth: 4, borderLeftColor: '#534AB7',
    borderTopWidth: 0.5, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: colors.borderLight,
  },
  synthesePhrase: { fontSize: 14, fontWeight: '600', color: colors.text, lineHeight: 20, marginBottom: 8 },
  syntheseLigne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  syntheseLibelle: { fontSize: 12, color: colors.textSecondary, flex: 1, marginRight: 8 },
  syntheseEcart: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  comparNote: {
    backgroundColor: colors.primaryLight, borderRadius: 12, padding: 12, marginBottom: 14,
  },
  comparNoteTxt: { fontSize: 12, color: colors.primaryDark, lineHeight: 18 },
  classementRangCompare: { fontSize: 12, fontWeight: '600', color: colors.text },

  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },

  resultCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: colors.borderLight },
  resultRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  resultLabel: { fontSize: 13, color: colors.textMuted },
  resultValue: { fontSize: 13, fontWeight: '500', color: colors.text },

  chargesEmptyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  chargesEmptyTxt: { fontSize: 12, color: colors.textMuted, flex: 1, marginRight: 8 },
  chargesEmptyLink: { fontSize: 12, fontWeight: '600', color: '#534AB7' },

  alerteCard: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10
  },
  alerteIcon: { fontSize: 20 },
  alerteTitre: { fontSize: 13, fontWeight: '700', marginBottom: 3 },
  alerteMsg: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },

  litigesCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 18,
    borderWidth: 0.5, borderColor: colors.borderLight, alignItems: 'center'
  },
  litigesIcon: { fontSize: 32, marginBottom: 10 },
  litigesTxt: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 14 },
  litigesBtn: { backgroundColor: '#534AB7', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
  litigesBtnTxt: { fontSize: 13, fontWeight: '700', color: '#fff' },
}) }
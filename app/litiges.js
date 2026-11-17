import { retour } from '../lib/navigation'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, Modal, Platform, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import ChampDate, { CalendrierFr, CalendrierPeriode } from '../components/ChampDate'
import PhotoJustificatif from '../components/PhotoJustificatif'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { compterLitigesStockEnAttente } from '../lib/correctionStockInitial'
import { useFocusRecherche } from '../lib/useFocusRecherche'
import { CATEGORIES_INVENTAIRE } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { annulerDeductionInventaire } from '../lib/api'
import {
  calculerLitigeContact, chargerPointsContact, compterContacts,
  chargerRestaurantsContact, choisirNombreContacts, contactsViennentDuPOS,
  corrigerNbCommandes, forcerLitigeContact,
} from '../lib/litigeContacts'
import { detailContactsParCaissier, repartirLitigeContacts, totauxLitigeContactsParCaissier } from '../lib/contactsParCaissier'
import { PLAFOND_COMPTAGE } from '../lib/deductionsVerification'
import {
  responsablesEcartPOS, fusionnerResponsablesEcart, SOURCE_DECISION_POS, ecartJourPOS,
} from '../lib/ecartPOS'
import { caissierAuMoment, normaliserHeure, phraseAttribution } from '../lib/attributionAvis'
import { chargerLitigesRestaurant, chargerShiftsEcart } from '../lib/litigesGlobal'
import { restoSansLitige, totauxParCaissier } from '../lib/litigesResume'
import { exporterPdf } from '../lib/pdfDocuments'
import { usePhoto } from '../lib/usePhoto'
import { detailApresChoix, estChoisi, personnesParGroupe } from '../lib/responsablesLitige'

function fmt(n) { return Math.round(n || 0).toLocaleString('fr-FR') + ' FCFA' }
function fmtShort(n) { return Math.round(n || 0).toLocaleString('fr-FR') }

const TODAY = new Date().toISOString().split('T')[0]
const HIER = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]

// « 1 jour » et « Hier » portent sur une seule journée : même affichage détaillé.
const unSeulJour = periodeKey => periodeKey === '1jour' || periodeKey === 'hier'

const PERIODES = [
  { key: '1jour', label: '1 jour' },
  { key: 'hier', label: 'Hier' },
  { key: 'semaine', label: '7 jours' },
  { key: 'mois', label: 'Ce mois' },
  { key: 'mois_prec', label: 'Mois préc.' },
  { key: 'perso', label: 'Perso' },
]

const ONGLETS = [
  { key: 'ecarts', label: 'Écarts' },
  { key: 'inventaire', label: 'Inventaire' },
  { key: 'avis', label: 'Avis clients' },
  { key: 'yango', label: 'Yango' },
  { key: 'glovo', label: 'Glovo' },
  { key: 'contact', label: 'Contacts' },
  { key: 'point_pas_fait', label: 'Point pas fait' },
  // Tous les litiges du restaurant sur la période, comme la vue « Tous les restaurants ».
  { key: 'tout', label: 'Tout' },
]

const TYPES_AVIS = [
  { key: 'mauvais', label: 'Mauvais avis', court: 'Mauvais', montant: 1000, couleur: '#C62828' },
  { key: 'bon', label: 'Bon avis', court: 'Bon', montant: -500, couleur: '#2E7D32' },
  // Neutre : on garde la trace de l'avis sans impact financier (ni sanction,
  // ni récompense). Le montant reste 0 dans tous les totaux.
  { key: 'neutre', label: 'Avis neutre', court: 'Neutre', montant: 0, couleur: '#78716C' },
]
function typeAvis(key) { return TYPES_AVIS.find(t => t.key === key) }
// Rouge = à la charge du resto, vert = en sa faveur, gris = sans impact
function couleurMontant(m, colors) {
  return m > 0 ? (colors?.error || '#C62828') : m < 0 ? (colors?.successDark || '#2E7D32') : (colors?.textMuted || '#78716C')
}
// Canal du client à l'origine de l'avis
const CANAUX_AVIS = [
  { key: 'sur_place', label: 'Sur place', court: 'Sur place', couleur: '#185FA5' },
  { key: 'yango', label: 'Yango', court: 'Yango', couleur: '#EF9F27' },
  { key: 'glovo', label: 'Glovo', court: 'Glovo', couleur: '#2E7D32' },
]
function canalAvis(key) { return CANAUX_AVIS.find(c => c.key === key) }
const TYPES_YANGO = [
  { key: 'tape_moins', label: 'Tapé −', couleur: '#C62828' },
  { key: 'tape_plus', label: 'Tapé +', couleur: '#2E7D32' },
]
const TYPES_GLOVO = [
  { key: 'tape_moins', label: 'Tapé −', couleur: '#C62828' },
  { key: 'tape_plus', label: 'Tapé +', couleur: '#2E7D32' },
  { key: 'remboursement', label: 'Remboursement', couleur: '#185FA5' },
  { key: 'temps_attente', label: 'Temps attente', couleur: '#F59E0B' },
]

// Map produit_id → nom de catégorie
const PRODUIT_TO_CAT = {}
CATEGORIES_INVENTAIRE.forEach(cat => {
  cat.produits.forEach(p => { PRODUIT_TO_CAT[p.id] = cat.nom })
})

const SHIFT_LABELS = {
  matin: 'Matin',
  soir: 'Soir',
  nuit: 'Nuit',
  double: 'Double',
  personnalise: 'Perso',
}

function getPlage(periodeKey, dateUnique, dateDebut, dateFin) {
  if (periodeKey === '1jour') return { debut: dateUnique, fin: dateUnique }
  if (periodeKey === 'hier') return { debut: HIER, fin: HIER }
  if (periodeKey === 'semaine') {
    const d = new Date()
    d.setDate(d.getDate() - 6)
    return { debut: d.toISOString().split('T')[0], fin: TODAY }
  }
  if (periodeKey === 'mois') {
    const now = new Date()
    const debut = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    return { debut, fin: TODAY }
  }
  if (periodeKey === 'mois_prec') {
    const firstOfThisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const lastOfPrev = new Date(firstOfThisMonth - 1)
    const firstOfPrev = new Date(lastOfPrev.getFullYear(), lastOfPrev.getMonth(), 1)
    return {
      debut: firstOfPrev.toISOString().split('T')[0],
      fin: lastOfPrev.toISOString().split('T')[0],
    }
  }
  return { debut: dateDebut, fin: dateFin }
}

function formDateDefaut(periodeKey, dateUnique) {
  if (periodeKey === 'hier') return HIER
  return periodeKey === '1jour' ? dateUnique : TODAY
}

export default function LitigesScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { userNom, userId, roleActif, restaurantId } = useApp()
  const isGerant = roleActif === 'gerant'
  const peutRegulariser = roleActif === 'manager' || roleActif === 'directeur'
  const { prendrePhoto, choisirPhoto } = usePhoto()
  // Ouvert depuis la recherche globale : restaurant, jour, onglet et litige.
  const params = useLocalSearchParams()
  const dateRecherche = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null
  const focus = useFocusRecherche(params.focus)

  // ── Restaurant ──────────────────────────────────────────────
  const [restaurants, setRestaurants] = useState([])
  const [restoSelectionne, setRestoSelectionne] = useState(null)
  const [litigesStock, setLitigesStock] = useState(0)
  const [showRestoPicker, setShowRestoPicker] = useState(false)

  // ── Période ─────────────────────────────────────────────────
  const [periodeKey, setPeriodeKey] = useState('1jour')
  const [dateUnique, setDateUnique] = useState(dateRecherche || TODAY)
  const [dateDebut, setDateDebut] = useState(TODAY)
  const [dateFin, setDateFin] = useState(TODAY)
  const [showCalUnique, setShowCalUnique] = useState(false)
  const [showCalDebut, setShowCalDebut] = useState(false)
  // Période perso en cours de choix, appliquée quand elle est complète.
  const [brouillonPerso, setBrouillonPerso] = useState({ debut: '', fin: '' })
  const [datesAvec, setDatesAvec] = useState({})

  // ── Mode global (tous restaurants) ──────────────────────────
  const [modeGlobal, setModeGlobal] = useState(false)
  const [donneesGlobales, setDonneesGlobales] = useState([])
  // Onglet « Tout » : la même carte que la vue globale, pour le restaurant choisi.
  const [donneesResto, setDonneesResto] = useState(null)
  // Comptages du vérificateur pour le restaurant sélectionné (vue mono-resto)
  const [deducVerifResto, setDeducVerifResto] = useState([])
  const [generatingPdf, setGeneratingPdf] = useState(false)

  // ── UI ───────────────────────────────────────────────────────
  const [onglet, setOnglet] = useState(['glovo', 'yango', 'avis', 'point_pas_fait'].includes(params.onglet) ? params.onglet : 'ecarts')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // Shifts servant à retrouver le caissier présent à l'heure d'un avis (lib/attributionAvis.js).
  const [shiftsAvis, setShiftsAvis] = useState([])
  const [attributionEnCours, setAttributionEnCours] = useState(false)
  const [confirmSuppr, setConfirmSuppr] = useState(null)
  // Litiges Yango/Glovo automatiques : journées dont des plats ne sont pas
  // encore reliés au POS, et détail déplié d'une ligne.
  const [aRelier, setARelier] = useState(0)
  // Erreurs de saisie (mauvais plat tapé sur la même commande) : jamais un
  // litige, seulement signalées. { yango: [...], glovo: [...] }
  const [erreursSaisie, setErreursSaisie] = useState({ yango: [], glovo: [] })
  const [detailOuvert, setDetailOuvert] = useState(null)
  const [saveError, setSaveError] = useState(null)

  // ── Volet 1 — écarts ────────────────────────────────────────
  const [ecartsListe, setEcartsListe] = useState([])
  const [expandedEcart, setExpandedEcart] = useState(null)  // date du jour déplié en vue période

  // ── Responsables des écarts (table litiges_responsables) ────
  const [responsablesListe, setResponsablesListe] = useState([])
  // Responsables DÉDUITS des shifts POS (jamais écrits en base, recalculés à
  // chaque lecture — cf. lib/ecartPOS.js). Sur un site basculé, la caisse a
  // déjà mesuré l'écart de chaque caissière au comptage à l'aveugle : le
  // gérant n'a plus à désigner qui que ce soit dans l'écran Ventes.
  const [responsablesPOS, setResponsablesPOS] = useState([])
  const [filtreType, setFiltreType] = useState('tous')        // 'tous' | 'manquant' | 'surplus'
  const [filtreResponsable, setFiltreResponsable] = useState(null)

  // ── Régularisation d'écart (manager/directeur) ──────────────
  const [regulPoint, setRegulPoint] = useState(null)
  const [regulMontant, setRegulMontant] = useState('')
  const [regulMotif, setRegulMotif] = useState('')
  const [regulPhotos, setRegulPhotos] = useState([])
  const [regulSaving, setRegulSaving] = useState(false)
  const [regulUploading, setRegulUploading] = useState(false)

  // ── Volet 2 — inventaire ────────────────────────────────────
  const [inventaireShifts, setInventaireShifts] = useState([])
  const [annulDeducSaving, setAnnulDeducSaving] = useState(null)  // id de la ligne en cours d'annulation

  // ── Volet 3 — avis clients ──────────────────────────────────
  const [avisClients, setAvisClients] = useState([])
  const [showFormAvis, setShowFormAvis] = useState(false)
  const [formAvis, setFormAvis] = useState({ type: 'mauvais', canal: 'sur_place', notes: '', numero_commande: '', date_saisie: TODAY, heure: '', id: null })

  // ── Volet 4 — Yango ─────────────────────────────────────────
  const [litigesYango, setLitigesYango] = useState([])
  const [showFormYango, setShowFormYango] = useState(false)
  const [formYango, setFormYango] = useState({ type: 'tape_moins', montant: '', notes: '', numero_commande: '', date_saisie: TODAY, id: null })

  // ── Volet 5 — Glovo ─────────────────────────────────────────
  const [litigesGlovo, setLitigesGlovo] = useState([])
  const [showFormGlovo, setShowFormGlovo] = useState(false)
  const [formGlovo, setFormGlovo] = useState({ type: 'tape_moins', montant: '', notes: '', numero_commande: '', date_saisie: TODAY, id: null })

  // ── Volet 6 — Écart Contact ──────────────────────────────────
  const [ecartContacts, setEcartContacts] = useState([])
  // Corrections manager/directeur (voir lib/litigeContacts.js)
  const [corrCmd, setCorrCmd] = useState(null)          // ligne ciblée : nb de commandes
  const [corrCmdForm, setCorrCmdForm] = useState({ yango: '', glovo: '', motif: '' })
  const [corrLitige, setCorrLitige] = useState(null)    // ligne ciblée : montant du litige
  const [corrLitigeForm, setCorrLitigeForm] = useState({ montant: '', motif: '' })
  const [corrSaving, setCorrSaving] = useState(false)
  const [corrError, setCorrError] = useState('')

  // ── Volet 7 — Point pas fait ─────────────────────────────────
  const [litigesPointPasFait, setLitigesPointPasFait] = useState([])
  const [showFormPPF, setShowFormPPF] = useState(false)
  const [formPPF, setFormPPF] = useState({ responsable_id: null, responsable_nom: '', montant: '', notes: '', date_saisie: TODAY, id: null })

  // ── Utilisateurs + équipe du restaurant (pour picker responsable) ─────
  const [utilisateurs, setUtilisateurs] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [rechercheResp, setRechercheResp] = useState('')
  // Litige automatique dont on change le responsable : { table, litige, responsable_id, responsable_nom }
  const [respAuto, setRespAuto] = useState(null)

  const plage = useMemo(
    () => getPlage(periodeKey, dateUnique, dateDebut, dateFin),
    [periodeKey, dateUnique, dateDebut, dateFin]
  )

  useEffect(() => { chargerRestaurants() }, [])

  useEffect(() => {
    if (modeGlobal) chargerTousRestaurants()
    else if (restoSelectionne) chargerTout()
  }, [modeGlobal, restoSelectionne, plage])

  async function chargerRestaurants() {
    const data = await chargerRestaurantsContact()
    setRestaurants(data || [])
    if (data?.length) {
      if (isGerant && restaurantId) {
        const monResto = data.find(r => r.id === restaurantId) || data[0]
        setRestoSelectionne(monResto)
        chargerDatesAvec(monResto.id)
        chargerUtilisateurs(monResto.id)
      } else {
        const initial = data.find(r => r.id === params.restaurant_id) || data[0]
        setRestoSelectionne(initial)
        chargerDatesAvec(initial.id)
        chargerUtilisateurs(initial.id)
      }
    }
  }

  async function chargerUtilisateurs(restoId) {
    const { data } = await supabase
      .from('utilisateurs').select('id, nom, role')
      .eq('restaurant_id', restoId).eq('actif', true).order('nom')
    setUtilisateurs(data || [])
    // Toute l'équipe (cuisiniers, gérant…) : un litige n'est pas toujours la
    // faute du caissier (remboursement d'un plat raté, etc.).
    const { data: equipe } = await supabase
      .from('travailleurs').select('id, nom, poste')
      .eq('restaurant_id', restoId).eq('actif', true).order('nom')
    setTravailleurs(equipe || [])
  }

  async function chargerDatesAvec(restoId) {
    const { data } = await supabase.from('points').select('date').eq('restaurant_id', restoId)
    const marked = {}
    ;(data || []).forEach(p => { marked[p.date] = { marked: true, dotColor: colors.primary } })
    setDatesAvec(marked)
  }

  async function chargerTout() {
    if (!restoSelectionne) return
    setLoading(true)
    compterLitigesStockEnAttente(restoSelectionne.id).then(setLitigesStock)
    await Promise.all([chargerDonneesResto(), chargerEcarts(), chargerResponsables(), chargerInventaire(), chargerAvis(), chargerYango(), chargerGlovo(), chargerEcartContacts(), chargerPointPasFait(), chargerDeducVerifResto(), chargerARelier(), chargerErreursSaisie()])
    setLoading(false)
  }

  async function chargerDonneesResto() {
    const resto = restoSelectionne
    const d = await chargerLitigesRestaurant(resto, plage.debut, plage.fin).catch(() => null)
    // Le restaurant a pu changer pendant le chargement : on garde la bonne carte.
    setDonneesResto(d && d.restaurant.id === resto.id ? d : null)
  }

  async function chargerEcarts() {
    const { debut, fin } = plage
    const filtrer = (q) => q
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut)
      .lte('date', fin)
      .order('date', { ascending: false })

    let { data: pointsData, error } = await filtrer(
      supabase.from('points').select('id, date, vente_machine, reste_fc, ecart_regularisations, explication_ecart_machine, explication_machine_statut, ecart_responsables, ecart_photos')
    )
    // Fallback si la colonne ecart_regularisations n'est pas encore créée en DB
    if (error) {
      const fb = await filtrer(supabase.from('points').select('id, date, vente_machine, reste_fc, explication_ecart_machine, ecart_responsables, ecart_photos'))
      pointsData = fb.data
      if (fb.error) {
        const fb2 = await filtrer(supabase.from('points').select('id, date, vente_machine, reste_fc'))
        pointsData = fb2.data
      }
    }

    if (!pointsData?.length) { setEcartsListe([]); setResponsablesPOS([]); return }

    const pointIds = pointsData.map(p => p.id)
    const allShifts = await chargerShiftsEcart(pointIds)
    const regularisationsPOS = pointsData.flatMap(p =>
      (Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : [])
        .filter(r => r?.source === SOURCE_DECISION_POS)
        .map(r => ({ ...r, point_id: r.point_id || p.id }))
    )

    const shiftsByPoint = {}
    ;(allShifts || []).forEach(s => {
      if (!shiftsByPoint[s.point_id]) shiftsByPoint[s.point_id] = []
      shiftsByPoint[s.point_id].push(s)
    })

    // Une seule dérivation pour toute la période : elle sert à la fois au
    // détail d'une journée et à l'onglet « Responsables des écarts ».
    setResponsablesPOS(responsablesEcartPOS(allShifts, regularisationsPOS))

    setEcartsListe(pointsData.map(p => {
      const shifts = shiftsByPoint[p.id] || []
      const cumulShifts = shifts.reduce((s, x) => s + (x.vente_shift || 0), 0)
      const ecartBrut = (p.vente_machine || 0) - cumulShifts
      const reguls = Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : []
      const regulsJour = reguls.filter(r => r?.source !== SOURCE_DECISION_POS)
      const totalRegul = regulsJour.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0)
      // Écart effectif : rapproché de 0 par les montants régularisés
      let ecart = ecartBrut
      if (ecartBrut < 0) ecart = Math.min(0, ecartBrut + totalRegul)
      else if (ecartBrut > 0) ecart = Math.max(0, ecartBrut - totalRegul)
      // Site POS : ce qui reste dû shift par shift après les décisions de
      // Vérification (même calcul que la liste des responsables). Un surplus
      // sans aucun manquant garde son affichage d'avant.
      const ecartPOSJour = ecartJourPOS(shifts, regularisationsPOS)
      if (ecartPOSJour !== null && (ecartPOSJour > 0 || ecartBrut >= 0)) {
        ecart = Math.max(0, ecartPOSJour - totalRegul)
      }
      // Écart annulé dans Vérification → neutralisé (écart 0), quel que soit le mode d'annulation.
      const annule = ['annulee', 'justifiee'].includes(p.explication_machine_statut)
      // Les deux statuts soldent l'écart, mais pas de la même manière : 'annulee'
      // a corrigé le fond, 'justifiee' non. Le libellé doit le dire.
      const justifie = p.explication_machine_statut === 'justifiee'
      if (annule) ecart = 0
      return {
        id: p.id,
        date: p.date,
        venteMachine: p.vente_machine || 0,
        cumulShifts,
        ecartBrut,
        ecart,
        annule,
        justifie,
        // Statut brut : nécessaire pour pouvoir le lever quand on supprime la
        // régularisation qui l'accompagnait (sinon l'écart reste figé à 0).
        statut: p.explication_machine_statut || null,
        regularisations: reguls,
        totalRegul,
        resteFc: p.reste_fc || 0,
        nbShifts: shifts.length,
        explication: p.explication_ecart_machine || '',
        responsablesEcart: Array.isArray(p.ecart_responsables) ? p.ecart_responsables : [],
        // Mesuré par la caisse, pas saisi par le gérant : affiché à part, pour
        // qu'un manager sache toujours qui a désigné le responsable.
        responsablesPOS: responsablesEcartPOS(shifts, regularisationsPOS),
        photosEcart: Array.isArray(p.ecart_photos) ? p.ecart_photos : [],
      }
    }))
  }

  async function chargerDeducVerifResto() {
    if (!restoSelectionne) { setDeducVerifResto([]); return }
    const { debut, fin } = plage
    const { data } = await supabase
      .from('deductions_verification').select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut).lte('date', fin)
      .neq('statut', 'validee')
      .order('date', { ascending: false })
    setDeducVerifResto(data || [])
  }

  async function chargerResponsables() {
    const { debut, fin } = plage
    let q = supabase.from('litiges_responsables')
      .select('*')
      .gte('date', debut)
      .lte('date', fin)
      .order('date', { ascending: false })
    if (restoSelectionne) q = q.eq('restaurant_id', restoSelectionne.id)
    const { data, error } = await q
    setResponsablesListe(error ? [] : (data || []))
  }

  // Ce que le gérant a imputé à la main + ce que la caisse a mesuré, sans
  // jamais compter deux fois la même journée (lib/ecartPOS.js).
  const responsablesFusionnes = useMemo(
    () => fusionnerResponsablesEcart(responsablesListe, responsablesPOS),
    [responsablesListe, responsablesPOS]
  )

  // ── Régularisation d'un écart ────────────────────────────────
  function ouvrirRegularisation(item) {
    setRegulPoint(item)
    setRegulMontant('')
    setRegulMotif('')
    setRegulPhotos([])
  }

  function gererPhotoRegul() {
    async function executer(source) {
      setRegulUploading(true)
      try {
        const url = source === 'camera' ? await prendrePhoto('regul-ecart') : await choisirPhoto('regul-ecart')
        if (url) setRegulPhotos(prev => [...prev, url])
      } finally {
        setRegulUploading(false)
      }
    }
    if (Platform.OS === 'web') {
      executer('gallery')
    } else {
      Alert.alert('Ajouter une preuve', 'Choisissez la source', [
        { text: 'Annuler', style: 'cancel' },
        { text: '📷 Caméra', onPress: () => executer('camera') },
        { text: '🖼 Galerie', onPress: () => executer('gallery') },
      ])
    }
  }

  async function enregistrerRegularisation() {
    const item = regulPoint
    if (!item) return
    // Manquant = machine > shifts (argent manquant en caisse) ; surplus = machine < shifts
    const sens = item.ecartBrut > 0 ? 'manquant' : 'surplus'
    const restant = Math.abs(item.ecart) // ce qu'il reste à justifier
    const montant = parseFloat(regulMontant) || 0
    if (montant <= 0) { Alert.alert('Montant invalide', 'Saisissez un montant supérieur à 0.'); return }
    if (Math.round(montant) > Math.round(restant)) {
      Alert.alert('Montant trop élevé', `Vous ne pouvez justifier que ${fmt(restant)} maximum sur cet écart.`); return
    }
    if (regulMotif.trim().length < 5) { Alert.alert('Explication requise', "Saisissez une explication d'au moins 5 caractères."); return }
    if (regulPhotos.length === 0) { Alert.alert('Preuve requise', 'Ajoutez au moins une photo justificative.'); return }

    setRegulSaving(true)
    try {
      // Ajustement du fond de caisse : manquant retrouvé → +FC ; surplus expliqué → −FC.
      // La correction s'applique au FOND ACTUEL (dernière journée validée), pas au jour
      // ancien de l'écart : l'argent bouge physiquement aujourd'hui, on ne réécrit pas l'historique.
      const deltaFc = sens === 'manquant' ? Math.round(montant) : -Math.round(montant)

      // Journée cible qui porte la correction de fond = dernier point validé du resto.
      const { data: cible } = await supabase.from('points')
        .select('id, ajustement_fond')
        .eq('restaurant_id', restoSelectionne.id).eq('valide', true)
        .order('date', { ascending: false }).limit(1).single()
      const cibleId = cible?.id || item.id   // fallback : le jour de l'écart lui-même

      const record = {
        sens,
        montant: Math.round(montant),
        motif: regulMotif.trim(),
        photos: regulPhotos,
        par_id: userId || null,
        par_nom: userNom || null,
        created_at: new Date().toISOString(),
        fond_point_id: cibleId,  // point qui a reçu la correction de fond (pour le reverse)
      }
      const nouvelles = [...(item.regularisations || []), record]

      // L'écart (explication / responsabilité) reste attaché au jour de l'écart.
      // La correction de fond (ajustement_fond) atterrit sur la journée cible.
      let error
      if (cibleId === item.id) {
        // Même ligne : un seul update combiné
        ;({ error } = await supabase.from('points')
          .update({ ecart_regularisations: nouvelles, ajustement_fond: (cible?.ajustement_fond || 0) + deltaFc })
          .eq('id', item.id))
      } else {
        ;({ error } = await supabase.from('points')
          .update({ ecart_regularisations: nouvelles })
          .eq('id', item.id))
        if (!error) {
          ;({ error } = await supabase.from('points')
            .update({ ajustement_fond: (cible?.ajustement_fond || 0) + deltaFc })
            .eq('id', cibleId))
        }
      }
      if (error) { Alert.alert('Erreur', "L'enregistrement a échoué. Réessayez."); return }
      setRegulPoint(null)
      await chargerEcarts()
    } finally {
      setRegulSaving(false)
    }
  }

  // Vrai si supprimer cette ligne doit aussi lever le statut posé depuis Vérification :
  // c'est le cas quand plus aucune régularisation issue de Vérification ne subsiste.
  function leveStatut(item, index) {
    if (!['annulee', 'justifiee'].includes(item.statut)) return false
    return !(item.regularisations || [])
      .filter((_, i) => i !== index)
      .some((x) => x?.source === 'verification')
  }

  function supprimerRegularisation(item, index) {
    const r = item.regularisations[index]
    if (!r) return
    Alert.alert(
      'Supprimer cette régularisation ?',
      (r.sans_fond
        ? `Le montant de ${fmt(r.montant)} sera réintégré dans l'écart. Le fond n'est pas concerné.`
        : `Le montant de ${fmt(r.montant)} sera réintégré dans l'écart et le fond actuel sera recalculé.`)
      + (leveStatut(item, index) ? "\n\nLe badge « écart justifié / annulé » sera retiré : l'écart redeviendra à traiter." : ''),
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive', onPress: async () => {
            const nouvelles = item.regularisations.filter((_, i) => i !== index)
            const deltaFc = r.sens === 'manquant' ? -(r.montant || 0) : (r.montant || 0) // inverse de l'ajout
            // Supprimer la régularisation ne suffisait pas : le statut 'justifiee' /
            // 'annulee' posé dans Vérification force l'écart à 0 plus haut. Sans le
            // lever ici, l'écart restait soldé pour toujours et la décision devenait
            // impossible à corriger.
            const statutMaj = leveStatut(item, index)
              ? {
                  explication_machine_statut: null,
                  explication_machine_statut_par: null,
                  explication_machine_statut_at: null,
                }
              : {}
            // Retire l'explication/responsabilité du jour de l'écart
            await supabase.from('points')
              .update({ ecart_regularisations: nouvelles, ...statutMaj })
              .eq('id', item.id)
            if (r.sans_fond) {
              // Justifié sans incidence sur le fond (bouton « ✔️ Justifier » de
              // Vérification) : aucun fond n'a été corrigé, donc rien à rendre.
              // Ce cas DOIT passer avant le test fond_point_id : ces records ont
              // fond_point_id null et tomberaient sinon dans la branche héritée
              // ci-dessous, qui irait modifier reste_fc — le faux fond qu'on évite.
            } else if (r.fond_point_id) {
              // Nouveau format : la correction de fond vit sur la journée cible → reverse là-bas
              const { data: pf } = await supabase.from('points')
                .select('ajustement_fond').eq('id', r.fond_point_id).single()
              await supabase.from('points')
                .update({ ajustement_fond: (pf?.ajustement_fond || 0) + deltaFc })
                .eq('id', r.fond_point_id)
            } else {
              // Régularisation héritée (ancien code) : la correction avait modifié reste_fc du jour
              await supabase.from('points')
                .update({ reste_fc: (item.resteFc || 0) + deltaFc })
                .eq('id', item.id)
            }
            await chargerEcarts()
          },
        },
      ]
    )
  }

  async function chargerInventaire() {
    const { debut, fin } = plage

    const { data: shifts } = await supabase
      .from('inventaires_shifts')
      .select('id, point_id, caissier_id, type_shift, montant_a_deduire, date')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut).lte('date', fin)
      .eq('valide', true)
      .order('date', { ascending: false })

    if (!shifts?.length) { setInventaireShifts([]); return }

    // Noms des caissiers
    const caissierIds = [...new Set(shifts.map(s => s.caissier_id).filter(Boolean))]
    const { data: utilisateurs } = await supabase
      .from('utilisateurs').select('id, nom').in('id', caissierIds)
    const nomById = {}
    ;(utilisateurs || []).forEach(u => { nomById[u.id] = u.nom })

    // Lignes avec écart par shift
    const shiftIds = shifts.map(s => s.id)
    const { data: lignes } = await supabase
      .from('inventaire_lignes')
      .select('id, inventaire_id, produit_id, produit_nom, montant_deduit')
      .in('inventaire_id', shiftIds)
      .gt('montant_deduit', 0)

    const lignesByShift = {}
    ;(lignes || []).forEach(l => {
      if (!lignesByShift[l.inventaire_id]) lignesByShift[l.inventaire_id] = []
      lignesByShift[l.inventaire_id].push(l)
    })

    setInventaireShifts(shifts.map(s => ({
      ...s,
      caissier_nom: nomById[s.caissier_id] || 'Caissier',
      lignes: lignesByShift[s.id] || [],
    })))
  }

  // Annule DÉFINITIVEMENT la déduction d'inventaire d'un produit (manager/directeur).
  function confirmerAnnulationDeductionLitige(ligne, inv) {
    if (!ligne?.id || annulDeducSaving) return
    const faire = async () => {
      setAnnulDeducSaving(ligne.id)
      try {
        await annulerDeductionInventaire({
          ligneId: ligne.id,
          inventaireId: inv.id,
          pointId: inv.point_id,
          par: userNom || roleActif || 'Manager',
        })
        await chargerInventaire()  // recharge la liste à jour
      } catch (e) {
        Alert.alert('Erreur', e?.message || "Impossible d'annuler la déduction")
      } finally {
        setAnnulDeducSaving(null)
      }
    }
    Alert.alert(
      'Annuler la déduction ?',
      `La déduction de ${fmt(ligne.montant_deduit)} sur « ${ligne.produit_nom} » sera annulée définitivement et retirée du total à déduire.`,
      [
        { text: 'Retour', style: 'cancel' },
        { text: 'Annuler la déduction', style: 'destructive', onPress: faire },
      ]
    )
  }

  // Shifts du restaurant autour des dates d'avis (la veille comprise : un
  // service de soirée finit après minuit).
  async function chargerShiftsAvis(debut, fin) {
    if (!restoSelectionne) return []
    const veille = new Date(`${debut}T12:00:00Z`); veille.setUTCDate(veille.getUTCDate() - 1)
    const { data } = await supabase.from('points_shifts')
      .select('restaurant_id, date, caissier_id, caissier_nom, heure_debut, heure_fin')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', veille.toISOString().slice(0, 10)).lte('date', fin)
      .order('date').range(0, 4999)
    setShiftsAvis(data || [])
    return data || []
  }

  // Attribue d'un coup les avis sans responsable de la période affichée.
  async function attribuerAvisAutomatiquement() {
    const sans = avisClients.filter(a => !a.responsable_id && !a.responsable_nom)
    if (!sans.length) return
    setAttributionEnCours(true)
    const dates = sans.map(a => a.date).sort()
    const shifts = await chargerShiftsAvis(dates[0], dates[dates.length - 1])
    let faits = 0
    for (const a of sans) {
      const r = caissierAuMoment(shifts, { restaurantId: restoSelectionne.id, date: a.date, heure: a.heure_commande })
      if (!r.caissier_id && !r.caissier_nom) continue
      const { error } = await supabase.from('litiges_avis_clients')
        .update({ responsable_id: r.caissier_id || null, responsable_nom: r.caissier_nom || null }).eq('id', a.id)
      if (!error) faits += 1
    }
    setAttributionEnCours(false)
    await chargerAvis()
    const restants = sans.length - faits
    Alert.alert(
      `${faits} avis attribué${faits > 1 ? 's' : ''}`,
      restants
        ? `${restants} avis restent sans responsable : plusieurs caissiers ce jour-là et pas d’heure de commande. Ouvrez-les pour indiquer l’heure.`
        : 'Tous les avis ont un responsable.',
    )
  }

  async function chargerAvis() {
    const { debut, fin } = plage
    const { data } = await supabase
      .from('litiges_avis_clients').select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut).lte('date', fin)
      .order('date', { ascending: false })
    setAvisClients(data || [])
  }

  async function chargerYango() {
    const { debut, fin } = plage
    const { data } = await supabase
      .from('litiges_yango').select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut).lte('date', fin)
      .order('date', { ascending: false })
    setLitigesYango(data || [])
  }

  async function chargerARelier() {
    const { count } = await supabase.from('journees_litiges_plateformes')
      .select('jour', { count: 'exact', head: true })
      .eq('restaurant_id', restoSelectionne.id).eq('statut', 'a_relier')
    setARelier(count || 0)
  }

  async function chargerErreursSaisie() {
    const { debut, fin } = plage
    const { data } = await supabase.from('journees_litiges_plateformes')
      .select('plateforme, jour, erreurs_saisie')
      .eq('restaurant_id', restoSelectionne.id).gte('jour', debut).lte('jour', fin)
      .order('jour', { ascending: false })
    const out = { yango: [], glovo: [] }
    for (const j of data || []) {
      for (const e of j.erreurs_saisie || []) out[j.plateforme]?.push({ ...e, jour: j.jour })
    }
    setErreursSaisie(out)
  }

  async function chargerGlovo() {
    const { debut, fin } = plage
    const { data } = await supabase
      .from('litiges_glovo').select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut).lte('date', fin)
      .order('date', { ascending: false })
    setLitigesGlovo(data || [])
  }

  async function chargerPointPasFait() {
    const { debut, fin } = plage
    const { data } = await supabase
      .from('litiges_point_pas_fait').select('*')
      .eq('restaurant_id', restoSelectionne.id)
      .gte('date', debut).lte('date', fin)
      .order('date', { ascending: false })
    setLitigesPointPasFait(data || [])
  }

  async function chargerEcartContacts() {
    const { debut, fin } = plage

    const points = await chargerPointsContact(restoSelectionne.id, debut, fin)

    if (!points?.length) { setEcartContacts([]); return }

    const pointIds = points.map(p => p.id)

    // Shifts : noms des caissières ET compteurs de contacts du POS.
    const { data: shifts } = await supabase
      .from('points_shifts')
      .select('point_id, caissier_id, caissier_nom, heure_debut, heure_fin, pos_nb_contacts, pos_nb_yango, pos_nb_glovo')
      .in('point_id', pointIds)
      .order('created_at', { ascending: true })

    const sourceResto = contactsViennentDuPOS(restoSelectionne) ? 'POS' : 'SAMTRACKLY'

    // Contacts pris (commandes avec contact_client renseigné) — paginé :
    // au-delà de 1000 commandes sur la période, Supabase tronquait
    // silencieusement et des journées entières tombaient à 0 contact.
    const { parPoint: contactsByPoint, parPointCaissier: contactsByPointCaissier } =
      await compterContacts(pointIds)

    // Noms des caissiers pour l'affichage contacts par caissier
    const allCaissierIds = [...new Set(
      Object.values(contactsByPointCaissier).flatMap(m => Object.keys(m))
    )]
    const { data: caissierUsers } = allCaissierIds.length
      ? await supabase.from('utilisateurs').select('id, nom').in('id', allCaissierIds)
      : { data: [] }
    const nomCaissier = {}
    ;(caissierUsers || []).forEach(u => { nomCaissier[u.id] = u.nom })
    // Sur un site POS il n'y a aucune ligne `commandes` : les noms viennent des shifts.
    ;(shifts || []).forEach(sh => {
      if (sh.caissier_id && sh.caissier_nom && !nomCaissier[sh.caissier_id]) {
        nomCaissier[sh.caissier_id] = sh.caissier_nom
      }
    })

    // Shifts groupés par point
    const shiftsByPoint = {}
    ;(shifts || []).forEach(s => {
      if (!shiftsByPoint[s.point_id]) shiftsByPoint[s.point_id] = []
      shiftsByPoint[s.point_id].push(s)
    })

    setEcartContacts(points.map(p => {
      const shiftsJour = shiftsByPoint[p.id] || []
      // Une source et une seule : POS pour un site basculé, commandes
      // Samtrackly sinon. Jamais la somme des deux.
      const infoContacts = choisirNombreContacts({
        sourcePoint: sourceResto,
        shifts: shiftsJour,
        contactsSamtrackly: contactsByPoint[p.id] || 0,
      })
      const calc = calculerLitigeContact(p, infoContacts.nombre, infoContacts)
      const caissiers = shiftsJour.map(s =>
        `${s.caissier_nom || '—'}${s.heure_debut ? ` (${s.heure_debut}→${s.heure_fin})` : ''}`
      ).join(' · ')
      // « Hilary 5 / 7 » : même module que l'écran Vérification, pour que les
      // deux écrans ne divergent jamais. Sur un site POS, la ventilation vient
      // des compteurs de shift ; les lignes `commandes` y sont vides.
      const detailCaissiers = detailContactsParCaissier({
        sourcePoint: sourceResto,
        commandes: [],
        shifts: shiftsJour,
        noms: nomCaissier,
      })
      const contactsParCaissier = sourceResto === 'POS'
        ? detailCaissiers.lignes
        : Object.entries(contactsByPointCaissier[p.id] || {}).map(([cid, v]) => ({
            cle: cid,
            nom: nomCaissier[cid] || 'Caissier',
            contacts: v.contacts,
            commandes: v.commandes,
          })).sort((a, b) => (b.commandes || 0) - (a.commandes || 0) || b.contacts - a.contacts)
      // Qui paie : prorata des contacts oubliés (lib/contactsParCaissier.js).
      const repartition = repartirLitigeContacts(calc.litige, contactsParCaissier)
      return { ...calc, point: p, date: p.date, caissiers, contactsParCaissier, repartition }
    }).filter(r => r.nbCommandes > 0 || r.caissiers))
  }

  // ── Mode global : toutes données par restaurant ─────────────
  async function chargerTousRestaurants() {
    if (!restaurants.length) return
    setLoading(true)
    const { debut, fin } = plage

    const resultats = await Promise.all(restaurants.map(resto => chargerLitigesRestaurant(resto, debut, fin)))

    setDonneesGlobales(resultats)
    setLoading(false)
  }

  // ── Génération PDF + partage natif ───────────────────────────
  // `donnees` : un élément par restaurant (vue globale) ou le seul restaurant
  // choisi (onglet « Tout »), qui ajoute en bas le résumé par caissier.
  async function genererEtPartagePDF(donnees, { parCaissier = false } = {}) {
    setGeneratingPdf(true)
    try {
      const periode = plageLabel()
      const unResto = donnees.length === 1
      let html = `<html><head><meta charset="utf-8"><style>
        body{font-family:Arial,sans-serif;font-size:12px;color:#333;padding:20px;margin:0}
        h1{font-size:18px;color:#534AB7;margin:0 0 4px}
        .sub{font-size:11px;color:#888;margin-bottom:20px}
        .resto{margin-bottom:20px;border:1px solid #ddd;border-radius:8px;overflow:hidden;page-break-inside:avoid}
        .resto-h{background:#534AB7;color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center}
        .resto-nom{font-size:14px;font-weight:bold}
        .resto-tot{font-size:13px;font-weight:bold}
        .volet{padding:8px 14px;border-bottom:1px solid #f0f0f0}
        .volet-h{display:flex;justify-content:space-between;font-weight:bold;font-size:12px;color:#444;margin-bottom:4px}
        .item{padding:3px 0 3px 12px;border-left:2px solid #e0e0e0;margin:3px 0;font-size:11px}
        .cmd{color:#185FA5;font-weight:bold}
        .r{color:#C62828}.g{color:#2E7D32}.b{color:#185FA5}
        .recap{background:#f8f8f8;padding:14px;margin-top:20px;border-radius:8px;border:1px solid #ddd}
        .recap-h{font-size:14px;font-weight:bold;margin-bottom:10px;color:#333}
        .recap-l{display:flex;justify-content:space-between;margin-bottom:5px;font-size:12px}
        .gt{border-top:1px solid #ccc;margin-top:8px;padding-top:8px;font-size:15px;font-weight:bold}
        .ok{color:#2E7D32;font-style:italic;font-size:11px}
      </style></head><body>
      <h1>⚖️ Rapport Litiges${unResto ? ` — ${donnees[0].restaurant.nom}` : ''}</h1>
      <p class="sub">Période : ${periode} — Généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`

      let grandTotal = 0

      // Mention du responsable, ajoutée à chaque ligne de litige. Vide quand
      // personne n'a été désigné, pour ne pas alourdir le document inutilement.
      const resp = nom => {
        const n = (nom || '').trim()
        return n ? ` · 👤 <strong>${n}</strong>` : ''
      }
      // Noms de caissiers venus du POS : jamais injectés tels quels dans le HTML.
      const esc = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

      for (const d of donnees) {
        grandTotal += d.total
        const tc = d.total > 0 ? 'r' : d.total < 0 ? 'g' : ''
        html += `<div class="resto"><div class="resto-h">
          <span class="resto-nom">${d.restaurant.nom}</span>
          <span class="resto-tot ${tc}">${d.total > 0 ? '+' : ''}${Math.round(d.total).toLocaleString('fr-FR')} FCFA</span>
        </div>`

        const vide = restoSansLitige(d)
        if (vide) {
          html += `<div class="volet"><span class="ok">✅ Aucun litige sur la période</span></div>`
        }

        // Écart
        if (d.ecartTotal !== 0 || d.responsables.length) {
          const ec = d.ecartTotal > 0 ? 'r' : 'g'
          html += `<div class="volet"><div class="volet-h"><span>📊 Écart point</span><span class="${ec}">${d.ecartTotal > 0 ? '+' : ''}${Math.round(d.ecartTotal).toLocaleString('fr-FR')} FCFA</span></div>`
          d.responsables.forEach(r => {
            const mc = r.montant > 0 ? 'r' : 'g'
            const role = r.role ? ` (${r.role})` : ''
            const type = r.type ? ` — ${r.type}` : ''
            html += `<div class="item">📅 ${r.date}${resp(r.responsable_nom) || ' · 👤 <em>non attribué</em>'}${role}${type} <span class="${mc}"><strong>${r.montant > 0 ? '+' : ''}${Math.round(r.montant).toLocaleString('fr-FR')} FCFA</strong></span></div>`
          })
          html += `</div>`
        }

        // Inventaire
        if (d.invTotal > 0) {
          html += `<div class="volet"><div class="volet-h"><span>📦 Inventaire</span><span class="r">−${Math.round(d.invTotal).toLocaleString('fr-FR')} FCFA</span></div>`
          d.invEnriched.forEach(inv => {
            const sl = SHIFT_LABELS[inv.type_shift] || inv.type_shift
            const parCat = {}
            inv.lignes.forEach(l => { const c = PRODUIT_TO_CAT[l.produit_id] || l.produit_nom; parCat[c] = (parCat[c] || 0) + (l.montant_deduit || 0) })
            const cats = Object.entries(parCat).filter(([, v]) => v > 0).map(([c, v]) => `${c} : ${Math.round(v).toLocaleString('fr-FR')} FCFA`).join(' · ')
            html += `<div class="item">👤 <strong>${inv.caissier_nom}</strong> — <strong>${sl}</strong>${cats ? ' — ' + cats : ''}</div>`
            inv.lignes.filter(l => l.explication).forEach(l => {
              html += `<div class="item">💬 <strong>${l.produit_nom}</strong> : ${l.explication}</div>`
            })
          })
          html += `</div>`
        }

        // Avis
        if (d.avis.length) {
          const ac = d.avisTotal > 0 ? 'r' : 'g'
          html += `<div class="volet"><div class="volet-h"><span>👁 Avis clients (${d.avis.length})</span><span class="${ac}">${d.avisTotal > 0 ? '+' : ''}${Math.round(d.avisTotal).toLocaleString('fr-FR')} FCFA</span></div>`
          d.avis.forEach(a => {
            const tl = typeAvis(a.type)?.label || a.type
            const cn = a.canal ? ` · <strong style="color:${canalAvis(a.canal)?.couleur || '#555'}">📍 ${canalAvis(a.canal)?.court || a.canal}</strong>` : ''
            const mc = a.montant > 0 ? 'r' : a.montant < 0 ? 'g' : ''  // neutre : couleur par défaut
            html += `<div class="item">${a.numero_commande ? `<span class="cmd">#${a.numero_commande}</span> — ` : ''}${tl}${cn}${resp(a.responsable_nom)}${a.notes ? ` — ${a.notes}` : ''} <span class="${mc}"><strong>${a.montant > 0 ? '+' : ''}${Math.round(a.montant).toLocaleString('fr-FR')} FCFA</strong></span></div>`
          })
          html += `</div>`
        }

        // Yango
        if (d.yango.length) {
          const yc = d.yangoTotal > 0 ? 'r' : 'g'
          html += `<div class="volet"><div class="volet-h"><span>🛵 Yango (${d.yango.length})</span><span class="${yc}">${d.yangoTotal > 0 ? '+' : ''}${Math.round(d.yangoTotal).toLocaleString('fr-FR')} FCFA</span></div>`
          d.yango.forEach(y => {
            const tl = TYPES_YANGO.find(t => t.key === y.type)?.label || y.type
            const mc = y.montant > 0 ? 'r' : 'g'
            html += `<div class="item">${y.numero_commande ? `<span class="cmd">#${y.numero_commande}</span> — ` : ''}${tl}${resp(y.responsable_nom)}${y.notes ? ` — ${y.notes}` : ''} <span class="${mc}"><strong>${y.montant > 0 ? '+' : ''}${Math.round(y.montant).toLocaleString('fr-FR')} FCFA</strong></span></div>`
          })
          html += `</div>`
        }

        // Glovo
        if (d.glovo.length) {
          const gc = d.glovoTotal > 0 ? 'r' : 'g'
          html += `<div class="volet"><div class="volet-h"><span>🟡 Glovo (${d.glovo.length})</span><span class="${gc}">${d.glovoTotal > 0 ? '+' : ''}${Math.round(d.glovoTotal).toLocaleString('fr-FR')} FCFA</span></div>`
          d.glovo.forEach(g => {
            const tl = TYPES_GLOVO.find(t => t.key === g.type)?.label || g.type
            const mc = g.montant > 0 ? 'r' : 'g'
            html += `<div class="item">${g.numero_commande ? `<span class="cmd">#${g.numero_commande}</span> — ` : ''}${tl}${resp(g.responsable_nom)}${g.notes ? ` — ${g.notes}` : ''} <span class="${mc}"><strong>${g.montant > 0 ? '+' : ''}${Math.round(g.montant).toLocaleString('fr-FR')} FCFA</strong></span></div>`
          })
          html += `</div>`
        }

        // Comptage vérificateur — montants plafonnés
        if (d.verifRetenu > 0) {
          html += `<div class="volet"><div class="volet-h"><span>🔍 Comptage vérificateur</span><span class="r">+${Math.round(d.verifRetenu).toLocaleString('fr-FR')} FCFA</span></div>`
          if (d.verifReel > d.verifRetenu) {
            html += `<div class="item" style="border-left-color:#E8C98A"><strong>⚖️ Écart réel ${Math.round(d.verifReel).toLocaleString('fr-FR')} FCFA</strong> — plafond de ${PLAFOND_COMPTAGE.toLocaleString('fr-FR')} FCFA par comptage appliqué, ${Math.round(d.verifRetenu).toLocaleString('fr-FR')} FCFA retenus.</div>`
          }
          d.verifLignes.forEach(l => {
            html += `<div class="item">📅 ${l.date} — ${l.produit_nom} (déclaré ${l.stock_declare}, compté ${l.stock_compte})${resp(l.caissier_nom)}${l.shift_libelle ? ` · ${l.shift_libelle}` : ''}${l.explication ? ` — ${l.explication}` : ''} <span class="r"><strong>${Math.round(l.montant).toLocaleString('fr-FR')} FCFA</strong></span></div>`
          })
          html += `</div>`
        }

        // Contacts manquants
        if (d.contactTotal > 0) {
          html += `<div class="volet"><div class="volet-h"><span>📞 Contacts manquants</span><span class="r">−${Math.round(d.contactTotal).toLocaleString('fr-FR')} FCFA</span></div>`
          d.contacts.forEach(c => {
            const qui = c.repartition
              ? [
                  ...c.repartition.parts.map(x => `${esc(x.nom)} ${Math.round(x.montant).toLocaleString('fr-FR')} F`),
                  ...(c.repartition.nonAttribue > 0 ? [`<em>non attribué ${Math.round(c.repartition.nonAttribue).toLocaleString('fr-FR')} F</em>`] : []),
                ].join(' · ')
              : ''
            html += `<div class="item">📅 ${c.date} — ${c.ecart} manquant${c.ecart > 1 ? 's' : ''} (${c.nbContacts}/${c.nbCommandes} · ${c.taux}%)${qui ? ` · 👤 ${qui}` : ''} <span class="r"><strong>−${Math.round(c.litige).toLocaleString('fr-FR')} FCFA</strong></span></div>`
          })
          if (d.contactsTotaux?.parCaissier.length) {
            html += `<div class="item"><strong>Par caissier :</strong> ${d.contactsTotaux.parCaissier.map(x => `${esc(x.nom)} ${Math.round(x.montant).toLocaleString('fr-FR')} F`).join(' · ')}</div>`
          }
          html += `</div>`
        }

        // Point pas fait
        if (d.pasFaitTotal > 0) {
          html += `<div class="volet"><div class="volet-h"><span>🚫 Point pas fait</span><span class="r">−${Math.round(d.pasFaitTotal).toLocaleString('fr-FR')} FCFA</span></div>`
          d.pasFait.forEach(pf => {
            html += `<div class="item">📅 ${pf.date}${resp(pf.responsable_nom) || ' · 👤 <em>non attribué</em>'}${pf.notes ? ` — ${pf.notes}` : ''} <span class="r"><strong>−${Math.round(pf.montant || 0).toLocaleString('fr-FR')} FCFA</strong></span></div>`
          })
          html += `</div>`
        }

        html += `</div>` // .resto
      }

      // Récap global
      const gtc = grandTotal > 0 ? '#C62828' : grandTotal < 0 ? '#2E7D32' : '#333'
      html += `<div class="recap"><div class="recap-h">📋 Récapitulatif${unResto ? '' : ' global'}</div>`
      donnees.forEach(d => {
        const c = d.total > 0 ? '#C62828' : d.total < 0 ? '#2E7D32' : '#888'
        html += `<div class="recap-l"><span>${d.restaurant.nom}</span><span style="color:${c};font-weight:bold">${d.total > 0 ? '+' : ''}${Math.round(d.total).toLocaleString('fr-FR')} FCFA</span></div>`
      })
      html += `<div class="recap-l gt"><span>TOTAL GLOBAL</span><span style="color:${gtc}">${grandTotal > 0 ? '+' : ''}${Math.round(grandTotal).toLocaleString('fr-FR')} FCFA</span></div></div>`

      // Résumé par caissier : chaque nom, son total et le détail par catégorie.
      if (parCaissier) {
        const f = m => `${m > 0 ? '+' : ''}${Math.round(m).toLocaleString('fr-FR')} FCFA`
        const coul = m => (m > 0 ? '#C62828' : m < 0 ? '#2E7D32' : '#888')
        for (const d of donnees) {
          const r = totauxParCaissier(d)
          html += `<div class="recap" style="page-break-inside:avoid"><div class="recap-h">👤 Résumé par caissier${unResto ? '' : ` — ${esc(d.restaurant.nom)}`}</div>`
          if (!r.personnes.length) html += `<div class="ok">Aucun litige attribué à un caissier sur la période.</div>`
          r.personnes.forEach(p => {
            html += `<div class="recap-l" style="margin-top:8px"><span><strong>${esc(p.nom)}</strong> <span style="color:#888">(${p.nb} ligne${p.nb > 1 ? 's' : ''})</span></span><span style="color:${coul(p.montant)};font-weight:bold">${f(p.montant)}</span></div>`
            html += `<div style="font-size:11px;color:#666;margin:0 0 6px 12px">${p.categories.map(c => `${c.nom} : ${f(c.montant)}`).join(' · ')}</div>`
          })
          if (Math.round(r.nonAttribue) !== 0) {
            html += `<div class="recap-l" style="margin-top:8px"><span><em>Non attribué</em></span><span style="color:${coul(r.nonAttribue)};font-weight:bold">${f(r.nonAttribue)}</span></div>`
          }
          html += `<div class="recap-l gt"><span>TOTAL</span><span style="color:${coul(r.total)}">${f(r.total)}</span></div></div>`
        }
      }
      html += `</body></html>`

      const nomFichier = unResto ? `${donnees[0].restaurant.nom}_${periode}` : periode
      await exporterPdf(html, `rapport_litiges_${nomFichier.replace(/[^\w\-→]+/g, '_')}.pdf`, 'Partager le rapport litiges')
    } catch (e) {
      Alert.alert('Erreur PDF', e.message || 'Impossible de générer le PDF')
    } finally {
      setGeneratingPdf(false)
    }
  }

  // ── Petits éléments d'affichage ──────────────────────────────
  // Ligne d'information précédée d'une icône (responsable, date, commande…)
  function info(icone, contenu, style = styles.ligneSous) {
    const couleur = StyleSheet.flatten(style)?.color || colors.textMuted
    return (
      <View style={styles.infoLigne}>
        <MaterialCommunityIcons name={icone} size={13} color={couleur} />
        <Text style={[style, { flexShrink: 1 }]}>{contenu}</Text>
      </View>
    )
  }
  // Titre de bloc avec pastille d'icône
  function titreIcone(icone, texte, style = styles.explicGerantTitre) {
    return (
      <View style={styles.titreIconeLigne}>
        <View style={styles.titreIconePastille}>
          <MaterialCommunityIcons name={icone} size={15} color={colors.primary} />
        </View>
        <Text style={[style, { marginBottom: 0, flexShrink: 1 }]}>{texte}</Text>
      </View>
    )
  }
  // Volet d'un restaurant en vue « tous les restaurants »
  function volet(icone, texte, couleur = colors.primary) {
    return (
      <View style={styles.voletTitre}>
        <MaterialCommunityIcons name={icone} size={15} color={couleur} />
        <Text style={[styles.globalVoletLabel, { color: couleur === colors.primary ? colors.text : couleur }]}>{texte}</Text>
      </View>
    )
  }
  // Boutons Modifier / Supprimer d'une ligne
  function actions(onModifier, onSupprimer) {
    return (
      <View style={styles.actionsLigne}>
        <TouchableOpacity style={styles.actionBtn} onPress={onModifier} accessibilityRole="button" accessibilityLabel="Modifier">
          <MaterialCommunityIcons name="pencil-outline" size={17} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSuppr]} onPress={onSupprimer} accessibilityRole="button" accessibilityLabel="Supprimer">
          <MaterialCommunityIcons name="trash-can-outline" size={17} color={colors.error} />
        </TouchableOpacity>
      </View>
    )
  }

  // ── Render mode global ───────────────────────────────────────
  function renderModeGlobal() {
    if (!donneesGlobales.length) return (
      <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucune donnée pour cette période</Text></View>
    )
    const grandTotal = donneesGlobales.reduce((s, d) => s + d.total, 0)
    const gtc = grandTotal > 0 ? colors.error : grandTotal < 0 ? colors.successDark : colors.textMuted

    return (
      <View style={styles.section}>
        {/* Grand total + bouton PDF */}
        <View style={[styles.totalBanner, {
          backgroundColor: grandTotal > 0 ? colors.errorLight : grandTotal < 0 ? colors.successLight : colors.surface,
          borderColor: grandTotal > 0 ? colors.error + '55' : grandTotal < 0 ? colors.success + '55' : colors.borderLight,
        }]}>
          <View>
            <Text style={styles.totalBannerLabel}>Total global — {plageLabel()}</Text>
            <Text style={styles.totalBannerLabel}>{donneesGlobales.length} restaurants</Text>
          </View>
          <Text style={[styles.totalBannerValue, { color: gtc }]}>
            {grandTotal > 0 ? '+' : ''}{fmt(grandTotal)}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.btnPdf, generatingPdf && { opacity: 0.6 }]}
          onPress={() => genererEtPartagePDF(donneesGlobales)}
          disabled={generatingPdf}
        >
          {generatingPdf
            ? <ActivityIndicator color="#FFFFFF" size="small" />
            : <MaterialCommunityIcons name="file-pdf-box" size={20} color="#FFFFFF" />}
          <Text style={styles.btnPdfTxt}>{generatingPdf ? 'Génération du PDF…' : 'Télécharger et partager le PDF'}</Text>
        </TouchableOpacity>

        {/* Un card par restaurant */}
        {donneesGlobales.map(d => renderCarteResto(d))}
      </View>
    )
  }

  // Carte des litiges d'un restaurant : vue « Tous les restaurants » et onglet « Tout ».
  function renderCarteResto(d) {
    const tc = d.total > 0 ? colors.error : d.total < 0 ? colors.successDark : colors.textMuted
    const vide = restoSansLitige(d)
    return (
      <View key={d.restaurant.id} style={styles.restoGlobalCard}>
        {/* Header restaurant */}
        <View style={styles.restoGlobalHeader}>
          <View style={styles.restoGlobalIcone}>
            <MaterialCommunityIcons name="storefront-outline" size={17} color={colors.primary} />
          </View>
          <Text style={styles.restoGlobalNom} numberOfLines={1}>{d.restaurant.nom}</Text>
          <View style={[styles.restoGlobalTotalPill, { backgroundColor: tc + '1A' }]}>
            <Text style={[styles.restoGlobalTotal, { color: tc }]}>
              {d.total > 0 ? '+' : ''}{fmt(d.total)}
            </Text>
          </View>
        </View>

        {vide ? (
          <View style={styles.aucunLitige}>
            <MaterialCommunityIcons name="check-circle-outline" size={16} color={colors.successDark} />
            <Text style={[styles.ligneSous, { color: colors.successDark, fontWeight: '700' }]}>Aucun litige</Text>
          </View>
        ) : (
          <View style={styles.restoGlobalBody}>
            {/* Écart */}
            {(d.ecartTotal !== 0 || d.responsables.length > 0) && (
              <>
                <View style={styles.globalVoletRow}>
                  {volet('chart-bar', 'Écart point')}
                  <Text style={[styles.globalVoletVal, { color: d.ecartTotal > 0 ? colors.error : colors.successDark }]}>
                    {d.ecartTotal > 0 ? '+' : ''}{fmtShort(d.ecartTotal)}
                  </Text>
                </View>
                {d.responsables.map((r, ri) => (
                  <View key={'resp' + ri} style={styles.globalItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.globalItemTxt} numberOfLines={2}>
                        {r.date}{r.type ? ` — ${r.type}` : ''}
                      </Text>
                      <Text style={styles.globalItemResp}>
                        {r.responsable_nom || 'Non attribué'}{r.role ? ` · ${r.role}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.globalItemMontant, { color: r.montant > 0 ? colors.error : colors.successDark }]}>
                      {r.montant > 0 ? '+' : ''}{fmtShort(r.montant)}
                    </Text>
                  </View>
                ))}
              </>
            )}
            {/* Inventaire + explication des manquants */}
            {d.invTotal > 0 && (
              <>
                <View style={styles.globalVoletRow}>
                  {volet('package-variant-closed', 'Inventaire')}
                  <Text style={[styles.globalVoletVal, { color: colors.error }]}>−{fmtShort(d.invTotal)}</Text>
                </View>
                {/* On rattache chaque ligne à son shift : un flatMap nu
                    perdait le caissier, donc le responsable de la déduction. */}
                {d.invEnriched.flatMap(inv =>
                  inv.lignes.map(l => ({ ...l, caissier_nom: inv.caissier_nom, type_shift: inv.type_shift }))
                ).map((l, li) => (
                  <View key={'inv' + li} style={styles.globalItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.globalItemTxt} numberOfLines={2}>
                        {l.produit_nom}
                        {l.explication ? <Text style={styles.globalItemCmd}> — {l.explication}</Text> : null}
                      </Text>
                      {l.caissier_nom ? (
                        <Text style={styles.globalItemResp}>
                          {l.caissier_nom}{l.type_shift ? ` · ${l.type_shift}` : ''}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.globalItemMontant, { color: colors.error }]}>−{fmtShort(l.montant_deduit)}</Text>
                  </View>
                ))}
              </>
            )}
            {/* Avis */}
            {d.avis.map(a => {
              const type = typeAvis(a.type)
              return (
                <View key={a.id} style={styles.globalItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.globalItemTxt} numberOfLines={2}>
                      {type?.label || a.type}
                      {a.canal ? <Text style={{ color: canalAvis(a.canal)?.couleur }}> · {canalAvis(a.canal)?.court || a.canal}</Text> : null}
                      {a.numero_commande ? <Text style={styles.globalItemCmd}> #{a.numero_commande}</Text> : null}
                      {a.notes ? ` — ${a.notes}` : ''}
                    </Text>
                    {a.responsable_nom ? (
                      <Text style={styles.globalItemResp}>{a.responsable_nom}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.globalItemMontant, { color: couleurMontant(a.montant, colors) }]}>
                    {a.montant > 0 ? '+' : ''}{fmtShort(a.montant)}
                  </Text>
                </View>
              )
            })}
            {/* Yango */}
            {d.yango.map(y => {
              const type = TYPES_YANGO.find(t => t.key === y.type)
              return (
                <View key={y.id} style={styles.globalItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.globalItemTxt} numberOfLines={2}>
                      {type?.label || y.type}
                      {y.numero_commande ? <Text style={styles.globalItemCmd}> #{y.numero_commande}</Text> : null}
                      {y.notes ? ` — ${y.notes}` : ''}
                    </Text>
                    {y.responsable_nom ? (
                      <Text style={styles.globalItemResp}>{y.responsable_nom}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.globalItemMontant, { color: y.montant > 0 ? colors.error : colors.successDark }]}>
                    {y.montant > 0 ? '+' : ''}{fmtShort(y.montant)}
                  </Text>
                </View>
              )
            })}
            {/* Glovo */}
            {d.glovo.map(g => {
              const type = TYPES_GLOVO.find(t => t.key === g.type)
              return (
                <View key={g.id} style={styles.globalItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.globalItemTxt} numberOfLines={2}>
                      {type?.label || g.type}
                      {g.numero_commande ? <Text style={styles.globalItemCmd}> #{g.numero_commande}</Text> : null}
                      {g.notes ? ` — ${g.notes}` : ''}
                    </Text>
                    {g.responsable_nom ? (
                      <Text style={styles.globalItemResp}>{g.responsable_nom}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.globalItemMontant, { color: g.montant > 0 ? colors.error : colors.successDark }]}>
                    {g.montant > 0 ? '+' : ''}{fmtShort(g.montant)}
                  </Text>
                </View>
              )
            })}
            {/* Comptage vérificateur — montants plafonnés */}
            {d.verifRetenu > 0 && (
              <>
                <View style={styles.globalVoletRow}>
                  {volet('magnify', 'Comptage vérificateur')}
                  <Text style={[styles.globalVoletVal, { color: colors.error }]}>+{fmtShort(d.verifRetenu)}</Text>
                </View>
                {d.verifReel > d.verifRetenu && (
                  <View style={styles.plafondBox}>
                    <Text style={styles.plafondTxt}>
                      Écart réel {fmt(d.verifReel)} — plafond de {fmt(PLAFOND_COMPTAGE)} par
                      comptage appliqué, {fmt(d.verifRetenu)} retenus.
                    </Text>
                  </View>
                )}
                {d.verifLignes.map(l => (
                  <View key={l.id} style={styles.globalItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.globalItemTxt} numberOfLines={2}>
                        {l.date} — {l.produit_nom}
                        <Text style={styles.globalItemCmd}> (déclaré {l.stock_declare} · compté {l.stock_compte})</Text>
                      </Text>
                      <Text style={styles.globalItemResp}>
                        {l.caissier_nom}{l.shift_libelle ? ` · ${l.shift_libelle}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.globalItemMontant, { color: colors.error }]}>{fmtShort(l.montant)}</Text>
                  </View>
                ))}
              </>
            )}

            {/* Contacts manquants */}
            {d.contactTotal > 0 && (
              <>
                <View style={styles.globalVoletRow}>
                  {volet('phone-outline', 'Contacts manquants')}
                  <Text style={[styles.globalVoletVal, { color: colors.error }]}>−{fmtShort(d.contactTotal)}</Text>
                </View>
                {d.contactsTotaux?.parCaissier.length > 0 && (
                  <View style={styles.globalItem}>
                    <Text style={[styles.globalItemResp, { flex: 1 }]}>
                      {`Par caissier : ${d.contactsTotaux.parCaissier.map(x => `${x.nom} ${fmtShort(x.montant)} F`).join(' · ')}`}
                      {d.contactsTotaux.nonAttribue > 0 ? ` · non attribué ${fmtShort(d.contactsTotaux.nonAttribue)} F` : ''}
                    </Text>
                  </View>
                )}
                {d.contacts.map((c, ci) => (
                  <View key={'ct' + ci} style={styles.globalItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.globalItemTxt} numberOfLines={2}>
                        {c.date} — {c.ecart} manquant{c.ecart > 1 ? 's' : ''}
                        <Text style={styles.globalItemCmd}> ({c.nbContacts}/{c.nbCommandes} · {c.taux}%)</Text>
                      </Text>
                      {c.repartition && (c.repartition.parts.length > 0 || c.repartition.nonAttribue > 0) ? (
                        <Text style={styles.globalItemResp}>
                          {[
                            ...c.repartition.parts.map(x => `${x.nom} ${fmtShort(x.montant)} F (${x.oublies} oublié${x.oublies > 1 ? 's' : ''})`),
                            ...(c.repartition.nonAttribue > 0 ? [`non attribué ${fmtShort(c.repartition.nonAttribue)} F`] : []),
                          ].join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.globalItemMontant, { color: colors.error }]}>−{fmtShort(c.litige)}</Text>
                  </View>
                ))}
              </>
            )}
            {/* Comptage POS pas encore arrivé : signalé, jamais facturé */}
            {d.contactsEnAttente > 0 && (
              <View style={styles.globalVoletRow}>
                {volet('timer-sand', `Contacts POS en attente (${d.contactsEnAttente} j)`, colors.warningDark)}
                <Text style={[styles.globalVoletVal, { color: colors.warningDark }]}>calcul suspendu</Text>
              </View>
            )}
            {/* Point pas fait */}
            {d.pasFaitTotal > 0 && (
              <View style={styles.globalVoletRow}>
                {volet('cancel', 'Point pas fait')}
                <Text style={[styles.globalVoletVal, { color: colors.error }]}>−{fmtShort(d.pasFaitTotal)}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    )
  }

  // ── KPI totaux ──────────────────────────────────────────────
  const totalEcart = ecartsListe.reduce((s, j) => s + Math.max(0, j.ecart), 0)
  const totalInventaire = inventaireShifts.reduce((s, x) => s + (x.montant_a_deduire || 0), 0)
  const totalAvis = avisClients.reduce((s, x) => s + (x.montant || 0), 0)
  const totalYango = litigesYango.reduce((s, x) => s + (x.montant || 0), 0)
  const totalGlovo = litigesGlovo.reduce((s, x) => s + (x.montant || 0), 0)
  const totalContact = ecartContacts.reduce((s, x) => s + x.litige, 0)
  const totauxContacts = totauxLitigeContactsParCaissier(ecartContacts)
  const totalPointPasFait = litigesPointPasFait.reduce((s, x) => s + (x.montant || 0), 0)
  // Les montants du vérificateur sont déjà plafonnés et répartis à
  // l'enregistrement : on somme simplement les parts encore dues.
  const totalVerif = deducVerifResto.reduce((s, x) => s + (Number(x.montant) || 0), 0)
  const verifParLot = {}
  deducVerifResto.forEach(x => { verifParLot[x.lot_id || x.date] = Number(x.montant_ecart) || 0 })
  const totalVerifReel = Object.values(verifParLot).reduce((s, v) => s + v, 0)
  const totalGlobal = totalEcart + totalInventaire + totalAvis + totalYango + totalGlovo + totalContact + totalPointPasFait + totalVerif

  // ── Sauvegarde ───────────────────────────────────────────────
  async function sauvegarderAvis() {
    if (!restoSelectionne) return
    setSaving(true)
    const montant = typeAvis(formAvis.type)?.montant ?? 1000
    const dateToSave = formAvis.date_saisie || TODAY
    // Sans responsable choisi : le caissier présent à l'heure de la commande.
    let { responsable_id: respId, responsable_nom: respNom } = formAvis
    if (!respId && !respNom) {
      const r = caissierAuMoment(shiftsAvis, { restaurantId: restoSelectionne.id, date: dateToSave, heure: formAvis.heure })
      if (r.caissier_id || r.caissier_nom) { respId = r.caissier_id; respNom = r.caissier_nom }
    }
    const champs = {
      type: formAvis.type, montant,
      canal: formAvis.canal || 'sur_place',
      notes: formAvis.notes || null,
      numero_commande: formAvis.numero_commande || null,
      date: dateToSave,
      heure_commande: normaliserHeure(formAvis.heure),
      responsable_id: respId || null,
      responsable_nom: respNom || null,
    }
    const run = (payload) => formAvis.id
      ? supabase.from('litiges_avis_clients').update(payload).eq('id', formAvis.id)
      : supabase.from('litiges_avis_clients').insert({ ...payload, restaurant_id: restoSelectionne.id, created_by: userNom || userId })

    let { error } = await run(champs)
    // Repli si `heure_commande` (supabase_avis_heure.sql) ou `canal` n'existent pas encore en base
    if (error && /heure_commande/i.test(error.message || '')) {
      const { heure_commande: _h, ...sansHeure } = champs
      ;({ error } = await run(sansHeure))
    }
    if (error && /canal/i.test(error.message || '')) {
      const { canal: _omit, heure_commande: _h2, ...sansCanal } = champs
      ;({ error } = await run(sansCanal))
    }
    setSaving(false)
    if (error) { setSaveError(error.message); return }
    setSaveError(null)
    setShowFormAvis(false)
    chargerAvis()
  }

  async function sauvegarderYango() {
    const montant = parseFloat(formYango.montant) || 0
    if (!montant || !restoSelectionne) return
    setSaving(true)
    const dateToSave = formYango.date_saisie || TODAY
    let err
    if (formYango.id) {
      const { error } = await supabase.from('litiges_yango').update({
        type: formYango.type, montant,
        notes: formYango.notes || null,
        numero_commande: formYango.numero_commande || null,
        date: dateToSave,
        responsable_id: formYango.responsable_id || null,
        responsable_nom: formYango.responsable_nom || null,
      }).eq('id', formYango.id)
      err = error
    } else {
      const { error } = await supabase.from('litiges_yango').insert({
        restaurant_id: restoSelectionne.id,
        date: dateToSave,
        type: formYango.type, montant,
        notes: formYango.notes || null,
        numero_commande: formYango.numero_commande || null,
        created_by: userNom || userId,
        responsable_id: formYango.responsable_id || null,
        responsable_nom: formYango.responsable_nom || null,
      })
      err = error
    }
    setSaving(false)
    if (err) { setSaveError(err.message); return }
    setSaveError(null)
    setShowFormYango(false)
    chargerYango()
  }

  async function sauvegarderGlovo() {
    const montant = parseFloat(formGlovo.montant) || 0
    if (!montant || !restoSelectionne) return
    setSaving(true)
    const dateToSave = formGlovo.date_saisie || TODAY
    let err
    if (formGlovo.id) {
      const { error } = await supabase.from('litiges_glovo').update({
        type: formGlovo.type, montant,
        notes: formGlovo.notes || null,
        numero_commande: formGlovo.numero_commande || null,
        date: dateToSave,
        responsable_id: formGlovo.responsable_id || null,
        responsable_nom: formGlovo.responsable_nom || null,
      }).eq('id', formGlovo.id)
      err = error
    } else {
      const { error } = await supabase.from('litiges_glovo').insert({
        restaurant_id: restoSelectionne.id,
        date: dateToSave,
        type: formGlovo.type, montant,
        notes: formGlovo.notes || null,
        numero_commande: formGlovo.numero_commande || null,
        created_by: userNom || userId,
        responsable_id: formGlovo.responsable_id || null,
        responsable_nom: formGlovo.responsable_nom || null,
      })
      err = error
    }
    setSaving(false)
    if (err) { setSaveError(err.message); return }
    setSaveError(null)
    setShowFormGlovo(false)
    chargerGlovo()
  }

  async function sauvegarderPointPasFait() {
    const montant = parseFloat(formPPF.montant) || 0
    if (!restoSelectionne) return
    setSaving(true)
    const dateToSave = formPPF.date_saisie || TODAY
    let err
    if (formPPF.id) {
      const { error } = await supabase.from('litiges_point_pas_fait').update({
        montant,
        notes: formPPF.notes || null,
        date: dateToSave,
        responsable_id: formPPF.responsable_id || null,
        responsable_nom: formPPF.responsable_nom || null,
      }).eq('id', formPPF.id)
      err = error
    } else {
      const { error } = await supabase.from('litiges_point_pas_fait').insert({
        restaurant_id: restoSelectionne.id,
        date: dateToSave,
        montant,
        notes: formPPF.notes || null,
        created_by: userNom || userId,
        responsable_id: formPPF.responsable_id || null,
        responsable_nom: formPPF.responsable_nom || null,
      })
      err = error
    }
    setSaving(false)
    if (err) { Alert.alert('Erreur', err.message); return }
    setShowFormPPF(false)
    chargerPointPasFait()
  }

  // Responsable d'un litige automatique : marqué « choisi à la main » pour que
  // le recalcul ne le remette pas sur le caissier (planEcriture).
  async function sauvegarderRespAuto() {
    if (!respAuto) return
    const { table, litige, responsable_id, responsable_nom } = respAuto
    const detail = detailApresChoix(litige, responsable_id || null, responsable_nom || null)
    if (!detail) { setRespAuto(null); return }
    setSaving(true)
    const { error } = await supabase.from(table).update({
      responsable_id: responsable_id || null,
      responsable_nom: responsable_nom || null,
      detail,
      modified_at: new Date().toISOString(),
    }).eq('id', litige.id)
    setSaving(false)
    if (error) { setSaveError("Le responsable n'a pas été enregistré. Réessayez."); return }
    setSaveError(null)
    setRespAuto(null)
    if (table === 'litiges_yango') chargerYango()
    else chargerGlovo()
  }

  async function supprimerItem() {
    if (!confirmSuppr) return
    setSaving(true)
    const { table, id, auto } = confirmSuppr
    // Litige automatique : rangé dans litiges_auto_annules avant d'être
    // retiré, pour que le calcul ne le recrée jamais.
    if (auto) {
      const { error } = await supabase.from('litiges_auto_annules').upsert({
        cle_auto: auto.cle_auto, plateforme: table === 'litiges_yango' ? 'yango' : 'glovo',
        copie: auto, annule_par: userNom || userId,
      }, { onConflict: 'cle_auto' })
      if (error) { setSaving(false); setSaveError("L'annulation n'a pas abouti. Réessayez."); return }
    }
    await supabase.from(table).delete().eq('id', id)
    setSaving(false)
    setConfirmSuppr(null)
    if (table === 'litiges_avis_clients') chargerAvis()
    else if (table === 'litiges_yango') chargerYango()
    else if (table === 'litiges_glovo') chargerGlovo()
    else chargerPointPasFait()
  }

  // ── Helpers UI ───────────────────────────────────────────────
  const multiJour = !unSeulJour(periodeKey)

  function ouvrirAddAvis() {
    setSaving(false)
    const date = formDateDefaut(periodeKey, dateUnique)
    setFormAvis({ type: 'mauvais', canal: 'sur_place', notes: '', numero_commande: '', date_saisie: date, heure: '', responsable_id: null, responsable_nom: '', id: null })
    chargerShiftsAvis(date, date)
    setShowFormAvis(true)
  }
  function ouvrirEditAvis(a) {
    setFormAvis({ type: a.type, canal: a.canal || 'sur_place', notes: a.notes || '', numero_commande: a.numero_commande || '', date_saisie: a.date || TODAY, heure: a.heure_commande ? String(a.heure_commande).slice(0, 5) : '', responsable_id: a.responsable_id || null, responsable_nom: a.responsable_nom || '', id: a.id })
    chargerShiftsAvis(a.date || TODAY, a.date || TODAY)
    setShowFormAvis(true)
  }
  function ouvrirAddYango() {
    setSaving(false)
    setFormYango({ type: 'tape_moins', montant: '', notes: '', numero_commande: '', date_saisie: formDateDefaut(periodeKey, dateUnique), responsable_id: null, responsable_nom: '', id: null })
    setShowFormYango(true)
  }
  function ouvrirEditYango(y) {
    setFormYango({ type: y.type, montant: y.montant?.toString() || '', notes: y.notes || '', numero_commande: y.numero_commande || '', date_saisie: y.date || TODAY, responsable_id: y.responsable_id || null, responsable_nom: y.responsable_nom || '', id: y.id })
    setShowFormYango(true)
  }
  function ouvrirAddGlovo() {
    setSaving(false)
    setFormGlovo({ type: 'tape_moins', montant: '', notes: '', numero_commande: '', date_saisie: formDateDefaut(periodeKey, dateUnique), responsable_id: null, responsable_nom: '', id: null })
    setShowFormGlovo(true)
  }
  function ouvrirEditGlovo(g) {
    setFormGlovo({ type: g.type, montant: g.montant?.toString() || '', notes: g.notes || '', numero_commande: g.numero_commande || '', date_saisie: g.date || TODAY, responsable_id: g.responsable_id || null, responsable_nom: g.responsable_nom || '', id: g.id })
    setShowFormGlovo(true)
  }
  function ouvrirAddPPF() {
    setSaving(false)
    setFormPPF({ responsable_id: null, responsable_nom: '', montant: '', notes: '', date_saisie: formDateDefaut(periodeKey, dateUnique), id: null })
    setShowFormPPF(true)
  }
  function ouvrirEditPPF(p) {
    setFormPPF({ responsable_id: p.responsable_id || null, responsable_nom: p.responsable_nom || '', montant: p.montant?.toString() || '', notes: p.notes || '', date_saisie: p.date || TODAY, id: p.id })
    setShowFormPPF(true)
  }

  // ── Picker responsable (inline JSX, pas un composant React) ────
  // Caissiers, gérant et toute l'équipe, rangés par poste. Un travailleur sans
  // compte est enregistré par son nom seul (responsable_id = null).
  function renderResponsablePicker(valueId, valueNom, onChange) {
    const groupes = personnesParGroupe(utilisateurs, travailleurs, rechercheResp)
    const aucun = !valueId && !valueNom
    return (
      <View>
        <Text style={styles.formLabel}>Responsable</Text>
        <TextInput style={styles.formInput} value={rechercheResp} onChangeText={setRechercheResp}
          placeholder="Chercher un nom…" placeholderTextColor="#bbb" />
        <ScrollView style={{ maxHeight: 220, marginBottom: 12 }} nestedScrollEnabled>
          <View style={styles.responsableLigne}>
            <TouchableOpacity
              style={[styles.responsableChip, aucun && styles.responsableChipActive]}
              onPress={() => onChange(null, '')}
            >
              <Text style={[styles.responsableChipTxt, aucun && styles.responsableChipTxtActive]}>— Aucun</Text>
            </TouchableOpacity>
          </View>
          {groupes.map(g => (
            <View key={g.groupe}>
              <Text style={styles.responsableGroupe}>{g.groupe}</Text>
              <View style={styles.responsableLigne}>
                {g.personnes.map(u => {
                  const actif = estChoisi(u, valueId, valueNom)
                  return (
                    <TouchableOpacity
                      key={u.cle}
                      style={[styles.responsableChip, actif && styles.responsableChipActive]}
                      onPress={() => { onChange(u.id, u.nom); setRechercheResp('') }}
                    >
                      <Text style={[styles.responsableChipTxt, actif && styles.responsableChipTxtActive]}>{u.nom}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
          ))}
          {!groupes.length && <Text style={styles.ligneSous}>Personne ne correspond à « {rechercheResp} ».</Text>}
        </ScrollView>
      </View>
    )
  }

  function renderPointPasFait() {
    return (
      <View style={styles.section}>
        {litigesPointPasFait.length > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Total point pas fait</Text>
            <Text style={[styles.totalBannerValue, { color: colors.error }]}>{fmt(totalPointPasFait)}</Text>
          </View>
        )}
        {litigesPointPasFait.map(p => (
          <View key={p.id} {...focus.props(p.id)} style={[styles.ligneCard, { borderColor: colors.error + '44' }, focus.style(p.id)]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.ligneNom, { color: colors.error }]}>Point pas fait</Text>
              {p.responsable_nom ? info('account-outline', p.responsable_nom, styles.ligneSous) : null}
              {multiJour && p.date ? info('calendar-blank-outline', p.date, styles.ligneSous) : null}
              {p.notes ? <Text style={styles.ligneSous}>{p.notes}</Text> : null}
              {p.created_by ? <Text style={styles.ligneCreer}>par {p.created_by}</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <Text style={[styles.montantTxt, { color: colors.error }]}>{fmtShort(p.montant)}</Text>
              {actions(() => ouvrirEditPPF(p), () => setConfirmSuppr({ table: 'litiges_point_pas_fait', id: p.id }))}
            </View>
          </View>
        ))}
        {!litigesPointPasFait.length && <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun point pas fait enregistré</Text></View>}
        <TouchableOpacity style={styles.btnAjout} onPress={ouvrirAddPPF}>
          <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
          <Text style={styles.btnAjoutTxt}>Ajouter un point pas fait</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Détails d'un écart : explication du gérant + régularisations + bouton annuler/réduire.
  // Partagé entre la vue 1 jour et les lignes dépliées de la vue période.
  function renderEcartDetails(item) {
    const mesuresPOS = item.responsablesPOS || []
    // Sur une journée déjà imputée à la main, la main gagne : on n'affiche pas
    // les deux, sinon le même écart se lit deux fois (cf. lib/ecartPOS.js).
    const montrerPOS = mesuresPOS.length > 0 && item.responsablesEcart.length === 0
    return (
      <>
        {/* Écart mesuré par la caisse, caissière par caissière. Rien n'a été
            saisi ici : le POS l'a compté au comptage à l'aveugle. */}
        {montrerPOS && (
          <View style={styles.explicGerantCard}>
            <View style={styles.respNomRow}>
              {titreIcone('account-cash-outline', 'Écart mesuré au POS')}
              <View style={styles.sourcePOSBadge}>
                <Text style={styles.sourcePOSBadgeTxt}>Mesuré au POS</Text>
              </View>
            </View>
            <Text style={styles.explicGerantVide}>
              Un shift = une caissière. La caisse a compté à l&apos;aveugle : personne
              n&apos;a eu à désigner de responsable.
            </Text>
            <View style={{ marginTop: 8 }}>
              {mesuresPOS.map(r => (
                <View key={r.id}>
                  <View style={styles.explicRespRow}>
                    <Text style={styles.explicRespNom}>
                      {r.responsable_nom}{r.type === 'surplus' ? ' · surplus' : ''}
                    </Text>
                    <Text style={[styles.explicRespMontant, {
                      color: r.type === 'manquant' ? colors.error : colors.primary,
                    }]}>{fmt(r.montant)}</Text>
                  </View>
                  {r.explication ? (
                    <Text style={styles.explicGerantTxt}>« {r.explication} »</Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Explication du gérant (saisie côté Ventes) — aide à décider l'annulation */}
        {item.ecartBrut !== 0 && (item.explication || item.responsablesEcart.length > 0 || item.photosEcart.length > 0) && (
          <View style={styles.explicGerantCard}>
            {titreIcone('note-text-outline', 'Explication du gérant')}
            {item.explication ? (
              <Text style={styles.explicGerantTxt}>"{item.explication}"</Text>
            ) : (
              <Text style={styles.explicGerantVide}>Aucune explication écrite.</Text>
            )}
            {item.responsablesEcart.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.explicGerantSousTitre}>Responsables désignés</Text>
                {item.responsablesEcart.map((r, i) => (
                  <View key={i} style={styles.explicRespRow}>
                    <Text style={styles.explicRespNom}>{r.nom}</Text>
                    <Text style={styles.explicRespMontant}>{fmt(r.montant)}</Text>
                  </View>
                ))}
              </View>
            )}
            {item.photosEcart.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.explicGerantSousTitre}>Photos justificatives</Text>
                <View style={styles.regulPhotosRow}>
                  {item.photosEcart.map((uri, i) => (
                    <PhotoJustificatif key={i} uri={uri} style={styles.regulPhotoThumb} compact />
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* Régularisations existantes */}
        {item.regularisations.length > 0 && (
          <View style={{ marginTop: 12, gap: 8 }}>
            {item.regularisations.map((r, i) => (
              <View key={i} style={styles.regulCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.regulCardTitre}>
                    {r.sens === 'manquant' ? 'Manquant justifié' : 'Surplus justifié'} · {fmt(r.montant)}
                  </Text>
                  {peutRegulariser && (
                    <TouchableOpacity onPress={() => supprimerRegularisation(item, i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <MaterialCommunityIcons name="close" size={18} color={colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
                {r.sans_fond && (
                  <View style={styles.regulSansFondBadge}>
                    <Text style={styles.regulSansFondTxt}>sans incidence sur le fond</Text>
                  </View>
                )}
                {r.motif ? <Text style={styles.regulMotif}>{r.motif}</Text> : null}
                {Array.isArray(r.photos) && r.photos.length > 0 && (
                  <View style={styles.regulPhotosRow}>
                    {r.photos.map((uri, j) => (
                      <PhotoJustificatif key={j} uri={uri} style={styles.regulPhotoThumb} compact />
                    ))}
                  </View>
                )}
                <Text style={styles.regulMeta}>
                  {r.par_nom || '—'} · {r.created_at ? new Date(r.created_at).toLocaleDateString('fr-FR') : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Bouton régulariser (manager/directeur, écart non nul) */}
        {peutRegulariser && item.ecart !== 0 && (
          <TouchableOpacity style={styles.regulBtn} onPress={() => ouvrirRegularisation(item)}>
            <MaterialCommunityIcons name="tools" size={18} color="#FFFFFF" />
            <Text style={styles.regulBtnTxt}>Annuler / réduire l'écart</Text>
          </TouchableOpacity>
        )}
      </>
    )
  }

  // ── Render volets ────────────────────────────────────────────
  function renderEcarts() {
    if (!ecartsListe.length) {
      return (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTxt}>Aucun point trouvé pour cette période</Text>
          <Text style={styles.emptySubTxt}>Sélectionnez une période avec des points enregistrés</Text>
        </View>
      )
    }

    // Vue 1 jour : grande carte
    if (!multiJour && ecartsListe.length === 1) {
      const item = ecartsListe[0]
      const c = item.ecart > 0 ? colors.error : item.ecart < 0 ? colors.warningDark : colors.successDark
      return (
        <View style={styles.section}>
          <View style={styles.kpiRow}>
            <View style={[styles.kpiBox, { flex: 1 }]}>
              <Text style={styles.kpiLabel}>Vente machine</Text>
              <Text style={[styles.kpiValue, { color: colors.text }]}>{fmt(item.venteMachine)}</Text>
            </View>
            <View style={[styles.kpiBox, { flex: 1 }]}>
              <Text style={styles.kpiLabel}>Cumul shifts ({item.nbShifts})</Text>
              <Text style={[styles.kpiValue, { color: colors.text }]}>{fmt(item.cumulShifts)}</Text>
            </View>
          </View>
          <View style={[styles.ecartCard, {
            backgroundColor: item.ecart !== 0 ? (item.ecart > 0 ? colors.errorLight : colors.warningLight) : colors.successLight,
            borderColor: c + '44',
          }]}>
            <Text style={styles.ecartLabel}>
              {item.annule ? (item.justifie ? 'Écart justifié' : 'Écart annulé')
                : item.totalRegul > 0 ? 'Écart restant' : 'Écart constaté'}
            </Text>
            <Text style={[styles.ecartValeur, { color: c }]}>{item.ecart > 0 ? '+' : ''}{fmt(item.ecart)}</Text>
            <Text style={[styles.ecartSous, { color: c }]}>
              {item.annule
                ? (item.justifie
                    ? 'Justifié dans Vérification — fond non modifié'
                    : 'Annulé dans Vérification — non pris en compte')
                : item.ecart > 0 ? 'Machine supérieure aux shifts déclarés'
                : item.ecart < 0 ? 'Shifts supérieurs à la machine'
                : (item.totalRegul > 0 ? 'Écart entièrement régularisé' : 'Aucun écart — tout est aligné')}
            </Text>
            {item.annule && item.ecartBrut !== 0 ? (
              <Text style={styles.ecartRegulHint}>Écart initial {item.ecartBrut > 0 ? '+' : ''}{fmt(item.ecartBrut)} · {item.justifie ? 'justifié' : 'annulé'}</Text>
            ) : item.totalRegul > 0 ? (
              <Text style={styles.ecartRegulHint}>
                Écart initial {item.ecartBrut > 0 ? '+' : ''}{fmt(item.ecartBrut)} · régularisé {fmt(item.totalRegul)}
              </Text>
            ) : null}
          </View>

          {renderEcartDetails(item)}
        </View>
      )
    }

    // Vue multi-jour : liste
    const c = totalEcart > 0 ? colors.error : totalEcart < 0 ? colors.warningDark : colors.successDark
    return (
      <View style={styles.section}>
        <View style={styles.totalBanner}>
          <Text style={styles.totalBannerLabel}>Écart total période</Text>
          <Text style={[styles.totalBannerValue, { color: c }]}>{totalEcart > 0 ? '+' : ''}{fmt(totalEcart)}</Text>
        </View>
        {ecartsListe.map(j => {
          const cj = j.ecart > 0 ? colors.error : j.ecart < 0 ? colors.warningDark : colors.successDark
          const ouvert = expandedEcart === j.date
          // Indices qu'il y a quelque chose à consulter / traiter sur ce jour
          // Les mesures du POS ouvrent le détail même quand l'écart du JOUR
          // vaut 0 : « Marie-Paule +2500 / Hilary −2500 » se compense au
          // total, et il manque pourtant 2 500 FCFA dans une caisse.
          const aDetails = (j.responsablesPOS || []).length > 0
            || (j.ecartBrut !== 0 && (j.explication || j.responsablesEcart.length > 0 || j.photosEcart.length > 0 || j.regularisations.length > 0 || (peutRegulariser && j.ecart !== 0)))
          return (
            <View key={j.date}>
              <TouchableOpacity
                style={[styles.ligneCard, ouvert && styles.ligneCardActive]}
                onPress={() => aDetails && setExpandedEcart(ouvert ? null : j.date)}
                activeOpacity={aDetails ? 0.6 : 1}
              >
                {aDetails && <MaterialCommunityIcons name={ouvert ? 'chevron-down' : 'chevron-right'} size={20} color={colors.primary} style={{ marginRight: 6 }} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.ligneNom}>{j.date}{j.annule ? (j.justifie ? '  ·  justifié' : '  ·  annulé') : ''}</Text>
                  <Text style={styles.ligneSous}>Machine {fmtShort(j.venteMachine)} — Shifts {fmtShort(j.cumulShifts)} ({j.nbShifts})</Text>
                </View>
                <Text style={[styles.montantTxt, { color: cj }]}>{j.ecart > 0 ? '+' : ''}{fmtShort(j.ecart)}</Text>
              </TouchableOpacity>
              {ouvert && (
                <View style={styles.ligneDetails}>
                  {renderEcartDetails(j)}
                </View>
              )}
            </View>
          )
        })}
      </View>
    )
  }

  // ── Responsables des écarts (filtres : type, responsable ; resto+période = contrôles du haut) ──
  function renderResponsablesEcarts() {
    if (!responsablesFusionnes.length) return null
    // Agrégat par personne (pour les chips + total imputé)
    const parPersonne = {}
    responsablesFusionnes.forEach(r => {
      const k = r.responsable_id || r.responsable_nom || '—'
      if (!parPersonne[k]) parPersonne[k] = { key: k, nom: r.responsable_nom || '—', total: 0, count: 0 }
      parPersonne[k].total += parseFloat(r.montant) || 0
      parPersonne[k].count += 1
    })
    const personnes = Object.values(parPersonne).sort((a, b) => b.total - a.total)
    const rows = responsablesFusionnes.filter(r =>
      (filtreType === 'tous' || r.type === filtreType) &&
      (!filtreResponsable || (r.responsable_id || r.responsable_nom || '—') === filtreResponsable)
    )
    const totalFiltre = rows.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0)
    return (
      <View style={[styles.section, { marginTop: 8 }]}>
        {titreIcone('account-group-outline', 'Responsables des écarts', styles.respSectionTitre)}

        {/* Filtre type */}
        <View style={styles.filtreRow}>
          {[['tous', 'Tous'], ['manquant', 'Manquants'], ['surplus', 'Surplus']].map(([t, label]) => (
            <TouchableOpacity key={t} style={[styles.filtreChip, filtreType === t && styles.filtreChipActif]} onPress={() => setFiltreType(t)}>
              <Text style={[styles.filtreChipTxt, filtreType === t && styles.filtreChipTxtActif]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Filtre responsable */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 10 }}>
          <TouchableOpacity style={[styles.filtreChip, !filtreResponsable && styles.filtreChipActif]} onPress={() => setFiltreResponsable(null)}>
            <Text style={[styles.filtreChipTxt, !filtreResponsable && styles.filtreChipTxtActif]}>Tous</Text>
          </TouchableOpacity>
          {personnes.map(p => (
            <TouchableOpacity key={p.key} style={[styles.filtreChip, filtreResponsable === p.key && styles.filtreChipActif]} onPress={() => setFiltreResponsable(p.key)}>
              <Text style={[styles.filtreChipTxt, filtreResponsable === p.key && styles.filtreChipTxtActif]}>{p.nom} · {fmtShort(p.total)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Total filtré */}
        <View style={styles.totalBanner}>
          <Text style={styles.totalBannerLabel}>Total imputé ({rows.length})</Text>
          <Text style={[styles.totalBannerValue, { color: colors.primary }]}>{fmt(totalFiltre)}</Text>
        </View>

        {/* Lignes */}
        {rows.map(r => (
          <View key={r.id} style={styles.ligneCard}>
            <View style={{ flex: 1 }}>
              <View style={styles.respNomRow}>
                <Text style={styles.ligneNom}>{r.responsable_nom}</Text>
                {/* Qui a désigné cette personne : la caisse ou le gérant ?
                    Un manager ne doit jamais avoir à le deviner. */}
                {r.source === 'POS' && (
                  <View style={styles.sourcePOSBadge}>
                    <Text style={styles.sourcePOSBadgeTxt}>Mesuré au POS</Text>
                  </View>
                )}
              </View>
              <Text style={styles.ligneSous}>
                {r.type === 'manquant' ? 'Manquant' : 'Surplus'} · {r.date}
                {r.role ? ` · ${r.role === 'gerant' ? 'Gérant' : 'Caissier'}` : ''}
              </Text>
              {r.explication ? (
                <Text style={styles.ligneSous}>« {r.explication} »</Text>
              ) : null}
            </View>
            <Text style={[styles.montantTxt, { color: r.type === 'manquant' ? colors.error : colors.primary }]}>{fmtShort(r.montant)}</Text>
          </View>
        ))}
      </View>
    )
  }

  function renderInventaire() {
    if (!inventaireShifts.length) {
      return (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTxt}>Aucune déduction inventaire validée</Text>
          <Text style={styles.emptySubTxt}>Les déductions apparaissent quand un shift inventaire est validé</Text>
        </View>
      )
    }

    return (
      <View style={styles.section}>
        <View style={styles.totalBanner}>
          <Text style={styles.totalBannerLabel}>Total déductions inventaire</Text>
          <Text style={[styles.totalBannerValue, { color: colors.error }]}>{fmt(totalInventaire)}</Text>
        </View>

        {/* Comptages du vérificateur : montants plafonnés, en attente ou répartis */}
        {deducVerifResto.length > 0 && (
          <>
            <View style={[styles.totalBanner, { marginTop: 10 }]}>
              <Text style={styles.totalBannerLabel}>Comptage vérificateur</Text>
              <Text style={[styles.totalBannerValue, { color: colors.error }]}>{fmt(totalVerif)}</Text>
            </View>
            {totalVerifReel > totalVerif && (
              <View style={styles.plafondBox}>
                <Text style={styles.plafondTxt}>
                  Écart réellement constaté {fmt(totalVerifReel)} — plafond de {fmt(PLAFOND_COMPTAGE)}
                  {' '}par comptage appliqué, {fmt(totalVerif)} retenus.
                </Text>
              </View>
            )}
            {deducVerifResto.map(d => (
              <View key={d.id} style={styles.globalItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.globalItemTxt} numberOfLines={2}>
                    {d.date} — {d.produits_resume || `${d.nb_produits || 0} produit(s) en écart`}
                  </Text>
                  <Text style={styles.globalItemResp}>
                    {d.caissier_nom}{d.shift_libelle ? ` · ${d.shift_libelle}` : ''}
                    {d.statut === 'en_attente' ? ' · à répartir' : ' · réparti'}
                  </Text>
                </View>
                <Text style={[styles.globalItemMontant, { color: colors.error }]}>{fmtShort(d.montant)}</Text>
              </View>
            ))}
          </>
        )}
        {inventaireShifts.map(inv => {
          const shiftLabel = SHIFT_LABELS[inv.type_shift] || inv.type_shift || 'Shift'
          // Grouper les lignes par catégorie
          const parCat = {}
          inv.lignes.forEach(l => {
            const cat = PRODUIT_TO_CAT[l.produit_id] || l.produit_nom || '?'
            parCat[cat] = (parCat[cat] || 0) + (l.montant_deduit || 0)
          })
          const catEntries = Object.entries(parCat).filter(([, v]) => v > 0)

          return (
            <View key={inv.id} style={[styles.ligneCard, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
              {/* En-tête shift */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={styles.ligneNom}>{inv.caissier_nom} — {shiftLabel}</Text>
                  {multiJour && inv.date ? info('calendar-blank-outline', inv.date, styles.ligneSous) : null}
                </View>
                <Text style={[styles.montantTxt, { color: colors.error }]}>−{fmtShort(inv.montant_a_deduire)}</Text>
              </View>
              {/* Détail : par produit (manager → bouton Annuler) ou par catégorie (lecture seule) */}
              {peutRegulariser ? (
                inv.lignes.length > 0 && (
                  <View style={styles.catDetail}>
                    {inv.lignes.map(l => (
                      <View key={l.id} style={styles.prodLigne}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={styles.catNom}>{l.produit_nom}</Text>
                          <Text style={[styles.catMontant, { color: colors.error }]}>−{fmtShort(l.montant_deduit)} FCFA</Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.annulDeducBtnSm, annulDeducSaving === l.id && { opacity: 0.6 }]}
                          onPress={() => confirmerAnnulationDeductionLitige(l, inv)}
                          disabled={!!annulDeducSaving}
                        >
                          {annulDeducSaving === l.id
                            ? <ActivityIndicator color={colors.error} size="small" />
                            : <Text style={styles.annulDeducBtnSmTxt}>Annuler</Text>}
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )
              ) : (
                catEntries.length > 0 && (
                  <View style={styles.catDetail}>
                    {catEntries.map(([cat, montant]) => (
                      <View key={cat} style={styles.catLigne}>
                        <Text style={styles.catNom}>{cat}</Text>
                        <Text style={styles.catMontant}>{fmtShort(montant)} FCFA</Text>
                      </View>
                    ))}
                  </View>
                )
              )}
            </View>
          )
        })}
      </View>
    )
  }

  function renderAvis() {
    return (
      <View style={styles.section}>
        {avisClients.length > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Impact total avis</Text>
            <Text style={[styles.totalBannerValue, { color: totalAvis > 0 ? colors.error : colors.successDark }]}>
              {totalAvis > 0 ? '+' : ''}{fmt(totalAvis)}
            </Text>
          </View>
        )}
        {avisClients.some(a => !a.responsable_id && !a.responsable_nom) && (
          <TouchableOpacity style={styles.attribuerBtn} onPress={attribuerAvisAutomatiquement} disabled={attributionEnCours}>
            {attributionEnCours
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <MaterialCommunityIcons name="account-arrow-left-outline" size={18} color={colors.primary} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.attribuerBtnTxt}>
                Attribuer les {avisClients.filter(a => !a.responsable_id && !a.responsable_nom).length} avis sans responsable
              </Text>
              <Text style={styles.attribuerBtnSous}>Au caissier présent à l’heure de la commande (ou seul caissier du jour)</Text>
            </View>
          </TouchableOpacity>
        )}
        {avisClients.map(a => {
          const type = typeAvis(a.type)
          return (
            <View key={a.id} {...focus.props(a.id)} style={[styles.ligneCard, focus.style(a.id)]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ligneNom, { color: type?.couleur || colors.text }]}>{type?.label || a.type}</Text>
                {a.canal ? info('map-marker-outline', canalAvis(a.canal)?.court || a.canal, [styles.ligneSous, { color: canalAvis(a.canal)?.couleur || colors.textMuted, fontWeight: '700' }]) : null}
                {a.responsable_nom ? info('account-outline', a.responsable_nom, styles.ligneSous) : null}
                {a.numero_commande ? info('receipt-text-outline', <>Commande #{a.numero_commande}</>, styles.ligneCmd) : null}
                {multiJour && a.date ? info('calendar-blank-outline', `${a.date}${a.heure_commande ? ` · ${String(a.heure_commande).slice(0, 5)}` : ''}`, styles.ligneSous) : null}
                {!multiJour && a.heure_commande ? info('clock-outline', `Commande à ${String(a.heure_commande).slice(0, 5)}`, styles.ligneSous) : null}
                {a.notes ? <Text style={styles.ligneSous}>{a.notes}</Text> : null}
                {a.created_by ? <Text style={styles.ligneCreer}>par {a.created_by}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[styles.montantTxt, { color: couleurMontant(a.montant, colors) }]}>
                  {a.montant > 0 ? '+' : ''}{fmtShort(a.montant)}
                </Text>
                {actions(() => ouvrirEditAvis(a), () => setConfirmSuppr({ table: 'litiges_avis_clients', id: a.id }))}
              </View>
            </View>
          )
        })}
        {!avisClients.length && <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun avis enregistré</Text></View>}
        <TouchableOpacity style={styles.btnAjout} onPress={ouvrirAddAvis}>
          <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
          <Text style={styles.btnAjoutTxt}>Ajouter un avis client</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Ligne Yango/Glovo : pastille « auto », détail déplié, et pour une ligne
  // automatique « Responsable » (choix gardé au recalcul) et « Annuler » (une
  // modification du montant serait écrasée ; une simple suppression recréée).
  function extrasAuto(l) {
    if (l.origine !== 'auto') return null
    const lignes = l.detail?.lignes || []
    return (
      <>
        <View style={styles.pastilleAuto}><Text style={styles.pastilleAutoTxt}>auto</Text></View>
        {lignes.length > 0 && (
          <TouchableOpacity onPress={() => setDetailOuvert(detailOuvert === l.id ? null : l.id)}>
            <Text style={styles.lienDetail}>{detailOuvert === l.id ? 'Masquer le détail' : 'Voir le détail'}</Text>
          </TouchableOpacity>
        )}
        {detailOuvert === l.id && lignes.map((d, i) => (
          <Text key={i} style={styles.ligneDetail}>
            {d.heure} · {d.plat ? `${d.plat} · ` : ''}n° {d.commande} · {fmtShort(d.prix)}
          </Text>
        ))}
      </>
    )
  }
  function actionsPlateforme(l, table, onModifier) {
    if (l.origine !== 'auto') return actions(onModifier, () => setConfirmSuppr({ table, id: l.id }))
    if (roleActif !== 'manager') return null
    return (
      <View style={{ alignItems: 'flex-end' }}>
        <TouchableOpacity
          onPress={() => { setSaveError(null); setRechercheResp(''); setRespAuto({ table, litige: l, responsable_id: l.responsable_id || null, responsable_nom: l.responsable_nom || '' }) }}
          accessibilityRole="button"
        >
          <Text style={styles.lienResponsable}>Responsable</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setConfirmSuppr({ table, id: l.id, auto: l })} accessibilityRole="button">
          <Text style={styles.lienAnnuler}>Annuler</Text>
        </TouchableOpacity>
      </View>
    )
  }
  function bandeauARelier() {
    if (!aRelier || roleActif !== 'manager') return null
    return (
      <TouchableOpacity style={styles.bandeauRelier} onPress={() => router.push('/correspondances-plats')}>
        <Text style={styles.bandeauRelierTxt}>
          {aRelier} journée{aRelier > 1 ? 's' : ''} en attente : des plats Glovo/Yango ne sont pas encore reliés au POS. Toucher pour les relier.
        </Text>
      </TouchableOpacity>
    )
  }

  function blocErreursSaisie(plateforme) {
    const liste = erreursSaisie[plateforme] || []
    if (!liste.length) return null
    const jj = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
    return (
      <View style={styles.ligneCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.ligneNom}>Erreurs de saisie · pas de litige</Text>
          <Text style={styles.ligneDetail}>
            Le caissier a tapé un autre plat, ou la commande sur la mauvaise plateforme, avec le bon numéro : rien n'est reproché, même si le prix diffère.
          </Text>
          {liste.map((e, i) => (
            <Text key={`${e.jour}-${e.commande}-${i}`} style={[styles.ligneDetail, { marginTop: 6 }]}>
              {jj(e.jour)} {e.heure} · commande {e.commande}{e.caissier_nom ? ` · ${e.caissier_nom}` : ''}{'\n'}
              vendu {e.vendu} ({fmtShort(e.prix_vendu)}) → tapé {e.tape} ({fmtShort(e.prix_tape)}){e.tape_en ? ` en ${e.tape_en === 'yango' ? 'Yango' : 'Glovo'} au lieu de ${plateforme === 'yango' ? 'Yango' : 'Glovo'}` : ''}
              {e.prix_tape !== e.prix_vendu ? ` · écart ${e.prix_tape > e.prix_vendu ? '+' : '−'} ${fmtShort(Math.abs(e.prix_tape - e.prix_vendu))}` : ''}
            </Text>
          ))}
        </View>
      </View>
    )
  }

  function renderYango() {
    return (
      <View style={styles.section}>
        {bandeauARelier()}
        {blocErreursSaisie('yango')}
        {litigesYango.length > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Impact total Yango</Text>
            <Text style={[styles.totalBannerValue, { color: totalYango > 0 ? colors.error : colors.successDark }]}>
              {totalYango > 0 ? '+' : ''}{fmt(totalYango)}
            </Text>
          </View>
        )}
        {litigesYango.map(y => {
          const type = TYPES_YANGO.find(t => t.key === y.type)
          return (
            <View key={y.id} {...focus.props(y.id)} style={[styles.ligneCard, focus.style(y.id)]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ligneNom, { color: type?.couleur || colors.text }]}>{type?.label || y.type}</Text>
                {y.responsable_nom ? info('account-outline', y.responsable_nom, styles.ligneSous) : null}
                {y.numero_commande ? info('receipt-text-outline', <>Commande #{y.numero_commande}</>, styles.ligneCmd) : null}
                {multiJour && y.date ? info('calendar-blank-outline', y.date, styles.ligneSous) : null}
                {y.notes ? <Text style={styles.ligneSous}>{y.notes}</Text> : null}
                {y.created_by ? <Text style={styles.ligneCreer}>par {y.created_by}</Text> : null}
                {extrasAuto(y)}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[styles.montantTxt, { color: y.montant > 0 ? colors.error : colors.successDark }]}>
                  {y.montant > 0 ? '+' : ''}{fmtShort(y.montant)}
                </Text>
                {actionsPlateforme(y, 'litiges_yango', () => ouvrirEditYango(y))}
              </View>
            </View>
          )
        })}
        {!litigesYango.length && <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun litige Yango enregistré</Text></View>}
        <TouchableOpacity style={styles.btnAjout} onPress={ouvrirAddYango}>
          <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
          <Text style={styles.btnAjoutTxt}>Ajouter un litige Yango</Text>
        </TouchableOpacity>
      </View>
    )
  }

  function renderGlovo() {
    return (
      <View style={styles.section}>
        {bandeauARelier()}
        {blocErreursSaisie('glovo')}
        {litigesGlovo.length > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Impact total Glovo</Text>
            <Text style={[styles.totalBannerValue, { color: totalGlovo > 0 ? colors.error : colors.successDark }]}>
              {totalGlovo > 0 ? '+' : ''}{fmt(totalGlovo)}
            </Text>
          </View>
        )}
        {litigesGlovo.map(g => {
          const type = TYPES_GLOVO.find(t => t.key === g.type)
          return (
            <View key={g.id} {...focus.props(g.id)} style={[styles.ligneCard, focus.style(g.id)]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ligneNom, { color: type?.couleur || colors.text }]}>{type?.label || g.type}</Text>
                {g.responsable_nom ? info('account-outline', g.responsable_nom, styles.ligneSous) : null}
                {g.numero_commande ? info('receipt-text-outline', <>Commande #{g.numero_commande}</>, styles.ligneCmd) : null}
                {multiJour && g.date ? info('calendar-blank-outline', g.date, styles.ligneSous) : null}
                {g.notes ? <Text style={styles.ligneSous}>{g.notes}</Text> : null}
                {g.created_by ? <Text style={styles.ligneCreer}>par {g.created_by}</Text> : null}
                {extrasAuto(g)}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[styles.montantTxt, { color: g.montant > 0 ? colors.error : colors.successDark }]}>
                  {g.montant > 0 ? '+' : ''}{fmtShort(g.montant)}
                </Text>
                {actionsPlateforme(g, 'litiges_glovo', () => ouvrirEditGlovo(g))}
              </View>
            </View>
          )
        })}
        {!litigesGlovo.length && <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun litige Glovo enregistré</Text></View>}
        <TouchableOpacity style={styles.btnAjout} onPress={ouvrirAddGlovo}>
          <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
          <Text style={styles.btnAjoutTxt}>Ajouter un litige Glovo</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Corrections du volet Contacts (manager / directeur) ──────
  function ouvrirCorrNbCommandes(item) {
    setCorrError('')
    setCorrCmd(item)
    setCorrCmdForm({
      yango: String(item.nbYango || 0),
      glovo: String(item.nbGlovo || 0),
      motif: item.nbCorrigeMotif || '',
    })
  }

  function ouvrirCorrLitige(item) {
    setCorrError('')
    setCorrLitige(item)
    setCorrLitigeForm({
      montant: String(item.forceParManager ? item.litige : item.litigeCalcule),
      motif: item.motif || '',
    })
  }

  async function sauvegarderCorrNbCommandes() {
    if (!corrCmd) return
    setCorrSaving(true)
    setCorrError('')
    const res = await corrigerNbCommandes({
      point: corrCmd.point,
      yango: corrCmdForm.yango,
      glovo: corrCmdForm.glovo,
      motif: corrCmdForm.motif,
      userId, userNom,
    })
    setCorrSaving(false)
    if (!res.ok) { setCorrError(res.error); return }
    setCorrCmd(null)
    await chargerEcartContacts()
    Alert.alert('✅ Nombre corrigé', 'Le litige contacts a été recalculé. Le gérant a été notifié.')
  }

  async function sauvegarderCorrLitige(annulerCorrection = false) {
    if (!corrLitige) return
    setCorrSaving(true)
    setCorrError('')
    const res = await forcerLitigeContact({
      point: corrLitige.point,
      montant: annulerCorrection ? null : corrLitigeForm.montant,
      motif: corrLitigeForm.motif,
      litigeCalcule: corrLitige.litigeCalcule,
      userId, userNom,
    })
    setCorrSaving(false)
    if (!res.ok) { setCorrError(res.error); return }
    setCorrLitige(null)
    await chargerEcartContacts()
    Alert.alert(
      annulerCorrection ? '↩️ Correction retirée' : '✅ Litige corrigé',
      annulerCorrection
        ? 'Le montant calculé automatiquement s’applique de nouveau.'
        : 'Le montant retenu a été enregistré. Le gérant a été notifié.'
    )
  }

  function renderEcartContacts() {
    const multiJour = !unSeulJour(periodeKey)
    return (
      <View style={styles.section}>
        {totalContact > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Total litige contacts</Text>
            <Text style={[styles.totalBannerValue, { color: colors.error }]}>{fmt(totalContact)}</Text>
          </View>
        )}
        {totalContact > 0 && totauxContacts.parCaissier.length > 0 && (
          <View style={[styles.ligneCard, { flexDirection: 'column', alignItems: 'stretch', gap: 4 }]}>
            <Text style={[styles.ligneNom, { color: colors.text }]}>Par caissier</Text>
            {totauxContacts.parCaissier.map(c => (
              <View key={c.cle} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.ligneSous}>{`${c.nom} · ${c.jours} jour${c.jours > 1 ? 's' : ''}`}</Text>
                <Text style={[styles.ligneSous, { color: colors.error, fontWeight: '700' }]}>{fmt(c.montant)}</Text>
              </View>
            ))}
            {totauxContacts.nonAttribue > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[styles.ligneSous, { color: colors.warningDark }]}>Non attribué</Text>
                <Text style={[styles.ligneSous, { color: colors.warningDark, fontWeight: '700' }]}>{fmt(totauxContacts.nonAttribue)}</Text>
              </View>
            )}
          </View>
        )}
        {ecartContacts.length === 0 ? (
          <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucune donnée sur cette période</Text></View>
        ) : (
          ecartContacts.map((item, idx) => {
            const parfait = item.ecart === 0
            const tolere = item.taux > 0 && item.taux <= 20
            // Plus de contacts que de commandes = surplus : jamais un litige
            // (même règle que le volet Écarts, où seuls les manquants comptent).
            const surplus = item.ecart < 0
            const aLitige = item.litige > 0
            return (
              <View key={idx} style={[styles.ligneCard, { flexDirection: 'column', alignItems: 'stretch' }, aLitige && { borderColor: colors.error + '66' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.ligneNom, { color: colors.text }]}>{item.date}</Text>
                    {item.caissiers ? info('account-outline', item.caissiers, styles.ligneSous) : null}
                    <Text style={styles.ligneSous}>
                      Cmds : {item.nbCommandes} (Y {item.nbYango} · G {item.nbGlovo})  ·  Contacts :{' '}
                      {item.contactsDisponibles ? item.nbContacts : 'en attente du POS'}
                      {item.contactsDisponibles ? `  ·  Écart : ${item.ecart}  ·  ${item.taux}%` : ''}
                      {item.contactsSource === 'POS' ? '  ·  Source : POS' : ''}
                    </Text>
                    {item.contactsIncomplets && (
                      <Text style={[styles.ligneSous, { color: colors.warningDark }]}>
                        Comptage incomplet : {item.shiftsSansContact} shift
                        {item.shiftsSansContact > 1 ? 's' : ''} sans données contacts POS
                      </Text>
                    )}
                    {item.calculSuspendu && item.nbCommandes > 0 && (
                      <Text style={[styles.ligneSous, { color: colors.warningDark }]}>{item.motifSuspension}</Text>
                    )}
                    {item.nbCorrige && (
                      <Text style={styles.corrBadge}>
                        Nombre corrigé (avant : Y {item.nbYangoOriginal ?? '—'} · G {item.nbGlovoOriginal ?? '—'})
                        {item.nbCorrigePar ? ` — ${item.nbCorrigePar}` : ''}
                        {item.nbCorrigeMotif ? ` · ${item.nbCorrigeMotif}` : ''}
                      </Text>
                    )}
                    {item.contactsParCaissier?.length > 0 && (
                      <View style={{ marginTop: 4, gap: 2 }}>
                        {item.contactsParCaissier.map((c, ci) => {
                          const part = item.repartition?.parts.find(x => x.cle === c.cle)
                          return (
                            <Text key={ci} style={[styles.ligneSous, { color: colors.primary }]}>
                              {c.nom} : {c.contacts == null
                                ? 'non transmis'
                                : `${c.contacts} / ${c.commandes == null ? '—' : c.commandes}`}
                              {part ? <Text style={{ color: colors.error, fontWeight: '700' }}>{`  → ${fmtShort(part.montant)} F`}</Text> : null}
                            </Text>
                          )
                        })}
                        {item.repartition?.nonAttribue > 0 && (
                          <Text style={[styles.ligneSous, { color: colors.warningDark }]}>
                            {`Non attribué : ${fmtShort(item.repartition.nonAttribue)} F (compteurs du POS incomplets)`}
                          </Text>
                        )}
                      </View>
                    )}
                    {parfait && !item.forceParManager && <Text style={[styles.statutContact, { color: colors.successDark, backgroundColor: colors.successLight }]}>Parfait</Text>}
                    {tolere && !item.forceParManager && <Text style={[styles.statutContact, { color: colors.warningDark, backgroundColor: colors.warningLight }]}>Toléré</Text>}
                    {surplus && !item.forceParManager && (
                      <Text style={{ fontSize: 12, color: colors.warningDark, fontWeight: '600' }}>
                        Surplus de {Math.abs(item.ecart)} contact{Math.abs(item.ecart) > 1 ? 's' : ''} — pas de litige
                      </Text>
                    )}
                    {item.litigeCalcule > 0 && !item.forceParManager && (
                      <Text style={{ fontSize: 12, color: colors.error, fontWeight: '700' }}>
                        {item.ecart} × 500 = {fmtShort(item.litigeCalcule)}
                      </Text>
                    )}
                    {item.forceParManager && (
                      <Text style={styles.corrBadge}>
                        Montant forcé (calculé : {fmtShort(item.litigeCalcule)})
                        {item.forcePar ? ` — ${item.forcePar}` : ''}
                        {item.motif ? ` · ${item.motif}` : ''}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.montantTxt, { color: item.litige > 0 ? colors.error : colors.successDark }]}>
                    {fmtShort(item.litige)}
                  </Text>
                </View>

                {peutRegulariser && item.point && (
                  <View style={styles.corrBtnRow}>
                    <TouchableOpacity style={styles.corrBtn} onPress={() => ouvrirCorrNbCommandes(item)}>
                      <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.primary} />
                      <Text style={styles.corrBtnTxt}>Nb commandes</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.corrBtn} onPress={() => ouvrirCorrLitige(item)}>
                      <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.primary} />
                      <Text style={styles.corrBtnTxt}>Montant du litige</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )
          })
        )}
        {ecartContacts.length > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderLight }}>
            <Text style={{ fontSize: 13, color: colors.textMuted, fontWeight: '600' }}>Total litige contacts</Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: totalContact > 0 ? colors.error : colors.successDark }}>
              {totalContact > 0 ? fmtShort(totalContact) : '0 FCFA'}
            </Text>
          </View>
        )}
      </View>
    )
  }

  // ── Label plage affichée ─────────────────────────────────────
  function plageLabel() {
    if (periodeKey === '1jour') return dateUnique
    if (periodeKey === 'hier') return HIER
    return `${plage.debut} → ${plage.fin}`
  }

  // Montant de chaque onglet, affiché sous son nom
  const montantsOnglets = {
    ecarts: totalEcart, inventaire: totalInventaire + totalVerif, avis: totalAvis,
    yango: totalYango, glovo: totalGlovo, contact: totalContact, point_pas_fait: totalPointPasFait,
    tout: donneesResto?.total ?? 0,
  }
  const avecOnglets = !modeGlobal && !!restoSelectionne
  const tonGlobal = totalGlobal > 0 ? 'rouge' : totalGlobal < 0 ? 'vert' : 'gris'
  const couleurTon = { rouge: colors.error, vert: colors.successDark, gris: colors.textMuted }[tonGlobal]
  const fondTon = { rouge: colors.errorLight, vert: colors.successLight, gris: colors.surfaceAlt }[tonGlobal]

  return (
    <SafeAreaView style={styles.container}>

      {/* En-tête : titre + restaurant */}
      <View style={styles.header}>
        <View style={styles.headerLigne}>
          <TouchableOpacity onPress={() => retour()} style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Retour">
            <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.headerCentre}>
            <View style={styles.headerIcone}>
              <MaterialCommunityIcons name="scale-balance" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.headerTitre}>Litiges</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <TouchableOpacity
          style={styles.restoBtn}
          onPress={() => setShowRestoPicker(true)}
          disabled={isGerant}
          accessibilityRole="button"
          accessibilityLabel="Choisir le restaurant"
        >
          <MaterialCommunityIcons name={modeGlobal ? 'earth' : 'storefront-outline'} size={17} color="#FFFFFF" />
          <Text style={styles.restoTxt} numberOfLines={1}>
            {modeGlobal ? 'Tous les restaurants' : (restoSelectionne?.nom || 'Choisir un restaurant')}
          </Text>
          {!isGerant && <MaterialCommunityIcons name="chevron-down" size={18} color="#FFFFFF" />}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContenu}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={avecOnglets ? [2] : undefined}
      >
        {/* 0 — Période */}
        <View style={styles.filtreCarte}>
          <View style={styles.periodeRangee}>
            {PERIODES.map(p => (
              <TouchableOpacity
                key={p.key}
                style={[styles.periodePill, periodeKey === p.key && styles.periodePillActive]}
                onPress={() => setPeriodeKey(p.key)}
              >
                <Text style={[styles.periodePillTxt, periodeKey === p.key && styles.periodePillTxtActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.dateRow}>
            {periodeKey === '1jour' ? (
              <TouchableOpacity style={styles.datePill} onPress={() => setShowCalUnique(true)}>
                <MaterialCommunityIcons name="calendar-month-outline" size={16} color={colors.primary} />
                <Text style={styles.datePillTxt}>{dateUnique}</Text>
                <MaterialCommunityIcons name="chevron-down" size={16} color={colors.primary} />
              </TouchableOpacity>
            ) : periodeKey === 'perso' ? (
              <>
                <TouchableOpacity style={styles.datePill} onPress={() => { setBrouillonPerso({ debut: dateDebut, fin: dateFin }); setShowCalDebut(true) }}>
                  <MaterialCommunityIcons name="calendar-month-outline" size={16} color={colors.primary} />
                  <Text style={styles.datePillTxt}>Du {dateDebut}</Text>
                </TouchableOpacity>
                <MaterialCommunityIcons name="arrow-right" size={16} color={colors.textMuted} />
                <TouchableOpacity style={styles.datePill} onPress={() => { setBrouillonPerso({ debut: dateDebut, fin: dateFin }); setShowCalDebut(true) }}>
                  <Text style={styles.datePillTxt}>Au {dateFin}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={[styles.datePill, styles.datePillFixe]}>
                <MaterialCommunityIcons name="calendar-range" size={16} color={colors.textSecondary} />
                <Text style={[styles.datePillTxt, { color: colors.textSecondary }]}>{plage.debut === plage.fin ? plage.debut : `${plage.debut} → ${plage.fin}`}</Text>
              </View>
            )}
          </View>
        </View>

        {/* 1 — Impact total du restaurant */}
        <View>
          {avecOnglets && (
            <View style={[styles.impactCarte, { borderColor: couleurTon + '40' }]}>
              <View style={[styles.impactIcone, { backgroundColor: fondTon }]}>
                <MaterialCommunityIcons name="scale-balance" size={22} color={couleurTon} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.impactLabel}>Impact total</Text>
                <Text style={styles.impactSous} numberOfLines={1}>
                  {totalGlobal > 0 ? 'À la charge du restaurant' : totalGlobal < 0 ? 'En faveur du restaurant' : 'Aucun litige sur la période'}
                </Text>
              </View>
              <Text style={[styles.impactValeur, { color: couleurTon }]}>
                {totalGlobal > 0 ? '+' : ''}{fmt(totalGlobal)}
              </Text>
            </View>
          )}
        </View>

        {/* 2 — Onglets (restent en haut au défilement) */}
        <View style={avecOnglets ? styles.ongletsFond : null}>
          {avecOnglets && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent}>
              {ONGLETS.map(o => {
                const actif = onglet === o.key
                const m = montantsOnglets[o.key] || 0
                return (
                  <TouchableOpacity key={o.key} style={[styles.tab, actif && styles.tabActive]} onPress={() => setOnglet(o.key)}>
                    <Text style={[styles.tabTxt, actif && styles.tabTxtActive]}>{o.label}</Text>
                    <Text style={[styles.tabMontant, { color: actif ? 'rgba(255,255,255,0.85)' : m > 0 ? colors.error : m < 0 ? colors.successDark : colors.textMuted }]}>
                      {m === 0 ? '—' : `${m > 0 ? '+' : ''}${fmtShort(m)}`}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          )}
        </View>

        {/* 3 — Contenu */}
        <View>
          {loading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : modeGlobal ? (
            renderModeGlobal()
          ) : !restoSelectionne ? (
            <View style={styles.emptyBox}>
              <MaterialCommunityIcons name="storefront-outline" size={34} color={colors.textMuted} />
              <Text style={styles.emptyTxt}>Choisissez un restaurant</Text>
            </View>
          ) : (
            <>
              {litigesStock > 0 && (
                <TouchableOpacity style={styles.bandeauRelier} onPress={() => router.push('/verification')}>
                  <Text style={styles.bandeauRelierTxt}>
                    {litigesStock} litige{litigesStock > 1 ? 's' : ''} de stock initial à décider dans l’écran Vérification →
                  </Text>
                </TouchableOpacity>
              )}
              {onglet === 'ecarts' && (<>{renderEcarts()}{renderResponsablesEcarts()}</>)}
              {onglet === 'inventaire' && renderInventaire()}
              {onglet === 'avis' && renderAvis()}
              {onglet === 'yango' && renderYango()}
              {onglet === 'glovo' && renderGlovo()}
              {onglet === 'contact' && renderEcartContacts()}
              {onglet === 'point_pas_fait' && renderPointPasFait()}
              {onglet === 'tout' && (donneesResto && donneesResto.restaurant.id === restoSelectionne.id ? (
                <View style={styles.section}>
                  <TouchableOpacity
                    style={[styles.btnPdf, generatingPdf && { opacity: 0.6 }]}
                    onPress={() => genererEtPartagePDF([donneesResto], { parCaissier: true })}
                    disabled={generatingPdf}
                  >
                    {generatingPdf
                      ? <ActivityIndicator color="#FFFFFF" size="small" />
                      : <MaterialCommunityIcons name="file-pdf-box" size={20} color="#FFFFFF" />}
                    <Text style={styles.btnPdfTxt}>{generatingPdf ? 'Génération du PDF…' : 'Télécharger le PDF (avec résumé caissiers)'}</Text>
                  </TouchableOpacity>
                  {renderCarteResto(donneesResto)}
                </View>
              ) : (
                <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucune donnée pour cette période</Text></View>
              ))}
            </>
          )}
        </View>
      </ScrollView>

      {/* ── Modal Restaurant ── */}
      <Modal visible={showRestoPicker} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowRestoPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.pickerBox}>
            <Text style={styles.pickerTitre}>Sélectionner un restaurant</Text>
            <ScrollView>
              {/* Option "Tous les restaurants" — masquée pour le gérant */}
              {!isGerant && (
                <TouchableOpacity
                  style={[styles.pickerLigne, modeGlobal && styles.pickerLigneActive, { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                  onPress={() => { setModeGlobal(true); setRestoSelectionne(null); setShowRestoPicker(false) }}
                >
                  <Text style={[styles.pickerLigneTxt, modeGlobal && { color: colors.primary, fontWeight: '700' }]}>Tous les restaurants</Text>
                </TouchableOpacity>
              )}
              {restaurants.map(r => (
                <TouchableOpacity key={r.id}
                  style={[styles.pickerLigne, !modeGlobal && restoSelectionne?.id === r.id && styles.pickerLigneActive]}
                  onPress={() => { setModeGlobal(false); setRestoSelectionne(r); chargerDatesAvec(r.id); chargerUtilisateurs(r.id); setShowRestoPicker(false) }}
                >
                  <Text style={[styles.pickerLigneTxt, !modeGlobal && restoSelectionne?.id === r.id && { color: colors.primary, fontWeight: '600' }]}>{r.nom}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Calendrier 1 jour ── */}
      <Modal visible={showCalUnique} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowCalUnique(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.pickerBox, { padding: 0 }]}>
            <CalendrierFr valeur={dateUnique} marques={datesAvec} couleur={colors.primary}
              onChoisir={iso => { setDateUnique(iso); setShowCalUnique(false) }} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Calendrier période perso : un jour de début, un jour de fin, ou un mois entier ── */}
      <Modal visible={showCalDebut} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowCalDebut(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.pickerBox, { padding: 0 }]}>
            <CalendrierPeriode debut={brouillonPerso.debut} fin={brouillonPerso.fin} couleur={colors.primary} maxDate={null}
              onChange={p => {
                setBrouillonPerso(p)
                if (p.debut && p.fin) { setDateDebut(p.debut); setDateFin(p.fin); setShowCalDebut(false) }
              }} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal Avis Client ── */}
      <Modal visible={showFormAvis} transparent animationType="slide">
        <ScrollView contentContainerStyle={styles.overlay} keyboardShouldPersistTaps="handled">
          <View style={styles.formModal}>
            <Text style={styles.formTitre}>{formAvis.id ? "Modifier l'avis" : 'Ajouter un avis client'}</Text>

            <Text style={styles.formLabel}>Type d'avis</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {TYPES_AVIS.map(t => (
                <TouchableOpacity key={t.key}
                  style={[styles.typeBtn, { flex: 1 }, formAvis.type === t.key && { backgroundColor: t.couleur, borderColor: t.couleur }]}
                  onPress={() => setFormAvis(p => ({ ...p, type: t.key }))}
                >
                  <Text style={[styles.typeBtnTxt, formAvis.type === t.key && { color: '#fff' }]}>{t.court || t.label}</Text>
                  <Text style={[styles.typeBtnMontant, formAvis.type === t.key && { color: '#ffffffbb' }]}>
                    {t.montant === 0 ? 'aucun impact' : `${t.montant > 0 ? '+' : ''}${t.montant} FCFA`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formLabel}>Canal du client</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {CANAUX_AVIS.map(c => {
                const actif = (formAvis.canal || 'sur_place') === c.key
                return (
                  <TouchableOpacity key={c.key}
                    style={[styles.typeBtn, { flex: 1 }, actif && { backgroundColor: c.couleur, borderColor: c.couleur }]}
                    onPress={() => setFormAvis(p => ({ ...p, canal: c.key }))}
                  >
                    <Text style={[styles.typeBtnTxt, actif && { color: '#fff' }]}>{c.label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.formLabel}>N° de commande (optionnel)</Text>
            <TextInput style={styles.formInput} value={formAvis.numero_commande}
              onChangeText={v => setFormAvis(p => ({ ...p, numero_commande: v }))}
              placeholder="Ex: 48291" placeholderTextColor="#bbb" keyboardType="default" />

            <ChampDate label="Date" styleLabel={styles.formLabel} valeur={formAvis.date_saisie}
              onChange={v => { setFormAvis(p => ({ ...p, date_saisie: v })); if (v) chargerShiftsAvis(v, v) }} />
            <Text style={styles.formLabel}>Heure commande</Text>
            <TextInput style={styles.formInput} value={formAvis.heure}
              onChangeText={v => setFormAvis(p => ({ ...p, heure: v }))}
              placeholder="Ex : 9h30" placeholderTextColor={colors.textPlaceholder} />
            {(() => {
              const r = caissierAuMoment(shiftsAvis, { restaurantId: restoSelectionne?.id, date: formAvis.date_saisie, heure: formAvis.heure })
              const trouve = !!(r.caissier_id || r.caissier_nom)
              const dejaChoisi = trouve && (formAvis.responsable_id ? formAvis.responsable_id === r.caissier_id : formAvis.responsable_nom === r.caissier_nom)
              return (
                <View style={[styles.suggestion, { backgroundColor: trouve ? colors.successLight : colors.surfaceAlt }]}>
                  <MaterialCommunityIcons name={trouve ? 'account-check-outline' : 'account-question-outline'} size={18}
                    color={trouve ? colors.successDark : colors.textSecondary} />
                  <Text style={[styles.suggestionTxt, { color: trouve ? colors.successDark : colors.textSecondary }]}>
                    {phraseAttribution(r, formAvis.heure)}
                  </Text>
                  {trouve && !dejaChoisi ? (
                    <TouchableOpacity style={styles.suggestionBtn}
                      onPress={() => setFormAvis(p => ({ ...p, responsable_id: r.caissier_id, responsable_nom: r.caissier_nom }))}>
                      <Text style={styles.suggestionBtnTxt}>Attribuer</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )
            })()}

            {renderResponsablePicker(formAvis.responsable_id, formAvis.responsable_nom, (id, nom) => setFormAvis(p => ({ ...p, responsable_id: id, responsable_nom: nom })))}
            {formAvis.responsable_nom && !formAvis.responsable_id ? (
              <Text style={[styles.ligneSous, { marginTop: -6, marginBottom: 10 }]}>Responsable : {formAvis.responsable_nom} (nom du POS)</Text>
            ) : null}

            <Text style={styles.formLabel}>Notes (optionnel)</Text>
            <TextInput style={[styles.formInput, { height: 56 }]} value={formAvis.notes}
              onChangeText={v => setFormAvis(p => ({ ...p, notes: v }))}
              placeholder="Détails du litige..." placeholderTextColor="#bbb" multiline />

            {saveError && <Text style={{ color: colors.error, fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{saveError}</Text>}
            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => { setShowFormAvis(false); setSaveError(null) }}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnValider} onPress={sauvegarderAvis} disabled={saving}>
                <Text style={styles.btnValiderTxt}>{saving ? '...' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </Modal>

      {/* ── Modal Yango ── */}
      <Modal visible={showFormYango} transparent animationType="slide">
        <ScrollView contentContainerStyle={styles.overlay} keyboardShouldPersistTaps="handled">
          <View style={styles.formModal}>
            <Text style={styles.formTitre}>{formYango.id ? 'Modifier Yango' : 'Ajouter litige Yango'}</Text>

            <Text style={styles.formLabel}>Type</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {TYPES_YANGO.map(t => (
                <TouchableOpacity key={t.key}
                  style={[styles.typeBtn, { flex: 1 }, formYango.type === t.key && { backgroundColor: t.couleur, borderColor: t.couleur }]}
                  onPress={() => setFormYango(p => ({ ...p, type: t.key }))}
                >
                  <Text style={[styles.typeBtnTxt, formYango.type === t.key && { color: '#fff' }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formLabel}>N° de commande (optionnel)</Text>
            <TextInput style={styles.formInput} value={formYango.numero_commande}
              onChangeText={v => setFormYango(p => ({ ...p, numero_commande: v }))}
              placeholder="Ex: 48291" placeholderTextColor="#bbb" />

            <Text style={styles.formLabel}>Montant (FCFA)</Text>
            <TextInput style={styles.formInput} value={formYango.montant}
              onChangeText={v => setFormYango(p => ({ ...p, montant: v }))}
              placeholder="Ex: 2500" placeholderTextColor="#bbb" keyboardType="numeric" />

            <ChampDate label="Date" styleLabel={styles.formLabel} valeur={formYango.date_saisie}
              onChange={v => setFormYango(p => ({ ...p, date_saisie: v }))} />

            {renderResponsablePicker(formYango.responsable_id, formYango.responsable_nom, (id, nom) => setFormYango(p => ({ ...p, responsable_id: id, responsable_nom: nom })))}

            <Text style={styles.formLabel}>Notes (optionnel)</Text>
            <TextInput style={styles.formInput} value={formYango.notes}
              onChangeText={v => setFormYango(p => ({ ...p, notes: v }))}
              placeholder="Détails..." placeholderTextColor="#bbb" />

            {saveError && <Text style={{ color: colors.error, fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{saveError}</Text>}
            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => { setShowFormYango(false); setSaveError(null) }}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnValider} onPress={sauvegarderYango} disabled={saving}>
                <Text style={styles.btnValiderTxt}>{saving ? '...' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </Modal>

      {/* ── Modal Glovo ── */}
      <Modal visible={showFormGlovo} transparent animationType="slide">
        <ScrollView contentContainerStyle={styles.overlay} keyboardShouldPersistTaps="handled">
          <View style={styles.formModal}>
            <Text style={styles.formTitre}>{formGlovo.id ? 'Modifier Glovo' : 'Ajouter litige Glovo'}</Text>

            <Text style={styles.formLabel}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {TYPES_GLOVO.map(t => (
                  <TouchableOpacity key={t.key}
                    style={[styles.typeBtn, formGlovo.type === t.key && { backgroundColor: t.couleur, borderColor: t.couleur }]}
                    onPress={() => setFormGlovo(p => ({ ...p, type: t.key }))}
                  >
                    <Text style={[styles.typeBtnTxt, formGlovo.type === t.key && { color: '#fff' }]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.formLabel}>N° de commande (optionnel)</Text>
            <TextInput style={styles.formInput} value={formGlovo.numero_commande}
              onChangeText={v => setFormGlovo(p => ({ ...p, numero_commande: v }))}
              placeholder="Ex: 48291" placeholderTextColor="#bbb" />

            <Text style={styles.formLabel}>Montant (FCFA)</Text>
            <TextInput style={styles.formInput} value={formGlovo.montant}
              onChangeText={v => setFormGlovo(p => ({ ...p, montant: v }))}
              placeholder="Ex: 2500" placeholderTextColor="#bbb" keyboardType="numeric" />

            <ChampDate label="Date" styleLabel={styles.formLabel} valeur={formGlovo.date_saisie}
              onChange={v => setFormGlovo(p => ({ ...p, date_saisie: v }))} />

            {renderResponsablePicker(formGlovo.responsable_id, formGlovo.responsable_nom, (id, nom) => setFormGlovo(p => ({ ...p, responsable_id: id, responsable_nom: nom })))}

            <Text style={styles.formLabel}>Notes (optionnel)</Text>
            <TextInput style={styles.formInput} value={formGlovo.notes}
              onChangeText={v => setFormGlovo(p => ({ ...p, notes: v }))}
              placeholder="Détails..." placeholderTextColor="#bbb" />

            {saveError && <Text style={{ color: colors.error, fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{saveError}</Text>}
            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => { setShowFormGlovo(false); setSaveError(null) }}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnValider} onPress={sauvegarderGlovo} disabled={saving}>
                <Text style={styles.btnValiderTxt}>{saving ? '...' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </Modal>

      {/* ── Modal responsable d'un litige automatique ── */}
      <Modal visible={!!respAuto} transparent animationType="slide" onRequestClose={() => setRespAuto(null)}>
        <ScrollView contentContainerStyle={styles.overlay} keyboardShouldPersistTaps="handled">
          <View style={styles.formModal}>
            <Text style={styles.formTitre}>Qui est responsable ?</Text>
            {respAuto && (
              <Text style={[styles.ligneSous, { marginBottom: 12 }]}>
                {respAuto.litige.notes || ''}{respAuto.litige.montant ? ` · ${fmtShort(respAuto.litige.montant)}` : ''}
                {'\n'}Calcul automatique : {respAuto.litige.responsable_nom || 'personne'}. Votre choix ne sera plus remplacé par le calcul.
              </Text>
            )}
            {respAuto && renderResponsablePicker(respAuto.responsable_id, respAuto.responsable_nom,
              (id, nom) => setRespAuto(p => ({ ...p, responsable_id: id, responsable_nom: nom })))}
            {saveError && <Text style={{ color: colors.error, fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{saveError}</Text>}
            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => { setRespAuto(null); setSaveError(null) }}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnValider} onPress={sauvegarderRespAuto} disabled={saving}>
                <Text style={styles.btnValiderTxt}>{saving ? '...' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </Modal>

      {/* ── Modal Point pas fait ── */}
      <Modal visible={showFormPPF} transparent animationType="slide">
        <ScrollView contentContainerStyle={styles.overlay} keyboardShouldPersistTaps="handled">
          <View style={styles.formModal}>
            <Text style={styles.formTitre}>{formPPF.id ? 'Modifier' : 'Ajouter'} — Point pas fait</Text>

            {renderResponsablePicker(formPPF.responsable_id, formPPF.responsable_nom, (id, nom) => setFormPPF(p => ({ ...p, responsable_id: id, responsable_nom: nom })))}

            <Text style={styles.formLabel}>Montant (FCFA)</Text>
            <TextInput style={styles.formInput} value={formPPF.montant}
              onChangeText={v => setFormPPF(p => ({ ...p, montant: v }))}
              placeholder="Ex: 5000" placeholderTextColor="#bbb" keyboardType="numeric" />

            <ChampDate label="Date" styleLabel={styles.formLabel} valeur={formPPF.date_saisie}
              onChange={v => setFormPPF(p => ({ ...p, date_saisie: v }))} />

            <Text style={styles.formLabel}>Notes (optionnel)</Text>
            <TextInput style={[styles.formInput, { height: 56 }]} value={formPPF.notes}
              onChangeText={v => setFormPPF(p => ({ ...p, notes: v }))}
              placeholder="Contexte..." placeholderTextColor="#bbb" multiline />

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => setShowFormPPF(false)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnValider, { backgroundColor: colors.error }]} onPress={sauvegarderPointPasFait} disabled={saving}>
                <Text style={styles.btnValiderTxt}>{saving ? '...' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </Modal>

      {/* ── Modal correction du nombre de commandes Yango / Glovo ── */}
      <Modal visible={!!corrCmd} transparent animationType="slide" onRequestClose={() => setCorrCmd(null)}>
        <ScrollView contentContainerStyle={styles.overlay} keyboardShouldPersistTaps="handled">
          <View style={styles.formModal}>
            <Text style={styles.formTitre}>Corriger le nombre de commandes</Text>
            {corrCmd && (
              <>
                <View style={styles.regulInfo}>
                  <Text style={styles.regulInfoTxt}>{corrCmd.date}</Text>
                  <Text style={styles.regulInfoSub}>
                    Saisi par le gérant : Yango {corrCmd.nbYango} · Glovo {corrCmd.nbGlovo}.
                    {'\n'}Contacts réellement pris : {corrCmd.nbContacts}.
                    {'\n'}Le litige contacts, les charges et le récap sont recalculés automatiquement.
                  </Text>
                </View>

                <Text style={styles.formLabel}>Commandes Yango</Text>
                <TextInput
                  style={styles.formInput}
                  value={corrCmdForm.yango}
                  onChangeText={v => setCorrCmdForm(p => ({ ...p, yango: v.replace(/[^0-9]/g, '') }))}
                  keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textMuted}
                />

                <Text style={styles.formLabel}>Commandes Glovo</Text>
                <TextInput
                  style={styles.formInput}
                  value={corrCmdForm.glovo}
                  onChangeText={v => setCorrCmdForm(p => ({ ...p, glovo: v.replace(/[^0-9]/g, '') }))}
                  keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textMuted}
                />

                <Text style={styles.formLabel}>Motif (optionnel)</Text>
                <TextInput
                  style={[styles.formInput, { minHeight: 60, textAlignVertical: 'top' }]}
                  value={corrCmdForm.motif}
                  onChangeText={v => setCorrCmdForm(p => ({ ...p, motif: v }))}
                  placeholder="Ex : le gérant a tapé 40 au lieu de 14"
                  placeholderTextColor={colors.textMuted}
                  multiline
                />

                {corrError ? <Text style={styles.corrErrorTxt}>{corrError}</Text> : null}
                <View style={styles.formBtns}>
                  <TouchableOpacity style={styles.btnAnnuler} onPress={() => setCorrCmd(null)} disabled={corrSaving}>
                    <Text style={styles.btnAnnulerTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnValider, corrSaving && { opacity: 0.5 }]}
                    onPress={sauvegarderCorrNbCommandes} disabled={corrSaving}
                  >
                    <Text style={styles.btnValiderTxt}>{corrSaving ? '...' : 'Corriger'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </Modal>

      {/* ── Modal correction du montant du litige contacts ── */}
      <Modal visible={!!corrLitige} transparent animationType="slide" onRequestClose={() => setCorrLitige(null)}>
        <ScrollView contentContainerStyle={styles.overlay} keyboardShouldPersistTaps="handled">
          <View style={styles.formModal}>
            <Text style={styles.formTitre}>Corriger le montant du litige</Text>
            {corrLitige && (
              <>
                <View style={styles.regulInfo}>
                  <Text style={styles.regulInfoTxt}>{corrLitige.date}</Text>
                  <Text style={styles.regulInfoSub}>
                    Montant calculé : {fmt(corrLitige.litigeCalcule)} ({corrLitige.ecart} contact
                    {corrLitige.ecart > 1 ? 's' : ''} manquant{corrLitige.ecart > 1 ? 's' : ''} × 500).
                    {'\n'}Mettez 0 si le restaurant n’y est pour rien (tablette en panne, etc.).
                  </Text>
                </View>

                <Text style={styles.formLabel}>Montant retenu (FCFA)</Text>
                <TextInput
                  style={styles.formInput}
                  value={corrLitigeForm.montant}
                  onChangeText={v => setCorrLitigeForm(p => ({ ...p, montant: v.replace(/[^0-9]/g, '') }))}
                  keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textMuted}
                />

                <Text style={styles.formLabel}>Motif (obligatoire)</Text>
                <TextInput
                  style={[styles.formInput, { minHeight: 70, textAlignVertical: 'top' }]}
                  value={corrLitigeForm.motif}
                  onChangeText={v => setCorrLitigeForm(p => ({ ...p, motif: v }))}
                  placeholder="Ex : tablette hors service, contacts impossibles à prendre"
                  placeholderTextColor={colors.textMuted}
                  multiline
                />

                {corrError ? <Text style={styles.corrErrorTxt}>{corrError}</Text> : null}

                {corrLitige.forceParManager && (
                  <TouchableOpacity
                    style={styles.corrResetBtn}
                    onPress={() => sauvegarderCorrLitige(true)}
                    disabled={corrSaving}
                  >
                    <Text style={styles.corrResetBtnTxt}>Revenir au montant calculé</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.formBtns}>
                  <TouchableOpacity style={styles.btnAnnuler} onPress={() => setCorrLitige(null)} disabled={corrSaving}>
                    <Text style={styles.btnAnnulerTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnValider, corrSaving && { opacity: 0.5 }]}
                    onPress={() => sauvegarderCorrLitige(false)} disabled={corrSaving}
                  >
                    <Text style={styles.btnValiderTxt}>{corrSaving ? '...' : 'Enregistrer'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </Modal>

      {/* ── Modal Confirmation Suppression ── */}
      <Modal visible={!!confirmSuppr} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={[styles.formModal, { alignItems: 'center', gap: 16 }]}>
            <Text style={[styles.formTitre, { color: colors.error }]}>{confirmSuppr?.auto ? 'Annuler ce litige automatique ?' : 'Supprimer cet élément ?'}</Text>
            <Text style={{ fontSize: 13, color: '#666', textAlign: 'center' }}>
              {confirmSuppr?.auto ? 'Il ne comptera plus et ne sera jamais recréé par le calcul.' : 'Cette action est irréversible.'}
            </Text>
            {confirmSuppr?.auto && saveError ? <Text style={{ fontSize: 13, color: colors.error, textAlign: 'center' }}>{saveError}</Text> : null}
            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => { setConfirmSuppr(null); setSaveError(null) }}>
                <Text style={styles.btnAnnulerTxt}>{confirmSuppr?.auto ? 'Garder' : 'Annuler'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnValider, { backgroundColor: colors.error }]} onPress={supprimerItem} disabled={saving}>
                <Text style={styles.btnValiderTxt}>{saving ? '...' : confirmSuppr?.auto ? 'Annuler le litige' : 'Supprimer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal régularisation d'écart */}
      <Modal visible={!!regulPoint} transparent animationType="slide" onRequestClose={() => setRegulPoint(null)}>
        <View style={styles.overlay}>
          <ScrollView style={{ maxHeight: '90%' }} keyboardShouldPersistTaps="handled">
            <View style={styles.formModal}>
              {regulPoint && (() => {
                const sens = regulPoint.ecartBrut > 0 ? 'manquant' : 'surplus'
                const restant = Math.abs(regulPoint.ecart)
                return (
                  <>
                    <Text style={styles.formTitre}>
                      {sens === 'manquant' ? 'Régulariser un manquant' : 'Régulariser un surplus'}
                    </Text>
                    <View style={styles.regulInfo}>
                      <Text style={styles.regulInfoTxt}>
                        Écart restant à justifier : <Text style={{ fontWeight: '800' }}>{fmt(restant)}</Text>
                      </Text>
                      <Text style={styles.regulInfoSub}>
                        {sens === 'manquant'
                          ? 'Le montant justifié sera ajouté au fond actuel (argent retrouvé aujourd’hui).'
                          : 'Le montant justifié sera retiré du fond actuel (argent restitué aujourd’hui).'}
                      </Text>
                    </View>

                    <Text style={styles.formLabel}>Montant justifié (max {fmt(restant)})</Text>
                    <TextInput
                      style={styles.formInput}
                      value={regulMontant}
                      onChangeText={v => setRegulMontant(v.replace(/[^0-9]/g, ''))}
                      placeholder="Ex : 5000"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="numeric"
                    />

                    <Text style={styles.formLabel}>Explication (obligatoire)</Text>
                    <TextInput
                      style={[styles.formInput, { minHeight: 70, textAlignVertical: 'top' }]}
                      value={regulMotif}
                      onChangeText={setRegulMotif}
                      placeholder="Ex : Erreur de comptage, montant retrouvé dans le tiroir..."
                      placeholderTextColor={colors.textMuted}
                      multiline
                    />

                    <Text style={styles.formLabel}>Photos justificatives (au moins une)</Text>
                    <View style={styles.regulPhotosRow}>
                      {regulPhotos.map((uri, i) => (
                        <View key={i} style={styles.regulPhotoWrap}>
                          <PhotoJustificatif uri={uri} style={styles.regulPhotoThumb} compact />
                          <TouchableOpacity style={styles.regulPhotoDel} onPress={() => setRegulPhotos(prev => prev.filter((_, j) => j !== i))}>
                            <MaterialCommunityIcons name="close" size={14} color="#FFFFFF" />
                          </TouchableOpacity>
                        </View>
                      ))}
                      <TouchableOpacity style={styles.regulPhotoAdd} onPress={gererPhotoRegul} disabled={regulUploading}>
                        <Text style={styles.regulPhotoAddTxt}>{regulUploading ? '…' : '＋'}</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.formBtns}>
                      <TouchableOpacity style={styles.btnAnnuler} onPress={() => setRegulPoint(null)} disabled={regulSaving}>
                        <Text style={styles.btnAnnulerTxt}>Annuler</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.btnValider} onPress={enregistrerRegularisation} disabled={regulSaving}>
                        <Text style={styles.btnValiderTxt}>{regulSaving ? '...' : 'Enregistrer'}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )
              })()}
            </View>
          </ScrollView>
        </View>
      </Modal>

    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  pastilleAuto: { alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, marginTop: 4 },
  pastilleAutoTxt: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  lienDetail: { color: colors.primary, fontSize: 13, marginTop: 6, minHeight: 24 },
  ligneDetail: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  lienResponsable: { color: colors.primary, fontSize: 14, fontWeight: '600', paddingVertical: 8, paddingHorizontal: 4 },
  lienAnnuler: { color: colors.error, fontSize: 14, fontWeight: '600', paddingVertical: 8, paddingHorizontal: 4 },
  bandeauRelier: { backgroundColor: colors.warningLight, borderRadius: 10, padding: 12, marginBottom: 12, minHeight: 48, justifyContent: 'center' },
  bandeauRelierTxt: { color: colors.warningDark, fontSize: 14 },
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.headerBg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 14, gap: 12,
    borderBottomLeftRadius: 22, borderBottomRightRadius: 22, zIndex: 2,
    shadowColor: colors.headerBg, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
  },
  headerLigne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  enteteBtn: {
    width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  headerCentre: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  headerIcone: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  headerTitre: { fontSize: 18, fontWeight: '800', color: colors.headerText, letterSpacing: -0.3 },

  restoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  restoTxt: { fontSize: 15, color: '#FFFFFF', fontWeight: '700', flex: 1 },

  body: { flex: 1 },
  bodyContenu: { padding: 14, paddingBottom: 60 },

  filtreCarte: {
    backgroundColor: colors.surface, borderRadius: 18, padding: 12, gap: 10,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  periodeRangee: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 4, borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
  },
  periodePill: {
    flexGrow: 1, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 9, borderRadius: 11,
  },
  periodePillActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 2,
  },
  periodePillTxt: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  periodePillTxtActive: { color: '#FFFFFF', fontWeight: '800' },

  dateRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  datePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38,
    backgroundColor: colors.primaryLight, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
  },
  datePillFixe: { backgroundColor: colors.surfaceAlt },
  datePillTxt: { fontSize: 13, color: colors.primary, fontWeight: '700' },

  impactCarte: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12,
    backgroundColor: colors.surface, borderRadius: 18, padding: 14, borderWidth: 1,
  },
  impactIcone: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  impactLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  impactSous: { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontWeight: '600' },
  impactValeur: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },

  ongletsFond: { backgroundColor: colors.bg, paddingTop: 12, paddingBottom: 10 },
  tabsContent: { gap: 8, alignItems: 'center', paddingRight: 4 },
  tab: {
    minHeight: 48, minWidth: 84, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 3,
  },
  tabTxt: { fontSize: 13, color: colors.text, fontWeight: '700' },
  tabTxtActive: { color: '#FFFFFF', fontWeight: '800' },
  tabMontant: { fontSize: 11, fontWeight: '700', marginTop: 1 },

  infoLigne: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  titreIconeLigne: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  titreIconePastille: {
    width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  voletTitre: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  actionsLigne: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  actionBtnSuppr: { backgroundColor: colors.errorLight },
  aucunLitige: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12 },
  statutContact: {
    alignSelf: 'flex-start', fontSize: 11, fontWeight: '800', overflow: 'hidden',
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, marginTop: 2,
  },

  section: { gap: 10 },

  kpiRow: { flexDirection: 'row', gap: 10 },
  kpiBox: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  kpiLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 4, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  kpiValue: { fontSize: 16, fontWeight: '700' },

  ecartCard: { borderRadius: 18, padding: 20, alignItems: 'center', gap: 6, borderWidth: 1 },
  ecartLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  ecartValeur: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  ecartSous: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  ecartRegulHint: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 6 },

  // ── Régularisation ──
  regulCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  regulCardTitre: { fontSize: 13, fontWeight: '700', color: colors.text, flex: 1 },
  regulSansFondBadge: { alignSelf: 'flex-start', marginTop: 6, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, backgroundColor: colors.surfaceAlt || '#EFEFEF' },
  regulSansFondTxt: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  regulMotif: { fontSize: 13, color: colors.textSecondary, marginTop: 6, lineHeight: 18 },
  regulMeta: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  regulPhotosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 12 },
  regulPhotoWrap: { position: 'relative' },
  regulPhotoThumb: { width: 60, height: 60, borderRadius: 8 },
  regulPhotoDel: {
    position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center',
  },
  regulPhotoAdd: {
    width: 60, height: 60, borderRadius: 8, borderWidth: 1.5, borderColor: colors.primary,
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  regulPhotoAddTxt: { fontSize: 26, color: colors.primary, fontWeight: '300' },
  regulBtn: {
    marginTop: 14, backgroundColor: colors.primary, borderRadius: 14, minHeight: 48,
    paddingVertical: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  regulBtnTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
  regulInfo: { backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, marginBottom: 14 },
  regulInfoTxt: { fontSize: 14, color: colors.text },
  regulInfoSub: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 17 },

  // ── Explication gérant (affichée dans l'écart) ──
  explicGerantCard: {
    marginTop: 12, backgroundColor: colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  explicGerantTitre: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 6 },
  explicGerantTxt: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', lineHeight: 19 },
  explicGerantVide: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  explicGerantSousTitre: { fontSize: 11, fontWeight: '800', color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  explicRespRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
  },
  explicRespNom: { fontSize: 13, color: colors.text },
  explicRespMontant: { fontSize: 13, fontWeight: '700', color: colors.primary },

  // ── Provenance de l'imputation : mesurée par la caisse, ou saisie à la main ──
  respNomRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 },
  sourcePOSBadge: {
    backgroundColor: colors.primaryLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
  },
  sourcePOSBadgeTxt: { fontSize: 10, fontWeight: '700', color: colors.primary },

  // ── Filtres responsables ──
  respSectionTitre: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 10 },
  filtreRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  filtreChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginRight: 8, minHeight: 36, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.borderLight, backgroundColor: colors.surface,
  },
  filtreChipActif: { backgroundColor: colors.primary, borderColor: colors.primary },
  filtreChipTxt: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  filtreChipTxtActif: { color: '#fff' },

  totalBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  totalBannerLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, flexShrink: 1 },
  totalBannerValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },

  ligneCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  ligneCardActive: { borderColor: colors.primary, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  ligneDetails: {
    backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1, borderTopWidth: 0,
    borderBottomLeftRadius: 16, borderBottomRightRadius: 16, padding: 14, paddingTop: 2, marginBottom: 2,
  },
  ligneNom: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 2 },
  ligneCmd: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  ligneSous: { fontSize: 12, color: colors.textMuted },
  ligneCreer: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  montantTxt: { fontSize: 16, fontWeight: '800' },

  catDetail: {
    backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 10, gap: 4,
  },
  catLigne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catNom: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  catMontant: { fontSize: 12, fontWeight: '700', color: colors.error },
  prodLigne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  annulDeducBtnSm: { backgroundColor: colors.errorLight, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', minWidth: 78, minHeight: 34 },
  annulDeducBtnSmTxt: { color: colors.error, fontWeight: '800', fontSize: 12 },

  // Corrections manager du volet Contacts
  corrBadge: { fontSize: 11, color: colors.warningDark, fontWeight: '600', marginTop: 2, lineHeight: 15 },
  corrBtnRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  corrBtn: {
    flex: 1, minHeight: 40, paddingVertical: 8, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 6, backgroundColor: colors.primaryLight,
  },
  corrBtnTxt: { fontSize: 12, fontWeight: '800', color: colors.primary },
  corrErrorTxt: { color: colors.error, fontSize: 12, marginBottom: 8, textAlign: 'center' },
  corrResetBtn: {
    paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginBottom: 10,
    backgroundColor: colors.warningLight, borderWidth: 1, borderColor: colors.warningDark + '55',
  },
  corrResetBtnTxt: { fontSize: 13, fontWeight: '700', color: colors.warningDark },

  emptyBox: { paddingVertical: 36, alignItems: 'center', gap: 8 },
  emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  emptySubTxt: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },

  btnAjout: {
    backgroundColor: colors.primary, borderRadius: 14, minHeight: 50, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 4,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 3,
  },
  btnAjoutTxt: { fontSize: 15, color: '#FFFFFF', fontWeight: '800' },

  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', padding: 18,
  },
  pickerBox: { backgroundColor: colors.surface, borderRadius: 20, overflow: 'hidden', maxHeight: 460 },
  pickerTitre: {
    fontSize: 16, fontWeight: '800', color: colors.text,
    padding: 18, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  pickerLigne: { padding: 16, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  pickerLigneActive: { backgroundColor: colors.primaryLight },
  pickerLigneTxt: { fontSize: 15, color: colors.text },

  formModal: { backgroundColor: colors.surface, borderRadius: 20, padding: 20 },
  formTitre: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 16 },
  formLabel: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6,
  },
  formInput: {
    backgroundColor: colors.bg, borderRadius: 12, padding: 12,
    fontSize: 15, color: colors.text, marginBottom: 12,
    borderWidth: 0.5, borderColor: colors.border,
  },
  formBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },

  typeBtn: {
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg, alignItems: 'center',
  },
  typeBtnTxt: { fontSize: 13, fontWeight: '600', color: colors.text },
  typeBtnMontant: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  btnAnnuler: {
    flex: 1, padding: 13, borderRadius: 12,
    backgroundColor: colors.bg, alignItems: 'center',
    borderWidth: 0.5, borderColor: colors.border,
  },
  btnAnnulerTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  btnValider: { flex: 1, padding: 13, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  btnValiderTxt: { fontSize: 14, color: '#FFFFFF', fontWeight: '800' },

  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 10, marginBottom: 12 },
  suggestionTxt: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
  suggestionBtn: { backgroundColor: colors.successDark, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  suggestionBtnTxt: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  attribuerBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.primaryLight, borderRadius: 14, padding: 12, minHeight: 52 },
  attribuerBtnTxt: { fontSize: 13.5, fontWeight: '800', color: colors.primary },
  attribuerBtnSous: { fontSize: 11.5, color: colors.primary, opacity: 0.85, marginTop: 1 },
  responsableChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.bg, borderWidth: 0.5, borderColor: colors.border,
  },
  responsableChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  responsableLigne: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  responsableGroupe: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  responsableChipTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  responsableChipTxtActive: { color: '#fff', fontWeight: '600' },

  btnPdf: {
    backgroundColor: colors.primary, borderRadius: 14, padding: 14, minHeight: 50,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  btnPdfTxt: { fontSize: 14, color: '#fff', fontWeight: '700' },

  restoGlobalCard: {
    backgroundColor: colors.surface, borderRadius: 18,
    borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden',
  },
  restoGlobalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  restoGlobalIcone: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  restoGlobalNom: { fontSize: 15, fontWeight: '800', color: colors.text, flex: 1 },
  restoGlobalTotalPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  restoGlobalTotal: { fontSize: 13, fontWeight: '800' },
  restoGlobalBody: { padding: 12, gap: 6 },

  globalVoletRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 4, marginTop: 4,
  },
  globalVoletLabel: { fontSize: 13, fontWeight: '800', color: colors.text },
  globalVoletVal: { fontSize: 13, fontWeight: '700' },

  globalItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 5, paddingLeft: 10,
    borderLeftWidth: 2, borderLeftColor: colors.primary + '40',
    marginLeft: 11,
  },
  globalItemTxt: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  globalItemCmd: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  globalItemResp: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  plafondBox: { backgroundColor: colors.warningLight, borderRadius: 12, padding: 10, marginVertical: 5 },
  plafondTxt: { fontSize: 11, color: colors.warningDark, lineHeight: 16, fontWeight: '600' },
  globalItemMontant: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
}) }

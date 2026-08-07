import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, Modal, Platform, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native'
import { Calendar } from 'react-native-calendars'
import PhotoJustificatif from '../components/PhotoJustificatif'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { CATEGORIES_INVENTAIRE } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { annulerDeductionInventaire } from '../lib/api'
import {
  calculerLitigeContact, chargerPointsContact, compterContacts,
  corrigerNbCommandes, forcerLitigeContact,
} from '../lib/litigeContacts'
import { PLAFOND_COMPTAGE } from '../lib/deductionsVerification'
import { exporterPdf } from '../lib/pdfDocuments'
import { usePhoto } from '../lib/usePhoto'

function fmt(n) { return Math.round(n || 0).toLocaleString('fr-FR') + ' FCFA' }
function fmtShort(n) { return Math.round(n || 0).toLocaleString('fr-FR') }

const TODAY = new Date().toISOString().split('T')[0]

const PERIODES = [
  { key: '1jour', label: '1 jour' },
  { key: 'semaine', label: '7 jours' },
  { key: 'mois', label: 'Ce mois' },
  { key: 'mois_prec', label: 'Mois préc.' },
  { key: 'perso', label: '🗓 Perso' },
]

const ONGLETS = [
  { key: 'ecarts', label: 'Écarts' },
  { key: 'inventaire', label: 'Inventaire' },
  { key: 'avis', label: 'Avis clients' },
  { key: 'yango', label: 'Yango' },
  { key: 'glovo', label: 'Glovo' },
  { key: 'contact', label: 'Contacts' },
  { key: 'point_pas_fait', label: 'Point pas fait' },
]

const TYPES_AVIS = [
  { key: 'mauvais', label: '👎 Mauvais avis', court: '👎 Mauvais', montant: 1000, couleur: '#C62828' },
  { key: 'bon', label: '👍 Bon avis', court: '👍 Bon', montant: -500, couleur: '#2E7D32' },
  // Neutre : on garde la trace de l'avis sans impact financier (ni sanction,
  // ni récompense). Le montant reste 0 dans tous les totaux.
  { key: 'neutre', label: '😐 Avis neutre', court: '😐 Neutre', montant: 0, couleur: '#78716C' },
]
function typeAvis(key) { return TYPES_AVIS.find(t => t.key === key) }
// Rouge = à la charge du resto, vert = en sa faveur, gris = sans impact
function couleurMontant(m, colors) {
  return m > 0 ? '#C62828' : m < 0 ? '#2E7D32' : (colors?.textMuted || '#78716C')
}
// Canal du client à l'origine de l'avis
const CANAUX_AVIS = [
  { key: 'sur_place', label: '🍽️ Sur place', court: 'Sur place', couleur: '#185FA5' },
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
  matin: '🌅 Matin',
  soir: '🌆 Soir',
  nuit: '🌙 Nuit',
  double: '🔄 Double',
  personnalise: '✏️ Perso',
}

function getPlage(periodeKey, dateUnique, dateDebut, dateFin) {
  if (periodeKey === '1jour') return { debut: dateUnique, fin: dateUnique }
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
  return periodeKey === '1jour' ? dateUnique : TODAY
}

export default function LitigesScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { userNom, userId, roleActif, restaurantId } = useApp()
  const isGerant = roleActif === 'gerant'
  const peutRegulariser = roleActif === 'manager' || roleActif === 'directeur'
  const { prendrePhoto, choisirPhoto } = usePhoto()

  // ── Restaurant ──────────────────────────────────────────────
  const [restaurants, setRestaurants] = useState([])
  const [restoSelectionne, setRestoSelectionne] = useState(null)
  const [showRestoPicker, setShowRestoPicker] = useState(false)

  // ── Période ─────────────────────────────────────────────────
  const [periodeKey, setPeriodeKey] = useState('1jour')
  const [dateUnique, setDateUnique] = useState(TODAY)
  const [dateDebut, setDateDebut] = useState(TODAY)
  const [dateFin, setDateFin] = useState(TODAY)
  const [showCalUnique, setShowCalUnique] = useState(false)
  const [showCalDebut, setShowCalDebut] = useState(false)
  const [showCalFin, setShowCalFin] = useState(false)
  const [datesAvec, setDatesAvec] = useState({})

  // ── Mode global (tous restaurants) ──────────────────────────
  const [modeGlobal, setModeGlobal] = useState(false)
  const [donneesGlobales, setDonneesGlobales] = useState([])
  // Comptages du vérificateur pour le restaurant sélectionné (vue mono-resto)
  const [deducVerifResto, setDeducVerifResto] = useState([])
  const [generatingPdf, setGeneratingPdf] = useState(false)

  // ── UI ───────────────────────────────────────────────────────
  const [onglet, setOnglet] = useState('ecarts')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmSuppr, setConfirmSuppr] = useState(null)
  const [saveError, setSaveError] = useState(null)

  // ── Volet 1 — écarts ────────────────────────────────────────
  const [ecartsListe, setEcartsListe] = useState([])
  const [expandedEcart, setExpandedEcart] = useState(null)  // date du jour déplié en vue période

  // ── Responsables des écarts (table litiges_responsables) ────
  const [responsablesListe, setResponsablesListe] = useState([])
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
  const [formAvis, setFormAvis] = useState({ type: 'mauvais', canal: 'sur_place', notes: '', numero_commande: '', date_saisie: TODAY, id: null })

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

  // ── Utilisateurs du restaurant (pour picker responsable) ─────
  const [utilisateurs, setUtilisateurs] = useState([])

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
    const { data } = await supabase.from('restaurants').select('id, nom, couleur, photo_url, localisation').order('nom')
    setRestaurants(data || [])
    if (data?.length) {
      if (isGerant && restaurantId) {
        const monResto = data.find(r => r.id === restaurantId) || data[0]
        setRestoSelectionne(monResto)
        chargerDatesAvec(monResto.id)
        chargerUtilisateurs(monResto.id)
      } else {
        setRestoSelectionne(data[0])
        chargerDatesAvec(data[0].id)
        chargerUtilisateurs(data[0].id)
      }
    }
  }

  async function chargerUtilisateurs(restoId) {
    const { data } = await supabase
      .from('utilisateurs').select('id, nom, role')
      .eq('restaurant_id', restoId).eq('actif', true).order('nom')
    setUtilisateurs(data || [])
  }

  async function chargerDatesAvec(restoId) {
    const { data } = await supabase.from('points').select('date').eq('restaurant_id', restoId)
    const marked = {}
    ;(data || []).forEach(p => { marked[p.date] = { marked: true, dotColor: '#185FA5' } })
    setDatesAvec(marked)
  }

  async function chargerTout() {
    if (!restoSelectionne) return
    setLoading(true)
    await Promise.all([chargerEcarts(), chargerResponsables(), chargerInventaire(), chargerAvis(), chargerYango(), chargerGlovo(), chargerEcartContacts(), chargerPointPasFait(), chargerDeducVerifResto()])
    setLoading(false)
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

    if (!pointsData?.length) { setEcartsListe([]); return }

    const pointIds = pointsData.map(p => p.id)
    const { data: allShifts } = await supabase
      .from('points_shifts').select('point_id, vente_shift').in('point_id', pointIds)

    const shiftsByPoint = {}
    ;(allShifts || []).forEach(s => {
      if (!shiftsByPoint[s.point_id]) shiftsByPoint[s.point_id] = []
      shiftsByPoint[s.point_id].push(s)
    })

    setEcartsListe(pointsData.map(p => {
      const shifts = shiftsByPoint[p.id] || []
      const cumulShifts = shifts.reduce((s, x) => s + (x.vente_shift || 0), 0)
      const ecartBrut = (p.vente_machine || 0) - cumulShifts
      const reguls = Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : []
      const totalRegul = reguls.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0)
      // Écart effectif : rapproché de 0 par les montants régularisés
      let ecart = ecartBrut
      if (ecartBrut < 0) ecart = Math.min(0, ecartBrut + totalRegul)
      else if (ecartBrut > 0) ecart = Math.max(0, ecartBrut - totalRegul)
      // Écart annulé dans Vérification → neutralisé (écart 0), quel que soit le mode d'annulation.
      const annule = p.explication_machine_statut === 'annulee'
      if (annule) ecart = 0
      return {
        id: p.id,
        date: p.date,
        venteMachine: p.vente_machine || 0,
        cumulShifts,
        ecartBrut,
        ecart,
        annule,
        regularisations: reguls,
        totalRegul,
        resteFc: p.reste_fc || 0,
        nbShifts: shifts.length,
        explication: p.explication_ecart_machine || '',
        responsablesEcart: Array.isArray(p.ecart_responsables) ? p.ecart_responsables : [],
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

  function supprimerRegularisation(item, index) {
    const r = item.regularisations[index]
    if (!r) return
    Alert.alert(
      'Supprimer cette régularisation ?',
      `Le montant de ${fmt(r.montant)} sera réintégré dans l'écart et le fond actuel sera recalculé.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive', onPress: async () => {
            const nouvelles = item.regularisations.filter((_, i) => i !== index)
            const deltaFc = r.sens === 'manquant' ? -(r.montant || 0) : (r.montant || 0) // inverse de l'ajout
            // Retire l'explication/responsabilité du jour de l'écart
            await supabase.from('points')
              .update({ ecart_regularisations: nouvelles })
              .eq('id', item.id)
            if (r.fond_point_id) {
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

    // Shifts pour avoir les noms caissiers
    const { data: shifts } = await supabase
      .from('points_shifts').select('point_id, caissier_nom, heure_debut, heure_fin')
      .in('point_id', pointIds)
      .order('created_at', { ascending: true })

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

    // Shifts groupés par point
    const shiftsByPoint = {}
    ;(shifts || []).forEach(s => {
      if (!shiftsByPoint[s.point_id]) shiftsByPoint[s.point_id] = []
      shiftsByPoint[s.point_id].push(s)
    })

    setEcartContacts(points.map(p => {
      const calc = calculerLitigeContact(p, contactsByPoint[p.id] || 0)
      const shiftsJour = shiftsByPoint[p.id] || []
      const caissiers = shiftsJour.map(s =>
        `${s.caissier_nom || '—'}${s.heure_debut ? ` (${s.heure_debut}→${s.heure_fin})` : ''}`
      ).join(' · ')
      const contactsParCaissier = Object.entries(contactsByPointCaissier[p.id] || {}).map(([cid, nb]) => ({
        nom: nomCaissier[cid] || 'Caissier',
        nb,
      })).sort((a, b) => b.nb - a.nb)
      return { ...calc, point: p, date: p.date, caissiers, contactsParCaissier }
    }).filter(r => r.nbCommandes > 0 || r.caissiers))
  }

  // ── Mode global : toutes données par restaurant ─────────────
  async function chargerTousRestaurants() {
    if (!restaurants.length) return
    setLoading(true)
    const { debut, fin } = plage

    const resultats = await Promise.all(restaurants.map(async resto => {
      // Écarts
      const { data: pointsData } = await supabase
        .from('points').select('id, date, vente_machine, explication_machine_statut, ecart_regularisations')
        .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin)
      let ecartTotal = 0
      if (pointsData?.length) {
        const ids = pointsData.map(p => p.id)
        const { data: shifts } = await supabase
          .from('points_shifts').select('point_id, vente_shift').in('point_id', ids)
        const byPoint = {}
        ;(shifts || []).forEach(s => { byPoint[s.point_id] = (byPoint[s.point_id] || 0) + (s.vente_shift || 0) })
        pointsData.forEach(p => {
          if (p.explication_machine_statut === 'annulee') return // écart soldé → 0
          const brut = (p.vente_machine || 0) - (byPoint[p.id] || 0)
          // Les régularisations partielles réduisent l'écart : sans ça, annuler
          // 8 000 sur un manquant de 10 000 laissait 10 000 dans le total.
          const reguls = Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : []
          const totalRegul = reguls.reduce((s2, r) => s2 + (parseFloat(r.montant) || 0), 0)
          ecartTotal += Math.max(0, brut - totalRegul)
        })
      }

      // Comptages du vérificateur : montants à déduire, plafonnés par comptage.
      const { data: dedVerif } = await supabase
        .from('deductions_verification')
        .select('*')
        .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin)
        .neq('statut', 'validee')
      const verifLignes = dedVerif || []
      // Le montant est déjà plafonné et réparti à l'enregistrement : on somme
      // simplement les parts. L'écart réel sert seulement à expliquer l'écart
      // entre ce qui a été constaté et ce qui est réellement retenu.
      const verifRetenu = verifLignes.reduce((s2, l) => s2 + (Number(l.montant) || 0), 0)
      const lots = {}
      verifLignes.forEach(l => { lots[l.lot_id || l.date] = Number(l.montant_ecart) || 0 })
      const verifReel = Object.values(lots).reduce((s2, v) => s2 + v, 0)

      // Responsables des écarts : le total ci-dessus ne dit pas QUI doit quoi.
      // C'est pourtant le plus gros poste de litiges, et chaque ligne porte un nom.
      const { data: responsables } = await supabase
        .from('litiges_responsables')
        .select('date, responsable_nom, role, montant, type')
        .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin)
        .order('montant', { ascending: false })

      // Inventaire + détail
      const { data: invShifts } = await supabase
        .from('inventaires_shifts').select('id, caissier_id, type_shift, montant_a_deduire, date')
        .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).eq('valide', true)
      let invEnriched = []
      let invTotal = 0
      if (invShifts?.length) {
        invTotal = invShifts.reduce((s, x) => s + (x.montant_a_deduire || 0), 0)
        const caissierIds = [...new Set(invShifts.map(s => s.caissier_id).filter(Boolean))]
        const { data: users } = await supabase.from('utilisateurs').select('id, nom').in('id', caissierIds)
        const nomById = {}
        ;(users || []).forEach(u => { nomById[u.id] = u.nom })
        const shiftIds = invShifts.map(s => s.id)
        const { data: lignes } = await supabase
          .from('inventaire_lignes')
          .select('inventaire_id, produit_id, produit_nom, montant_deduit, explication, nombre_explique, ecart')
          .in('inventaire_id', shiftIds).gt('montant_deduit', 0)
        const lignesByShift = {}
        ;(lignes || []).forEach(l => {
          if (!lignesByShift[l.inventaire_id]) lignesByShift[l.inventaire_id] = []
          lignesByShift[l.inventaire_id].push(l)
        })
        invEnriched = invShifts.map(s => ({
          ...s,
          caissier_nom: nomById[s.caissier_id] || 'Caissier',
          lignes: lignesByShift[s.id] || [],
        }))
      }

      // Avis / Yango / Glovo
      const [{ data: avis }, { data: yango }, { data: glovo }] = await Promise.all([
        supabase.from('litiges_avis_clients').select('*').eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).order('date', { ascending: false }),
        supabase.from('litiges_yango').select('*').eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).order('date', { ascending: false }),
        supabase.from('litiges_glovo').select('*').eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin).order('date', { ascending: false }),
      ])
      const avisTotal  = (avis  || []).reduce((s, x) => s + (x.montant || 0), 0)
      const yangoTotal = (yango || []).reduce((s, x) => s + (x.montant || 0), 0)
      const glovoTotal = (glovo || []).reduce((s, x) => s + (x.montant || 0), 0)

      // Contacts manquants — règle et corrections dans lib/litigeContacts.js
      const ptsContact = await chargerPointsContact(resto.id, debut, fin)
      let contacts = []
      let contactTotal = 0
      if (ptsContact?.length) {
        const { parPoint: contactsByPoint } = await compterContacts(ptsContact.map(p => p.id))
        contacts = ptsContact.map(p => ({
          date: p.date,
          ...calculerLitigeContact(p, contactsByPoint[p.id] || 0),
        })).filter(r => r.litige > 0)
        contactTotal = contacts.reduce((s, r) => s + r.litige, 0)
      }

      // Point pas fait
      const { data: pasFait } = await supabase
        .from('litiges_point_pas_fait').select('*')
        .eq('restaurant_id', resto.id).gte('date', debut).lte('date', fin)
        .order('date', { ascending: false })
      const pasFaitTotal = (pasFait || []).reduce((s, x) => s + (x.montant || 0), 0)

      return {
        restaurant: resto, ecartTotal, invTotal, invEnriched,
        responsables: responsables || [],
        avis: avis || [], avisTotal,
        yango: yango || [], yangoTotal,
        glovo: glovo || [], glovoTotal,
        contacts, contactTotal,
        pasFait: pasFait || [], pasFaitTotal,
        verifLignes, verifRetenu, verifReel,
        // Le total du restaurant n'intègre que le montant RETENU (plafonné),
        // jamais l'écart brut : c'est ce qui sera effectivement déduit.
        total: ecartTotal + invTotal + avisTotal + yangoTotal + glovoTotal
          + contactTotal + pasFaitTotal + verifRetenu,
      }
    }))

    setDonneesGlobales(resultats)
    setLoading(false)
  }

  // ── Génération PDF + partage natif ───────────────────────────
  async function genererEtPartagePDF() {
    setGeneratingPdf(true)
    try {
      const periode = plageLabel()
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
      <h1>⚖️ Rapport Litiges</h1>
      <p class="sub">Période : ${periode} — Généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`

      let grandTotal = 0

      // Mention du responsable, ajoutée à chaque ligne de litige. Vide quand
      // personne n'a été désigné, pour ne pas alourdir le document inutilement.
      const resp = nom => {
        const n = (nom || '').trim()
        return n ? ` · 👤 <strong>${n}</strong>` : ''
      }

      for (const d of donneesGlobales) {
        grandTotal += d.total
        const tc = d.total > 0 ? 'r' : d.total < 0 ? 'g' : ''
        html += `<div class="resto"><div class="resto-h">
          <span class="resto-nom">${d.restaurant.nom}</span>
          <span class="resto-tot ${tc}">${d.total > 0 ? '+' : ''}${Math.round(d.total).toLocaleString('fr-FR')} FCFA</span>
        </div>`

        const vide = !d.ecartTotal && !d.invTotal && !d.avis.length && !d.yango.length
          && !d.glovo.length && !d.contactTotal && !d.pasFaitTotal && !d.responsables.length && !d.verifRetenu
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
            html += `<div class="item">📅 ${c.date} — ${c.ecart} manquant${c.ecart > 1 ? 's' : ''} (${c.nbContacts}/${c.nbCommandes} · ${c.taux}%) <span class="r"><strong>−${Math.round(c.litige).toLocaleString('fr-FR')} FCFA</strong></span></div>`
          })
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
      html += `<div class="recap"><div class="recap-h">📋 Récapitulatif global</div>`
      donneesGlobales.forEach(d => {
        const c = d.total > 0 ? '#C62828' : d.total < 0 ? '#2E7D32' : '#888'
        html += `<div class="recap-l"><span>${d.restaurant.nom}</span><span style="color:${c};font-weight:bold">${d.total > 0 ? '+' : ''}${Math.round(d.total).toLocaleString('fr-FR')} FCFA</span></div>`
      })
      html += `<div class="recap-l gt"><span>TOTAL GLOBAL</span><span style="color:${gtc}">${grandTotal > 0 ? '+' : ''}${Math.round(grandTotal).toLocaleString('fr-FR')} FCFA</span></div></div></body></html>`

      await exporterPdf(html, `rapport_litiges_${periode.replace(/\s+/g, '_')}.pdf`, 'Partager le rapport litiges')
    } catch (e) {
      Alert.alert('Erreur PDF', e.message || 'Impossible de générer le PDF')
    } finally {
      setGeneratingPdf(false)
    }
  }

  // ── Render mode global ───────────────────────────────────────
  function renderModeGlobal() {
    if (!donneesGlobales.length) return (
      <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucune donnée pour cette période</Text></View>
    )
    const grandTotal = donneesGlobales.reduce((s, d) => s + d.total, 0)
    const gtc = grandTotal > 0 ? '#C62828' : grandTotal < 0 ? '#2E7D32' : colors.textMuted

    return (
      <View style={styles.section}>
        {/* Grand total + bouton PDF */}
        <View style={[styles.totalBanner, {
          backgroundColor: grandTotal > 0 ? '#FFF0F0' : grandTotal < 0 ? '#F0FFF4' : colors.surface,
          borderColor: grandTotal > 0 ? '#FFCDD2' : grandTotal < 0 ? '#C8E6C9' : colors.borderLight,
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
          onPress={genererEtPartagePDF}
          disabled={generatingPdf}
        >
          <Text style={styles.btnPdfTxt}>{generatingPdf ? '⏳ Génération PDF...' : '📄 Télécharger & partager PDF'}</Text>
        </TouchableOpacity>

        {/* Un card par restaurant */}
        {donneesGlobales.map(d => {
          const tc = d.total > 0 ? '#C62828' : d.total < 0 ? '#2E7D32' : colors.textMuted
          const vide = !d.ecartTotal && !d.invTotal && !d.avis.length && !d.yango.length && !d.glovo.length && !d.contactTotal && !d.pasFaitTotal
          return (
            <View key={d.restaurant.id} style={styles.restoGlobalCard}>
              {/* Header restaurant */}
              <View style={styles.restoGlobalHeader}>
                <Text style={styles.restoGlobalNom}>{d.restaurant.nom}</Text>
                <Text style={[styles.restoGlobalTotal, { color: tc }]}>
                  {d.total > 0 ? '+' : ''}{fmt(d.total)}
                </Text>
              </View>

              {vide ? (
                <Text style={[styles.ligneSous, { padding: 10, fontStyle: 'italic' }]}>✅ Aucun litige</Text>
              ) : (
                <View style={styles.restoGlobalBody}>
                  {/* Écart */}
                  {(d.ecartTotal !== 0 || d.responsables.length > 0) && (
                    <>
                      <View style={styles.globalVoletRow}>
                        <Text style={styles.globalVoletLabel}>📊 Écart point</Text>
                        <Text style={[styles.globalVoletVal, { color: d.ecartTotal > 0 ? '#C62828' : '#2E7D32' }]}>
                          {d.ecartTotal > 0 ? '+' : ''}{fmtShort(d.ecartTotal)}
                        </Text>
                      </View>
                      {d.responsables.map((r, ri) => (
                        <View key={'resp' + ri} style={styles.globalItem}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.globalItemTxt} numberOfLines={2}>
                              📅 {r.date}{r.type ? ` — ${r.type}` : ''}
                            </Text>
                            <Text style={styles.globalItemResp}>
                              👤 {r.responsable_nom || 'Non attribué'}{r.role ? ` · ${r.role}` : ''}
                            </Text>
                          </View>
                          <Text style={[styles.globalItemMontant, { color: r.montant > 0 ? '#C62828' : '#2E7D32' }]}>
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
                        <Text style={styles.globalVoletLabel}>📦 Inventaire</Text>
                        <Text style={[styles.globalVoletVal, { color: '#C62828' }]}>−{fmtShort(d.invTotal)}</Text>
                      </View>
                      {/* On rattache chaque ligne à son shift : un flatMap nu
                          perdait le caissier, donc le responsable de la déduction. */}
                      {d.invEnriched.flatMap(inv =>
                        inv.lignes.map(l => ({ ...l, caissier_nom: inv.caissier_nom, type_shift: inv.type_shift }))
                      ).map((l, li) => (
                        <View key={'inv' + li} style={styles.globalItem}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.globalItemTxt} numberOfLines={2}>
                              📦 {l.produit_nom}
                              {l.explication ? <Text style={styles.globalItemCmd}> — {l.explication}</Text> : null}
                            </Text>
                            {l.caissier_nom ? (
                              <Text style={styles.globalItemResp}>
                                👤 {l.caissier_nom}{l.type_shift ? ` · ${l.type_shift}` : ''}
                              </Text>
                            ) : null}
                          </View>
                          <Text style={[styles.globalItemMontant, { color: '#C62828' }]}>−{fmtShort(l.montant_deduit)}</Text>
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
                            {a.canal ? <Text style={{ color: canalAvis(a.canal)?.couleur }}> · 📍{canalAvis(a.canal)?.court || a.canal}</Text> : null}
                            {a.numero_commande ? <Text style={styles.globalItemCmd}> #{a.numero_commande}</Text> : null}
                            {a.notes ? ` — ${a.notes}` : ''}
                          </Text>
                          {a.responsable_nom ? (
                            <Text style={styles.globalItemResp}>👤 {a.responsable_nom}</Text>
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
                            🛵 {type?.label || y.type}
                            {y.numero_commande ? <Text style={styles.globalItemCmd}> #{y.numero_commande}</Text> : null}
                            {y.notes ? ` — ${y.notes}` : ''}
                          </Text>
                          {y.responsable_nom ? (
                            <Text style={styles.globalItemResp}>👤 {y.responsable_nom}</Text>
                          ) : null}
                        </View>
                        <Text style={[styles.globalItemMontant, { color: y.montant > 0 ? '#C62828' : '#2E7D32' }]}>
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
                            🟡 {type?.label || g.type}
                            {g.numero_commande ? <Text style={styles.globalItemCmd}> #{g.numero_commande}</Text> : null}
                            {g.notes ? ` — ${g.notes}` : ''}
                          </Text>
                          {g.responsable_nom ? (
                            <Text style={styles.globalItemResp}>👤 {g.responsable_nom}</Text>
                          ) : null}
                        </View>
                        <Text style={[styles.globalItemMontant, { color: g.montant > 0 ? '#C62828' : '#2E7D32' }]}>
                          {g.montant > 0 ? '+' : ''}{fmtShort(g.montant)}
                        </Text>
                      </View>
                    )
                  })}
                  {/* Comptage vérificateur — montants plafonnés */}
                  {d.verifRetenu > 0 && (
                    <>
                      <View style={styles.globalVoletRow}>
                        <Text style={styles.globalVoletLabel}>🔍 Comptage vérificateur</Text>
                        <Text style={[styles.globalVoletVal, { color: '#C62828' }]}>+{fmtShort(d.verifRetenu)}</Text>
                      </View>
                      {d.verifReel > d.verifRetenu && (
                        <View style={styles.plafondBox}>
                          <Text style={styles.plafondTxt}>
                            ⚖️ Écart réel {fmt(d.verifReel)} — plafond de {fmt(PLAFOND_COMPTAGE)} par
                            comptage appliqué, {fmt(d.verifRetenu)} retenus.
                          </Text>
                        </View>
                      )}
                      {d.verifLignes.map(l => (
                        <View key={l.id} style={styles.globalItem}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.globalItemTxt} numberOfLines={2}>
                              📅 {l.date} — {l.produit_nom}
                              <Text style={styles.globalItemCmd}> (déclaré {l.stock_declare} · compté {l.stock_compte})</Text>
                            </Text>
                            <Text style={styles.globalItemResp}>
                              👤 {l.caissier_nom}{l.shift_libelle ? ` · ${l.shift_libelle}` : ''}
                            </Text>
                          </View>
                          <Text style={[styles.globalItemMontant, { color: '#C62828' }]}>{fmtShort(l.montant)}</Text>
                        </View>
                      ))}
                    </>
                  )}

                  {/* Contacts manquants */}
                  {d.contactTotal > 0 && (
                    <>
                      <View style={styles.globalVoletRow}>
                        <Text style={styles.globalVoletLabel}>📞 Contacts manquants</Text>
                        <Text style={[styles.globalVoletVal, { color: '#C62828' }]}>−{fmtShort(d.contactTotal)}</Text>
                      </View>
                      {d.contacts.map((c, ci) => (
                        <View key={'ct' + ci} style={styles.globalItem}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.globalItemTxt} numberOfLines={2}>
                              📅 {c.date} — {c.ecart} manquant{c.ecart > 1 ? 's' : ''}
                              <Text style={styles.globalItemCmd}> ({c.nbContacts}/{c.nbCommandes} · {c.taux}%)</Text>
                            </Text>
                          </View>
                          <Text style={[styles.globalItemMontant, { color: '#C62828' }]}>−{fmtShort(c.litige)}</Text>
                        </View>
                      ))}
                    </>
                  )}
                  {/* Point pas fait */}
                  {d.pasFaitTotal > 0 && (
                    <View style={styles.globalVoletRow}>
                      <Text style={styles.globalVoletLabel}>🚫 Point pas fait</Text>
                      <Text style={[styles.globalVoletVal, { color: '#C62828' }]}>−{fmtShort(d.pasFaitTotal)}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )
        })}
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
    const champs = {
      type: formAvis.type, montant,
      canal: formAvis.canal || 'sur_place',
      notes: formAvis.notes || null,
      numero_commande: formAvis.numero_commande || null,
      date: dateToSave,
      responsable_id: formAvis.responsable_id || null,
      responsable_nom: formAvis.responsable_nom || null,
    }
    const run = (payload) => formAvis.id
      ? supabase.from('litiges_avis_clients').update(payload).eq('id', formAvis.id)
      : supabase.from('litiges_avis_clients').insert({ ...payload, restaurant_id: restoSelectionne.id, created_by: userNom || userId })

    let { error } = await run(champs)
    // Repli si la colonne `canal` n'existe pas encore en base (migration non jouée)
    if (error && /canal/i.test(error.message || '')) {
      const { canal: _omit, ...sansCanal } = champs
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

  async function supprimerItem() {
    if (!confirmSuppr) return
    setSaving(true)
    const { table, id } = confirmSuppr
    await supabase.from(table).delete().eq('id', id)
    setSaving(false)
    setConfirmSuppr(null)
    if (table === 'litiges_avis_clients') chargerAvis()
    else if (table === 'litiges_yango') chargerYango()
    else if (table === 'litiges_glovo') chargerGlovo()
    else chargerPointPasFait()
  }

  // ── Helpers UI ───────────────────────────────────────────────
  const multiJour = periodeKey !== '1jour'

  function ouvrirAddAvis() {
    setSaving(false)
    setFormAvis({ type: 'mauvais', canal: 'sur_place', notes: '', numero_commande: '', date_saisie: formDateDefaut(periodeKey, dateUnique), responsable_id: null, responsable_nom: '', id: null })
    setShowFormAvis(true)
  }
  function ouvrirEditAvis(a) {
    setFormAvis({ type: a.type, canal: a.canal || 'sur_place', notes: a.notes || '', numero_commande: a.numero_commande || '', date_saisie: a.date || TODAY, responsable_id: a.responsable_id || null, responsable_nom: a.responsable_nom || '', id: a.id })
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
  function renderResponsablePicker(value, onChange) {
    return (
      <View>
        <Text style={styles.formLabel}>Responsable</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity
              style={[styles.responsableChip, !value && styles.responsableChipActive]}
              onPress={() => onChange(null, '')}
            >
              <Text style={[styles.responsableChipTxt, !value && styles.responsableChipTxtActive]}>— Aucun</Text>
            </TouchableOpacity>
            {utilisateurs.map(u => (
              <TouchableOpacity
                key={u.id}
                style={[styles.responsableChip, value === u.id && styles.responsableChipActive]}
                onPress={() => onChange(u.id, u.nom)}
              >
                <Text style={[styles.responsableChipTxt, value === u.id && styles.responsableChipTxtActive]}>{u.nom}</Text>
              </TouchableOpacity>
            ))}
          </View>
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
            <Text style={[styles.totalBannerValue, { color: '#C62828' }]}>{fmt(totalPointPasFait)}</Text>
          </View>
        )}
        {litigesPointPasFait.map(p => (
          <View key={p.id} style={[styles.ligneCard, { borderColor: '#C6282844', borderWidth: 1 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.ligneNom, { color: '#C62828' }]}>⚠️ Point pas fait</Text>
              {p.responsable_nom ? <Text style={styles.ligneSous}>👤 {p.responsable_nom}</Text> : null}
              {multiJour && p.date ? <Text style={styles.ligneSous}>📅 {p.date}</Text> : null}
              {p.notes ? <Text style={styles.ligneSous}>{p.notes}</Text> : null}
              {p.created_by ? <Text style={styles.ligneCreer}>par {p.created_by}</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <Text style={[styles.montantTxt, { color: '#C62828' }]}>{fmtShort(p.montant)}</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity onPress={() => ouvrirEditPPF(p)}><Text style={styles.btnAction}>✏️</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setConfirmSuppr({ table: 'litiges_point_pas_fait', id: p.id })}><Text style={styles.btnAction}>🗑️</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
        {!litigesPointPasFait.length && <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun point pas fait enregistré</Text></View>}
        <TouchableOpacity style={styles.btnAjout} onPress={ouvrirAddPPF}>
          <Text style={styles.btnAjoutTxt}>+ Ajouter un point pas fait</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Détails d'un écart : explication du gérant + régularisations + bouton annuler/réduire.
  // Partagé entre la vue 1 jour et les lignes dépliées de la vue période.
  function renderEcartDetails(item) {
    return (
      <>
        {/* Explication du gérant (saisie côté Ventes) — aide à décider l'annulation */}
        {item.ecartBrut !== 0 && (item.explication || item.responsablesEcart.length > 0 || item.photosEcart.length > 0) && (
          <View style={styles.explicGerantCard}>
            <Text style={styles.explicGerantTitre}>📝 Explication du gérant</Text>
            {item.explication ? (
              <Text style={styles.explicGerantTxt}>"{item.explication}"</Text>
            ) : (
              <Text style={styles.explicGerantVide}>Aucune explication écrite.</Text>
            )}
            {item.responsablesEcart.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.explicGerantSousTitre}>👤 Responsables désignés</Text>
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
                <Text style={styles.explicGerantSousTitre}>📷 Photos justificatives</Text>
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
                    {r.sens === 'manquant' ? '📉 Manquant justifié' : '📈 Surplus justifié'} · {fmt(r.montant)}
                  </Text>
                  {peutRegulariser && (
                    <TouchableOpacity onPress={() => supprimerRegularisation(item, i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.regulDelTxt}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
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
            <Text style={styles.regulBtnTxt}>🛠️ Annuler / Réduire l'écart</Text>
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
      const c = item.ecart > 0 ? '#C62828' : item.ecart < 0 ? '#F57F17' : '#2E7D32'
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
            backgroundColor: item.ecart !== 0 ? (item.ecart > 0 ? '#FFF0F0' : '#FFF8E1') : '#F0FFF4',
            borderColor: c + '44',
          }]}>
            <Text style={styles.ecartLabel}>{item.annule ? '🚫 Écart annulé' : item.totalRegul > 0 ? 'Écart restant' : 'Écart constaté'}</Text>
            <Text style={[styles.ecartValeur, { color: c }]}>{item.ecart > 0 ? '+' : ''}{fmt(item.ecart)}</Text>
            <Text style={[styles.ecartSous, { color: c }]}>
              {item.annule ? '🚫 Annulé dans Vérification — non pris en compte'
                : item.ecart > 0 ? 'Machine supérieure aux shifts déclarés'
                : item.ecart < 0 ? 'Shifts supérieurs à la machine'
                : (item.totalRegul > 0 ? '✅ Écart entièrement régularisé' : '✅ Aucun écart — tout est aligné')}
            </Text>
            {item.annule && item.ecartBrut !== 0 ? (
              <Text style={styles.ecartRegulHint}>Écart initial {item.ecartBrut > 0 ? '+' : ''}{fmt(item.ecartBrut)} · annulé</Text>
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
    const c = totalEcart > 0 ? '#C62828' : totalEcart < 0 ? '#F57F17' : '#2E7D32'
    return (
      <View style={styles.section}>
        <View style={styles.totalBanner}>
          <Text style={styles.totalBannerLabel}>Écart total période</Text>
          <Text style={[styles.totalBannerValue, { color: c }]}>{totalEcart > 0 ? '+' : ''}{fmt(totalEcart)}</Text>
        </View>
        {ecartsListe.map(j => {
          const cj = j.ecart > 0 ? '#C62828' : j.ecart < 0 ? '#F57F17' : '#2E7D32'
          const ouvert = expandedEcart === j.date
          // Indices qu'il y a quelque chose à consulter / traiter sur ce jour
          const aDetails = j.ecartBrut !== 0 && (j.explication || j.responsablesEcart.length > 0 || j.photosEcart.length > 0 || j.regularisations.length > 0 || (peutRegulariser && j.ecart !== 0))
          return (
            <View key={j.date}>
              <TouchableOpacity
                style={[styles.ligneCard, ouvert && styles.ligneCardActive]}
                onPress={() => aDetails && setExpandedEcart(ouvert ? null : j.date)}
                activeOpacity={aDetails ? 0.6 : 1}
              >
                {aDetails && <Text style={styles.ligneChevron}>{ouvert ? '▾' : '▸'}</Text>}
                <View style={{ flex: 1 }}>
                  <Text style={styles.ligneNom}>{j.date}{j.annule ? '  ·  🚫 annulé' : ''}</Text>
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
    if (!responsablesListe.length) return null
    // Agrégat par personne (pour les chips + total imputé)
    const parPersonne = {}
    responsablesListe.forEach(r => {
      const k = r.responsable_id || r.responsable_nom || '—'
      if (!parPersonne[k]) parPersonne[k] = { key: k, nom: r.responsable_nom || '—', total: 0, count: 0 }
      parPersonne[k].total += parseFloat(r.montant) || 0
      parPersonne[k].count += 1
    })
    const personnes = Object.values(parPersonne).sort((a, b) => b.total - a.total)
    const rows = responsablesListe.filter(r =>
      (filtreType === 'tous' || r.type === filtreType) &&
      (!filtreResponsable || (r.responsable_id || r.responsable_nom || '—') === filtreResponsable)
    )
    const totalFiltre = rows.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0)
    return (
      <View style={[styles.section, { marginTop: 8 }]}>
        <Text style={styles.respSectionTitre}>👤 Responsables des écarts</Text>

        {/* Filtre type */}
        <View style={styles.filtreRow}>
          {[['tous', 'Tous'], ['manquant', 'Manquants'], ['surplus', 'Surplus']].map(([t, label]) => (
            <TouchableOpacity key={t} style={[styles.filtreChip, filtreType === t && styles.filtreChipActif]} onPress={() => setFiltreType(t)}>
              <Text style={[styles.filtreChipTxt, filtreType === t && styles.filtreChipTxtActif]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Filtre responsable */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
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
          <Text style={[styles.totalBannerValue, { color: '#534AB7' }]}>{fmt(totalFiltre)}</Text>
        </View>

        {/* Lignes */}
        {rows.map(r => (
          <View key={r.id} style={styles.ligneCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.ligneNom}>{r.responsable_nom}</Text>
              <Text style={styles.ligneSous}>
                {r.type === 'manquant' ? '📉 Manquant' : '📈 Surplus'} · 📅 {r.date}
                {r.role ? ` · ${r.role === 'gerant' ? 'Gérant' : 'Caissier'}` : ''}
              </Text>
            </View>
            <Text style={[styles.montantTxt, { color: r.type === 'manquant' ? '#C62828' : '#185FA5' }]}>{fmtShort(r.montant)}</Text>
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
          <Text style={[styles.totalBannerValue, { color: '#C62828' }]}>{fmt(totalInventaire)}</Text>
        </View>

        {/* Comptages du vérificateur : montants plafonnés, en attente ou répartis */}
        {deducVerifResto.length > 0 && (
          <>
            <View style={[styles.totalBanner, { marginTop: 10 }]}>
              <Text style={styles.totalBannerLabel}>🔍 Comptage vérificateur</Text>
              <Text style={[styles.totalBannerValue, { color: '#C62828' }]}>{fmt(totalVerif)}</Text>
            </View>
            {totalVerifReel > totalVerif && (
              <View style={styles.plafondBox}>
                <Text style={styles.plafondTxt}>
                  ⚖️ Écart réellement constaté {fmt(totalVerifReel)} — plafond de {fmt(PLAFOND_COMPTAGE)}
                  {' '}par comptage appliqué, {fmt(totalVerif)} retenus.
                </Text>
              </View>
            )}
            {deducVerifResto.map(d => (
              <View key={d.id} style={styles.globalItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.globalItemTxt} numberOfLines={2}>
                    📅 {d.date} — {d.produits_resume || `${d.nb_produits || 0} produit(s) en écart`}
                  </Text>
                  <Text style={styles.globalItemResp}>
                    👤 {d.caissier_nom}{d.shift_libelle ? ` · ${d.shift_libelle}` : ''}
                    {d.statut === 'en_attente' ? ' · ⏳ à répartir' : ' · ✓ réparti'}
                  </Text>
                </View>
                <Text style={[styles.globalItemMontant, { color: '#C62828' }]}>{fmtShort(d.montant)}</Text>
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
                  {multiJour && inv.date ? <Text style={styles.ligneSous}>📅 {inv.date}</Text> : null}
                </View>
                <Text style={[styles.montantTxt, { color: '#C62828' }]}>−{fmtShort(inv.montant_a_deduire)}</Text>
              </View>
              {/* Détail : par produit (manager → bouton Annuler) ou par catégorie (lecture seule) */}
              {peutRegulariser ? (
                inv.lignes.length > 0 && (
                  <View style={styles.catDetail}>
                    {inv.lignes.map(l => (
                      <View key={l.id} style={styles.prodLigne}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={styles.catNom}>{l.produit_nom}</Text>
                          <Text style={[styles.catMontant, { color: '#C62828' }]}>−{fmtShort(l.montant_deduit)} FCFA</Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.annulDeducBtnSm, annulDeducSaving === l.id && { opacity: 0.6 }]}
                          onPress={() => confirmerAnnulationDeductionLitige(l, inv)}
                          disabled={!!annulDeducSaving}
                        >
                          {annulDeducSaving === l.id
                            ? <ActivityIndicator color="#A32D2D" size="small" />
                            : <Text style={styles.annulDeducBtnSmTxt}>🚫 Annuler</Text>}
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
            <Text style={[styles.totalBannerValue, { color: totalAvis > 0 ? '#C62828' : '#2E7D32' }]}>
              {totalAvis > 0 ? '+' : ''}{fmt(totalAvis)}
            </Text>
          </View>
        )}
        {avisClients.map(a => {
          const type = typeAvis(a.type)
          return (
            <View key={a.id} style={styles.ligneCard}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ligneNom, { color: type?.couleur || colors.text }]}>{type?.label || a.type}</Text>
                {a.canal ? <Text style={[styles.ligneSous, { color: canalAvis(a.canal)?.couleur || colors.textMuted, fontWeight: '600' }]}>📍 {canalAvis(a.canal)?.court || a.canal}</Text> : null}
                {a.responsable_nom ? <Text style={styles.ligneSous}>👤 {a.responsable_nom}</Text> : null}
                {a.numero_commande ? <Text style={styles.ligneCmd}>🔖 Cmd #{a.numero_commande}</Text> : null}
                {multiJour && a.date ? <Text style={styles.ligneSous}>📅 {a.date}</Text> : null}
                {a.notes ? <Text style={styles.ligneSous}>{a.notes}</Text> : null}
                {a.created_by ? <Text style={styles.ligneCreer}>par {a.created_by}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[styles.montantTxt, { color: couleurMontant(a.montant, colors) }]}>
                  {a.montant > 0 ? '+' : ''}{fmtShort(a.montant)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => ouvrirEditAvis(a)}><Text style={styles.btnAction}>✏️</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmSuppr({ table: 'litiges_avis_clients', id: a.id })}><Text style={styles.btnAction}>🗑️</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          )
        })}
        {!avisClients.length && <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun avis enregistré</Text></View>}
        <TouchableOpacity style={styles.btnAjout} onPress={ouvrirAddAvis}>
          <Text style={styles.btnAjoutTxt}>+ Ajouter un avis client</Text>
        </TouchableOpacity>
      </View>
    )
  }

  function renderYango() {
    return (
      <View style={styles.section}>
        {litigesYango.length > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Impact total Yango</Text>
            <Text style={[styles.totalBannerValue, { color: totalYango > 0 ? '#C62828' : '#2E7D32' }]}>
              {totalYango > 0 ? '+' : ''}{fmt(totalYango)}
            </Text>
          </View>
        )}
        {litigesYango.map(y => {
          const type = TYPES_YANGO.find(t => t.key === y.type)
          return (
            <View key={y.id} style={styles.ligneCard}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ligneNom, { color: type?.couleur || colors.text }]}>{type?.label || y.type}</Text>
                {y.responsable_nom ? <Text style={styles.ligneSous}>👤 {y.responsable_nom}</Text> : null}
                {y.numero_commande ? <Text style={styles.ligneCmd}>🔖 Cmd #{y.numero_commande}</Text> : null}
                {multiJour && y.date ? <Text style={styles.ligneSous}>📅 {y.date}</Text> : null}
                {y.notes ? <Text style={styles.ligneSous}>{y.notes}</Text> : null}
                {y.created_by ? <Text style={styles.ligneCreer}>par {y.created_by}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[styles.montantTxt, { color: y.montant > 0 ? '#C62828' : '#2E7D32' }]}>
                  {y.montant > 0 ? '+' : ''}{fmtShort(y.montant)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => ouvrirEditYango(y)}><Text style={styles.btnAction}>✏️</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmSuppr({ table: 'litiges_yango', id: y.id })}><Text style={styles.btnAction}>🗑️</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          )
        })}
        {!litigesYango.length && <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun litige Yango enregistré</Text></View>}
        <TouchableOpacity style={styles.btnAjout} onPress={ouvrirAddYango}>
          <Text style={styles.btnAjoutTxt}>+ Ajouter un litige Yango</Text>
        </TouchableOpacity>
      </View>
    )
  }

  function renderGlovo() {
    return (
      <View style={styles.section}>
        {litigesGlovo.length > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Impact total Glovo</Text>
            <Text style={[styles.totalBannerValue, { color: totalGlovo > 0 ? '#C62828' : '#2E7D32' }]}>
              {totalGlovo > 0 ? '+' : ''}{fmt(totalGlovo)}
            </Text>
          </View>
        )}
        {litigesGlovo.map(g => {
          const type = TYPES_GLOVO.find(t => t.key === g.type)
          return (
            <View key={g.id} style={styles.ligneCard}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.ligneNom, { color: type?.couleur || colors.text }]}>{type?.label || g.type}</Text>
                {g.responsable_nom ? <Text style={styles.ligneSous}>👤 {g.responsable_nom}</Text> : null}
                {g.numero_commande ? <Text style={styles.ligneCmd}>🔖 Cmd #{g.numero_commande}</Text> : null}
                {multiJour && g.date ? <Text style={styles.ligneSous}>📅 {g.date}</Text> : null}
                {g.notes ? <Text style={styles.ligneSous}>{g.notes}</Text> : null}
                {g.created_by ? <Text style={styles.ligneCreer}>par {g.created_by}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[styles.montantTxt, { color: g.montant > 0 ? '#C62828' : '#2E7D32' }]}>
                  {g.montant > 0 ? '+' : ''}{fmtShort(g.montant)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => ouvrirEditGlovo(g)}><Text style={styles.btnAction}>✏️</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmSuppr({ table: 'litiges_glovo', id: g.id })}><Text style={styles.btnAction}>🗑️</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          )
        })}
        {!litigesGlovo.length && <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucun litige Glovo enregistré</Text></View>}
        <TouchableOpacity style={styles.btnAjout} onPress={ouvrirAddGlovo}>
          <Text style={styles.btnAjoutTxt}>+ Ajouter un litige Glovo</Text>
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
    const multiJour = periodeKey !== '1jour'
    return (
      <View style={styles.section}>
        {totalContact > 0 && (
          <View style={styles.totalBanner}>
            <Text style={styles.totalBannerLabel}>Total litige contacts</Text>
            <Text style={[styles.totalBannerValue, { color: '#C62828' }]}>{fmt(totalContact)}</Text>
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
              <View key={idx} style={[styles.ligneCard, { flexDirection: 'column', alignItems: 'stretch' }, aLitige && { borderColor: '#C62828', borderWidth: 1 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.ligneNom, { color: colors.text }]}>📅 {item.date}</Text>
                    {item.caissiers ? <Text style={styles.ligneSous}>👤 {item.caissiers}</Text> : null}
                    <Text style={styles.ligneSous}>
                      Cmds : {item.nbCommandes} (Y {item.nbYango} · G {item.nbGlovo})  ·  Contacts : {item.nbContacts}  ·  Écart : {item.ecart}  ·  {item.taux}%
                    </Text>
                    {item.nbCorrige && (
                      <Text style={styles.corrBadge}>
                        ✏️ Nb corrigé (avant : Y {item.nbYangoOriginal ?? '—'} · G {item.nbGlovoOriginal ?? '—'})
                        {item.nbCorrigePar ? ` — ${item.nbCorrigePar}` : ''}
                        {item.nbCorrigeMotif ? ` · ${item.nbCorrigeMotif}` : ''}
                      </Text>
                    )}
                    {item.contactsParCaissier?.length > 0 && (
                      <View style={{ marginTop: 4, gap: 2 }}>
                        {item.contactsParCaissier.map((c, ci) => (
                          <Text key={ci} style={[styles.ligneSous, { color: '#185FA5' }]}>
                            📞 {c.nom} : {c.nb} contact{c.nb > 1 ? 's' : ''}
                          </Text>
                        ))}
                      </View>
                    )}
                    {parfait && !item.forceParManager && <Text style={{ fontSize: 12, color: '#2E7D32', fontWeight: '600' }}>✅ Parfait</Text>}
                    {tolere && !item.forceParManager && <Text style={{ fontSize: 12, color: '#F57F17', fontWeight: '600' }}>✅ Toléré</Text>}
                    {surplus && !item.forceParManager && (
                      <Text style={{ fontSize: 12, color: '#F57F17', fontWeight: '600' }}>
                        ↩️ Surplus de {Math.abs(item.ecart)} contact{Math.abs(item.ecart) > 1 ? 's' : ''} — pas de litige
                      </Text>
                    )}
                    {item.litigeCalcule > 0 && !item.forceParManager && (
                      <Text style={{ fontSize: 12, color: '#C62828', fontWeight: '600' }}>
                        ⚠️ {item.ecart} × 500 = {fmtShort(item.litigeCalcule)}
                      </Text>
                    )}
                    {item.forceParManager && (
                      <Text style={styles.corrBadge}>
                        ✏️ Montant forcé (calculé : {fmtShort(item.litigeCalcule)})
                        {item.forcePar ? ` — ${item.forcePar}` : ''}
                        {item.motif ? ` · ${item.motif}` : ''}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.montantTxt, { color: item.litige > 0 ? '#C62828' : '#2E7D32' }]}>
                    {fmtShort(item.litige)}
                  </Text>
                </View>

                {peutRegulariser && item.point && (
                  <View style={styles.corrBtnRow}>
                    <TouchableOpacity style={styles.corrBtn} onPress={() => ouvrirCorrNbCommandes(item)}>
                      <Text style={styles.corrBtnTxt}>✏️ Nb commandes</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.corrBtn} onPress={() => ouvrirCorrLitige(item)}>
                      <Text style={styles.corrBtnTxt}>✏️ Montant du litige</Text>
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
            <Text style={{ fontSize: 14, fontWeight: '700', color: totalContact > 0 ? '#C62828' : '#2E7D32' }}>
              {totalContact > 0 ? fmtShort(totalContact) : '0 FCFA ✅'}
            </Text>
          </View>
        )}
      </View>
    )
  }

  // ── Label plage affichée ─────────────────────────────────────
  function plageLabel() {
    if (periodeKey === '1jour') return dateUnique
    return `${plage.debut} → ${plage.fin}`
  }

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>⚖️ Litiges</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Restaurant */}
      <View style={styles.restoRow}>
        {isGerant ? (
          <View style={styles.restoBtn}>
            <Text style={styles.restoTxt} numberOfLines={1}>
              🏪 {restoSelectionne?.nom || '...'}
            </Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.restoBtn} onPress={() => setShowRestoPicker(true)}>
            <Text style={styles.restoTxt} numberOfLines={1}>
              {modeGlobal ? '🌐 Tous les restaurants' : '🏪 ' + (restoSelectionne?.nom || 'Restaurant...')}
            </Text>
            <Text style={styles.restoArrow}>▾</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Sélecteur de période */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.periodeScroll} contentContainerStyle={styles.periodeContent}>
        {PERIODES.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodePill, periodeKey === p.key && styles.periodePillActive]}
            onPress={() => setPeriodeKey(p.key)}
          >
            <Text style={[styles.periodePillTxt, periodeKey === p.key && styles.periodePillTxtActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Date(s) sélectionnée(s) */}
      <View style={styles.dateRow}>
        {periodeKey === '1jour' ? (
          <TouchableOpacity style={styles.datePill} onPress={() => setShowCalUnique(true)}>
            <Text style={styles.datePillTxt}>📅 {dateUnique}</Text>
          </TouchableOpacity>
        ) : periodeKey === 'perso' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity style={styles.datePill} onPress={() => setShowCalDebut(true)}>
              <Text style={styles.datePillTxt}>Du {dateDebut}</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.textMuted, fontSize: 14 }}>→</Text>
            <TouchableOpacity style={styles.datePill} onPress={() => setShowCalFin(true)}>
              <Text style={styles.datePillTxt}>Au {dateFin}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.datePill}>
            <Text style={styles.datePillTxt}>📅 {plage.debut} → {plage.fin}</Text>
          </View>
        )}
      </View>

      {/* KPI global — masqué en mode tous restaurants */}
      {!modeGlobal && restoSelectionne && (
        <View style={[styles.kpiGlobal, {
          backgroundColor: totalGlobal > 0 ? '#FFF0F0' : totalGlobal < 0 ? '#F0FFF4' : colors.surface,
          borderColor: totalGlobal > 0 ? '#FFCDD2' : totalGlobal < 0 ? '#C8E6C9' : colors.borderLight,
        }]}>
          <Text style={styles.kpiGlobalLabel}>Impact total — {plageLabel()}</Text>
          <Text style={[styles.kpiGlobalValue, {
            color: totalGlobal > 0 ? '#C62828' : totalGlobal < 0 ? '#2E7D32' : colors.textMuted,
          }]}>
            {totalGlobal > 0 ? '+' : ''}{fmt(totalGlobal)}
          </Text>
        </View>
      )}

      {/* Onglets — masqués en mode tous restaurants */}
      {!modeGlobal && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsContent}>
          {ONGLETS.map(o => (
            <TouchableOpacity key={o.key} style={[styles.tab, onglet === o.key && styles.tabActive]} onPress={() => setOnglet(o.key)}>
              <Text style={[styles.tabTxt, onglet === o.key && styles.tabTxtActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Contenu */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color='#185FA5' />
      ) : modeGlobal ? (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 50 }} showsVerticalScrollIndicator={false}>
          {renderModeGlobal()}
        </ScrollView>
      ) : !restoSelectionne ? (
        <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Sélectionnez un restaurant</Text></View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 50 }} showsVerticalScrollIndicator={false}>
          {onglet === 'ecarts' && (<>{renderEcarts()}{renderResponsablesEcarts()}</>)}
          {onglet === 'inventaire' && renderInventaire()}
          {onglet === 'avis' && renderAvis()}
          {onglet === 'yango' && renderYango()}
          {onglet === 'glovo' && renderGlovo()}
          {onglet === 'contact' && renderEcartContacts()}
          {onglet === 'point_pas_fait' && renderPointPasFait()}
        </ScrollView>
      )}

      {/* ── Modal Restaurant ── */}
      <Modal visible={showRestoPicker} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowRestoPicker(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.pickerBox}>
            <Text style={styles.pickerTitre}>Sélectionner un restaurant</Text>
            <ScrollView>
              {/* Option "Tous les restaurants" — masquée pour le gérant */}
              {!isGerant && (
                <TouchableOpacity
                  style={[styles.pickerLigne, modeGlobal && styles.pickerLigneActive, { borderBottomWidth: 1, borderBottomColor: '#e0e0e0' }]}
                  onPress={() => { setModeGlobal(true); setRestoSelectionne(null); setShowRestoPicker(false) }}
                >
                  <Text style={[styles.pickerLigneTxt, modeGlobal && { color: '#534AB7', fontWeight: '700' }]}>🌐 Tous les restaurants</Text>
                </TouchableOpacity>
              )}
              {restaurants.map(r => (
                <TouchableOpacity key={r.id}
                  style={[styles.pickerLigne, !modeGlobal && restoSelectionne?.id === r.id && styles.pickerLigneActive]}
                  onPress={() => { setModeGlobal(false); setRestoSelectionne(r); chargerDatesAvec(r.id); chargerUtilisateurs(r.id); setShowRestoPicker(false) }}
                >
                  <Text style={[styles.pickerLigneTxt, !modeGlobal && restoSelectionne?.id === r.id && { color: '#185FA5', fontWeight: '600' }]}>{r.nom}</Text>
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
            <Calendar
              current={dateUnique}
              onDayPress={day => { setDateUnique(day.dateString); setShowCalUnique(false) }}
              markedDates={{ ...datesAvec, [dateUnique]: { selected: true, selectedColor: '#185FA5' } }}
              theme={{ selectedDayBackgroundColor: '#185FA5', todayTextColor: '#185FA5', arrowColor: '#185FA5' }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Calendrier Début (perso) ── */}
      <Modal visible={showCalDebut} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowCalDebut(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.pickerBox, { padding: 0 }]}>
            <Calendar
              current={dateDebut}
              onDayPress={day => { setDateDebut(day.dateString); setShowCalDebut(false) }}
              markedDates={{ [dateDebut]: { selected: true, selectedColor: '#185FA5' } }}
              theme={{ selectedDayBackgroundColor: '#185FA5', todayTextColor: '#185FA5', arrowColor: '#185FA5' }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Calendrier Fin (perso) ── */}
      <Modal visible={showCalFin} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowCalFin(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.pickerBox, { padding: 0 }]}>
            <Calendar
              current={dateFin}
              onDayPress={day => { setDateFin(day.dateString); setShowCalFin(false) }}
              markedDates={{ [dateFin]: { selected: true, selectedColor: '#185FA5' } }}
              theme={{ selectedDayBackgroundColor: '#185FA5', todayTextColor: '#185FA5', arrowColor: '#185FA5' }}
            />
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

            <Text style={styles.formLabel}>Date</Text>
            <TextInput style={styles.formInput} value={formAvis.date_saisie}
              onChangeText={v => setFormAvis(p => ({ ...p, date_saisie: v }))}
              placeholder="AAAA-MM-JJ" placeholderTextColor="#bbb" />

            {renderResponsablePicker(formAvis.responsable_id, (id, nom) => setFormAvis(p => ({ ...p, responsable_id: id, responsable_nom: nom })))}

            <Text style={styles.formLabel}>Notes (optionnel)</Text>
            <TextInput style={[styles.formInput, { height: 56 }]} value={formAvis.notes}
              onChangeText={v => setFormAvis(p => ({ ...p, notes: v }))}
              placeholder="Détails du litige..." placeholderTextColor="#bbb" multiline />

            {saveError && <Text style={{ color: '#C62828', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>⚠️ {saveError}</Text>}
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

            <Text style={styles.formLabel}>Date</Text>
            <TextInput style={styles.formInput} value={formYango.date_saisie}
              onChangeText={v => setFormYango(p => ({ ...p, date_saisie: v }))}
              placeholder="AAAA-MM-JJ" placeholderTextColor="#bbb" />

            {renderResponsablePicker(formYango.responsable_id, (id, nom) => setFormYango(p => ({ ...p, responsable_id: id, responsable_nom: nom })))}

            <Text style={styles.formLabel}>Notes (optionnel)</Text>
            <TextInput style={styles.formInput} value={formYango.notes}
              onChangeText={v => setFormYango(p => ({ ...p, notes: v }))}
              placeholder="Détails..." placeholderTextColor="#bbb" />

            {saveError && <Text style={{ color: '#C62828', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>⚠️ {saveError}</Text>}
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
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

            <Text style={styles.formLabel}>Date</Text>
            <TextInput style={styles.formInput} value={formGlovo.date_saisie}
              onChangeText={v => setFormGlovo(p => ({ ...p, date_saisie: v }))}
              placeholder="AAAA-MM-JJ" placeholderTextColor="#bbb" />

            {renderResponsablePicker(formGlovo.responsable_id, (id, nom) => setFormGlovo(p => ({ ...p, responsable_id: id, responsable_nom: nom })))}

            <Text style={styles.formLabel}>Notes (optionnel)</Text>
            <TextInput style={styles.formInput} value={formGlovo.notes}
              onChangeText={v => setFormGlovo(p => ({ ...p, notes: v }))}
              placeholder="Détails..." placeholderTextColor="#bbb" />

            {saveError && <Text style={{ color: '#C62828', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>⚠️ {saveError}</Text>}
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

      {/* ── Modal Point pas fait ── */}
      <Modal visible={showFormPPF} transparent animationType="slide">
        <ScrollView contentContainerStyle={styles.overlay} keyboardShouldPersistTaps="handled">
          <View style={styles.formModal}>
            <Text style={styles.formTitre}>{formPPF.id ? 'Modifier' : 'Ajouter'} — Point pas fait</Text>

            {renderResponsablePicker(formPPF.responsable_id, (id, nom) => setFormPPF(p => ({ ...p, responsable_id: id, responsable_nom: nom })))}

            <Text style={styles.formLabel}>Montant (FCFA)</Text>
            <TextInput style={styles.formInput} value={formPPF.montant}
              onChangeText={v => setFormPPF(p => ({ ...p, montant: v }))}
              placeholder="Ex: 5000" placeholderTextColor="#bbb" keyboardType="numeric" />

            <Text style={styles.formLabel}>Date</Text>
            <TextInput style={styles.formInput} value={formPPF.date_saisie}
              onChangeText={v => setFormPPF(p => ({ ...p, date_saisie: v }))}
              placeholder="AAAA-MM-JJ" placeholderTextColor="#bbb" />

            <Text style={styles.formLabel}>Notes (optionnel)</Text>
            <TextInput style={[styles.formInput, { height: 56 }]} value={formPPF.notes}
              onChangeText={v => setFormPPF(p => ({ ...p, notes: v }))}
              placeholder="Contexte..." placeholderTextColor="#bbb" multiline />

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => setShowFormPPF(false)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnValider, { backgroundColor: '#C62828' }]} onPress={sauvegarderPointPasFait} disabled={saving}>
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
            <Text style={styles.formTitre}>✏️ Corriger le nombre de commandes</Text>
            {corrCmd && (
              <>
                <View style={styles.regulInfo}>
                  <Text style={styles.regulInfoTxt}>📅 {corrCmd.date}</Text>
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

                {corrError ? <Text style={styles.corrErrorTxt}>⚠️ {corrError}</Text> : null}
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
            <Text style={styles.formTitre}>✏️ Corriger le montant du litige</Text>
            {corrLitige && (
              <>
                <View style={styles.regulInfo}>
                  <Text style={styles.regulInfoTxt}>📅 {corrLitige.date}</Text>
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

                {corrError ? <Text style={styles.corrErrorTxt}>⚠️ {corrError}</Text> : null}

                {corrLitige.forceParManager && (
                  <TouchableOpacity
                    style={styles.corrResetBtn}
                    onPress={() => sauvegarderCorrLitige(true)}
                    disabled={corrSaving}
                  >
                    <Text style={styles.corrResetBtnTxt}>↩️ Revenir au montant calculé</Text>
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
            <Text style={[styles.formTitre, { color: '#C62828' }]}>Supprimer cet élément ?</Text>
            <Text style={{ fontSize: 13, color: '#666', textAlign: 'center' }}>Cette action est irréversible.</Text>
            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.btnAnnuler} onPress={() => setConfirmSuppr(null)}>
                <Text style={styles.btnAnnulerTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnValider, { backgroundColor: '#C62828' }]} onPress={supprimerItem} disabled={saving}>
                <Text style={styles.btnValiderTxt}>{saving ? '...' : 'Supprimer'}</Text>
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
                      {sens === 'manquant' ? '📉 Régulariser un manquant' : '📈 Régulariser un surplus'}
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
                            <Text style={styles.regulPhotoDelTxt}>✕</Text>
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
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#534AB7',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontSize: 28, color: '#fff', lineHeight: 32 },
  headerTitre: { fontSize: 17, fontWeight: '700', color: '#fff' },

  restoRow: {
    padding: 10, paddingBottom: 6,
    backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
  },
  restoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 0.5, borderColor: colors.border,
  },
  restoTxt: { fontSize: 14, color: colors.text, fontWeight: '500', flex: 1 },
  restoArrow: { fontSize: 12, color: colors.textMuted, marginLeft: 6 },

  periodeScroll: { maxHeight: 44, backgroundColor: colors.surface },
  periodeContent: { paddingHorizontal: 10, paddingVertical: 7, gap: 6, alignItems: 'center' },
  periodePill: {
    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
    backgroundColor: colors.bg, borderWidth: 0.5, borderColor: colors.border,
  },
  periodePillActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  periodePillTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  periodePillTxtActive: { color: '#fff', fontWeight: '600' },

  dateRow: {
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
    flexDirection: 'row',
  },
  datePill: {
    backgroundColor: '#EBF3FF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 0.5, borderColor: '#B8D4F5',
  },
  datePillTxt: { fontSize: 12, color: '#185FA5', fontWeight: '600' },

  kpiGlobal: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 10, marginTop: 8, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9, borderWidth: 0.5,
  },
  kpiGlobalLabel: { fontSize: 11, color: '#666', fontWeight: '500' },
  kpiGlobalValue: { fontSize: 17, fontWeight: '800' },

  tabsScroll: { maxHeight: 44, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  tabsContent: { paddingHorizontal: 10, paddingVertical: 6, gap: 6, alignItems: 'center' },
  tab: {
    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
    backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border,
  },
  tabActive: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  tabTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  tabTxtActive: { color: '#fff', fontWeight: '600' },

  body: { flex: 1, padding: 10 },
  section: { gap: 10 },

  kpiRow: { flexDirection: 'row', gap: 10 },
  kpiBox: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: colors.borderLight,
  },
  kpiLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 4, fontWeight: '500' },
  kpiValue: { fontSize: 16, fontWeight: '700' },

  ecartCard: { borderRadius: 14, padding: 18, alignItems: 'center', gap: 6, borderWidth: 1 },
  ecartLabel: { fontSize: 12, color: '#666', fontWeight: '500' },
  ecartValeur: { fontSize: 28, fontWeight: '800' },
  ecartSous: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  ecartRegulHint: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 6 },

  // ── Régularisation ──
  regulCard: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 12,
    borderWidth: 0.5, borderColor: colors.border,
  },
  regulCardTitre: { fontSize: 13, fontWeight: '700', color: colors.text, flex: 1 },
  regulDelTxt: { fontSize: 16, color: '#C62828', fontWeight: '700', paddingLeft: 8 },
  regulMotif: { fontSize: 13, color: colors.textSecondary, marginTop: 6, lineHeight: 18 },
  regulMeta: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  regulPhotosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 12 },
  regulPhotoWrap: { position: 'relative' },
  regulPhotoThumb: { width: 60, height: 60, borderRadius: 8 },
  regulPhotoDel: {
    position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#C62828', alignItems: 'center', justifyContent: 'center',
  },
  regulPhotoDelTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  regulPhotoAdd: {
    width: 60, height: 60, borderRadius: 8, borderWidth: 1.5, borderColor: '#534AB7',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  regulPhotoAddTxt: { fontSize: 26, color: '#534AB7', fontWeight: '300' },
  regulBtn: {
    marginTop: 14, backgroundColor: '#534AB7', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  regulBtnTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
  regulInfo: { backgroundColor: colors.bg, borderRadius: 10, padding: 12, marginBottom: 14 },
  regulInfoTxt: { fontSize: 14, color: colors.text },
  regulInfoSub: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 17 },

  // ── Explication gérant (affichée dans l'écart) ──
  explicGerantCard: {
    marginTop: 12, backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: '#534AB7',
  },
  explicGerantTitre: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 6 },
  explicGerantTxt: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', lineHeight: 19 },
  explicGerantVide: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  explicGerantSousTitre: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 4 },
  explicRespRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
  },
  explicRespNom: { fontSize: 13, color: colors.text },
  explicRespMontant: { fontSize: 13, fontWeight: '700', color: '#534AB7' },

  // ── Filtres responsables ──
  respSectionTitre: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 },
  filtreRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  filtreChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, marginRight: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  filtreChipActif: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  filtreChipTxt: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  filtreChipTxtActif: { color: '#fff' },

  totalBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: colors.borderLight,
  },
  totalBannerLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  totalBannerValue: { fontSize: 17, fontWeight: '700' },

  ligneCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: colors.borderLight,
  },
  ligneCardActive: { borderColor: '#534AB7', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  ligneChevron: { fontSize: 13, color: '#534AB7', marginRight: 8, fontWeight: '700' },
  ligneDetails: {
    backgroundColor: colors.surface, borderColor: '#534AB7', borderWidth: 0.5, borderTopWidth: 0,
    borderBottomLeftRadius: 12, borderBottomRightRadius: 12, padding: 14, marginBottom: 2,
  },
  ligneNom: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 2 },
  ligneCmd: { fontSize: 12, color: '#185FA5', fontWeight: '500', marginBottom: 2 },
  ligneSous: { fontSize: 12, color: colors.textMuted },
  ligneCreer: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  montantTxt: { fontSize: 15, fontWeight: '700' },
  btnAction: { fontSize: 17 },

  catDetail: {
    backgroundColor: colors.bg, borderRadius: 8, padding: 10,
    borderWidth: 0.5, borderColor: colors.borderLight, gap: 4,
  },
  catLigne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catNom: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  catMontant: { fontSize: 12, fontWeight: '700', color: '#C62828' },
  prodLigne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  annulDeducBtnSm: { backgroundColor: '#FCEBEB', borderWidth: 1, borderColor: '#F09595', borderRadius: 7, paddingVertical: 6, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', minWidth: 78, minHeight: 32 },
  annulDeducBtnSmTxt: { color: '#A32D2D', fontWeight: '700', fontSize: 12 },

  // Corrections manager du volet Contacts
  corrBadge: { fontSize: 11, color: '#854F0B', fontWeight: '600', marginTop: 2, lineHeight: 15 },
  corrBtnRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  corrBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.borderLight,
  },
  corrBtnTxt: { fontSize: 12, fontWeight: '600', color: '#534AB7' },
  corrErrorTxt: { color: '#C62828', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  corrResetBtn: {
    paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginBottom: 10,
    backgroundColor: '#F1EFE8', borderWidth: 1, borderColor: '#854F0B',
  },
  corrResetBtnTxt: { fontSize: 13, fontWeight: '700', color: '#854F0B' },

  emptyBox: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  emptySubTxt: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },

  btnAjout: {
    backgroundColor: '#185FA5', borderRadius: 12, padding: 14,
    alignItems: 'center', marginTop: 4,
  },
  btnAjoutTxt: { fontSize: 14, color: '#fff', fontWeight: '600' },

  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', padding: 18,
  },
  pickerBox: { backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', maxHeight: 420 },
  pickerTitre: {
    fontSize: 14, fontWeight: '700', color: colors.textMuted,
    padding: 16, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
  },
  pickerLigne: { padding: 16, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  pickerLigneActive: { backgroundColor: '#EBF3FF' },
  pickerLigneTxt: { fontSize: 15, color: colors.text },

  formModal: { backgroundColor: colors.surface, borderRadius: 20, padding: 20 },
  formTitre: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 14 },
  formLabel: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6,
  },
  formInput: {
    backgroundColor: colors.bg, borderRadius: 10, padding: 12,
    fontSize: 15, color: colors.text, marginBottom: 12,
    borderWidth: 0.5, borderColor: colors.border,
  },
  formBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },

  typeBtn: {
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg, alignItems: 'center',
  },
  typeBtnTxt: { fontSize: 13, fontWeight: '600', color: colors.text },
  typeBtnMontant: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  btnAnnuler: {
    flex: 1, padding: 13, borderRadius: 10,
    backgroundColor: colors.bg, alignItems: 'center',
    borderWidth: 0.5, borderColor: colors.border,
  },
  btnAnnulerTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  btnValider: { flex: 1, padding: 13, borderRadius: 10, backgroundColor: '#185FA5', alignItems: 'center' },
  btnValiderTxt: { fontSize: 14, color: '#fff', fontWeight: '600' },

  responsableChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: colors.bg, borderWidth: 0.5, borderColor: colors.border,
  },
  responsableChipActive: { backgroundColor: '#534AB7', borderColor: '#534AB7' },
  responsableChipTxt: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  responsableChipTxtActive: { color: '#fff', fontWeight: '600' },

  btnPdf: {
    backgroundColor: '#534AB7', borderRadius: 12, padding: 14,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  btnPdfTxt: { fontSize: 14, color: '#fff', fontWeight: '700' },

  restoGlobalCard: {
    backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: 0.5, borderColor: colors.borderLight, overflow: 'hidden',
  },
  restoGlobalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#534AB7', paddingHorizontal: 14, paddingVertical: 10,
  },
  restoGlobalNom: { fontSize: 14, fontWeight: '700', color: '#fff', flex: 1 },
  restoGlobalTotal: { fontSize: 14, fontWeight: '800', color: '#fff' },
  restoGlobalBody: { padding: 10, gap: 6 },

  globalVoletRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 5, paddingHorizontal: 4,
    borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
  },
  globalVoletLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  globalVoletVal: { fontSize: 13, fontWeight: '700' },

  globalItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 4, paddingLeft: 10,
    borderLeftWidth: 2, borderLeftColor: colors.borderLight,
    marginLeft: 4,
  },
  globalItemTxt: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  globalItemCmd: { fontSize: 12, color: '#185FA5', fontWeight: '600' },
  globalItemResp: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  plafondBox: { backgroundColor: '#FFF4E0', borderRadius: 8, padding: 9, marginVertical: 5, borderWidth: 1, borderColor: '#E8C98A' },
  plafondTxt: { fontSize: 11, color: '#7A4800', lineHeight: 16 },
  globalItemMontant: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
}) }

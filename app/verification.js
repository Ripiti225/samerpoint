import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, ScrollView, ActivityIndicator,
  Modal, Alert, RefreshControl, Dimensions, FlatList, TextInput,
} from 'react-native'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useLocalSearchParams } from 'expo-router'
import { supabase } from '../lib/supabase'
import { annulerDeductionInventaire, deciderEcartInventaire } from '../lib/api'
import { useApp } from '../context/AppContext'
import { genererPdfPoint, genererPdfEcarts } from '../lib/generatePdf'
import { CATEGORIES_INVENTAIRE } from '../lib/constants'
import {
  PLAFOND_COMPTAGE, chargerDeductions, repartitionValide,
} from '../lib/deductionsVerification'
import { useTheme } from '../context/ThemeContext'
import { journaliser } from '../lib/journal'
import {
  calculerLitigeContact, chargerRestaurantsContact, choisirNombreContacts,
  compterCommandesPOS, contactsViennentDuPOS, corrigerNbCommandes,
} from '../lib/litigeContacts'
import { detailContactsParCaissier, panierMoyenLivraison } from '../lib/contactsParCaissier'
import { creerNotification } from '../lib/notificationsInterne'
import { envoyerNotifFactureCorrigee } from '../lib/notifications'
import PhotoJustificatif, { photoConsultable } from '../components/PhotoJustificatif'
import { estPhotoEnAttente } from '../lib/photoQueue'
import { cloturesPOS, resumerEcartsGlobaux } from '../lib/cloturesCaisse'
import { decisionEcartShiftPOS, SOURCE_DECISION_POS } from '../lib/ecartPOS'
import { preparerEntreesVerification } from '../lib/entreesVerification'
import { photosCanalDisponibles } from '../lib/photosVerification'
import {
  alertesPoint, bornesDuMois, libelleMoisLong, moisVoisin, organiserPoints, ventesParCanal,
} from '../lib/verificationListe'

const { width: SW } = Dimensions.get('window')

// Décision du manager sur l'explication d'écart « vente machine ».
// Sert à la fois au badge affiché et au contenu de la notification gérant.
const STATUT_MACHINE = {
  // Statut d'historique : le bouton « ✅ Valider » a été remplacé par « ✔️ Justifier »
  // le 15/08/2026. Plus aucune action ne pose ce statut, mais les points déjà validés
  // doivent continuer d'afficher leur badge.
  validee: {
    label: '✅ Explication validée',
    box: { backgroundColor: '#EAF3DE', borderColor: '#3B6D11' },
    txt: '#3B6D11',
    titreNotif: '✅ Explication validée',
    msgNotif: (d) => `L'écart de vente machine du ${d} a été validé par le manager. Aucune correction nécessaire.`,
    confirm: 'Valider cette explication ? Le gérant sera notifié.',
  },
  justifiee: {
    label: '✔️ Écart justifié',
    box: { backgroundColor: '#EAF3DE', borderColor: '#3B6D11' },
    txt: '#3B6D11',
    titreNotif: '✔️ Écart justifié',
    msgNotif: (d) => `L'écart de vente machine du ${d} a été justifié par le manager. Le fond n'a pas été modifié.`,
    confirm: 'Justifier cet écart ? Le gérant sera notifié.',
  },
  refusee: {
    label: '❌ Explication refusée',
    box: { backgroundColor: '#FCEBEB', borderColor: '#A32D2D' },
    txt: '#A32D2D',
    titreNotif: '❌ Explication refusée',
    msgNotif: (d) => `L'écart de vente machine du ${d} a été refusé par le manager. Merci de corriger ou de fournir une nouvelle explication.`,
    confirm: 'Refuser cette explication ? Le gérant sera notifié.',
  },
  annulee: {
    label: '🚫 Écart annulé',
    box: { backgroundColor: '#F1EFE8', borderColor: '#854F0B' },
    txt: '#854F0B',
    titreNotif: '🚫 Écart annulé',
    msgNotif: (d) => `L'écart de vente machine du ${d} a été annulé par le manager : il n'est plus pris en compte.`,
    confirm: 'Annuler cet écart ? Il ne sera plus pris en compte et le gérant sera notifié.',
  },
}

export default function VerificationScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { userNom, roleActif, userId } = useApp() ?? {}
  const { restaurant_id: paramRestoId, point_id: paramPointId } = useLocalSearchParams()
  const [restaurants, setRestaurants] = useState([])
  const [restoSelectionne, setRestoSelectionne] = useState(null)
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pointSelectionne, setPointSelectionne] = useState(null)
  const [modalPoint, setModalPoint] = useState(false)
  const [detailPoint, setDetailPoint] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [modalPhoto, setModalPhoto] = useState(false)
  const [photoSelectionnee, setPhotoSelectionnee] = useState(null)
  const [validating, setValidating] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  // Un mois à la fois (les points à vérifier plus anciens restent en tête).
  const [mois, setMois] = useState(() => new Date().toISOString().slice(0, 7))
  const liste = useMemo(() => organiserPoints(points, mois), [points, mois])
  // Onglet de la fiche d'un point : ventes · ecart · photos · depenses · argent · equipe · stock · historique
  const [ongletFiche, setOngletFiche] = useState('ventes')
  // Inventaire du point, affiché dans l'onglet Stock de la fiche
  const [detailInventaire, setDetailInventaire] = useState(null)
  const inventaireDemande = useRef(null)  // point dont l'inventaire est attendu
  const [annulDeducSaving, setAnnulDeducSaving] = useState(null)  // id de la ligne en cours d'annulation
  // Décision manager sur un écart inventaire expliqué (validee / refusee)
  const [decisionInv, setDecisionInv] = useState(null)  // { ...ligneEcart } ou null
  const [qteAcceptee, setQteAcceptee] = useState('')
  const [decisionSaving, setDecisionSaving] = useState(false)
  const [loadingInventaire, setLoadingInventaire] = useState(false)
  // Montants issus des comptages du vérificateur, en attente de décision
  const [deducVerif, setDeducVerif] = useState([])
  const [deducMigration, setDeducMigration] = useState(false)
  const [deducEnCours, setDeducEnCours] = useState(null)
  // Répartition en cours d'édition : { [lot_id]: [{ ...part, montant }] }
  const [repartition, setRepartition] = useState({})
  const [caissiersDuJour, setCaissiersDuJour] = useState([])
  const [justifie, setJustifie] = useState({})     // { [lot]: montant non déduit }
  const [rouverts, setRouverts] = useState({})     // { [lot]: true } → décision reprise
  const [generatingEcartsPdf, setGeneratingEcartsPdf] = useState(false)
  // Déverrouillage / correction
  const [modalCorrection, setModalCorrection] = useState(false)
  const [sectionsSelectionnees, setSectionsSelectionnees] = useState([])
  const [motifCorrection, setMotifCorrection] = useState('')
  const [savingCorrection, setSavingCorrection] = useState(false)
  const [errorCorrection, setErrorCorrection] = useState('')
  // Décision manager sur l'explication d'écart « vente machine »
  const [statuantMachine, setStatuantMachine] = useState(false)
  // Annulation d'écart (régularise le fond, même mécanique que Litiges)
  const [modalAnnulerMachine, setModalAnnulerMachine] = useState(null)
  const [annulerMontant, setAnnulerMontant] = useState('')
  const [annulerSaving, setAnnulerSaving] = useState(false)
  // Annulation d'une décision déjà posée sur l'écart machine (retour en arrière)
  const [retourSaving, setRetourSaving] = useState(false)
  // Correction du nombre de commandes Yango/Glovo saisi par le gérant
  // (il sert au litige « contacts » — une faute de frappe crée un faux litige)
  const [corrCmdOuvert, setCorrCmdOuvert] = useState(false)
  const [corrCmdYango, setCorrCmdYango] = useState('')
  const [corrCmdGlovo, setCorrCmdGlovo] = useState('')
  const [corrCmdMotif, setCorrCmdMotif] = useState('')
  const [corrCmdSaving, setCorrCmdSaving] = useState(false)
  const [corrCmdError, setCorrCmdError] = useState('')
  // Correction de facture fournisseur (montant saisi ≠ photo)
  const [corrFacture, setCorrFacture] = useState(null) // la transaction ciblée
  const [corrMontant, setCorrMontant] = useState('')
  const [corrRaison, setCorrRaison] = useState('')
  const [corrSaving, setCorrSaving] = useState(false)
  const [corrError, setCorrError] = useState('')
  // Galerie photos zoom
  const [galeriePhotos, setGaleriePhotos] = useState([])
  const [galerieIndex, setGalerieIndex] = useState(0)
  const [showGalerie, setShowGalerie] = useState(false)
  const galerieRef = useRef(null)
  const [zoomActif, setZoomActif] = useState(false)
  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    if (viewableItems[0]) setGalerieIndex(viewableItems[0].index)
  }, [])

  // Garde de rôle : seuls manager et directeur ont accès
  useEffect(() => {
    if (roleActif && roleActif !== 'manager' && roleActif !== 'directeur') {
      router.replace('/accueil')
    }
  }, [roleActif])

  useEffect(() => { chargerRestaurants() }, [])

  async function chargerRestaurants() {
    setLoading(true)
    const restos = await chargerRestaurantsContact()
    if (!restos.length) { setLoading(false); return }
    setRestaurants(restos)

    const restoInitial = paramRestoId
      ? (restos.find(r => r.id === paramRestoId) || restos[0])
      : restos[0]

    if (restoInitial) {
      setRestoSelectionne(restoInitial)
      // Lien direct vers un point (notification) : on ouvre son mois.
      let m = mois
      let cible = null
      if (paramPointId) {
        const { data } = await supabase.from('points').select('*').eq('id', paramPointId).maybeSingle()
        if (data) { cible = data; m = data.date.slice(0, 7); setMois(m) }
      }
      await chargerPointsResto(restoInitial.id, m)
      if (cible) ouvrirPoint(cible)
    }
    setLoading(false)
  }

  // Points du mois choisi + points validés jamais vérifiés des mois d'avant.
  async function chargerPointsResto(restoId, m = mois) {
    if (!restoId) return []
    setLoading(true)
    const { debut, finExclue } = bornesDuMois(m)
    const [duMois, enRetard] = await Promise.all([
      supabase.from('points').select('*').eq('restaurant_id', restoId)
        .gte('date', debut).lt('date', finExclue).order('date', { ascending: false }),
      supabase.from('points').select('*').eq('restaurant_id', restoId)
        .lt('date', debut).eq('valide', true).eq('verifie', false).order('date'),
    ])
    const data = [...(enRetard.data || []), ...(duMois.data || [])]
    setPoints(data)
    setLoading(false)
    return data
  }

  async function changerMois(decalage) {
    const m = moisVoisin(mois, decalage)
    setMois(m)
    if (restoSelectionne) await chargerPointsResto(restoSelectionne.id, m)
  }

  async function onRefresh() {
    setRefreshing(true)
    if (restoSelectionne) await chargerPointsResto(restoSelectionne.id)
    setRefreshing(false)
  }

  async function changerResto(resto) {
    setRestoSelectionne(resto)
    setPoints([])
    await chargerPointsResto(resto.id)
  }

  async function ouvrirPoint(point) {
    setPointSelectionne(point)
    setOngletFiche('ventes')
    setLoadingDetail(true)
    setModalPoint(true)
    setDetailPoint(null)
    setDetailInventaire(null)
    setRepartition({})
    chargerInventaire(point)

    const [
      { data: sequences },
      { data: depenses },
      { data: fournisseurs },
      { data: shifts },
      { data: presences },
      { data: commandes },
      { data: inventaireRaw },
      { data: inventairesPosRaw },
      { data: historiquesFournisseurs },
      { data: deverouillages },
    ] = await Promise.all([
      supabase.from('sequences').select('*').eq('point_id', point.id).order('numero'),
      supabase.from('depenses').select('*').eq('point_id', point.id),
      supabase.from('transactions_fournisseurs').select('*, fournisseurs(nom)').eq('point_id', point.id),
      supabase.from('points_shifts').select('*').eq('point_id', point.id).order('created_at'),
      supabase.from('presences').select('*').eq('point_id', point.id),
      supabase.from('commandes').select('partenaire, contact_client, caissier_id').eq('point_id', point.id),
      supabase.from('inventaires').select('*, fournisseurs(nom)').eq('point_id', point.id).order('shift_numero'),
      supabase.from('inventaires_shifts')
        .select('id, caissier_id, type_shift, pos_service_id')
        .eq('point_id', point.id)
        .order('created_at'),
      supabase.from('historique_credit_fournisseurs')
        .select('id, fournisseur_id, source, ancien_credit, nouveau_credit, facture, paye, photo_url, motif, modified_at, fournisseurs(nom)')
        .eq('point_id', point.id)
        .order('modified_at', { ascending: true }),
      supabase.from('deverouillages_points')
        .select('id, section, statut, motif, deverouille_at, corrige_at')
        .eq('point_id', point.id)
        .order('deverouille_at', { ascending: true }),
    ])

    // Les réceptions du POS vivent dans `entrees_shift`, séparément des lignes
    // d'inventaire. On ne les charge que pour les inventaires réellement issus
    // du POS ; le reste de l'écran conserve l'ancien format comme historique.
    const inventairesPOS = (inventairesPosRaw || []).filter(inv => inv.pos_service_id)
    let entreesPosRaw = []
    if (inventairesPOS.length > 0) {
      const { data } = await supabase
        .from('entrees_shift')
        .select('inventaire_id, produit_nom, quantite, fournisseur_nom')
        .in('inventaire_id', inventairesPOS.map(inv => inv.id))
        .order('fournisseur_nom')
      entreesPosRaw = data || []
    }

    // Contacts uniques par partenaire
    const contactsParPartenaire = {}
    ;(commandes || []).forEach(c => {
      if (c.contact_client && c.partenaire) {
        contactsParPartenaire[c.partenaire] = (contactsParPartenaire[c.partenaire] || 0) + 1
      }
    })
    // Total des contacts pris — base du litige « contacts ». La source dépend du
    // restaurant : compteurs du POS sur un site basculé (les caissières n'ont
    // plus Samtrackly), `commandes.contact_client` sinon. Jamais les deux
    // additionnées, et exactement le même calcul que Litiges/Charges — sinon
    // les écrans afficheraient trois montants pour la même journée.
    const contactsSamtrackly = (commandes || [])
      .filter(c => c.contact_client && c.contact_client.trim() !== '').length
    const infoContacts = choisirNombreContacts({
      sourcePoint: contactsViennentDuPOS(restoSelectionne) ? 'POS' : 'SAMTRACKLY',
      shifts: shifts || [],
      contactsSamtrackly,
    })
    const nbContactsTotal = infoContacts.nombre
    // Détail « qui a pris combien » — même source unique que le litige, jamais
    // les deux additionnées. Les noms viennent des shifts du jour ; les
    // caissiers qui n'ont pas de shift (commandes saisies hors shift) sont
    // résolus par une requête de plus, pas par un « Caissier » anonyme.
    const nomsCaissiers = {}
    ;(shifts || []).forEach(sh => {
      if (sh.caissier_id && sh.caissier_nom) nomsCaissiers[sh.caissier_id] = sh.caissier_nom
    })
    const idsSansNom = [...new Set(
      (commandes || []).map(c => c.caissier_id).filter(id => id && !nomsCaissiers[id])
    )]
    if (idsSansNom.length) {
      const { data: us } = await supabase.from('utilisateurs').select('id, nom').in('id', idsSansNom)
      ;(us || []).forEach(u => { nomsCaissiers[u.id] = u.nom })
    }
    // Sites sans POS : les commandes jamais saisies ne laissent aucune trace.
    // Le seul indice qui reste est l'argent livraison encaissé sur le shift,
    // rapporté au panier moyen du restaurant (50 dernières journées déjà
    // chargées). C'est une alerte à vérifier, jamais une preuve — voir
    // l'en-tête de lib/contactsParCaissier.js.
    const { panier: panierLivraison } = panierMoyenLivraison(points)
    const contactsCaissiers = detailContactsParCaissier({
      sourcePoint: contactsViennentDuPOS(restoSelectionne) ? 'POS' : 'SAMTRACKLY',
      commandes: commandes || [],
      shifts: shifts || [],
      noms: nomsCaissiers,
      panier: panierLivraison,
    })

    // Commandes comptées par le POS : information de contrôle croisé. Le nombre
    // qui fait foi pour le litige reste celui saisi par le gérant (décision du
    // 2026-08-17, cf. CHAMPS_REMPLIS_PAR_LE_POS dans lib/sourcePoint.js).
    const commandesPOS = compterCommandesPOS(shifts || [])

    // Inventaire groupé par shift
    const invParShift = {}
    ;(inventaireRaw || []).forEach(ligne => {
      const key = ligne.shift_numero
      if (!invParShift[key]) {
        invParShift[key] = { numero: key, nom: ligne.shift_nom, lignes: [] }
      }
      invParShift[key].lignes.push(ligne)
    })

    // Entrées inventaire liées aux fournisseurs (shift 0)
    const invParFournisseur = {}
    ;(inventaireRaw || []).filter(l => l.shift_numero === 0 && l.fournisseur_id).forEach(ligne => {
      if (!invParFournisseur[ligne.fournisseur_id]) invParFournisseur[ligne.fournisseur_id] = []
      invParFournisseur[ligne.fournisseur_id].push(ligne)
    })

    const historiqueEntreesDisponible = (inventaireRaw || []).some(l => (Number(l.entrees) || 0) > 0)
      || (fournisseurs || []).some(f => (Number(f.facture) || 0) > 0)
    const entreesVerification = preparerEntreesVerification({
      inventaires: inventairesPOS,
      entrees: entreesPosRaw,
      shifts: shifts || [],
      historiqueDisponible: historiqueEntreesDisponible,
    })

    setDetailPoint({
      point,
      sequences: sequences || [],
      depenses: depenses || [],
      fournisseurs: fournisseurs || [],
      shifts: shifts || [],
      presences: presences || [],
      invParFournisseur,
      entreesVerification,
      contactsParPartenaire,
      nbContactsTotal,
      infoContacts,
      contactsCaissiers,
      panierLivraison,
      commandesPOS,
      invShifts: Object.values(invParShift).sort((a, b) => a.numero - b.numero),
      historiquesFournisseurs: historiquesFournisseurs || [],
      deverouillages: deverouillages || [],
    })
    setLoadingDetail(false)
  }

  async function telechargerPdf() {
    if (!detailPoint || !pointSelectionne) return
    setGeneratingPdf(true)
    try {
      const result = await genererPdfPoint(detailPoint, pointSelectionne, restoSelectionne)
      if (result?.success) {
        Alert.alert('✅ PDF téléchargé', `Le point du ${formatDate(pointSelectionne.date)} a été téléchargé.\n\nFichier : ${result.nomFichier}`)
      }
    } catch (err) {
      Alert.alert('Erreur', 'Impossible de générer le PDF : ' + err.message)
    } finally {
      setGeneratingPdf(false)
    }
  }

  // Décisions inventaire encore ouvertes dans l'onglet Stock. Elles
  // n'empêchent pas de vérifier le point : on prévient seulement.
  function inventaireEnAttente() {
    const restes = []
    if (loadingInventaire && !detailInventaire) restes.push("l'inventaire est encore en chargement")
    const explications = (detailInventaire?.shiftsNouveauFormat || [])
      .flatMap(sh => sh.lignes)
      .filter(l => l.stock_reel != null && (l.ecart ?? 0) < -0.01 && l.explication_statut === 'en_attente')
      .length
    if (explications) restes.push(`${explications} explication${explications > 1 ? 's' : ''} d'écart en attente de décision`)
    const comptages = Object.entries(repartition)
      .filter(([lot, parts]) => rouverts[lot] || !['repartie', 'validee'].includes(parts[0]?.statut))
      .length
    if (comptages) restes.push(`${comptages} comptage${comptages > 1 ? 's' : ''} vérificateur non réparti${comptages > 1 ? 's' : ''}`)
    return restes
  }

  function confirmerVerification() {
    const restes = inventaireEnAttente()
    const avertissement = restes.length
      ? `\n\n⚠️ Stock : ${restes.join(' · ')}. Vous pouvez valider quand même.`
      : ''
    Alert.alert(
      'Confirmer la vérification',
      `Vous confirmez avoir vérifié toutes les données, photos et le stock du point du ${formatDate(pointSelectionne?.date)} ?\n\nCette action signifie que tout est conforme.${avertissement}`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', onPress: () => marquerVerifie(pointSelectionne?.id) },
      ]
    )
  }

  async function marquerVerifie(pointId) {
    setValidating(true)
    const { error } = await supabase.from('points').update({
      verifie: true, verifie_par: userNom || roleActif || 'Manager', verifie_at: new Date().toISOString(),
    }).eq('id', pointId)
    if (error) { Alert.alert('Erreur', error.message); setValidating(false); return }
    setValidating(false)
    setModalPoint(false)
    setPoints(prev => prev.map(p => p.id === pointId ? { ...p, verifie: true } : p))
    Alert.alert('✅ Point vérifié !', 'Le point a été marqué comme vérifié avec succès.')
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  // « Jeudi 2 octobre »
  function formatJour(dateStr) {
    if (!dateStr) return ''
    const t = new Date(`${dateStr}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    return t.charAt(0).toUpperCase() + t.slice(1)
  }

  // « 412 500 F »
  function fmtCourt(n) {
    return `${Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g, ' ')} F`
  }

  // Petite étiquette colorée : rouge = écart / retard, orange = à surveiller, vert = bon.
  function puce(ton, texte) {
    const t = {
      rouge: [colors.errorLight, colors.errorDark], orange: [colors.warningLight, colors.warningDark],
      vert: [colors.successLight, colors.successDark], gris: [colors.surfaceAlt, colors.textSecondary],
    }[ton]
    return (
      <View key={texte} style={[styles.puce, { backgroundColor: t[0] }]}>
        <Text style={[styles.puceTxt, { color: t[1] }]}>{texte}</Text>
      </View>
    )
  }

  function formatDate(dateStr) {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
    return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
  }

  function photosManquantesPoint(point) {
    const m = []
    if ((point.yango_cse || 0) > 0 && !point.photo_yango_cse) m.push('Yango CSE')
    if ((point.glovo_cse || 0) > 0 && !point.photo_glovo_cse) m.push('Glovo CSE')
    if ((point.wave || 0) > 0 && !point.photo_wave) m.push('Wave')
    if ((point.om || 0) > 0 && !point.photo_om) m.push('Orange Money')
    if ((point.djamo || 0) > 0 && !point.photo_djamo) m.push('Djamo')
    if ((point.yango_tab || 0) > 0 && !point.photo_yango_tab) m.push('Yango TAB')
    if ((point.glovo_tab || 0) > 0 && !point.photo_glovo_tab) m.push('Glovo TAB')
    if ((point.kdo || 0) > 0 && !point.photo_kdo) m.push('KDO')
    if ((point.retour || 0) > 0 && !point.photo_retour) m.push('Retour')
    return m
  }

  const TYPES_SHIFTS_MAP = {
    matin: '🌅 Shift Matin', soir: '🌆 Shift Soir', nuit: '🌙 Shift Nuit', double: '🔄 Shift Double',
  }

  // Charge l'inventaire du point pour l'onglet Stock (appelé à l'ouverture
  // de la fiche, puis après chaque décision pour recharger le détail à jour).
  async function chargerInventaire(point) {
    if (!point) return
    inventaireDemande.current = point.id
    setLoadingInventaire(true)

    const [
      { data: invShiftsRaw },
      { data: pointsShiftsRaw },
      { data: ancienFormatRaw },
    ] = await Promise.all([
      supabase
        .from('inventaires_shifts')
        .select(`
          id, caissier_id, type_shift, heure_debut, heure_fin, montant_a_deduire, valide, created_at,
          inventaire_lignes(
            id, produit_id, produit_nom, stock_initial, entrees, sorties,
            stock_reel, ecart, nombre_explique, explication, montant_deduit,
            deduction_annulee, montant_deduit_annule,
            explication_statut, quantite_acceptee, explication_decidee_par, explication_decidee_at
          )
        `)
        .eq('point_id', point.id)
        .order('created_at'),
      supabase
        .from('points_shifts')
        .select('caissier_id, caissier_nom, heure_debut, heure_fin, type_shift')
        .eq('point_id', point.id),
      supabase
        .from('inventaires')
        .select('*')
        .eq('point_id', point.id)
        .order('shift_numero'),
    ])

    // Entrées de produits reçues pendant les shifts, avec leur fournisseur.
    // Table à part (entrees_shift) : elle ne remonte pas avec inventaire_lignes.
    const invIds = (invShiftsRaw || []).map(s => s.id)
    let entreesRaw = []
    if (invIds.length > 0) {
      const { data } = await supabase
        .from('entrees_shift')
        .select('inventaire_id, produit_nom, quantite, fournisseur_nom, source')
        .in('inventaire_id', invIds)
        .order('fournisseur_nom')
      entreesRaw = data || []
    }

    const caissierNomMap = {}
    ;(pointsShiftsRaw || []).forEach(ps => {
      if (ps.caissier_id && ps.caissier_nom) caissierNomMap[ps.caissier_id] = ps.caissier_nom
    })

    // Repli sur la table des utilisateurs : un caissier peut avoir saisi un
    // inventaire sans avoir de points_shifts ce jour-là, son nom manquerait.
    const idsSansNom = [...new Set(
      (invShiftsRaw || []).map(s => s.caissier_id).filter(id => id && !caissierNomMap[id]),
    )]
    if (idsSansNom.length > 0) {
      const { data: users } = await supabase
        .from('utilisateurs').select('id, nom').in('id', idsSansNom)
      ;(users || []).forEach(u => { caissierNomMap[u.id] = u.nom })
    }

    const shiftsNouveauFormat = (invShiftsRaw || []).map(invShift => ({
      ...invShift,
      caissierNom: caissierNomMap[invShift.caissier_id] || null,
      shiftLabel: TYPES_SHIFTS_MAP[invShift.type_shift] || invShift.type_shift || 'Shift',
      lignes: invShift.inventaire_lignes || [],
    }))

    const ancienMap = {}
    ;(ancienFormatRaw || []).forEach(ligne => {
      const key = ligne.shift_numero
      if (!ancienMap[key]) {
        ancienMap[key] = { numero: key, nom: ligne.shift_nom, heure_debut: ligne.heure_debut, heure_fin: ligne.heure_fin, lignes: [] }
      }
      ancienMap[key].lignes.push(ligne)
    })

    // Regroupement par fournisseur : c'est l'angle utile pour vérifier qui a
    // livré quoi. Un même produit peut venir de plusieurs fournisseurs dans
    // la journée, et un fournisseur livrer plusieurs produits.
    // Qui a saisi l'entrée : entrees_shift ne porte pas d'auteur, on le déduit
    // du shift d'inventaire auquel la ligne est rattachée.
    const auteurParInventaire = {}
    ;(invShiftsRaw || []).forEach(inv => {
      auteurParInventaire[inv.id] = {
        nom: caissierNomMap[inv.caissier_id] || 'Caissier',
        shift: TYPES_SHIFTS_MAP[inv.type_shift] || inv.type_shift || '',
      }
    })

    const parFournisseur = {}
    entreesRaw.forEach(e => {
      const nom = (e.fournisseur_nom || '').trim() || 'Sans fournisseur'
      if (!parFournisseur[nom]) parFournisseur[nom] = { fournisseur: nom, produits: {}, nbLignes: 0 }
      const auteur = auteurParInventaire[e.inventaire_id] || { nom: 'Caissier', shift: '' }
      // Clé produit + auteur : deux réceptions du même produit par des
      // personnes différentes restent deux lignes distinctes.
      const cle = `${e.produit_nom || 'Produit inconnu'}|${auteur.nom}`
      if (!parFournisseur[nom].produits[cle]) {
        parFournisseur[nom].produits[cle] = {
          nom: e.produit_nom || 'Produit inconnu',
          quantite: 0,
          auteur: auteur.nom,
          shift: auteur.shift,
        }
      }
      parFournisseur[nom].produits[cle].quantite += parseFloat(e.quantite) || 0
      parFournisseur[nom].nbLignes += 1
    })
    const entreesParFournisseur = Object.values(parFournisseur)
      .map(f => ({
        ...f,
        produits: Object.values(f.produits).sort((a, b) => b.quantite - a.quantite),
      }))
      .sort((a, b) => b.nbLignes - a.nbLignes)

    const { lignes: dv, migration: dvMig } = await chargerDeductions(point.restaurant_id, point.date)
    // Une autre fiche a été ouverte entre-temps : on n'écrase pas son inventaire.
    if (inventaireDemande.current !== point.id) return
    setDeducVerif(dv)
    setDeducMigration(dvMig)
    // Répartition initiale = la proposition enregistrée par le vérificateur.
    const parLot = {}
    ;(dv || []).forEach(d => { (parLot[d.lot_id || d.date] = parLot[d.lot_id || d.date] || []).push({ ...d }) })
    setRepartition(parLot)
    const justifs = {}
    Object.entries(parLot).forEach(([lot, ps]) => { justifs[lot] = Number(ps[0]?.montant_justifie) || 0 })
    setJustifie(justifs)
    setRouverts({})
    // Toutes les personnes imputables : les caissiers du jour + le gérant.
    setCaissiersDuJour((pointsShiftsRaw || [])
      .filter(ps => ps.caissier_id && ps.caissier_nom)
      .map(ps => ({
        caissier_id: ps.caissier_id,
        caissier_nom: ps.caissier_nom,
        shift_libelle: `${ps.heure_debut || '?'}–${ps.heure_fin || '?'}`,
      }))
      .filter((v, i, arr) => arr.findIndex(x => x.caissier_id === v.caissier_id) === i))

    setDetailInventaire({
      shiftsNouveauFormat,
      shiftsAncienFormat: Object.values(ancienMap).sort((a, b) => a.numero - b.numero),
      useNouveauFormat: shiftsNouveauFormat.length > 0,
      entreesParFournisseur,
      nbEntrees: entreesRaw.length,
    })
    setLoadingInventaire(false)
  }

  // ── Répartition d'un comptage ──────────────────────────────────────────
  // L'app propose, l'administration dispose : chaque montant est modifiable,
  // on peut ajouter ou retirer une personne, ou tout mettre à la charge du
  // gérant quand aucun caissier n'est précisément en cause.

  function majMontant(lot, index, valeur) {
    const montant = Math.max(0, parseInt(String(valeur).replace(/\D/g, ''), 10) || 0)
    setRepartition(prev => ({
      ...prev,
      [lot]: prev[lot].map((p, i) => (i === index ? { ...p, montant } : p)),
    }))
  }

  function retirerPart(lot, index) {
    setRepartition(prev => ({ ...prev, [lot]: prev[lot].filter((_, i) => i !== index) }))
  }

  function ajouterPart(lot, personne) {
    setRepartition(prev => {
      const actuel = prev[lot] || []
      if (personne.beneficiaire_type !== 'gerant'
        && actuel.some(p => p.caissier_id === personne.caissier_id)) return prev
      const modele = actuel[0] || {}
      return {
        ...prev,
        [lot]: [...actuel, {
          lot_id: modele.lot_id, restaurant_id: modele.restaurant_id, date: modele.date,
          nb_produits: modele.nb_produits, produits_resume: modele.produits_resume,
          montant_ecart: modele.montant_ecart, montant_plafond: modele.montant_plafond,
          explication: modele.explication,
          verificateur_nom: modele.verificateur_nom,
          role_dans_ecart: personne.beneficiaire_type === 'gerant' ? 'gerant' : 'ajoute',
          montant: 0, montant_propose: 0,
          ...personne,
        }],
      }
    })
  }

  /** Écrit la répartition définitive : on remplace les lignes du comptage. */
  async function enregistrerRepartition(lot) {
    const parts = repartition[lot] || []
    const plafond = parts[0]?.montant_plafond ?? 0
    const justif = Math.max(0, Math.min(plafond, Number(justifie[lot]) || 0))
    const aRepartir = plafond - justif
    // Tout justifié → plus rien à imputer à personne.
    const statut = aRepartir <= 0 ? 'validee' : 'repartie'

    if (aRepartir > 0) {
      const ctrl = repartitionValide(parts, aRepartir)
      if (!ctrl.ok) {
        Alert.alert(
          'Répartition incomplète',
          `La somme des montants (${fmt(ctrl.somme)}) doit être égale à ${fmt(aRepartir)}.\n\n` +
          (ctrl.reste > 0 ? `Il reste ${fmt(ctrl.reste)} à attribuer.` : `Vous avez dépassé de ${fmt(-ctrl.reste)}.`),
        )
        return
      }
    }
    setDeducEnCours(lot)
    const anciens = deducVerif.filter(d => (d.lot_id || d.date) === lot).map(d => d.id)
    if (anciens.length) {
      await supabase.from('deductions_verification').delete().in('id', anciens)
    }
    // En justification totale on garde TOUTES les personnes avec un montant à
    // zéro, et non une seule ligne : sans ça, rouvrir la décision ferait
    // perdre la répartition et il faudrait tout ressaisir.
    const rows = parts
      .map(p => (aRepartir <= 0 ? { ...p, montant: 0 } : p))
      .filter(p => aRepartir <= 0 || p.montant > 0)
      .map(({ id, created_at, ...p }) => ({
        ...p,
        montant_justifie: justif,
        statut,
        decide_par_id: userId || null,
        decide_par_nom: userNom || null,
        decide_at: new Date().toISOString(),
      }))
    const { error } = rows.length
      ? await supabase.from('deductions_verification').insert(rows)
      : { error: null }
    setDeducEnCours(null)
    if (error) { Alert.alert('Erreur', error.message); return }
    await chargerInventaire(pointSelectionne)
  }

  // Annule DÉFINITIVEMENT la déduction d'inventaire d'un produit (manager/directeur).
  function confirmerAnnulationDeduction(ligne) {
    if (!ligne?.id || annulDeducSaving) return
    const faire = async () => {
      setAnnulDeducSaving(ligne.id)
      try {
        await annulerDeductionInventaire({
          ligneId: ligne.id,
          inventaireId: ligne.inventaireId,
          pointId: pointSelectionne?.id,
          par: userNom || roleActif || 'Manager',
        })
        await chargerInventaire(pointSelectionne)  // recharge le détail à jour
      } catch (e) {
        Alert.alert('Erreur', e?.message || "Impossible d'annuler la déduction")
      } finally {
        setAnnulDeducSaving(null)
      }
    }
    Alert.alert(
      'Annuler la déduction ?',
      `La déduction de ${fmt(ligne.montantDeduit)} sur « ${ligne.produit_nom} » sera annulée définitivement et retirée du total à déduire.`,
      [
        { text: 'Retour', style: 'cancel' },
        { text: 'Annuler la déduction', style: 'destructive', onPress: faire },
      ]
    )
  }

  // ── Décision manager sur un écart inventaire expliqué ────────────────
  function ouvrirDecisionInv(e) {
    setDecisionInv(e)
    const defaut = e.quantite_acceptee != null ? e.quantite_acceptee : (e.nombreExplique || 0)
    setQteAcceptee(defaut ? String(defaut) : '')
  }

  async function enregistrerDecisionInv(statut) {
    const e = decisionInv
    if (!e || decisionSaving) return
    const ecartAbs = Math.abs(e.ecart || 0)
    const prix = e.prix || 0
    const qAcc = statut === 'validee'
      ? Math.max(0, Math.min(ecartAbs, parseFloat(qteAcceptee) || 0))
      : 0
    const nouveauMontant = Math.round(Math.max(0, ecartAbs - qAcc) * prix)
    setDecisionSaving(true)
    try {
      await deciderEcartInventaire({
        ligneId: e.id,
        inventaireId: e.inventaireId,
        pointId: pointSelectionne?.id,
        statut,
        quantiteAcceptee: qAcc,
        nouveauMontant,
        prix,
        par: userNom || roleActif || 'Manager',
      })
      creerNotification({
        type: `ecart_inventaire_${statut}`,
        titre: statut === 'validee' ? '✅ Écart inventaire validé' : '❌ Écart inventaire refusé',
        message: statut === 'validee'
          ? `${e.produit_nom} : explication acceptée (${qAcc} justifié) — déduction ${fmt(nouveauMontant)}.`
          : `${e.produit_nom} : explication refusée — déduction pleine de ${fmt(nouveauMontant)}.`,
        restaurant_id: pointSelectionne?.restaurant_id,
        cible_role: ['gerant'],
        created_by: userId || null,
        screen: null,
      }).catch(() => {})
      setDecisionInv(null)
      await chargerInventaire(pointSelectionne)
    } catch (err) {
      Alert.alert('Erreur', err?.message || 'Décision impossible')
    } finally {
      setDecisionSaving(false)
    }
  }

  function voirPhoto(uri, label) {
    if (!uri) return
    // Ouvrir le plein écran sur une URI locale ou un jeton en attente ne
    // donnerait qu'un écran noir : on explique au lieu d'afficher du vide.
    if (!photoConsultable(uri)) {
      Alert.alert(
        estPhotoEnAttente(uri) ? 'Photo en attente' : 'Photo indisponible',
        estPhotoEnAttente(uri)
          ? "Cette photo est encore sur l'appareil qui l'a prise. Elle apparaîtra ici dès que cet appareil retrouvera le réseau."
          : "Cette photo n'a jamais été envoyée sur le serveur : elle est restée sur le téléphone qui l'a prise et n'est plus récupérable. Demandez une nouvelle photo du justificatif."
      )
      return
    }
    setPhotoSelectionnee({ uri, label })
    setModalPhoto(true)
  }

  // ── Correction du nombre de commandes Yango / Glovo ──────────────────
  function ouvrirCorrectionCommandes() {
    const p = pointSelectionne
    setCorrCmdYango(String(p?.yango_nb_commandes || 0))
    setCorrCmdGlovo(String(p?.glovo_nb_commandes || 0))
    setCorrCmdMotif(p?.nb_commandes_correction_motif || '')
    setCorrCmdError('')
    setCorrCmdOuvert(true)
  }

  async function sauvegarderCorrectionCommandes() {
    const p = pointSelectionne
    if (!p) return
    setCorrCmdSaving(true)
    setCorrCmdError('')
    const res = await corrigerNbCommandes({
      point: p,
      yango: corrCmdYango,
      glovo: corrCmdGlovo,
      motif: corrCmdMotif,
      userId, userNom: userNom || roleActif,
    })
    setCorrCmdSaving(false)
    if (!res.ok) { setCorrCmdError(res.error); return }

    // MAJ locale (détail + liste) sans recharger tout le point
    setPointSelectionne(res.point)
    setPoints(prev => prev.map(x => x.id === res.point.id ? { ...x, ...res.point } : x))
    setDetailPoint(prev => prev && ({ ...prev, point: res.point }))
    setCorrCmdOuvert(false)
    Alert.alert(
      '✅ Nombre de commandes corrigé',
      'Le litige « contacts » est recalculé automatiquement dans Litiges et Charges.\nLe gérant a été notifié.'
    )
  }

  // ── Correction de facture fournisseur ────────────────────────────────
  function ouvrirCorrectionFacture(t) {
    setCorrFacture(t)
    setCorrMontant('')
    setCorrRaison('')
    setCorrError('')
  }
  function fermerCorrectionFacture() {
    setCorrFacture(null)
    setCorrMontant('')
    setCorrRaison('')
    setCorrError('')
  }
  async function sauvegarderCorrectionFacture() {
    const t = corrFacture
    if (!t) return
    const nouveau = Math.round(parseFloat(corrMontant) || 0)
    const ancien = Math.round(parseFloat(t.facture) || 0)
    if (nouveau < 0) { setCorrError('Le montant ne peut pas être négatif.'); return }
    if (nouveau === ancien) { setCorrError('Le nouveau montant est identique à l’ancien.'); return }
    if (!corrRaison.trim()) { setCorrError('La raison est obligatoire.'); return }
    setCorrSaving(true)
    setCorrError('')
    try {
      // On garde le TOUT PREMIER montant d'origine (ré-correction possible).
      const original = (t.facture_original == null) ? ancien : t.facture_original
      const ancienReste = parseFloat(t.reste) || 0
      // Seule la facture change → reste = ancienReste + (nouvelle − ancienne). Pas d'impact sur le fond.
      const nouveauReste = ancienReste + (nouveau - ancien)
      const nowIso = new Date().toISOString()

      const { error } = await supabase.from('transactions_fournisseurs').update({
        facture: nouveau,
        reste: nouveauReste,
        facture_original: original,
        facture_corrigee_par: userId || null,
        facture_corrigee_par_nom: userNom || roleActif || null,
        facture_corrigee_at: nowIso,
        facture_correction_raison: corrRaison.trim(),
      }).eq('id', t.id)
      if (error) { setCorrError(error.message); setCorrSaving(false); return }

      // Solde fournisseur — recalcul simple : si c'est la transaction la plus
      // récente du fournisseur, on met à jour son crédit actuel.
      try {
        const { data: derniere } = await supabase
          .from('transactions_fournisseurs')
          .select('id')
          .eq('fournisseur_id', t.fournisseur_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (derniere && derniere.id === t.id) {
          await supabase.from('fournisseurs').update({ credit_actuel: nouveauReste }).eq('id', t.fournisseur_id)
        }
      } catch (_) { /* created_at absent : on ignore, la transaction reste corrigée */ }

      const nomFourn = t.fournisseurs?.nom || 'Fournisseur'
      const dateTxt = pointSelectionne?.date ? formatDate(pointSelectionne.date) : ''
      // Notif in-app (cloche) — screen null : purement informatif, le gérant
      // n'a pas accès à l'écran Vérification (pas de navigation morte).
      creerNotification({
        type: 'facture_corrigee',
        titre: '✏️ Facture corrigée',
        message: `${nomFourn} — facture ${fmt(ancien)} → ${fmt(nouveau)}${dateTxt ? ` (${dateTxt})` : ''}. Raison : ${corrRaison.trim()}`,
        restaurant_id: pointSelectionne.restaurant_id,
        cible_role: ['gerant'],
        created_by: userId || null,
        screen: null,
      }).catch(() => {})
      // Push Expo hors-app vers le(s) gérant(s) du resto (app native).
      envoyerNotifFactureCorrigee(nomFourn, ancien, nouveau, pointSelectionne.restaurant_id).catch(() => {})

      journaliser('correction_facture_fournisseur', {
        point_id: pointSelectionne.id,
        fournisseur_id: t.fournisseur_id,
        fournisseur: nomFourn,
        ancienne_facture: ancien,
        nouvelle_facture: nouveau,
        raison: corrRaison.trim(),
      }, { par: userNom || roleActif }).catch(() => {})

      // MAJ locale immédiate (badge + montant) sans recharger tout le point.
      setDetailPoint(prev => prev && ({
        ...prev,
        fournisseurs: prev.fournisseurs.map(f => f.id === t.id ? {
          ...f,
          facture: nouveau,
          reste: nouveauReste,
          facture_original: original,
          facture_corrigee_par_nom: userNom || roleActif || null,
          facture_corrigee_at: nowIso,
          facture_correction_raison: corrRaison.trim(),
        } : f),
      }))

      fermerCorrectionFacture()
      Alert.alert('✅ Facture corrigée', `Nouveau montant : ${fmt(nouveau)}.\nLe gérant a été notifié.`)
    } catch (e) {
      setCorrError(e?.message || 'Erreur inattendue')
    } finally {
      setCorrSaving(false)
    }
  }

  function toggleSection(section) {
    setSectionsSelectionnees(prev =>
      prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
    )
  }

  async function demanderCorrection() {
    if (sectionsSelectionnees.length === 0) {
      Alert.alert('Sections manquantes', 'Sélectionnez au moins une section à corriger.')
      return
    }
    if (motifCorrection.trim().length < 10) {
      Alert.alert('Motif trop court', 'Le motif doit contenir au moins 10 caractères.')
      return
    }
    setErrorCorrection('')
    setSavingCorrection(true)
    try {
      const rows = sectionsSelectionnees.map(section => ({
        point_id: pointSelectionne.id,
        restaurant_id: pointSelectionne.restaurant_id,
        section,
        statut: 'ouvert',
        motif: motifCorrection.trim(),
        deverouille_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('deverouillages_points').insert(rows)
      if (error) {
        setErrorCorrection(error.message)
        return
      }
      journaliser('demande_correction_point', {
        point_id: pointSelectionne.id,
        sections: sectionsSelectionnees,
        motif: motifCorrection.trim(),
      }, { par: userNom || roleActif }).catch(() => {})

      creerNotification({
        type: 'correction_demandee',
        titre: '⚠️ Correction demandée',
        message: `Correction requise sur le point du ${formatDate(pointSelectionne.date)} — ${sectionsSelectionnees.join(', ')}. Motif : ${motifCorrection.trim()}`,
        restaurant_id: pointSelectionne.restaurant_id,
        cible_role: ['gerant'],
        created_by: userId || null,
        screen: 'recap-point',
      }).catch(() => {})

      setModalCorrection(false)
      setSectionsSelectionnees([])
      setMotifCorrection('')
      setErrorCorrection('')
    } catch (err) {
      setErrorCorrection(err?.message || 'Erreur inattendue')
    } finally {
      setSavingCorrection(false)
    }
  }

  function confirmerStatutMachine(statut) {
    const cfg = STATUT_MACHINE[statut]
    if (!cfg || statuantMachine) return
    Alert.alert(cfg.titreNotif, cfg.confirm, [
      { text: 'Retour', style: 'cancel' },
      { text: 'Confirmer', onPress: () => statuerExplicationMachine(statut) },
    ])
  }

  async function statuerExplicationMachine(statut) {
    if (!pointSelectionne) return
    const cfg = STATUT_MACHINE[statut]
    if (!cfg) return
    setStatuantMachine(true)
    const maj = {
      explication_machine_statut: statut,
      explication_machine_statut_par: userNom || roleActif || 'Manager',
      explication_machine_statut_at: new Date().toISOString(),
    }
    try {
      const { error } = await supabase.from('points').update(maj).eq('id', pointSelectionne.id)
      if (error) {
        // Colonnes pas encore créées en base (migration SQL non exécutée) :
        // on notifie quand même le gérant, mais le statut n'est pas mémorisé.
        console.warn('Statut explication machine non persisté :', error.message)
      } else {
        setPointSelectionne(prev => prev ? { ...prev, ...maj } : prev)
        setPoints(prev => prev.map(p => p.id === pointSelectionne.id ? { ...p, ...maj } : p))
      }

      creerNotification({
        type: `explication_machine_${statut}`,
        titre: cfg.titreNotif,
        message: cfg.msgNotif(formatDate(pointSelectionne.date)),
        restaurant_id: pointSelectionne.restaurant_id,
        cible_role: ['gerant'],
        created_by: userId || null,
        screen: 'recap-point',
      }).catch(() => {})

      journaliser('statut_explication_machine', {
        point_id: pointSelectionne.id,
        statut,
      }, { par: userNom || roleActif }).catch(() => {})

      Alert.alert(
        cfg.titreNotif,
        error
          ? 'Décision envoyée au gérant.\n(Statut non mémorisé — la migration SQL doit être exécutée.)'
          : 'Décision enregistrée. Le gérant a été notifié.'
      )
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Action impossible')
    } finally {
      setStatuantMachine(false)
    }
  }

  // Ouvre le modal : calcule sens + écart restant (déduction faite des
  // régularisations déjà posées dans Litiges, pour ne pas doubler).
  //
  // Deux modes partagent ce calcul, et c'est volontaire :
  //   • 'fond'      → « 🚫 Annuler » : solde l'écart ET corrige ajustement_fond ;
  //   • 'sans_fond' → « ✔️ Justifier » : solde l'écart, ne touche à AUCUN fond.
  // Le second sert aux écarts qui ne sont qu'une erreur de saisie (mauvaise vente
  // machine tapée, shift absent du cumul) : aucun argent n'a bougé, corriger le
  // fond fabriquerait un faux fond qui se reporte ensuite de journée en journée.
  function ouvrirAnnulerMachine(mode = 'fond') {
    const p = pointSelectionne
    if (!p) return
    const cumulShifts = (detailPoint?.shifts || []).reduce((s, sh) => s + (sh.vente_shift || 0), 0)
    const venteMachine = p.vente_machine || 0
    const ecartBrut = venteMachine - cumulShifts // convention Litiges (signe opposé à l'écart affiché)
    const sens = ecartBrut > 0 ? 'manquant' : 'surplus'
    const toutesReguls = Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : []
    const reguls = toutesReguls.filter(r => r?.source !== SOURCE_DECISION_POS)
    const totalRegul = reguls.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0)
    let ecartEff = ecartBrut
    if (ecartBrut < 0) ecartEff = Math.min(0, ecartBrut + totalRegul)
    else if (ecartBrut > 0) ecartEff = Math.max(0, ecartBrut - totalRegul)
    const restant = Math.round(Math.abs(ecartEff))
    setAnnulerMontant(restant ? String(restant) : '')
    setModalAnnulerMachine({
      mode,
      sens,
      restant,
      explication: (p.explication_ecart_machine || '').trim(),
      photos: Array.isArray(p.ecart_photos) ? p.ecart_photos : [],
      regulsExistantes: toutesReguls,
    })
  }

  function ouvrirDecisionCloturePOS(cloture, mode = 'fond') {
    const p = pointSelectionne
    if (!p) return
    const toutesReguls = Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : []
    const decision = decisionEcartShiftPOS(cloture, toutesReguls)
    if (decision.restant <= 0) return
    setAnnulerMontant(String(decision.restant))
    setModalAnnulerMachine({
      source: 'pos_shift',
      mode,
      sens: Number(cloture.ecart_pos) < 0 ? 'manquant' : 'surplus',
      restant: decision.restant,
      explication: String(cloture.explication_ecart || '').trim(),
      photos: [],
      regulsExistantes: toutesReguls,
      shiftId: cloture.id,
      posServiceId: cloture.pos_service_id || null,
      caissierNom: cloture.caissier_nom || 'Caissier non identifié',
    })
  }

  function estDecisionDuShiftPOS(record, cloture) {
    if (record?.source !== SOURCE_DECISION_POS) return false
    if (record.shift_id != null) return String(record.shift_id) === String(cloture?.id)
    return Boolean(record.pos_service_id && cloture?.pos_service_id
      && String(record.pos_service_id) === String(cloture.pos_service_id))
  }

  function confirmerRefusCloturePOS(cloture) {
    if (!pointSelectionne || statuantMachine) return
    Alert.alert('❌ Refuser l’explication', `Refuser l’explication de ${cloture.caissier_nom || 'ce caissier'} ? L’écart restera dans les litiges.`, [
      { text: 'Retour', style: 'cancel' },
      { text: 'Refuser', style: 'destructive', onPress: () => refuserExplicationCloturePOS(cloture) },
    ])
  }

  async function refuserExplicationCloturePOS(cloture) {
    const p = pointSelectionne
    if (!p) return
    setStatuantMachine(true)
    try {
      const reguls = Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : []
      const record = {
        source: SOURCE_DECISION_POS,
        point_id: p.id,
        shift_id: cloture.id,
        pos_service_id: cloture.pos_service_id || null,
        decision: 'refusee',
        sens: Number(cloture.ecart_pos) < 0 ? 'manquant' : 'surplus',
        montant: 0,
        motif: String(cloture.explication_ecart || '').trim(),
        sans_fond: true,
        par_id: userId || null,
        par_nom: userNom || null,
        created_at: new Date().toISOString(),
      }
      const nouvelles = [...reguls, record]
      const { error } = await supabase.from('points').update({ ecart_regularisations: nouvelles }).eq('id', p.id)
      if (error) { Alert.alert('Erreur', "L'enregistrement a échoué. Réessayez."); return }
      setPointSelectionne(prev => prev ? { ...prev, ecart_regularisations: nouvelles } : prev)
      setPoints(prev => prev.map(pt => pt.id === p.id ? { ...pt, ecart_regularisations: nouvelles } : pt))
      creerNotification({
        type: 'explication_pos_refusee',
        titre: '❌ Explication POS refusée',
        message: `L'explication de ${cloture.caissier_nom || 'la caissière'} pour l'écart espèces du ${formatDate(p.date)} a été refusée.`,
        restaurant_id: p.restaurant_id,
        cible_role: ['gerant'],
        created_by: userId || null,
        screen: 'recap-point',
      }).catch(() => {})
      journaliser('refus_explication_ecart_pos', { point_id: p.id, shift_id: cloture.id }, { par: userNom || roleActif }).catch(() => {})
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Action impossible')
    } finally {
      setStatuantMachine(false)
    }
  }

  // Confirme la décision : écrit une régularisation, et — en mode 'fond' seulement —
  // ajuste ajustement_fond sur le dernier point validé (réplique exacte de
  // enregistrerRegularisation() dans litiges.js).
  async function confirmerAnnulationMachine() {
    const p = pointSelectionne
    const ctx = modalAnnulerMachine
    if (!p || !ctx) return
    const sansFond = ctx.mode === 'sans_fond'
    const verbe = sansFond ? 'justifier' : 'annuler'
    const montant = Math.round(parseFloat(annulerMontant) || 0)
    if (montant <= 0) { Alert.alert('Montant invalide', 'Saisissez un montant supérieur à 0.'); return }
    if (montant > ctx.restant) {
      Alert.alert('Montant trop élevé', `Vous ne pouvez ${verbe} que ${fmt(ctx.restant)} maximum sur cet écart.`)
      return
    }
    setAnnulerSaving(true)
    try {
      // Sens identique à Litiges : manquant régularisé → fond +montant ; surplus → fond −montant.
      const deltaFc = ctx.sens === 'manquant' ? montant : -montant

      // La correction de fond atterrit sur le dernier point validé du resto (« fond actuel »),
      // jamais sur le jour de l'écart : l'argent bouge aujourd'hui, on ne réécrit pas l'historique.
      // En mode « justifier », on ne cherche même pas la journée cible : aucun fond ne bouge.
      let cible = null
      if (!sansFond) {
        ;({ data: cible } = await supabase.from('points')
          .select('id, ajustement_fond')
          .eq('restaurant_id', p.restaurant_id).eq('valide', true)
          .order('date', { ascending: false }).limit(1).single())
      }
      const cibleId = sansFond ? null : (cible?.id || p.id)

      const record = {
        sens: ctx.sens,
        montant,
        motif: ctx.explication || (sansFond
          ? 'Écart justifié sans incidence sur le fond (vérification)'
          : 'Écart annulé par le manager (vérification)'),
        photos: ctx.photos,
        par_id: userId || null,
        par_nom: userNom || null,
        created_at: new Date().toISOString(),
        fond_point_id: cibleId, // point qui a reçu la correction (pour le reverse depuis Litiges)
        // Marqueur lu par litiges.js : à la suppression, il n'y a AUCUN fond à rendre.
        // Sans lui, fond_point_id null ferait passer le record pour une régularisation
        // héritée et la suppression irait modifier reste_fc.
        sans_fond: sansFond,
        source: ctx.source === 'pos_shift' ? SOURCE_DECISION_POS : 'verification',
        ...(ctx.source === 'pos_shift' ? {
          point_id: p.id,
          shift_id: ctx.shiftId,
          pos_service_id: ctx.posServiceId,
          decision: sansFond ? 'justifiee' : 'annulee',
        } : {}),
      }
      const nouvelles = [...ctx.regulsExistantes, record]

      // Le statut « annulee » neutralise TOUT l'écart côté Litiges. On ne le
      // pose donc que si la régularisation solde l'écart entièrement. Sinon,
      // annuler 8 000 sur un manquant de 10 000 affichait 0 au lieu de 2 000.
      const soldeApres = Math.round(ctx.restant - montant)
      const statutMaj = ctx.source !== 'pos_shift' && soldeApres <= 0 ? {
        explication_machine_statut: sansFond ? 'justifiee' : 'annulee',
        explication_machine_statut_par: userNom || roleActif || 'Manager',
        explication_machine_statut_at: new Date().toISOString(),
      } : {}

      let error
      if (sansFond) {
        // Un seul UPDATE, sur le point de l'écart. Ni ajustement_fond ni reste_fc.
        ;({ error } = await supabase.from('points').update({
          ecart_regularisations: nouvelles, ...statutMaj,
        }).eq('id', p.id))
      } else if (cibleId === p.id) {
        ;({ error } = await supabase.from('points').update({
          ecart_regularisations: nouvelles,
          ajustement_fond: (cible?.ajustement_fond || 0) + deltaFc,
          ...statutMaj,
        }).eq('id', p.id))
      } else {
        ;({ error } = await supabase.from('points').update({
          ecart_regularisations: nouvelles, ...statutMaj,
        }).eq('id', p.id))
        if (!error) {
          ;({ error } = await supabase.from('points').update({
            ajustement_fond: (cible?.ajustement_fond || 0) + deltaFc,
          }).eq('id', cibleId))
        }
      }
      if (error) { Alert.alert('Erreur', "L'enregistrement a échoué. Réessayez."); return }

      setPointSelectionne(prev => prev ? { ...prev, ...statutMaj, ecart_regularisations: nouvelles } : prev)
      setPoints(prev => prev.map(pt => pt.id === p.id ? { ...pt, ...statutMaj, ecart_regularisations: nouvelles } : pt))

      creerNotification({
        type: ctx.source === 'pos_shift'
          ? (sansFond ? 'explication_pos_justifiee' : 'explication_pos_annulee')
          : (sansFond ? 'explication_machine_justifiee' : 'explication_machine_annulee'),
        titre: sansFond ? '✔️ Écart justifié' : '🚫 Écart annulé',
        message: ctx.source === 'pos_shift'
          ? `L'écart espèces de ${ctx.caissierNom} du ${formatDate(p.date)} a été ${sansFond ? 'justifié' : 'annulé'} par le manager : ${fmt(montant)} neutralisé${sansFond ? ', sans correction du fond' : ' sur le fond'}.`
          : sansFond
            ? `L'écart de vente machine du ${formatDate(p.date)} (${ctx.sens}) a été justifié par le manager : ${fmt(montant)} neutralisé, sans correction du fond.`
            : `L'écart de vente machine du ${formatDate(p.date)} (${ctx.sens}) a été annulé par le manager : ${fmt(montant)} neutralisé sur le fond.`,
        restaurant_id: p.restaurant_id,
        cible_role: ['gerant'],
        created_by: userId || null,
        screen: 'recap-point',
      }).catch(() => {})

      journaliser(sansFond ? 'justification_ecart_machine' : 'annulation_ecart_machine', {
        point_id: p.id, shift_id: ctx.shiftId || null, sens: ctx.sens, montant, fond_point_id: cibleId,
      }, { par: userNom || roleActif }).catch(() => {})

      setModalAnnulerMachine(null)
      setAnnulerMontant('')
      Alert.alert(
        sansFond ? '✔️ Écart justifié' : '🚫 Écart annulé',
        sansFond
          ? `${fmt(montant)} neutralisé. Le fond n'a pas été modifié et le gérant a été notifié.\n\nRéversible depuis l'écran Litiges.`
          : `${fmt(montant)} neutralisé sur le fond. Le gérant a été notifié.\n\nRéversible depuis l'écran Litiges.`
      )
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Action impossible')
    } finally {
      setAnnulerSaving(false)
    }
  }

  // Seuls ces rôles peuvent défaire une décision déjà prise sur l'écart machine.
  const peutAnnulerDecisionMachine = ['manager', 'directeur'].includes(roleActif)

  // Applique un delta au fond (ajustement_fond) d'une journée. Retourne false si
  // l'écriture a échoué, pour que l'appelant puisse remettre les choses en place.
  async function appliquerDeltaFond(pointId, delta) {
    if (!pointId || !delta) return true
    const { data: pf, error: e1 } = await supabase.from('points')
      .select('ajustement_fond').eq('id', pointId).single()
    if (e1) return false
    const { error: e2 } = await supabase.from('points')
      .update({ ajustement_fond: (pf?.ajustement_fond || 0) + delta })
      .eq('id', pointId)
    return !e2
  }

  function confirmerRetourDecisionPOS(cloture, decision) {
    if (!pointSelectionne || retourSaving) return
    const cfg = STATUT_MACHINE[decision.statut]
    Alert.alert('↩️ Revenir sur la décision', `${cfg?.label || 'Cette décision'} pour ${cloture.caissier_nom || 'ce caissier'} sera annulée. L’écart redeviendra à traiter.`, [
      { text: 'Retour', style: 'cancel' },
      { text: 'Confirmer', style: 'destructive', onPress: () => revenirSurDecisionPOS(cloture) },
    ])
  }

  async function revenirSurDecisionPOS(cloture) {
    const p = pointSelectionne
    if (!p) return
    setRetourSaving(true)
    const faits = []
    try {
      const reguls = Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : []
      const aDefaire = reguls.filter(r => estDecisionDuShiftPOS(r, cloture))
      const restantes = reguls.filter(r => !estDecisionDuShiftPOS(r, cloture))

      for (const r of aDefaire) {
        if (r?.sans_fond) continue
        const montant = Math.round(parseFloat(r?.montant) || 0)
        if (!montant) continue
        const delta = r.sens === 'manquant' ? -montant : montant
        const cible = r.fond_point_id || p.id
        const ok = await appliquerDeltaFond(cible, delta)
        if (!ok) {
          for (const f of faits) await appliquerDeltaFond(f.cible, -f.delta)
          Alert.alert('Erreur', "Le fond n'a pas pu être remis à jour. Rien n'a été modifié.")
          return
        }
        faits.push({ cible, delta })
      }

      const { error } = await supabase.from('points').update({ ecart_regularisations: restantes }).eq('id', p.id)
      if (error) {
        for (const f of faits) await appliquerDeltaFond(f.cible, -f.delta)
        Alert.alert('Erreur', "L'annulation a échoué. Rien n'a été modifié.")
        return
      }
      setPointSelectionne(prev => prev ? { ...prev, ecart_regularisations: restantes } : prev)
      setPoints(prev => prev.map(pt => pt.id === p.id ? { ...pt, ecart_regularisations: restantes } : pt))
      journaliser('retour_decision_ecart_pos', { point_id: p.id, shift_id: cloture.id }, { par: userNom || roleActif }).catch(() => {})
      Alert.alert('↩️ Décision annulée', `L'écart de ${cloture.caissier_nom || 'ce caissier'} est de nouveau à traiter.`)
    } catch (e) {
      for (const f of faits) await appliquerDeltaFond(f.cible, -f.delta)
      Alert.alert('Erreur', e?.message || 'Action impossible')
    } finally {
      setRetourSaving(false)
    }
  }

  function confirmerRetourDecisionMachine() {
    const p = pointSelectionne
    if (!p || retourSaving) return
    const cfg = STATUT_MACHINE[p.explication_machine_statut]
    const reguls = Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : []
    const aDefaire = reguls.filter(r => r?.source === 'verification' && !r?.shift_id)
    const totalFond = aDefaire.filter(r => !r?.sans_fond)
      .reduce((s, r) => s + (parseFloat(r?.montant) || 0), 0)
    const lignes = [
      `Décision actuelle : ${cfg?.label || p.explication_machine_statut}.`,
      aDefaire.length
        ? `L'écart de ${fmt(aDefaire.reduce((s, r) => s + (parseFloat(r?.montant) || 0), 0))} redeviendra à traiter.`
        : "L'écart redeviendra à traiter.",
      totalFond > 0
        ? `Le fond sera remis comme avant (${fmt(totalFond)} repris).`
        : "Le fond n'est pas concerné.",
      'Le gérant sera notifié.',
    ]
    Alert.alert('↩️ Revenir sur la décision', lignes.join('\n\n'), [
      { text: 'Retour', style: 'cancel' },
      { text: 'Confirmer', style: 'destructive', onPress: revenirSurDecisionMachine },
    ])
  }

  // Défait une décision posée par erreur (« Justifier », « Annuler », « Refuser »…).
  // Retire uniquement les régularisations écrites depuis Vérification, rend au fond
  // ce que le mode « Annuler » lui avait ajouté, puis efface le statut : l'écart
  // redevient exactement ce qu'il était avant la décision. Les régularisations
  // saisies dans Litiges sont conservées, elles ne dépendent pas de cette décision.
  async function revenirSurDecisionMachine() {
    const p = pointSelectionne
    if (!p) return
    setRetourSaving(true)
    const faits = []   // deltas de fond déjà appliqués, pour pouvoir revenir en arrière
    try {
      const reguls = Array.isArray(p.ecart_regularisations) ? p.ecart_regularisations : []
      const aDefaire = reguls.filter(r => r?.source === 'verification' && !r?.shift_id)
      const restantes = reguls.filter(r => r?.source !== 'verification' || r?.shift_id)

      // Sens inverse de l'ajout : à l'ajout, manquant → fond +montant, surplus → fond −montant.
      for (const r of aDefaire) {
        if (r?.sans_fond) continue
        const montant = Math.round(parseFloat(r?.montant) || 0)
        if (!montant) continue
        const delta = r.sens === 'manquant' ? -montant : montant
        const cible = r.fond_point_id || p.id
        const ok = await appliquerDeltaFond(cible, delta)
        if (!ok) {
          for (const f of faits) await appliquerDeltaFond(f.cible, -f.delta)
          Alert.alert('Erreur', "Le fond n'a pas pu être remis à jour. Rien n'a été modifié.")
          return
        }
        faits.push({ cible, delta })
      }

      const maj = {
        ecart_regularisations: restantes,
        explication_machine_statut: null,
        explication_machine_statut_par: null,
        explication_machine_statut_at: null,
      }
      const { error } = await supabase.from('points').update(maj).eq('id', p.id)
      if (error) {
        for (const f of faits) await appliquerDeltaFond(f.cible, -f.delta)
        Alert.alert('Erreur', "L'annulation a échoué. Rien n'a été modifié.")
        return
      }

      setPointSelectionne(prev => prev ? { ...prev, ...maj } : prev)
      setPoints(prev => prev.map(pt => pt.id === p.id ? { ...pt, ...maj } : pt))

      const totalFond = faits.reduce((s, f) => s + Math.abs(f.delta), 0)
      creerNotification({
        type: 'explication_machine_decision_annulee',
        titre: '↩️ Décision annulée',
        message: `La décision prise sur l'écart de vente machine du ${formatDate(p.date)} a été annulée par le manager : l'écart est de nouveau à traiter.`
          + (totalFond > 0 ? ` Le fond a été remis comme avant (${fmt(totalFond)}).` : ''),
        restaurant_id: p.restaurant_id,
        cible_role: ['gerant'],
        created_by: userId || null,
        screen: 'recap-point',
      }).catch(() => {})

      journaliser('retour_decision_ecart_machine', {
        point_id: p.id,
        statut_annule: p.explication_machine_statut || null,
        regularisations_retirees: aDefaire.length,
        fond_rendu: totalFond,
      }, { par: userNom || roleActif }).catch(() => {})

      Alert.alert(
        '↩️ Décision annulée',
        `L'écart est de nouveau à traiter.${totalFond > 0 ? `\n\nLe fond a été remis comme avant (${fmt(totalFond)}).` : "\n\nLe fond n'a pas été touché."}\n\nLe gérant a été notifié.`
      )
    } catch (e) {
      for (const f of faits) await appliquerDeltaFond(f.cible, -f.delta)
      Alert.alert('Erreur', e?.message || 'Action impossible')
    } finally {
      setRetourSaving(false)
    }
  }

  function getPrixProduit(produitId) {
    for (const cat of CATEGORIES_INVENTAIRE) {
      const prod = cat.produits.find(p => p.id === produitId)
      if (prod) return prod.prix || 0
    }
    return 0
  }

  async function telechargerPdfEcarts(ecartsAvecCalc, totalDeduit) {
    if (!pointSelectionne) return
    setGeneratingEcartsPdf(true)
    try {
      const result = await genererPdfEcarts({
        ecarts: ecartsAvecCalc, totalDeduit,
        point: pointSelectionne, restoNom: restoSelectionne?.nom || 'SAMER',
      })
      if (result?.success) {
        Alert.alert('✅ PDF téléchargé', `Rapport des écarts du ${formatDate(pointSelectionne.date)} téléchargé.\n\nFichier : ${result.nomFichier}`)
      }
    } catch (err) {
      Alert.alert('Erreur', 'Impossible de générer le PDF : ' + err.message)
    } finally {
      setGeneratingEcartsPdf(false)
    }
  }

  // ─── Galerie photos ──────────────────────────────────────────
  function ouvriGalerie(photos, startIndex = 0) {
    if (!photos || photos.length === 0) return
    setGaleriePhotos(photos)
    setGalerieIndex(startIndex)
    setShowGalerie(true)
  }

  function getToutesPhotos() {
    if (!detailPoint) return []
    const photos = []
    detailPoint.sequences.forEach(s => {
      if (s.photo_url) photos.push({ uri: s.photo_url, label: `Séquence ${s.numero}` })
    })
    if (pointSelectionne?.photo_yango_tab) photos.push({ uri: pointSelectionne.photo_yango_tab, label: 'TAB Yango' })
    if (pointSelectionne?.photo_glovo_tab) photos.push({ uri: pointSelectionne.photo_glovo_tab, label: 'TAB Glovo' })
    detailPoint.shifts.forEach((s, i) => {
      if (s.photo_kdo && s.kdo > 0) photos.push({ uri: s.photo_kdo, label: `S${i+1} KDO` })
      if (s.photo_retour && s.retour > 0) photos.push({ uri: s.photo_retour, label: `S${i+1} Retour` })
      if (s.photo_yango_cse && s.yango_cse > 0) photos.push({ uri: s.photo_yango_cse, label: `S${i+1} Yango CSE` })
      if (s.photo_glovo_cse && s.glovo_cse > 0) photos.push({ uri: s.photo_glovo_cse, label: `S${i+1} Glovo CSE` })
      if (s.photo_wave && s.wave > 0) photos.push({ uri: s.photo_wave, label: `S${i+1} Wave` })
      if (s.photo_djamo && s.djamo > 0) photos.push({ uri: s.photo_djamo, label: `S${i+1} Djamo` })
      if (s.photo_om && s.om > 0) photos.push({ uri: s.photo_om, label: `S${i+1} OM` })
    })
    return photos
  }

  // ─── Vignette photo ──────────────────────────────────────────
  // Bloc « corriger la facture » — affiché uniquement sur une VRAIE
  // transaction_fournisseurs (pas les entrées draft/historique du gérant).
  function LigneCorrigerFacture({ f }) {
    const estTransaction = !!f?.id && (detailPoint?.fournisseurs || []).some(tx => tx.id === f.id)
    if (!estTransaction || (parseFloat(f.facture) || 0) <= 0) return null
    const corrige = !!f.facture_corrigee_at
    return (
      <View style={{ marginTop: 5 }}>
        {corrige && (
          <Text style={styles.factCorrBadge}>
            {`✏️ Corrigé : ${fmt(parseFloat(f.facture_original) || 0)} → ${fmt(parseFloat(f.facture) || 0)}${f.facture_corrigee_par_nom ? ` · ${f.facture_corrigee_par_nom}` : ''}`}
          </Text>
        )}
        <TouchableOpacity style={styles.factCorrBtn} onPress={() => ouvrirCorrectionFacture(f)} activeOpacity={0.8}>
          <Text style={styles.factCorrBtnTxt}>{corrige ? '✏️ Re-corriger la facture' : '✏️ Corriger la facture'}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  function PhotoVignette({ uri, label, montant, onPress }) {
    // « Une URL est présente » ne veut pas dire « la photo est consultable » :
    // une URI locale ou un jeton en attente doivent rester non cliquables.
    const aPhoto = photoConsultable(uri)
    const renseignee = !!uri
    return (
      <TouchableOpacity
        style={[styles.photoVignette, !aPhoto && styles.photoVignetteManquante]}
        onPress={() => aPhoto && (onPress ? onPress() : voirPhoto(uri, label))}
        disabled={!aPhoto}
        activeOpacity={aPhoto ? 0.7 : 1}
      >
        {renseignee ? (
          <PhotoJustificatif uri={uri} style={styles.photoThumb} compact />
        ) : (
          <View style={styles.photoAbsente}>
            <Text style={styles.photoAbsenteIcon}>❌</Text>
          </View>
        )}
        <Text style={[styles.photoLabel, !aPhoto && { color: '#993C1D' }]}>
          {aPhoto ? '✅ ' : ''}{label}
        </Text>
        {montant > 0 && <Text style={styles.photoMontant}>{fmt(montant)}</Text>}
        {aPhoto && <Text style={styles.photoTapTxt}>Tap pour voir</Text>}
      </TouchableOpacity>
    )
  }

  // ─── Statut présence badge ────────────────────────────────────
  function statutPresenceBadge(statut) {
    const map = {
      'Présent':    { bg: '#EAF3DE', text: '#3B6D11', icon: '✅' },
      'Absent':     { bg: '#FAECE7', text: '#993C1D', icon: '❌' },
      'Permission': { bg: '#F1EFE8', text: '#444441', icon: '🕐' },
      'Repos':      { bg: '#E6F1FB', text: '#185FA5', icon: '😴' },
      'Congé':      { bg: '#EEEDFE', text: '#3C3489', icon: '🏖️' },
      'Malade':     { bg: '#FAEEDA', text: '#854F0B', icon: '🤒' },
    }
    return map[statut] || { bg: '#f0f0f0', text: '#888', icon: '❓' }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/accueil')} style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <MaterialCommunityIcons name="chevron-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitre}>Vérification</Text>
          <Text style={styles.headerSub}>{restoSelectionne?.nom || 'Contrôle des points & photos'}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Sélection restaurant */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={[styles.restoBar, { flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 10 }}
      >
        {restaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.restoBtn, restoSelectionne?.id === r.id && styles.restoBtnActive]}
            onPress={() => changerResto(r)}
          >
            <Text style={[styles.restoTxt, restoSelectionne?.id === r.id && styles.restoTxtActive]}>{r.nom}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Mois choisi */}
      <View style={styles.moisBarre}>
        <TouchableOpacity style={styles.moisFleche} onPress={() => changerMois(-1)} accessibilityRole="button" accessibilityLabel="Mois précédent">
          <MaterialCommunityIcons name="chevron-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.moisTxt}>{libelleMoisLong(mois)}</Text>
        <TouchableOpacity style={styles.moisFleche} onPress={() => changerMois(1)} accessibilityRole="button" accessibilityLabel="Mois suivant">
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Résumé du mois */}
      {!loading && (
        <View style={styles.resumeMois}>
          {[
            { val: liste.compteurs.aVerifier, label: 'À vérifier', color: colors.warningDark },
            { val: liste.compteurs.verifies, label: 'Vérifiés', color: colors.success },
            { val: liste.compteurs.enCours, label: 'En cours', color: colors.textMuted },
          ].map((c, i) => (
            <View key={c.label} style={[styles.resumeCase, i > 0 && styles.resumeCaseSep]}>
              <Text style={[styles.resumeVal, { color: c.color }]}>{c.val}</Text>
              <Text style={styles.resumeLabel}>{c.label}</Text>
            </View>
          ))}
        </View>
      )}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingTxt}>Chargement des points...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.body} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {liste.aVerifier.length === 0 && liste.historique.length === 0 ? (
            <View style={styles.emptyBox}>
              <MaterialCommunityIcons name="calendar-blank-outline" size={42} color={colors.textMuted} />
              <Text style={styles.emptyTxt}>Aucun point en {libelleMoisLong(mois).toLowerCase()}</Text>
              <Text style={styles.emptySub}>Changez de mois, ou tirez vers le bas pour rafraîchir</Text>
            </View>
          ) : (
            <>
              {liste.aVerifier.length > 0 && (
                <>
                  <Text style={styles.titreListe}>À vérifier</Text>
                  {liste.aVerifier.map(({ point, enRetard }) => {
                    const alertes = alertesPoint(point, photosManquantesPoint(point))
                    return (
                      <TouchableOpacity
                        key={point.id}
                        style={[styles.carteAVerifier, { borderLeftColor: enRetard ? colors.error : colors.primary }]}
                        onPress={() => ouvrirPoint(point)}
                        accessibilityRole="button"
                        accessibilityLabel={`${formatJour(point.date)}, ventes ${fmtCourt(point.vente_total)}${enRetard ? ', en retard' : ''}`}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.carteDate}>{formatJour(point.date)}</Text>
                          <View style={styles.alertes}>
                            {enRetard && puce('rouge', 'En retard · mois précédent')}
                            {alertes.map(al => puce(al.ton, al.texte))}
                          </View>
                        </View>
                        <Text style={styles.carteMontant}>{fmtCourt(point.vente_total)}</Text>
                        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    )
                  })}
                </>
              )}

              {liste.historique.length > 0 && (
                <>
                  <Text style={styles.titreListe}>Historique</Text>
                  <View style={styles.listeCompacte}>
                    {liste.historique.map((point, i) => (
                      <TouchableOpacity
                        key={point.id}
                        style={[styles.ligneCompacte, i > 0 && styles.ligneCompacteSep]}
                        onPress={() => ouvrirPoint(point)}
                        accessibilityRole="button"
                        accessibilityLabel={`${formatJour(point.date)}, ${point.verifie ? 'vérifié' : 'en cours'}`}
                      >
                        <View style={[styles.pointStatut, { backgroundColor: point.verifie ? colors.success : colors.textMuted }]} />
                        <Text style={styles.ligneDate}>{formatJour(point.date)}{!point.valide ? ' · en cours' : ''}</Text>
                        <Text style={styles.ligneMontant}>{point.valide ? fmtCourt(point.vente_total) : '—'}</Text>
                        <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ══════════════════════════════════════════
          MODAL DÉTAIL POINT
      ══════════════════════════════════════════ */}
      <Modal visible={modalPoint} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalPoint(false)} style={styles.enteteBtn} accessibilityRole="button" accessibilityLabel="Fermer">
              <MaterialCommunityIcons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={{ alignItems: 'center', flex: 1 }}>
              <Text style={styles.modalTitre}>{formatJour(pointSelectionne?.date)}</Text>
              <Text style={styles.modalSub}>{restoSelectionne?.nom}</Text>
            </View>
            {pointSelectionne?.valide ? (
              <TouchableOpacity onPress={telechargerPdf} disabled={generatingPdf} style={styles.enteteBtn}
                accessibilityRole="button" accessibilityLabel="Télécharger le point en PDF">
                {generatingPdf
                  ? <ActivityIndicator color="#FFFFFF" size="small" />
                  : <MaterialCommunityIcons name="file-download-outline" size={22} color="#FFFFFF" />}
              </TouchableOpacity>
            ) : <View style={{ width: 40 }} />}
          </View>

          {loadingDetail ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingTxt}>Chargement...</Text>
            </View>
          ) : detailPoint && (
            <>
            <ScrollView style={{ padding: 14 }} showsVerticalScrollIndicator={false}>

              {/* Résumé : l'essentiel du point, avant le détail en onglets */}
              {(() => {
                const p = pointSelectionne
                const toutes = getToutesPhotos()
                const manquantes = photosManquantesPoint(p || {})
                const ecart = p?.ecart_caisse
                const statut = p?.verifie
                  ? puce('vert', `Vérifié par ${p.verifie_par || '—'}`)
                  : p?.valide ? puce('orange', 'À vérifier') : puce('gris', 'En cours · pas encore validé')
                return (
                  <View style={styles.ficheResume}>
                    <View style={{ flexDirection: 'row' }}>{statut}</View>
                    <Text style={styles.ficheLabel}>Ventes du jour</Text>
                    <Text style={styles.ficheGros}>{fmtCourt(p?.vente_total)}</Text>
                    <View style={styles.ficheTrois}>
                      <View style={styles.ficheCase}>
                        <Text style={styles.ficheCaseLabel}>Écart caisse</Text>
                        <Text style={[styles.ficheCaseVal, { color: ecart == null ? colors.textMuted : ecart ? colors.error : colors.success }]}>
                          {ecart == null ? '—' : ecart === 0 ? 'Juste' : `${ecart > 0 ? '+' : '−'} ${fmtCourt(Math.abs(ecart)).replace(' F', '')}`}
                        </Text>
                      </View>
                      <View style={styles.ficheCase}>
                        <Text style={styles.ficheCaseLabel}>Dépenses</Text>
                        <Text style={styles.ficheCaseVal}>{fmtCourt(p?.depense_total).replace(' F', '')}</Text>
                      </View>
                      <View style={styles.ficheCase}>
                        <Text style={styles.ficheCaseLabel}>Photos</Text>
                        <Text style={[styles.ficheCaseVal, manquantes.length > 0 && { color: colors.warningDark }]}>
                          {toutes.length}{manquantes.length ? ` · ${manquantes.length} manq.` : ''}
                        </Text>
                      </View>
                    </View>
                  </View>
                )
              })()}

              {/* Onglets de la fiche */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 12 }}
                contentContainerStyle={{ gap: 8 }}>
                {[
                  ['ventes', 'Ventes'], ['ecart', 'Écart'], ['photos', 'Photos'], ['depenses', 'Dépenses'],
                  ['argent', 'Argent'], ['equipe', 'Équipe'], ['stock', 'Stock'],
                  ...(detailPoint.deverouillages.length > 0 ? [['historique', 'Corrections']] : []),
                ].map(([cle, label]) => (
                  <TouchableOpacity key={cle} onPress={() => setOngletFiche(cle)}
                    style={[styles.ficheOnglet, ongletFiche === cle && styles.ficheOngletActif]}
                    accessibilityRole="tab" accessibilityState={{ selected: ongletFiche === cle }}>
                    <Text style={[styles.ficheOngletTxt, ongletFiche === cle && styles.ficheOngletTxtActif]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {ongletFiche === 'argent' && (<>
{/* ══════════════════════════════════════
                  1. RÉCAPITULATIF FINANCIER
              ══════════════════════════════════════ */}
              {(() => {
                const p = pointSelectionne
                const especeShifts = detailPoint.shifts.reduce((s, sh) => s + (sh.espece || 0), 0)
                const yangoCse = detailPoint.shifts.reduce((s, sh) => s + (sh.yango_cse || 0), 0)
                const glovoCse = detailPoint.shifts.reduce((s, sh) => s + (sh.glovo_cse || 0), 0)
                const yangoTab = p?.yango_tab || 0
                const glovoTab = p?.glovo_tab || 0
                const waveOmDjamo = (p?.wave || 0) + (p?.om || 0) + (p?.djamo || 0)
                const depGerant = p?.depenses_gerant_caisse_total || 0
                const depShifts = (p?.depense_total || 0) - depGerant

                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>Récapitulatif Financier</Text>
                    <View style={styles.recapCard}>
                      {/* Ventes */}
                      {[
                        { label: 'Yango CSE', val: yangoCse, color: '#EF9F27', show: yangoCse > 0 },
                        { label: 'Yango TAB', val: yangoTab, color: '#EF9F27', show: yangoTab > 0 },
                        { label: 'Glovo CSE', val: glovoCse, color: '#EF9F27', show: glovoCse > 0 },
                        { label: 'Glovo TAB', val: glovoTab, color: '#EF9F27', show: glovoTab > 0 },
                        { label: 'Ventes Wave/OM/Djamo', val: waveOmDjamo, color: '#EF9F27', show: waveOmDjamo > 0 },
                        { label: 'Ventes Espèces', val: especeShifts, color: '#EF9F27', show: especeShifts > 0 },
                      ].filter(r => r.show).map((r, i) => (
                        <View key={i} style={styles.recapRow}>
                          <Text style={styles.recapLabel}>{r.label}</Text>
                          <Text style={[styles.recapVal, { color: r.color }]}>{fmt(r.val)}</Text>
                        </View>
                      ))}
                      <View style={[styles.recapRow, styles.recapRowTotal]}>
                        <Text style={[styles.recapLabel, { fontWeight: '700' }]}>Total Ventes</Text>
                        <Text style={[styles.recapVal, { color: '#EF9F27', fontWeight: '700' }]}>{fmt(p?.vente_total || 0)}</Text>
                      </View>

                      <View style={styles.recapSep} />

                      {/* Dépenses */}
                      {depShifts > 0 && (
                        <View style={styles.recapRow}>
                          <Text style={styles.recapLabel}>Dépenses shifts</Text>
                          <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(depShifts)}</Text>
                        </View>
                      )}
                      {(() => {
                        const draft = p?.draft_gerant
                        if (!draft && depGerant <= 0) return null
                        const totalFourn = Object.values(draft?.fournisseurs || {}).reduce((s, d) => s + (parseFloat(d?.paye) || 0), 0)
                        const totalMarche = Object.values(draft?.depenses || {}).reduce((s, lignes) =>
                          s + (lignes || []).reduce((ss, l) => ss + (parseFloat(l?.montant) || 0), 0), 0)
                        const totalPaies = (draft?.paies || []).reduce((s, l) => s + (parseFloat(l?.montant) || 0), 0)
                        return (
                          <>
                            {totalFourn > 0 && (
                              <View style={styles.recapRow}>
                                <Text style={styles.recapLabel}>Gérant — Fournisseurs</Text>
                                <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(totalFourn)}</Text>
                              </View>
                            )}
                            {totalMarche > 0 && (
                              <View style={styles.recapRow}>
                                <Text style={styles.recapLabel}>Gérant — Marché / Dépenses</Text>
                                <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(totalMarche)}</Text>
                              </View>
                            )}
                            {totalPaies > 0 && (
                              <View style={styles.recapRow}>
                                <Text style={styles.recapLabel}>Gérant — Paies</Text>
                                <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(totalPaies)}</Text>
                              </View>
                            )}
                            {depGerant > 0 && (totalFourn + totalMarche + totalPaies === 0) && (
                              <View style={styles.recapRow}>
                                <Text style={styles.recapLabel}>Dépenses gérant</Text>
                                <Text style={[styles.recapVal, { color: '#A32D2D' }]}>{fmt(depGerant)}</Text>
                              </View>
                            )}
                          </>
                        )
                      })()}
                      {(p?.fc_compte || 0) > 0 && (
                        <View style={styles.recapRow}>
                          <Text style={styles.recapLabel}>Fond de caisse reçu</Text>
                          <Text style={[styles.recapVal, { color: '#185FA5' }]}>{fmt(p.fc_compte)}</Text>
                        </View>
                      )}
                      <View style={[styles.recapRow, styles.recapRowTotal]}>
                        <Text style={[styles.recapLabel, { fontWeight: '700' }]}>Total Dépenses</Text>
                        <Text style={[styles.recapVal, { color: '#A32D2D', fontWeight: '700' }]}>{fmt(p?.depense_total || 0)}</Text>
                      </View>

                      <View style={styles.recapSep} />

                      {/* Espèces */}
                      <View style={styles.recapRow}>
                        <Text style={styles.recapLabel}>Reste Espèces</Text>
                        <Text style={[styles.recapVal, { color: colors.primary, fontWeight: '600' }]}>{fmt(p?.reste_especes || 0)}</Text>
                      </View>
                      {(p?.fc_veille || 0) > 0 && (
                        <View style={styles.recapRow}>
                          <Text style={styles.recapLabel}>Fc de la veille</Text>
                          <Text style={[styles.recapVal, { color: colors.primary }]}>{fmt(p.fc_veille)}</Text>
                        </View>
                      )}
                      {/* Fond reçu : fond_recu (Modifier le point) sinon fc_compte (validation gérant) */}
                      {((p?.fond_recu || 0) || (p?.fc_compte || 0)) > 0 && (
                        <View style={styles.recapRow}>
                          <Text style={styles.recapLabel}>Fond reçu</Text>
                          <Text style={[styles.recapVal, { color: colors.primary }]}>{fmt((p?.fond_recu || 0) || (p?.fc_compte || 0))}</Text>
                        </View>
                      )}
                      {(p?.ajustement_fond || 0) !== 0 && (
                        <View style={styles.recapRow}>
                          <Text style={styles.recapLabel}>Ajustement écart</Text>
                          <Text style={[styles.recapVal, { color: (p.ajustement_fond || 0) >= 0 ? '#2E7D32' : '#C62828' }]}>
                            {(p.ajustement_fond || 0) > 0 ? '+' : ''}{fmt(p.ajustement_fond)}
                          </Text>
                        </View>
                      )}
                      <View style={[styles.recapRow, styles.recapRowTotal]}>
                        <Text style={[styles.recapLabel, { fontWeight: '700' }]}>Reste + Fc</Text>
                        <Text style={[styles.recapVal, { color: colors.primary, fontWeight: '700' }]}>{fmt((p?.reste_fc || 0) + (p?.ajustement_fond || 0))}</Text>
                      </View>

                      <View style={styles.recapSep} />

                      {/* Bénéfice */}
                      <View style={[styles.recapRow, { borderBottomWidth: 0, paddingVertical: 12 }]}>
                        <Text style={[styles.recapLabel, { fontSize: 14, fontWeight: '700' }]}>Bénéfice SC</Text>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: '#3B6D11' }}>
                          {fmt(p?.benefice_sc || 0)}
                        </Text>
                      </View>
                    </View>
                  </View>
                )
              })()}
              </>)}

              {ongletFiche === 'ventes' && (<>
              {/* Ventes par canal en barres : d'où vient l'argent */}
              {(() => {
                const especes = detailPoint.shifts.reduce((t, sh) => t + (sh.espece || 0), 0)
                const canaux = ventesParCanal(pointSelectionne || {}, especes)
                const max = Math.max(1, ...canaux.map(c => c.montant))
                if (!canaux.length) return null
                return (
                  <View style={styles.barresCarte}>
                    {canaux.map(c => (
                      <View key={c.canal} style={styles.barreLigne}>
                        <Text style={styles.barreNom}>{c.canal}</Text>
                        <View style={styles.barreFond}>
                          <View style={[styles.barrePlein, { width: `${Math.max(3, Math.round((c.montant / max) * 100))}%` }]} />
                        </View>
                        <Text style={styles.barreVal}>{fmtCourt(c.montant).replace(' F', '')}</Text>
                      </View>
                    ))}
                  </View>
                )
              })()}

{/* ══════════════════════════════════════
                  2. VENTES PAR CANAL
              ══════════════════════════════════════ */}
              {(() => {
                const p = pointSelectionne
                const yangoCseTotal = detailPoint.shifts.reduce((s, sh) => s + (sh.yango_cse || 0), 0)
                const glovoCseTotal = detailPoint.shifts.reduce((s, sh) => s + (sh.glovo_cse || 0), 0)
                const yangoTab = p?.yango_tab || 0
                const glovoTab = p?.glovo_tab || 0
                const waveTotal = detailPoint.shifts.reduce((s, sh) => s + (sh.wave || 0), 0) || (p?.wave || 0)
                const omTotal = detailPoint.shifts.reduce((s, sh) => s + (sh.om || 0), 0) || (p?.om || 0)
                const djamoTotal = detailPoint.shifts.reduce((s, sh) => s + (sh.djamo || 0), 0) || (p?.djamo || 0)
                const especeShifts = detailPoint.shifts.reduce((s, sh) => s + (sh.espece || 0), 0)
                const yangoContacts = detailPoint.contactsParPartenaire?.['Yango'] || 0
                const glovoContacts = detailPoint.contactsParPartenaire?.['Glovo'] || 0
                // Le POS envoie un total de contacts, pas leur ventilation par
                // partenaire : sur un site basculé on ne prétend pas la connaître.
                const contactsDuPOS = detailPoint.infoContacts?.source === 'POS'
                const hasYango = yangoCseTotal > 0 || yangoTab > 0
                const hasGlovo = glovoCseTotal > 0 || glovoTab > 0
                const hasAutres = waveTotal > 0 || omTotal > 0 || djamoTotal > 0 || especeShifts > 0
                const toutes = getToutesPhotos()

                const yangoCSEPhotos = photosCanalDisponibles(detailPoint.shifts, {
                  montantChamp: 'yango_cse', photoChamp: 'photo_yango_cse', label: 'Yango CSE',
                })
                const glovoCSEPhotos = photosCanalDisponibles(detailPoint.shifts, {
                  montantChamp: 'glovo_cse', photoChamp: 'photo_glovo_cse', label: 'Glovo CSE',
                })

                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>Ventes par canal</Text>

                    {/* YANGO */}
                    {hasYango && (
                      <View style={styles.canalCard}>
                        <Text style={styles.canalNom}>🛵 YANGO</Text>

                        {/* Yango CSE */}
                        {yangoCseTotal > 0 && (
                          <>
                            <View style={styles.canalRow}>
                              <Text style={styles.canalLabel}>Yango CSE (shifts)</Text>
                              <Text style={styles.canalVal}>{fmt(yangoCseTotal)}</Text>
                            </View>
                            {yangoCSEPhotos.map((photo, i) => (
                              <TouchableOpacity key={i} style={styles.canalPhotoTouchable}
                                onPress={() => { const idx = toutes.findIndex(x => x.uri === photo.uri); ouvriGalerie(toutes, idx >= 0 ? idx : 0) }}>
                                <PhotoJustificatif uri={photo.uri} style={styles.canalPhotoMini} compact />
                                <Text style={styles.canalPhotoLabel}>📷 {photo.label} — Tap pour agrandir</Text>
                              </TouchableOpacity>
                            ))}
                          </>
                        )}

                        {/* Yango TAB */}
                        {yangoTab > 0 && (
                          <>
                            <View style={[styles.canalRow, yangoCseTotal > 0 && { marginTop: 8, borderTopWidth: 0.5, borderTopColor: '#eee', paddingTop: 8 }]}>
                              <Text style={styles.canalLabel}>Yango TAB</Text>
                              <Text style={styles.canalVal}>{fmt(yangoTab)}</Text>
                            </View>
                            {p?.photo_yango_tab ? (
                              <TouchableOpacity style={styles.canalPhotoTouchable}
                                onPress={() => { const idx = toutes.findIndex(x => x.uri === p.photo_yango_tab); ouvriGalerie(toutes, idx >= 0 ? idx : 0) }}>
                                <PhotoJustificatif uri={p.photo_yango_tab} style={styles.canalPhotoMini} compact />
                                <Text style={styles.canalPhotoLabel}>📷 Photo TAB Yango — Tap pour agrandir</Text>
                              </TouchableOpacity>
                            ) : null}
                          </>
                        )}

                        {(p?.yango_nb_commandes || 0) > 0 && (
                          <>
                            <View style={styles.canalRow}>
                              <Text style={styles.canalLabel}>Nombre de commandes</Text>
                              <Text style={styles.canalVal}>{p.yango_nb_commandes} cmd</Text>
                            </View>
                            <View style={styles.canalRow}>
                              <Text style={styles.canalLabel}>Contacts pris</Text>
                              <Text style={styles.canalVal}>
                                {contactsDuPOS ? 'détail non transmis par le POS' : `${yangoContacts} contacts`}
                              </Text>
                            </View>
                          </>
                        )}
                      </View>
                    )}

                    {/* GLOVO */}
                    {hasGlovo && (
                      <View style={[styles.canalCard, { borderLeftColor: '#F0C020' }]}>
                        <Text style={[styles.canalNom, { color: '#B8960C' }]}>🟡 GLOVO</Text>

                        {/* Glovo CSE */}
                        {glovoCseTotal > 0 && (
                          <>
                            <View style={styles.canalRow}>
                              <Text style={styles.canalLabel}>Glovo CSE (shifts)</Text>
                              <Text style={styles.canalVal}>{fmt(glovoCseTotal)}</Text>
                            </View>
                            {glovoCSEPhotos.map((photo, i) => (
                              <TouchableOpacity key={i} style={styles.canalPhotoTouchable}
                                onPress={() => { const idx = toutes.findIndex(x => x.uri === photo.uri); ouvriGalerie(toutes, idx >= 0 ? idx : 0) }}>
                                <PhotoJustificatif uri={photo.uri} style={styles.canalPhotoMini} compact />
                                <Text style={styles.canalPhotoLabel}>📷 {photo.label} — Tap pour agrandir</Text>
                              </TouchableOpacity>
                            ))}
                          </>
                        )}

                        {/* Glovo TAB */}
                        {glovoTab > 0 && (
                          <>
                            <View style={[styles.canalRow, glovoCseTotal > 0 && { marginTop: 8, borderTopWidth: 0.5, borderTopColor: '#eee', paddingTop: 8 }]}>
                              <Text style={styles.canalLabel}>Glovo TAB</Text>
                              <Text style={styles.canalVal}>{fmt(glovoTab)}</Text>
                            </View>
                            {p?.photo_glovo_tab ? (
                              <TouchableOpacity style={styles.canalPhotoTouchable}
                                onPress={() => { const idx = toutes.findIndex(x => x.uri === p.photo_glovo_tab); ouvriGalerie(toutes, idx >= 0 ? idx : 0) }}>
                                <PhotoJustificatif uri={p.photo_glovo_tab} style={styles.canalPhotoMini} compact />
                                <Text style={styles.canalPhotoLabel}>📷 Photo TAB Glovo — Tap pour agrandir</Text>
                              </TouchableOpacity>
                            ) : null}
                          </>
                        )}

                        {(p?.glovo_nb_commandes || 0) > 0 && (
                          <>
                            <View style={styles.canalRow}>
                              <Text style={styles.canalLabel}>Nombre de commandes</Text>
                              <Text style={styles.canalVal}>{p.glovo_nb_commandes} cmd</Text>
                            </View>
                            <View style={styles.canalRow}>
                              <Text style={styles.canalLabel}>Contacts pris</Text>
                              <Text style={styles.canalVal}>
                                {contactsDuPOS ? 'détail non transmis par le POS' : `${glovoContacts} contacts`}
                              </Text>
                            </View>
                          </>
                        )}
                      </View>
                    )}

                    {/* Autres canaux */}
                    {hasAutres && (
                      <View style={[styles.canalCard, { borderLeftColor: '#185FA5' }]}>
                        <Text style={styles.canalAutresTitre}>AUTRES CANAUX</Text>
                        {waveTotal > 0 && <View style={styles.canalRow}><Text style={styles.canalLabel}>Wave</Text><Text style={styles.canalVal}>{fmt(waveTotal)}</Text></View>}
                        {omTotal > 0 && <View style={styles.canalRow}><Text style={styles.canalLabel}>Orange Money</Text><Text style={styles.canalVal}>{fmt(omTotal)}</Text></View>}
                        {djamoTotal > 0 && <View style={styles.canalRow}><Text style={styles.canalLabel}>Djamo</Text><Text style={styles.canalVal}>{fmt(djamoTotal)}</Text></View>}
                        {especeShifts > 0 && <View style={styles.canalRow}><Text style={styles.canalLabel}>Espèces</Text><Text style={styles.canalVal}>{fmt(especeShifts)}</Text></View>}
                      </View>
                    )}

                    {/* Nombre de commandes livraison → base du litige « contacts ».
                        Le gérant peut s'être trompé : manager/directeur corrigent ici.
                        Toujours affiché, même sans montant Yango/Glovo sur le point :
                        c'est justement quand le nombre est faux qu'il faut le corriger. */}
                    {(() => {
                      const calc = calculerLitigeContact(
                        p, detailPoint.nbContactsTotal || 0, detailPoint.infoContacts
                      )
                      const cmdPOS = detailPoint.commandesPOS
                      const contactsDuPOS = calc.contactsSource === 'POS'
                      return (
                        <View style={styles.corrCmdBox}>
                          <View style={styles.canalRow}>
                            <Text style={styles.canalLabel}>Commandes livraison saisies</Text>
                            <Text style={styles.canalVal}>
                              Yango {calc.nbYango} · Glovo {calc.nbGlovo}
                            </Text>
                          </View>
                          {/* Contrôle croisé : ce que le POS a compté de son côté.
                              Le nombre qui fait foi reste celui du gérant. */}
                          {contactsDuPOS && cmdPOS?.disponible && (
                            <View style={styles.canalRow}>
                              <Text style={styles.canalLabel}>Commandes comptées par le POS</Text>
                              <Text style={styles.canalVal}>
                                Yango {cmdPOS.yango} · Glovo {cmdPOS.glovo}
                              </Text>
                            </View>
                          )}
                          <View style={styles.canalRow}>
                            <Text style={styles.canalLabel}>Contacts pris</Text>
                            <Text style={styles.canalVal}>
                              {!calc.contactsDisponibles
                                ? 'en attente du POS'
                                : `${calc.nbContacts} / ${calc.nbCommandes}`
                                  + (calc.nbCommandes > 0 && calc.ecart > 0 ? ` (${calc.taux}% manquants)` : '')
                                  + (calc.ecart < 0 ? ` (surplus de ${Math.abs(calc.ecart)})` : '')}
                            </Text>
                          </View>
                          {/* Qui a pris combien. Même source que le litige (POS ou
                              Samtrackly) ; « — » quand le POS n'a rien transmis pour
                              une caissière : absent n'est pas zéro. */}
                          {detailPoint.contactsCaissiers?.lignes?.length > 0 && (
                            <View style={styles.contactsCaissierBox}>
                              <Text style={styles.contactsCaissierTitre}>Détail par caissier</Text>
                              {detailPoint.contactsCaissiers.lignes.map((c) => {
                                const manquants = c.contacts != null && c.commandes != null
                                  ? c.commandes - c.contacts : 0
                                return (
                                  <View key={c.cle}>
                                    <View style={styles.canalRow}>
                                      <Text style={styles.canalLabel}>📞 {c.nom}</Text>
                                      <Text style={[styles.canalVal, {
                                        color: c.contacts == null ? colors.textMuted
                                          : manquants > 0 ? '#A32D2D' : '#2E7D32',
                                      }]}>
                                        {c.contacts == null
                                          ? 'non transmis'
                                          : `${c.contacts} / ${c.commandes == null ? '—' : c.commandes}`}
                                      </Text>
                                    </View>
                                    {/* Site sans POS : l'argent du shift laisse supposer plus de
                                        commandes que ce qui a été enregistré. Estimation, à vérifier. */}
                                    {c.alerte && (
                                      <Text style={styles.contactsCaissierAlerte}>
                                        ⚠️ Son shift a encaissé {fmt(c.montantLivraison)} de livraison,
                                        soit environ {c.attendu} commandes : {c.attendu - c.commandes} n'ont
                                        pas été enregistrées.
                                      </Text>
                                    )}
                                  </View>
                                )
                              })}
                              {/* Le litige se calcule sur le nombre saisi par le gérant :
                                  si le détail ne tombe pas juste, on le dit plutôt que de
                                  laisser croire à une erreur de calcul. */}
                              {detailPoint.contactsCaissiers.sommeCommandes > 0
                                && detailPoint.contactsCaissiers.sommeCommandes !== calc.nbCommandes && (
                                <Text style={styles.contactsCaissierNote}>
                                  Détail indicatif : {detailPoint.contactsCaissiers.sommeCommandes} commande
                                  {detailPoint.contactsCaissiers.sommeCommandes > 1 ? 's' : ''} enregistrée
                                  {detailPoint.contactsCaissiers.sommeCommandes > 1 ? 's' : ''} ici, contre{' '}
                                  {calc.nbCommandes} saisie{calc.nbCommandes > 1 ? 's' : ''} par le gérant —
                                  c'est ce dernier nombre qui sert au litige.
                                </Text>
                              )}
                              {detailPoint.contactsCaissiers.lignes.some(l => l.alerte) && (
                                <Text style={styles.contactsCaissierNote}>
                                  Estimation : argent livraison du shift ÷ panier moyen du restaurant
                                  ({fmt(detailPoint.panierLivraison)}). À vérifier avec le caissier —
                                  ce n'est pas une preuve et ça ne déclenche aucune retenue.
                                </Text>
                              )}
                            </View>
                          )}
                          {contactsDuPOS && (
                            <Text style={styles.corrCmdBadge}>Source : POS</Text>
                          )}
                          {calc.contactsIncomplets && (
                            <Text style={[styles.corrCmdLitige, { color: '#B06E00' }]}>
                              ⚠️ Comptage incomplet : {calc.shiftsSansContact} shift
                              {calc.shiftsSansContact > 1 ? 's' : ''} sans données contacts POS
                            </Text>
                          )}
                          {calc.calculSuspendu && calc.nbCommandes > 0 && (
                            <Text style={[styles.corrCmdLitige, { color: '#B06E00' }]}>
                              ⏳ {calc.motifSuspension}
                            </Text>
                          )}
                          {calc.litige > 0 && (
                            <Text style={styles.corrCmdLitige}>
                              ⚠️ Litige contacts : {fmt(calc.litige)}
                              {calc.forceParManager ? ' (montant forcé)' : ''}
                            </Text>
                          )}
                          {calc.nbCorrige && (
                            <Text style={styles.corrCmdBadge}>
                              ✏️ Corrigé (avant : Yango {calc.nbYangoOriginal ?? '—'} · Glovo {calc.nbGlovoOriginal ?? '—'})
                              {calc.nbCorrigePar ? ` — ${calc.nbCorrigePar}` : ''}
                              {calc.nbCorrigeMotif ? `\n${calc.nbCorrigeMotif}` : ''}
                            </Text>
                          )}
                          <TouchableOpacity style={styles.corrCmdBtn} onPress={ouvrirCorrectionCommandes}>
                            <Text style={styles.corrCmdBtnTxt}>✏️ Corriger le nombre de commandes</Text>
                          </TouchableOpacity>
                        </View>
                      )
                    })()}

                    {!hasYango && !hasGlovo && !hasAutres && (
                      <View style={styles.emptySection}>
                        <Text style={styles.emptySectionTxt}>Aucun montant enregistré sur les canaux</Text>
                      </View>
                    )}
                  </View>
                )
              })()}
              </>)}

              {ongletFiche === 'ecart' && (<>
{/* ══════════════════════════════════════
                  2.5 VENTE MACHINE
              ══════════════════════════════════════ */}
              {(() => {
                const p = pointSelectionne
                // Une clôture POS possède déjà l'écart officiel du rapport Z,
                // affiché dans la section suivante. Ne pas recréer ici un
                // pseudo-écart à partir de vente_shift et vente_machine.
                if (cloturesPOS(detailPoint.shifts).length > 0) return null
                const venteMachine = p?.vente_machine
                const venteTheo = detailPoint.shifts.reduce((s, sh) => s + (sh.vente_shift || 0), 0)
                if (venteMachine == null && !p?.explication_ecart_machine) return null
                const ecart = venteMachine != null ? venteTheo - venteMachine : null
                // Régularisations déjà posées sur cet écart (partagées avec l'écran Litiges)
                const regulsMachine = (Array.isArray(p?.ecart_regularisations) ? p.ecart_regularisations : [])
                  .filter(r => r?.source !== SOURCE_DECISION_POS)
                const totalRegulMachine = regulsMachine.reduce((s, r) => s + (parseFloat(r?.montant) || 0), 0)
                const resteMachine = Math.max(0, Math.round((ecart != null ? Math.abs(ecart) : 0) - totalRegulMachine))
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>Vente machine</Text>
                    <View style={styles.recapCard}>
                      <View style={styles.recapRow}>
                        <Text style={styles.recapLabel}>Vente théorique (shifts)</Text>
                        <Text style={styles.recapVal}>{fmt(venteTheo)}</Text>
                      </View>
                      {venteMachine != null && (
                        <View style={styles.recapRow}>
                          <Text style={styles.recapLabel}>Vente machine</Text>
                          <Text style={styles.recapVal}>{fmt(venteMachine)}</Text>
                        </View>
                      )}
                      {ecart != null && (
                        <View style={[styles.recapRow, {
                          backgroundColor: ecart === 0 ? '#EAF3DE' : '#FAEEDA',
                          borderRadius: 8, paddingHorizontal: 10, marginTop: 4
                        }]}>
                          <Text style={[styles.recapLabel, { color: ecart === 0 ? '#3B6D11' : '#854F0B' }]}>
                            {ecart === 0 ? '✅ Aucun écart' : '⚠️ Écart'}
                          </Text>
                          {ecart !== 0 && (
                            <Text style={[styles.recapVal, { color: '#A32D2D', fontWeight: '700' }]}>
                              {ecart >= 0 ? '+' : ''}{fmt(ecart)}
                            </Text>
                          )}
                        </View>
                      )}
                      {totalRegulMachine > 0 && (
                        <View style={styles.machineRegulRecap}>
                          <View style={styles.machineRegulRow}>
                            <Text style={styles.machineRegulLabel}>Déjà régularisé</Text>
                            <Text style={[styles.machineRegulVal, { color: '#3B6D11' }]}>{fmt(totalRegulMachine)}</Text>
                          </View>
                          <View style={styles.machineRegulRow}>
                            <Text style={styles.machineRegulLabel}>Reste à régulariser</Text>
                            <Text style={[styles.machineRegulVal, { color: resteMachine > 0 ? '#A32D2D' : '#3B6D11' }]}>{fmt(resteMachine)}</Text>
                          </View>
                          <Text style={styles.machineRegulNote}>{"Détail et réversion dans l'écran Litiges."}</Text>
                        </View>
                      )}
                      {p?.explication_ecart_machine ? (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#ddd' }}>
                          <Text style={[styles.recapLabel, { marginBottom: 6 }]}>📝 Explication :</Text>
                          <Text style={{ fontSize: 13, color: '#444', fontStyle: 'italic', lineHeight: 19 }}>
                            "{p.explication_ecart_machine}"
                          </Text>
                        </View>
                      ) : ecart != null && ecart !== 0 ? (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#ddd' }}>
                          <Text style={{ fontSize: 12, color: '#A32D2D', fontWeight: '600' }}>
                            ⚠️ Aucune explication fournie
                          </Text>
                        </View>
                      ) : null}
                      {Array.isArray(p?.ecart_responsables) && p.ecart_responsables.length > 0 ? (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#ddd' }}>
                          <Text style={[styles.recapLabel, { marginBottom: 6 }]}>👤 Responsables du {ecart != null && ecart > 0 ? 'surplus' : 'manquant'} :</Text>
                          {p.ecart_responsables.map((r, i) => (
                            <View key={i} style={styles.recapRow}>
                              <Text style={styles.recapLabel}>{r.nom}</Text>
                              <Text style={[styles.recapVal, { color: '#A32D2D', fontWeight: '700' }]}>{fmt(r.montant)}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      {Array.isArray(p?.ecart_photos) && p.ecart_photos.length > 0 ? (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#ddd' }}>
                          <Text style={[styles.recapLabel, { marginBottom: 8 }]}>📷 Photos justificatives :</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {p.ecart_photos.map((uri, i) => (
                              <TouchableOpacity
                                key={i}
                                onPress={() => ouvriGalerie(p.ecart_photos.map((u, j) => ({ uri: u, label: `Justificatif ${j + 1}` })))}
                                activeOpacity={0.85}
                              >
                                <PhotoJustificatif uri={uri} style={{ width: 80, height: 80, borderRadius: 8 }} compact />
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      ) : null}
                      {p?.photo_vente_machine ? (
                        <TouchableOpacity
                          style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#ddd' }}
                          onPress={() => ouvriGalerie([{ uri: p.photo_vente_machine, label: 'Vente machine' }])}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.recapLabel, { marginBottom: 8 }]}>📷 Photo vente machine :</Text>
                          <PhotoJustificatif
                            uri={p.photo_vente_machine}
                            style={{ width: '100%', height: 180, borderRadius: 10 }}
                          />
                          <Text style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 6 }}>
                            Appuyer pour agrandir
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: '#ddd' }}>
                          <Text style={{ fontSize: 12, color: '#aaa' }}>📷 Aucune photo de caisse enregistrée</Text>
                        </View>
                      )}

                      {/* Décision manager sur l'explication (seulement s'il y a un écart) */}
                      {ecart != null && ecart !== 0 && (
                        <View style={styles.machineDecisionBox}>
                          {p?.explication_machine_statut && STATUT_MACHINE[p.explication_machine_statut] ? (
                            <>
                              <View style={[styles.machineStatutBadge, STATUT_MACHINE[p.explication_machine_statut].box]}>
                                <Text style={[styles.machineStatutTxt, { color: STATUT_MACHINE[p.explication_machine_statut].txt }]}>
                                  {STATUT_MACHINE[p.explication_machine_statut].label}
                                  {p.explication_machine_statut_par ? ` — ${p.explication_machine_statut_par}` : ''}
                                </Text>
                              </View>
                              {/* Sortie de secours : une décision prise par erreur (justifier au lieu
                                  d'annuler, ou l'inverse) se défait ici, sans passer par Litiges. */}
                              {peutAnnulerDecisionMachine && (
                                <TouchableOpacity
                                  style={[styles.machineRetourBtn, retourSaving && { opacity: 0.5 }]}
                                  onPress={confirmerRetourDecisionMachine}
                                  disabled={retourSaving}
                                  activeOpacity={0.85}
                                >
                                  <Text style={styles.machineRetourTxt}>
                                    {retourSaving ? 'Annulation…' : '↩️ Revenir sur cette décision'}
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </>
                          ) : (
                            <Text style={styles.machineDecisionHint}>{"Décision sur l'explication :"}</Text>
                          )}
                          <View style={styles.machineBtnRow}>
                            <TouchableOpacity
                              style={[styles.machineBtn, styles.machineBtnJustifier, (statuantMachine || retourSaving) && { opacity: 0.5 }]}
                              onPress={() => ouvrirAnnulerMachine('sans_fond')}
                              disabled={statuantMachine || retourSaving}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.machineBtnTxt}>✔️ Justifier</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.machineBtn, styles.machineBtnRefuser, (statuantMachine || retourSaving) && { opacity: 0.5 }]}
                              onPress={() => confirmerStatutMachine('refusee')}
                              disabled={statuantMachine || retourSaving}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.machineBtnTxt}>❌ Refuser</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.machineBtn, styles.machineBtnAnnuler, (statuantMachine || retourSaving) && { opacity: 0.5 }]}
                              onPress={() => ouvrirAnnulerMachine('fond')}
                              disabled={statuantMachine || retourSaving}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.machineBtnTxt}>🚫 Annuler</Text>
                            </TouchableOpacity>
                          </View>
                          <Text style={styles.machineDecisionNote}>Le gérant est notifié. « Justifier » ne touche pas au fond, « Annuler » le corrige.</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )
              })()}

              {/* Clôtures POS : rapport_z.diff en indicateur principal et
                  services_caisse.ecart en détail espèces secondaire. */}
              {(() => {
                const clotures = cloturesPOS(detailPoint.shifts)
                const resume = resumerEcartsGlobaux(detailPoint.shifts)
                if (clotures.length === 0) return null
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>Rapports Z — clôtures POS</Text>
                    <View style={styles.ecartsPosCard}>
                      {clotures.map((cloture, index) => {
                        const manquant = cloture.ecartGlobal != null && cloture.ecartGlobal < 0
                        const reguls = Array.isArray(pointSelectionne?.ecart_regularisations)
                          ? pointSelectionne.ecart_regularisations : []
                        const decision = decisionEcartShiftPOS(cloture, reguls)
                        const statutCfg = decision.statut ? STATUT_MACHINE[decision.statut] : null
                        const aEcartEspeces = cloture.ecartEspeces != null && cloture.ecartEspeces !== 0
                        const couleur = cloture.ecartGlobal == null ? colors.textMuted
                          : manquant ? '#A32D2D'
                          : cloture.ecartGlobal > 0 ? '#3B6D11' : colors.textMuted
                        return (
                          <View
                            key={cloture.pos_service_id || cloture.id || index}
                            style={styles.ecartPosLigne}
                          >
                            <View style={styles.ecartPosEntete}>
                              <Text style={styles.ecartPosCaissier}>
                                {cloture.caissier_nom || 'Caissier non identifié'}
                              </Text>
                              <View style={[styles.ecartPosBadge, {
                                backgroundColor: cloture.ecartGlobal == null ? colors.inputBg
                                  : manquant ? '#FCEBEB' : '#EAF3DE',
                              }]}>
                                <Text style={[styles.ecartPosBadgeTxt, { color: couleur }]}>
                                  Écart global · {cloture.ecartGlobalTexte}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.ecartPosEspeces}>
                              Écart espèces · {cloture.ecartEspecesTexte}
                            </Text>
                            {cloture.explication_ecart ? (
                              <Text style={styles.ecartPosExplication}>{cloture.explication_ecart}</Text>
                            ) : null}
                            {aEcartEspeces && (
                              <View style={styles.ecartPosDecision}>
                                {statutCfg ? (
                                  <>
                                    <View style={[styles.machineStatutBadge, statutCfg.box]}>
                                      <Text style={[styles.machineStatutTxt, { color: statutCfg.txt }]}>
                                        {statutCfg.label}{decision.restant > 0 ? ` · reste ${fmt(decision.restant)}` : ''}
                                      </Text>
                                    </View>
                                    {peutAnnulerDecisionMachine && (
                                      <TouchableOpacity
                                        style={[styles.machineRetourBtn, retourSaving && { opacity: 0.5 }]}
                                        onPress={() => confirmerRetourDecisionPOS(cloture, decision)}
                                        disabled={retourSaving || statuantMachine}
                                      >
                                        <Text style={styles.machineRetourTxt}>↩️ Revenir sur cette décision</Text>
                                      </TouchableOpacity>
                                    )}
                                  </>
                                ) : (
                                  <Text style={styles.machineDecisionHint}>Décision sur l’explication du caissier :</Text>
                                )}
                                {decision.restant > 0 && !decision.statut && (
                                  <View style={styles.machineBtnRow}>
                                    <TouchableOpacity
                                      style={[styles.machineBtn, styles.machineBtnJustifier, (statuantMachine || retourSaving) && { opacity: 0.5 }]}
                                      onPress={() => ouvrirDecisionCloturePOS(cloture, 'sans_fond')}
                                      disabled={statuantMachine || retourSaving}
                                    >
                                      <Text style={styles.machineBtnTxt}>✔️ Justifier</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[styles.machineBtn, styles.machineBtnRefuser, (statuantMachine || retourSaving) && { opacity: 0.5 }]}
                                      onPress={() => confirmerRefusCloturePOS(cloture)}
                                      disabled={statuantMachine || retourSaving}
                                    >
                                      <Text style={styles.machineBtnTxt}>❌ Refuser</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={[styles.machineBtn, styles.machineBtnAnnuler, (statuantMachine || retourSaving) && { opacity: 0.5 }]}
                                      onPress={() => ouvrirDecisionCloturePOS(cloture, 'fond')}
                                      disabled={statuantMachine || retourSaving}
                                    >
                                      <Text style={styles.machineBtnTxt}>🚫 Annuler</Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                            )}
                          </View>
                        )
                      })}
                      <View style={styles.ecartPosTotal}>
                        <Text style={styles.ecartPosTotalLabel}>Écart global</Text>
                        <Text style={[styles.ecartPosTotalValeur, {
                          color: resume.total == null ? colors.textMuted
                            : resume.total < 0 ? '#A32D2D'
                            : resume.total > 0 ? '#3B6D11' : colors.textMuted,
                        }]}>
                          {resume.totalTexte}
                        </Text>
                      </View>
                      {resume.indisponibles > 0 && (
                        <Text style={styles.ecartPosIndisponible}>
                          {resume.indisponibles} clôture
                          {resume.indisponibles > 1 ? 's historiques exclues' : ' historique exclue'} du total : rapport Z non disponible.
                        </Text>
                      )}
                    </View>
                  </View>
                )
              })()}
              </>)}

              {ongletFiche === 'equipe' && (<>
{/* ══════════════════════════════════════
                  3. SHIFTS CAISSIERS
                  Détail opérationnel immédiatement après les clôtures POS.
                  Les photos ne sont plus demandées au POS.
              ══════════════════════════════════════ */}
              {detailPoint.shifts.length > 0 && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.sectionTitre}>Shifts caissiers ({detailPoint.shifts.length})</Text>
                  {detailPoint.shifts.map((shift, i) => (
                    <View key={shift.id} style={styles.shiftCard}>
                      <View style={styles.shiftHeader}>
                        <View style={styles.shiftNumBox}>
                          <Text style={styles.shiftNumTxt}>S{i + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.shiftHeures}>⏰ {shift.heure_debut} → {shift.heure_fin}</Text>
                          {shift.caissier_nom && <Text style={styles.shiftCaissier}>👤 {shift.caissier_nom}</Text>}
                        </View>
                        <Text style={styles.shiftVente}>{fmt(shift.vente_shift || 0)}</Text>
                      </View>
                      <View style={styles.shiftDonnees}>
                        {[
                          { label: 'Dépenses', val: shift.depenses },
                          { label: 'Fournisseurs', val: shift.fournisseurs },
                          { label: 'KDO', val: shift.kdo },
                          { label: 'Retour', val: shift.retour },
                          { label: 'Yango CSE', val: shift.yango_cse },
                          { label: 'Glovo CSE', val: shift.glovo_cse },
                          { label: 'Wave', val: shift.wave },
                          { label: 'Djamo', val: shift.djamo },
                          { label: 'Orange Money', val: shift.om },
                          { label: 'Espèces', val: shift.espece },
                        ].filter(r => (r.val || 0) > 0).map((r, j) => (
                          <View key={j} style={styles.shiftRow}>
                            <Text style={styles.shiftLabel}>{r.label}</Text>
                            <Text style={styles.shiftVal}>{fmt(r.val)}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              )}
              </>)}

              {ongletFiche === 'depenses' && (<>
{/* ══════════════════════════════════════
                  4. DÉDUCTIONS GÉRANT
              ══════════════════════════════════════ */}
              {(() => {
                // transactions du point gérant (facture/paye validées via fournisseurs.js)
                const txGerant = detailPoint.fournisseurs.filter(f => f.saisi_par === 'gerant')
                // déductions caisse gérant : draft_gerant en priorité (source fiable avec vrais montants + photo)
                const draftFourn = pointSelectionne?.draft_gerant?.fournisseurs || {}
                const draftEntries = Object.entries(draftFourn)
                  .filter(([_, d]) => (parseFloat(d?.paye) || 0) > 0 || (parseFloat(d?.montant_facture) || 0) > 0)
                  .map(([id, d]) => {
                    const creditV = parseFloat(d.credit_veille) || 0
                    const fact = parseFloat(d.montant_facture) || 0
                    const pay = parseFloat(d.paye) || 0
                    return {
                      fournisseur_id: id,
                      fournisseurs: { nom: d.nom || 'Fournisseur' },
                      facture: fact,
                      paye: pay,
                      reste: creditV + fact - pay,
                      photo_url: d.photoUri || null,
                      caissier_nom: 'Gérant',
                    }
                  })
                // IDs de tous les fournisseurs déjà dans transactions_fournisseurs (gérant + caissier)
                const allTxIds = new Set(detailPoint.fournisseurs.map(f => f.fournisseur_id))
                const draftIds = new Set(draftEntries.map(e => e.fournisseur_id))
                // histoExtra = dernier recours : uniquement si absent du draft ET absent des transactions (évite les doublons inter-sections)
                const histoDeductionGerant = detailPoint.historiquesFournisseurs.filter(h => h.source === 'deduction_gerant')
                const histoExtra = histoDeductionGerant.filter(h => !draftIds.has(h.fournisseur_id) && !allTxIds.has(h.fournisseur_id))
                // txGerant filtré : on exclut les fournisseurs déjà dans le draft
                const txGerantFiltered = txGerant.filter(f => !draftIds.has(f.fournisseur_id))
                const fourGerant = [...txGerantFiltered, ...draftEntries, ...histoExtra]
                const depGerant = detailPoint.depenses.filter(d => d.saisi_par === 'gerant')
                const totalFourGerant = fourGerant.reduce((s, f) => s + (f.paye || 0), 0)
                const totalDepGerant = depGerant.reduce((s, d) => s + (d.montant || 0), 0)
                const totalGerant = totalFourGerant + totalDepGerant
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>Déductions Gérant</Text>

                    {/* Fournisseurs gérant */}
                    <Text style={styles.listSubTitre}>💼 Fournisseurs</Text>
                    {fourGerant.length === 0 ? (
                      <View style={styles.emptySection}>
                        <Text style={styles.emptySectionTxt}>Aucune dépense enregistrée</Text>
                      </View>
                    ) : (
                      <View style={[styles.listCard, { marginBottom: 8 }]}>
                        {fourGerant.map((f, i) => {
                          const reste = f.nouveau_credit ?? f.reste ?? 0
                          return (
                            <View key={i} style={[styles.listRow, i === fourGerant.length - 1 && { borderBottomWidth: 0 }]}>
                              <View style={styles.listLeft}>
                                <Text style={styles.listLabel}>{f.fournisseurs?.nom || 'Fournisseur'}</Text>
                                <Text style={styles.listSub}>
                                  Facture: {fmt(f.facture || 0)} — Payé: {fmt(f.paye || 0)}
                                </Text>
                                {reste > 0 && <Text style={[styles.listSub, { color: '#A32D2D' }]}>Reste dû: {fmt(reste)}</Text>}
                                <LigneCorrigerFacture f={f} />
                              </View>
                              <View style={styles.listRight}>
                                <View style={{ alignItems: 'flex-end' }}>
                                  <Text style={[styles.listVal, { color: (f.paye || 0) > 0 ? '#3B6D11' : colors.textMuted }]}>{fmt(f.paye || 0)}</Text>
                                  <Text style={styles.listAuteur}>{f.caissier_nom || 'Gérant'}</Text>
                                </View>
                                {f.photo_url ? (
                                  <TouchableOpacity onPress={() => voirPhoto(f.photo_url, f.fournisseurs?.nom)}>
                                    <PhotoJustificatif uri={f.photo_url} style={styles.miniThumb} compact />
                                  </TouchableOpacity>
                                ) : (
                                  <View style={styles.photoAbsenteThumb}>
                                    <Text style={styles.photoAbsenteThumbTxt}>📷</Text>
                                  </View>
                                )}
                              </View>
                            </View>
                          )
                        })}
                        <View style={styles.listTotalRow}>
                          <Text style={styles.listTotalLabel}>Sous-total fournisseurs</Text>
                          <Text style={[styles.listTotalVal, { color: '#A32D2D' }]}>{fmt(totalFourGerant)}</Text>
                        </View>
                      </View>
                    )}

                    {/* Dépenses gérant (marché, etc.) */}
                    <Text style={styles.listSubTitre}>🛒 Marché & Autres Dépenses</Text>
                    {depGerant.length === 0 ? (
                      <View style={styles.emptySection}>
                        <Text style={styles.emptySectionTxt}>Aucune dépense enregistrée</Text>
                      </View>
                    ) : (
                      <View style={[styles.listCard, { marginBottom: 8 }]}>
                        {depGerant.map((d, i) => (
                          <View key={i} style={[styles.listRow, i === depGerant.length - 1 && { borderBottomWidth: 0 }]}>
                            <View style={styles.listLeft}>
                              <Text style={styles.listLabel}>{d.libelle || 'Sans nom'}</Text>
                              <Text style={styles.listSub}>{d.categorie}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={[styles.listVal, { color: '#A32D2D' }]}>{fmt(d.montant || 0)}</Text>
                              <Text style={styles.listAuteur}>{d.caissier_nom || 'Gérant'}</Text>
                            </View>
                          </View>
                        ))}
                        <View style={styles.listTotalRow}>
                          <Text style={styles.listTotalLabel}>Sous-total dépenses</Text>
                          <Text style={[styles.listTotalVal, { color: '#A32D2D' }]}>{fmt(totalDepGerant)}</Text>
                        </View>
                      </View>
                    )}

                    {/* Total général gérant */}
                    {totalGerant > 0 && (
                      <View style={[styles.listCard, { backgroundColor: '#FAECE7', borderColor: '#F09595' }]}>
                        <View style={[styles.listRow, { borderBottomWidth: 0, paddingVertical: 6 }]}>
                          <Text style={[styles.listTotalLabel, { color: '#993C1D', fontSize: 13 }]}>💳 TOTAL DÉDUCTIONS GÉRANT</Text>
                          <Text style={[styles.listTotalVal, { color: '#A32D2D', fontSize: 16 }]}>{fmt(totalGerant)}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                )
              })()}

              {/* ══════════════════════════════════════
                  5. FOURNISSEURS CAISSIERS
              ══════════════════════════════════════ */}
              {(() => {
                // transactions_fournisseurs = source de vérité permanente pour les caissiers
                const fourCaissier = detailPoint.fournisseurs.filter(f => f.saisi_par !== 'gerant')
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>Fournisseurs caissiers ({fourCaissier.length})</Text>
                    {fourCaissier.length === 0 ? (
                      <View style={styles.emptySection}>
                        <Text style={styles.emptySectionTxt}>Aucune donnée enregistrée</Text>
                      </View>
                    ) : (
                      <View style={styles.listCard}>
                        {fourCaissier.map((f, i) => {
                          const reste = f.nouveau_credit ?? f.reste ?? 0
                          return (
                            <View key={i} style={[styles.listRow, i === fourCaissier.length - 1 && { borderBottomWidth: 0 }]}>
                              <View style={styles.listLeft}>
                                <Text style={styles.listLabel}>{f.fournisseurs?.nom || 'Fournisseur'}</Text>
                                <Text style={styles.listSub}>
                                  Facture: {fmt(f.facture || 0)} — Payé: {fmt(f.paye || 0)}
                                </Text>
                                {reste > 0 && (
                                  <Text style={[styles.listSub, { color: '#A32D2D' }]}>Reste: {fmt(reste)}</Text>
                                )}
                                {detailPoint.invParFournisseur[f.fournisseur_id]?.length > 0 && (
                                  <Text style={[styles.listSub, { color: '#3B6D11', marginTop: 2 }]}>
                                    📦 {detailPoint.invParFournisseur[f.fournisseur_id].map(l => `${l.produit_nom} — ${l.entrees}`).join(' / ')}
                                  </Text>
                                )}
                                <LigneCorrigerFacture f={f} />
                              </View>
                              <View style={styles.listRight}>
                                <View style={{ alignItems: 'flex-end' }}>
                                  <Text style={[styles.listVal, { color: reste > 0 ? '#A32D2D' : '#3B6D11' }]}>
                                    {fmt(f.paye || 0)}
                                  </Text>
                                  <Text style={styles.listAuteur}>{f.caissier_nom || 'Caissier'}</Text>
                                </View>
                                {f.photo_url ? (
                                  <TouchableOpacity onPress={() => voirPhoto(f.photo_url, f.fournisseurs?.nom)}>
                                    <PhotoJustificatif uri={f.photo_url} style={styles.miniThumb} compact />
                                  </TouchableOpacity>
                                ) : (
                                  <View style={styles.photoAbsenteThumb}>
                                    <Text style={styles.photoAbsenteThumbTxt}>📷</Text>
                                  </View>
                                )}
                              </View>
                            </View>
                          )
                        })}
                        <View style={styles.listTotalRow}>
                          <Text style={styles.listTotalLabel}>Total payé</Text>
                          <Text style={styles.listTotalVal}>{fmt(fourCaissier.reduce((s, f) => s + (f.paye || 0), 0))}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                )
              })()}

              {/* ══════════════════════════════════════
                  4.5 DÉPENSES CAISSIERS
              ══════════════════════════════════════ */}
              {(() => {
                const depCaissier = detailPoint.depenses.filter(d => d.saisi_par !== 'gerant')
                if (depCaissier.length === 0) return null
                const total = depCaissier.reduce((s, d) => s + (d.montant || 0), 0)
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>Dépenses caissiers ({depCaissier.length})</Text>
                    <View style={styles.listCard}>
                      {depCaissier.map((d, i) => (
                        <View key={i} style={[styles.listRow, i === depCaissier.length - 1 && { borderBottomWidth: 0 }]}>
                          <View style={styles.listLeft}>
                            <Text style={styles.listLabel}>{d.libelle || 'Sans nom'}</Text>
                            <Text style={styles.listSub}>{d.categorie}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[styles.listVal, { color: '#A32D2D' }]}>{fmt(d.montant || 0)}</Text>
                            <Text style={styles.listAuteur}>{d.caissier_nom || 'Caissier'}</Text>
                          </View>
                        </View>
                      ))}
                      <View style={styles.listTotalRow}>
                        <Text style={styles.listTotalLabel}>Total dépenses caissiers</Text>
                        <Text style={[styles.listTotalVal, { color: '#A32D2D' }]}>{fmt(total)}</Text>
                      </View>
                    </View>
                  </View>
                )
              })()}
              </>)}

              {ongletFiche === 'stock' && (<>
{/* ══════════════════════════════════════
                  6. ENTRÉES DU JOUR
              ══════════════════════════════════════ */}
              {(() => {
                const entreesPOS = detailPoint.entreesVerification
                if (entreesPOS?.source === 'POS') {
                  return (
                    <View style={{ marginBottom: 14 }}>
                      <View style={styles.entreeSectionHeader}>
                        <Text style={styles.sectionTitre}>Entrées du jour ({entreesPOS.nbEntrees})</Text>
                        <View style={styles.entreeSourceBadge}>
                          <Text style={styles.entreeSourceBadgeTxt}>Source POS</Text>
                        </View>
                      </View>
                      {entreesPOS.groupes.map(groupe => (
                        <View key={groupe.fournisseur} style={styles.entreeFournCard}>
                          <Text style={[styles.entreeFournNom, { marginBottom: 6 }]}>🏭 {groupe.fournisseur}</Text>
                          {groupe.produits.map(produit => (
                            <View
                              key={`${produit.nom}|${produit.auteur}|${produit.shift}`}
                              style={styles.entreeProdRow}
                            >
                              <View style={{ flex: 1, paddingRight: 10 }}>
                                <Text style={styles.entreeProdNom} numberOfLines={1}>{produit.nom}</Text>
                                <Text style={styles.entreeProdMeta} numberOfLines={1}>
                                  👤 {produit.auteur}{produit.shift ? ` · ${produit.shift}` : ''}
                                </Text>
                              </View>
                              <Text style={styles.entreeProdQte}>
                                +{Number(produit.quantite).toLocaleString('fr-FR')}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ))}
                    </View>
                  )
                }

                // Repli historique : anciennes lignes `inventaires`.
                const entreesMap = {}
                detailPoint.invShifts.forEach(shift => {
                  ;(shift.lignes || []).forEach(l => {
                    if ((l.entrees || 0) > 0) {
                      entreesMap[l.produit_nom] = (entreesMap[l.produit_nom] || 0) + l.entrees
                    }
                  })
                })
                const entreesStock = Object.entries(entreesMap)
                  .map(([nom, qte]) => ({ nom, qte }))
                  .sort((a, b) => a.nom.localeCompare(b.nom))

                // Fournisseurs avec facture > 0
                const fournFacture = detailPoint.fournisseurs.filter(f => (f.facture || 0) > 0)
                // Fournisseurs avec entrées inventaire liées (ancien format)
                const fournEntrees = Object.entries(detailPoint.invParFournisseur)

                if (entreesStock.length === 0 && fournFacture.length === 0 && fournEntrees.length === 0) return null

                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>Entrées du jour</Text>

                    {/* Fournisseurs avec entrées inventaire liées (ancien format) */}
                    {fournEntrees.map(([fournId, lignes]) => {
                      const tx = detailPoint.fournisseurs.find(f => f.fournisseur_id === fournId)
                      const nom = lignes[0]?.fournisseurs?.nom || tx?.fournisseurs?.nom || 'Fournisseur'
                      return (
                        <View key={fournId} style={styles.entreeFournCard}>
                          <View style={styles.entreeFournHeader}>
                            <Text style={styles.entreeFournNom}>🏭 {nom}</Text>
                            {tx && (tx.facture || 0) > 0 && (
                              <Text style={styles.entreeFournFacture}>📄 {fmt(tx.facture)}</Text>
                            )}
                          </View>
                          {lignes.map((l, i) => (
                            <View key={i} style={styles.entreeProdRow}>
                              <Text style={styles.entreeProdNom}>{l.produit_nom}</Text>
                              <Text style={styles.entreeProdQte}>+{l.entrees}</Text>
                            </View>
                          ))}
                        </View>
                      )
                    })}

                    {/* Fournisseurs avec facture mais sans entrées inventaire liées */}
                    {fournFacture
                      .filter(f => !detailPoint.invParFournisseur[f.fournisseur_id])
                      .map((f, i) => (
                        <View key={f.id || i} style={styles.entreeFournCard}>
                          <View style={styles.entreeFournHeader}>
                            <Text style={styles.entreeFournNom}>🏭 {f.fournisseurs?.nom || 'Fournisseur'}</Text>
                            <Text style={styles.entreeFournFacture}>📄 {fmt(f.facture)}</Text>
                          </View>
                          <Text style={[styles.entreeProdNom, { color: colors.textMuted, fontStyle: 'italic' }]}>
                            Entrées à compléter dans l'inventaire
                          </Text>
                        </View>
                      ))
                    }

                    {/* Entrées historiques non rattachées à un fournisseur */}
                    {entreesStock.length > 0 && (
                      <View style={styles.entreeFournCard}>
                        <Text style={[styles.entreeFournNom, { marginBottom: 8 }]}>📦 Entrées de stock (inventaire)</Text>
                        {entreesStock.map((e, i) => (
                          <View key={i} style={styles.entreeProdRow}>
                            <Text style={styles.entreeProdNom}>{e.nom}</Text>
                            <Text style={styles.entreeProdQte}>+{e.qte}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )
              })()}
              </>)}

              {ongletFiche === 'equipe' && (<>
{/* ══════════════════════════════════════
                  7. PRÉSENCES & PAIES
              ══════════════════════════════════════ */}
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.sectionTitre}>Présences & Paies ({detailPoint.presences.length})</Text>
                {detailPoint.presences.length === 0 ? (
                  <View style={styles.emptySection}>
                    <Text style={styles.emptySectionTxt}>Aucune donnée enregistrée</Text>
                  </View>
                ) : (
                  <View style={styles.listCard}>
                    {detailPoint.presences.map((p, i) => {
                      const badge = statutPresenceBadge(p.statut)
                      return (
                        <View key={i} style={[styles.listRow, i === detailPoint.presences.length - 1 && { borderBottomWidth: 0 }]}>
                          <View style={styles.listLeft}>
                            <Text style={styles.listLabel}>{p.travailleur_nom}</Text>
                            {p.shift_nom && (
                              <Text style={styles.listSub}>⏰ {p.shift_nom}{p.heure_debut ? ` · ${p.heure_debut}→${p.heure_fin}` : ''}</Text>
                            )}
                            <View style={[styles.statutPresenceBadge, { backgroundColor: badge.bg }]}>
                              <Text style={[styles.statutPresenceTxt, { color: badge.text }]}>
                                {badge.icon} {p.statut}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.listVal}>{p.paye > 0 ? fmt(p.paye) : '—'}</Text>
                        </View>
                      )
                    })}
                    <View style={styles.listTotalRow}>
                      <Text style={styles.listTotalLabel}>Total paie</Text>
                      <Text style={styles.listTotalVal}>{fmt(detailPoint.presences.reduce((s, p) => s + (p.paye || 0), 0))}</Text>
                    </View>
                  </View>
                )}
              </View>
              </>)}

              {ongletFiche === 'stock' && (<>
{/* ══════════════════════════════════════
                  8. INVENTAIRE (comptages, écarts, déductions)
              ══════════════════════════════════════ */}
              {loadingInventaire && !detailInventaire ? (
                <View style={styles.emptySection}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.emptySectionTxt}>Chargement de l'inventaire...</Text>
                </View>
              ) : !detailInventaire ? (
                <View style={styles.emptySection}>
                  <Text style={styles.emptySectionTxt}>Aucun inventaire enregistré</Text>
                </View>
              ) : (() => {
            const { shiftsNouveauFormat, shiftsAncienFormat, useNouveauFormat,
              entreesParFournisseur = [], nbEntrees = 0 } = detailInventaire
            const peutVoirEcarts = roleActif === 'manager' || roleActif === 'directeur'

            // ─── Calcul des lignes avec écart ───────────────────────
            const toutesLignesEcart = []
            let totalProduitsMesures = 0

            if (useNouveauFormat) {
              shiftsNouveauFormat.forEach(shift => {
                const lignesMesurees = shift.lignes.filter(l => l.stock_reel != null)
                totalProduitsMesures += lignesMesurees.length
                lignesMesurees.forEach(l => {
                  const ecart = l.ecart ?? 0
                  if (Math.abs(ecart) > 0.01) {
                    const nombreExplique = parseFloat(l.nombre_explique ?? 0)
                    const diffInexpliquee = Math.max(0, Math.abs(ecart) - nombreExplique)
                    const prix = getPrixProduit(l.produit_id)
                    const montantDeduit = l.montant_deduit != null ? l.montant_deduit : diffInexpliquee * prix
                    toutesLignesEcart.push({
                      ...l, ecart, nombreExplique, diffInexpliquee, prix, montantDeduit,
                      inventaireId: shift.id,
                      caissierNom: shift.caissierNom, shiftLabel: shift.shiftLabel,
                      heureDebut: shift.heure_debut, heureFin: shift.heure_fin,
                    })
                  }
                })
              })
            } else {
              shiftsAncienFormat.filter(s => s.numero > 0).forEach(shift => {
                shift.lignes.forEach(l => {
                  const stockTheo = (l.stock_initial || 0) + (l.entrees || 0) - (l.sorties || 0)
                  const ecartVal = l.ecart ?? (l.stock_final - stockTheo)
                  totalProduitsMesures++
                  if (Math.abs(ecartVal) > 0.01) {
                    const nombreExplique = parseFloat(l.nombre_a_expliquer || 0)
                    const diffInexpliquee = Math.max(0, Math.abs(ecartVal) - nombreExplique)
                    const prix = getPrixProduit(l.produit_id)
                    const montantDeduit = diffInexpliquee * prix
                    toutesLignesEcart.push({
                      produit_nom: l.produit_nom, produit_id: l.produit_id,
                      stock_initial: l.stock_initial, entrees: l.entrees,
                      sorties: l.sorties, stock_reel: l.stock_final,
                      ecart: ecartVal, nombreExplique, explication: l.explication_ecart,
                      diffInexpliquee, prix, montantDeduit,
                      caissierNom: null, shiftLabel: shift.nom || `Shift ${shift.numero}`,
                      heureDebut: shift.heure_debut, heureFin: shift.heure_fin,
                    })
                  }
                })
              })
            }

            const aucunInventaire = useNouveauFormat
              ? shiftsNouveauFormat.every(s => s.lignes.length === 0)
              : shiftsAncienFormat.filter(s => s.numero > 0).length === 0

            if (aucunInventaire) return (
              <View style={styles.emptySection}>
                <Text style={styles.emptySectionTxt}>Aucun inventaire enregistré</Text>
              </View>
            )

            const nbAvecEcart = toutesLignesEcart.length
            const nbSansEcart = Math.max(0, totalProduitsMesures - nbAvecEcart)
            // Manquants et surplus comptés SÉPARÉMENT (2026-08-24). Les mélanger
            // sous « avec écart » faisait lire « 7 non expliqués » comme
            // « 7 produits manquants » alors que les 7 étaient des surplus —
            // lesquels ne donnent jamais lieu à retenue.
            const lignesManque = toutesLignesEcart.filter(l => l.ecart < 0)
            const lignesSurplus = toutesLignesEcart.filter(l => l.ecart > 0)
            const nbExpliques = lignesManque.filter(l => l.diffInexpliquee <= 0.01).length
            const nbNonExpliques = lignesManque.length - nbExpliques
            const nbEnAttente = lignesManque.filter(l => l.explication_statut === 'en_attente').length
            const totalDeduit = toutesLignesEcart.reduce((s, l) => s + (l.montantDeduit || 0), 0)

            return (
                  <View>

                {/* ══ SECTION 1 : Résumé global ════════════════════════ */}
                <Text style={styles.sectionTitre}>Résumé global</Text>
                <View style={styles.invResumeCard}>
                  <View style={styles.invResumeRow}>
                    <View style={[styles.invResumeBadge, { backgroundColor: '#EAF3DE' }]}>
                      <Text style={[styles.invResumeBadgeNum, { color: '#3B6D11' }]}>{nbSansEcart}</Text>
                      <Text style={[styles.invResumeBadgeLbl, { color: '#3B6D11' }]}>✅ Produits OK</Text>
                    </View>
                    <View style={[styles.invResumeBadge, { backgroundColor: lignesManque.length > 0 ? '#FAEEDA' : '#EAF3DE' }]}>
                      <Text style={[styles.invResumeBadgeNum, { color: lignesManque.length > 0 ? '#854F0B' : '#3B6D11' }]}>{lignesManque.length}</Text>
                      <Text style={[styles.invResumeBadgeLbl, { color: lignesManque.length > 0 ? '#854F0B' : '#3B6D11' }]}>⚠️ Manquants</Text>
                    </View>
                  </View>
                  {lignesSurplus.length > 0 && (
                    <View style={[styles.invResumeRow, { marginTop: 8 }]}>
                      <View style={[styles.invResumeBadge, { backgroundColor: '#EDEDF2' }]}>
                        <Text style={[styles.invResumeBadgeNum, { color: '#5B5B6B' }]}>{lignesSurplus.length}</Text>
                        <Text style={[styles.invResumeBadgeLbl, { color: '#5B5B6B' }]}>📦 Surplus — aucune retenue</Text>
                      </View>
                    </View>
                  )}
                  {lignesManque.length > 0 && (
                    <View style={[styles.invResumeRow, { marginTop: 8 }]}>
                      <View style={[styles.invResumeBadge, { backgroundColor: '#E6F1FB' }]}>
                        <Text style={[styles.invResumeBadgeNum, { color: '#185FA5' }]}>{nbExpliques}</Text>
                        <Text style={[styles.invResumeBadgeLbl, { color: '#185FA5' }]}>📋 Expliqués</Text>
                      </View>
                      <View style={[styles.invResumeBadge, { backgroundColor: nbNonExpliques > 0 ? '#FCEBEB' : '#EAF3DE' }]}>
                        <Text style={[styles.invResumeBadgeNum, { color: nbNonExpliques > 0 ? '#A32D2D' : '#3B6D11' }]}>{nbNonExpliques}</Text>
                        <Text style={[styles.invResumeBadgeLbl, { color: nbNonExpliques > 0 ? '#A32D2D' : '#3B6D11' }]}>
                          {nbNonExpliques > 0 ? '❌ Manquants non expliqués' : '✅ Tous expliqués'}
                        </Text>
                      </View>
                    </View>
                  )}
                  {peutVoirEcarts && (
                    <View style={[styles.invResumeTotalBox, { backgroundColor: totalDeduit > 0 ? '#FCEBEB' : '#EAF3DE' }]}>
                      <Text style={[styles.invResumeTotalLabel, { color: totalDeduit > 0 ? '#A32D2D' : '#3B6D11' }]}>
                        💰 Montant total à déduire
                      </Text>
                      <Text style={[styles.invResumeTotalVal, { color: totalDeduit > 0 ? '#A32D2D' : '#3B6D11' }]}>
                        {fmt(totalDeduit)}
                      </Text>
                    </View>
                  )}
                  {peutVoirEcarts && nbEnAttente > 0 && (
                    <Text style={{ marginTop: 6, fontSize: 12, fontWeight: '600', color: '#854F0B', textAlign: 'center' }}>
                      ⏳ Montant non définitif : {nbEnAttente} explication{nbEnAttente > 1 ? 's' : ''} en attente de votre vérification
                    </Text>
                  )}
                </View>

                {/* ══ Entrées de produits reçues, par fournisseur ═══════
                    Sur un site POS elles sont déjà dans « Entrées du jour ». */}
                {entreesParFournisseur.length > 0 && detailPoint.entreesVerification?.source !== 'POS' && (
                  <>
                    <Text style={styles.sectionTitre}>Entrées de produits ({nbEntrees})</Text>
                    <View style={styles.invResumeCard}>
                      {entreesParFournisseur.map((f, i) => (
                        <View
                          key={f.fournisseur}
                          style={[styles.invEntreeFourn, i > 0 && styles.invEntreeFournSep]}
                        >
                          <Text style={styles.invEntreeFournNom}>🧾 {f.fournisseur}</Text>
                          {f.produits.map(p => (
                            <View key={`${p.nom}|${p.auteur}`} style={styles.invEntreeLigne}>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.invEntreeProduit} numberOfLines={1}>{p.nom}</Text>
                                <Text style={styles.invEntreeAuteur} numberOfLines={1}>
                                  👤 {p.auteur}{p.shift ? ` · ${p.shift}` : ''}
                                </Text>
                              </View>
                              <Text style={styles.invEntreeQte}>
                                +{Number(p.quantite).toLocaleString('fr-FR')}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ))}
                    </View>
                  </>
                )}

                {/* ══ Comptage du vérificateur → répartition ═══════════ */}
                {deducMigration && (
                  <View style={styles.deducAlerte}>
                    <Text style={styles.deducAlerteTxt}>
                      ⚠️ Script supabase_deductions_verification.sql non passé : les montants
                      issus des comptages ne sont pas enregistrés.
                    </Text>
                  </View>
                )}
                {Object.entries(repartition).map(([lot, parts]) => {
                  const ref = parts[0] || {}
                  const plafond = ref.montant_plafond ?? 0
                  const justif = Math.max(0, Math.min(plafond, Number(justifie[lot]) || 0))
                  const aRepartir = plafond - justif
                  const ctrl = repartitionValide(parts, aRepartir)
                  // Une décision prise reste modifiable : le bouton « Modifier »
                  // rouvre le comptage, rien n'est jamais définitif.
                  const tranche = ref.statut === 'repartie' || ref.statut === 'validee'
                  const fige = tranche && !rouverts[lot]
                  return (
                    <View key={lot}>
                      <Text style={styles.sectionTitre}>Comptage vérificateur — {fmt(plafond)} à répartir
                      </Text>

                      <View style={styles.invResumeCard}>
                        <Text style={styles.deducMeta}>
                          {ref.nb_produits} produit(s) en écart : {ref.produits_resume || '—'}
                        </Text>
                        {ref.montant_ecart > plafond && (
                          <View style={styles.deducAlerte}>
                            <Text style={styles.deducAlerteTxt}>
                              ⚖️ Écart réel {fmt(ref.montant_ecart)} — plafond de {fmt(PLAFOND_COMPTAGE)}
                              {' '}par comptage appliqué.
                            </Text>
                          </View>
                        )}
                        {ref.explication ? (
                          <Text style={styles.deducExpl}>💬 {ref.explication}</Text>
                        ) : (
                          <Text style={styles.deducExplVide}>Aucune explication donnée au vérificateur</Text>
                        )}

                        {!fige && peutVoirEcarts && (
                          <View style={styles.justifLigne}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.justifLbl}>✓ Montant justifié</Text>
                              <Text style={styles.justifAide}>
                                Part reconnue comme expliquée — elle ne sera déduite à personne.
                              </Text>
                            </View>
                            <TextInput
                              style={styles.repartInput}
                              value={String(justif)}
                              onChangeText={v => setJustifie(prev => ({
                                ...prev, [lot]: Math.max(0, parseInt(String(v).replace(/\D/g, ''), 10) || 0),
                              }))}
                              keyboardType="numeric"
                              selectTextOnFocus
                            />
                          </View>
                        )}

                        {aRepartir > 0 && parts.map((p, i) => (
                          <View key={`${lot}-${i}`} style={styles.repartLigne}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.repartNom}>
                                {p.beneficiaire_type === 'gerant' ? '🧑‍💼 ' : '👤 '}{p.caissier_nom}
                              </Text>
                              <Text style={styles.repartMeta}>
                                {p.shift_libelle || 'Gérant du restaurant'}
                                {p.role_dans_ecart === 'en_poste' ? ' · en poste'
                                  : p.role_dans_ecart === 'shift_precedent' ? ' · shift précédent' : ''}
                                {p.montant_propose ? ` · proposé ${fmt(p.montant_propose)}` : ''}
                              </Text>
                            </View>
                            {fige || !peutVoirEcarts ? (
                              <Text style={styles.deducMontant}>{fmt(p.montant)}</Text>
                            ) : (
                              <>
                                <TextInput
                                  style={styles.repartInput}
                                  value={String(p.montant ?? 0)}
                                  onChangeText={v => majMontant(lot, i, v)}
                                  keyboardType="numeric"
                                  selectTextOnFocus
                                />
                                <TouchableOpacity onPress={() => retirerPart(lot, i)} style={styles.repartRetirer}>
                                  <Text style={styles.repartRetirerTxt}>✕</Text>
                                </TouchableOpacity>
                              </>
                            )}
                          </View>
                        ))}

                        {!fige && peutVoirEcarts && (
                          <>
                            <View style={styles.repartTotalBox}>
                              <Text style={styles.repartTotalLbl}>
                                {aRepartir > 0 ? 'À répartir' : 'Intégralement justifié'}
                              </Text>
                              <Text style={[styles.repartTotalVal, { color: ctrl.ok ? '#3B6D11' : '#A32D2D' }]}>
                                {aRepartir > 0
                                  ? `${fmt(ctrl.somme)} / ${fmt(aRepartir)}${ctrl.ok ? '  ✓' : ctrl.reste > 0 ? `  · reste ${fmt(ctrl.reste)}` : '  · dépassement'}`
                                  : 'rien à déduire  ✓'}
                              </Text>
                            </View>

                            <Text style={styles.repartAjoutTitre}>Ajouter une personne</Text>
                            <View style={styles.repartChips}>
                              {caissiersDuJour
                                .filter(c => !parts.some(p => p.caissier_id === c.caissier_id))
                                .map(c => (
                                  <TouchableOpacity
                                    key={c.caissier_id}
                                    style={styles.repartChip}
                                    onPress={() => ajouterPart(lot, { ...c, beneficiaire_type: 'caissier' })}
                                  >
                                    <Text style={styles.repartChipTxt}>+ {c.caissier_nom}</Text>
                                  </TouchableOpacity>
                                ))}
                              {!parts.some(p => p.beneficiaire_type === 'gerant') && (
                                <TouchableOpacity
                                  style={[styles.repartChip, styles.repartChipGerant]}
                                  onPress={() => ajouterPart(lot, {
                                    beneficiaire_type: 'gerant',
                                    caissier_id: null,
                                    caissier_nom: 'Gérant du restaurant',
                                    shift_libelle: null,
                                  })}
                                >
                                  <Text style={styles.repartChipGerantTxt}>+ 🧑‍💼 Gérant</Text>
                                </TouchableOpacity>
                              )}
                            </View>

                            <View style={styles.deducActions}>
                              <TouchableOpacity
                                style={[styles.deducBtn, styles.deducBtnValider]}
                                disabled={deducEnCours === lot}
                                onPress={() => setJustifie(prev => ({ ...prev, [lot]: plafond }))}
                              >
                                <Text style={styles.deducBtnValiderTxt}>Tout justifier</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.deducBtn, styles.deducBtnRefuser, !(ctrl.ok || aRepartir <= 0) && { opacity: 0.45 }]}
                                disabled={deducEnCours === lot || !(ctrl.ok || aRepartir <= 0)}
                                onPress={() => enregistrerRepartition(lot)}
                              >
                                <Text style={styles.deducBtnRefuserTxt}>✓ Confirmer</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        )}

                        {fige && (
                          <>
                            <Text style={[styles.deducStatut, { color: ref.statut === 'validee' ? '#185FA5' : '#A32D2D' }]}>
                              {ref.statut === 'validee' ? '✓ Intégralement justifié — rien à déduire' : '✓ Répartition confirmée'}
                              {Number(ref.montant_justifie) > 0 && ref.statut !== 'validee'
                                ? ` · ${fmt(ref.montant_justifie)} justifiés` : ''}
                              {ref.decide_par_nom ? ` · par ${ref.decide_par_nom}` : ''}
                            </Text>
                            {peutVoirEcarts && (
                              <TouchableOpacity
                                style={styles.deducModifier}
                                onPress={() => {
                                  setRouverts(prev => ({ ...prev, [lot]: true }))
                                  // Si tout avait été justifié, les parts sont à zéro :
                                  // on remet une répartition égale pour repartir d'une base.
                                  if (parts.every(x => !Number(x.montant))) {
                                    const base = Math.floor(plafond / parts.length)
                                    const reste = plafond - base * parts.length
                                    setJustifie(prev => ({ ...prev, [lot]: 0 }))
                                    setRepartition(prev => ({
                                      ...prev,
                                      [lot]: prev[lot].map((x, k) => ({ ...x, montant: base + (k < reste ? 1 : 0) })),
                                    }))
                                  }
                                }}
                              >
                                <Text style={styles.deducModifierTxt}>✎ Modifier cette décision</Text>
                              </TouchableOpacity>
                            )}
                          </>
                        )}
                      </View>
                    </View>
                  )
                })}

                {/* ══ SECTION 2 : Produits avec écarts (manager/directeur) ══ */}
                {peutVoirEcarts && nbAvecEcart > 0 && (
                  <>
                    <Text style={styles.sectionTitre}>Produits avec écarts ({nbAvecEcart})</Text>
                    {toutesLignesEcart.map((e, i) => {
                      const stockTheo = (e.stock_initial || 0) + (e.entrees || 0) - (e.sorties || 0)
                      const ecartExplique = e.diffInexpliquee <= 0.01
                      return (
                        <View key={i} style={[styles.invFicheCard, { borderColor: ecartExplique ? '#B8D4F5' : '#F09595' }]}>
                          <View style={styles.invFicheHeader}>
                            <Text style={styles.invFicheNom}>{e.produit_nom}</Text>
                            <View style={[styles.invFicheStatut, { backgroundColor: ecartExplique ? '#E6F1FB' : '#FCEBEB' }]}>
                              <Text style={[styles.invFicheStatutTxt, { color: ecartExplique ? '#185FA5' : '#A32D2D' }]}>
                                {ecartExplique ? '✅ Expliqué' : '❌ Non expliqué'}
                              </Text>
                            </View>
                          </View>

                          {[
                            { label: 'Stock théorique', val: stockTheo % 1 !== 0 ? stockTheo.toFixed(2) : String(stockTheo) },
                            { label: 'Stock réel constaté', val: e.stock_reel != null ? (e.stock_reel % 1 !== 0 ? e.stock_reel.toFixed(2) : String(e.stock_reel)) : '—' },
                            { label: 'Écart', val: `${e.ecart >= 0 ? '+' : ''}${e.ecart.toFixed(2)}`, color: e.ecart < 0 ? '#A32D2D' : '#EF9F27', bold: true },
                            { label: 'Nombre à expliquer', val: e.nombreExplique > 0 ? (e.nombreExplique % 1 !== 0 ? e.nombreExplique.toFixed(2) : String(e.nombreExplique)) : '—' },
                          ].map((r, j) => (
                            <View key={j} style={styles.ecartRow}>
                              <Text style={styles.ecartLabel}>{r.label}</Text>
                              <Text style={[styles.ecartVal, r.color && { color: r.color }, r.bold && { fontWeight: '700' }]}>{r.val}</Text>
                            </View>
                          ))}

                          {!!e.explication && (
                            <View style={styles.invFicheExplication}>
                              <Text style={styles.invFicheExplicationLabel}>💬 Explication</Text>
                              <Text style={styles.invFicheExplicationTxt}>"{e.explication}"</Text>
                            </View>
                          )}

                          <View style={[styles.ecartRow, { borderTopWidth: 1, borderTopColor: '#f0f0f0', marginTop: 4, paddingTop: 8 }]}>
                            <Text style={styles.ecartLabel}>Diff. inexpliquée</Text>
                            <Text style={[styles.ecartVal, { color: e.diffInexpliquee > 0.01 ? '#A32D2D' : '#3B6D11', fontWeight: '700' }]}>
                              {e.diffInexpliquee > 0.01 ? e.diffInexpliquee.toFixed(2) : '✅ 0'}
                            </Text>
                          </View>
                          <View style={styles.ecartRow}>
                            <Text style={styles.ecartLabel}>Prix unitaire</Text>
                            <Text style={styles.ecartVal}>{e.prix > 0 ? fmt(e.prix) : '—'}</Text>
                          </View>
                          <View style={[styles.ecartRow, { borderBottomWidth: 0, backgroundColor: e.montantDeduit > 0 ? '#FFF0F0' : '#F0FFF4', borderRadius: 6, paddingHorizontal: 8, marginTop: 2 }]}>
                            <Text style={[styles.ecartLabel, { fontWeight: '700' }]}>Montant à déduire</Text>
                            <Text style={[styles.ecartVal, { color: e.montantDeduit > 0 ? '#A32D2D' : '#3B6D11', fontWeight: '700', fontSize: 14 }]}>
                              {e.montantDeduit > 0 ? fmt(e.montantDeduit) : '0 FCFA ✅'}
                            </Text>
                          </View>

                          {e.explication_statut ? (
                            <View style={styles.decisionInvBox}>
                              {e.explication_statut === 'en_attente' ? (
                                <>
                                  <Text style={styles.decisionInvPending}>⏳ Explication en attente de votre décision</Text>
                                  {peutVoirEcarts && e.id && (
                                    <TouchableOpacity style={styles.decisionInvBtn} onPress={() => ouvrirDecisionInv(e)}>
                                      <Text style={styles.decisionInvBtnTxt}>⚖️ Valider / Refuser l'explication</Text>
                                    </TouchableOpacity>
                                  )}
                                </>
                              ) : e.explication_statut === 'validee' ? (
                                <>
                                  <Text style={[styles.decisionInvStatut, { color: '#3B6D11' }]}>
                                    ✅ Explication validée{e.quantite_acceptee != null ? ` · accepté ${e.quantite_acceptee}` : ''} · déduit {fmt(e.montantDeduit)}
                                  </Text>
                                  {peutVoirEcarts && e.id && (
                                    <TouchableOpacity onPress={() => ouvrirDecisionInv(e)}><Text style={styles.decisionInvModifier}>✏️ Modifier la décision</Text></TouchableOpacity>
                                  )}
                                </>
                              ) : (
                                <>
                                  <Text style={[styles.decisionInvStatut, { color: '#A32D2D' }]}>
                                    ❌ Explication refusée · déduction pleine {fmt(e.montantDeduit)}
                                  </Text>
                                  {peutVoirEcarts && e.id && (
                                    <TouchableOpacity onPress={() => ouvrirDecisionInv(e)}><Text style={styles.decisionInvModifier}>✏️ Modifier la décision</Text></TouchableOpacity>
                                  )}
                                </>
                              )}
                            </View>
                          ) : e.deduction_annulee ? (
                            <View style={styles.deducAnnuleeBadge}>
                              <Text style={styles.deducAnnuleeTxt}>
                                🚫 Déduction annulée{e.montant_deduit_annule > 0 ? ` (${fmt(e.montant_deduit_annule)})` : ''}
                              </Text>
                            </View>
                          ) : (e.montantDeduit > 0 && e.id && (
                            <TouchableOpacity
                              style={[styles.annulDeducBtn, annulDeducSaving === e.id && { opacity: 0.6 }]}
                              onPress={() => confirmerAnnulationDeduction(e)}
                              disabled={!!annulDeducSaving}
                            >
                              {annulDeducSaving === e.id
                                ? <ActivityIndicator color="#A32D2D" size="small" />
                                : <Text style={styles.annulDeducBtnTxt}>🚫 Annuler la déduction de ce produit</Text>}
                            </TouchableOpacity>
                          ))}

                          {(e.caissierNom || e.heureDebut) && (
                            <View style={styles.invFicheCaissier}>
                              {e.caissierNom && <Text style={styles.invFicheCaissierTxt}>👤 {e.caissierNom}</Text>}
                              {e.heureDebut && (
                                <Text style={styles.invFicheCaissierTxt}>⏰ {e.shiftLabel} · {e.heureDebut} → {e.heureFin}</Text>
                              )}
                            </View>
                          )}
                        </View>
                      )
                    })}
                  </>
                )}

                {/* ══ SECTION 3 : Bilan financier (manager/directeur) ══ */}
                {peutVoirEcarts && (
                  <>
                    <Text style={styles.sectionTitre}>Bilan financier</Text>
                    <View style={styles.invBilanCard}>
                      {toutesLignesEcart.filter(e => e.montantDeduit > 0).length === 0 ? (
                        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                          <Text style={{ fontSize: 14, color: '#3B6D11', fontWeight: '600' }}>✅ Aucune déduction à effectuer</Text>
                        </View>
                      ) : (
                        <>
                          {toutesLignesEcart.filter(e => e.montantDeduit > 0).map((e, i) => (
                            <View key={i} style={styles.invBilanRow}>
                              <Text style={styles.invBilanProduit}>{e.produit_nom}</Text>
                              <Text style={styles.invBilanMontant}>{fmt(e.montantDeduit)}</Text>
                            </View>
                          ))}
                          <View style={styles.invBilanSep} />
                          <View style={styles.invBilanTotalRow}>
                            <Text style={styles.invBilanTotalLabel}>Total à déduire</Text>
                            <Text style={styles.invBilanTotalVal}>{fmt(totalDeduit)}</Text>
                          </View>
                        </>
                      )}
                    </View>

                    {totalDeduit > 0 && (
                      <TouchableOpacity
                        style={[styles.pdfBtn, generatingEcartsPdf && { opacity: 0.6 }]}
                        onPress={() => telechargerPdfEcarts(toutesLignesEcart, totalDeduit)}
                        disabled={generatingEcartsPdf}
                      >
                        {generatingEcartsPdf
                          ? <><ActivityIndicator color={colors.primary} size="small" /><Text style={[styles.pdfBtnTxt, { marginLeft: 8 }]}>Génération en cours...</Text></>
                          : <><Text style={styles.pdfBtnTxt}>📄 Exporter le bilan en PDF</Text><Text style={styles.pdfBtnSub}>Rapport complet : écarts, explications et montants</Text></>
                        }
                      </TouchableOpacity>
                    )}
                  </>
                )}

                {/* ══ Détail par shift ══════════════════════════════════ */}
                <Text style={[styles.sectionTitre, { marginTop: 8 }]}>📦 Détail par shift</Text>
                {useNouveauFormat ? (
                  shiftsNouveauFormat.map((shift, si) => (
                    <View key={si} style={styles.invShiftCard}>
                      <View style={styles.invShiftHeader}>
                        <View style={styles.invShiftBadge}>
                          <Text style={styles.invShiftBadgeTxt}>S{si + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.invShiftNom}>{shift.shiftLabel}</Text>
                          {shift.heure_debut && <Text style={styles.invShiftHeure}>{shift.heure_debut} → {shift.heure_fin}</Text>}
                          {shift.caissierNom && <Text style={[styles.invShiftHeure, { color: colors.primary }]}>👤 {shift.caissierNom}</Text>}
                        </View>
                        <Text style={styles.invShiftCount}>{shift.lignes.filter(l => l.stock_reel != null).length} produit(s)</Text>
                      </View>
                      {shift.lignes.filter(l => l.stock_reel != null).map((ligne, li) => {
                        const ecart = ligne.ecart ?? 0
                        const hasEcart = Math.abs(ecart) > 0.01
                        return (
                          <View key={li} style={[styles.invLigneRow, hasEcart && styles.invLigneRowAlert]}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.invLigneNom, hasEcart && { color: '#A32D2D' }]}>{ligne.produit_nom}</Text>
                              <Text style={styles.invLigneSub}>
                                Init: {ligne.stock_initial ?? 0} | +{ligne.entrees ?? 0} | -{ligne.sorties ?? 0} | Réel: {ligne.stock_reel}
                              </Text>
                              {hasEcart && ligne.explication && (
                                <Text style={[styles.invLigneSub, { color: '#185FA5' }]}>"{ligne.explication}"</Text>
                              )}
                            </View>
                            <View style={[styles.invEcartBadge, { backgroundColor: hasEcart ? '#FCEBEB' : '#EAF3DE' }]}>
                              <Text style={[styles.invEcartTxt, { color: hasEcart ? '#A32D2D' : '#3B6D11' }]}>
                                {hasEcart
                                  ? (peutVoirEcarts ? (ecart >= 0 ? '+' : '') + ecart.toFixed(1) : '⚠️')
                                  : '✅'
                                }
                              </Text>
                            </View>
                          </View>
                        )
                      })}
                    </View>
                  ))
                ) : (
                  shiftsAncienFormat.filter(s => s.numero > 0).map((shift, si) => (
                    <View key={si} style={styles.invShiftCard}>
                      <View style={styles.invShiftHeader}>
                        <View style={styles.invShiftBadge}>
                          <Text style={styles.invShiftBadgeTxt}>{`S${shift.numero}`}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.invShiftNom}>{shift.nom || `Shift ${shift.numero}`}</Text>
                          {shift.heure_debut && <Text style={styles.invShiftHeure}>{shift.heure_debut} → {shift.heure_fin}</Text>}
                        </View>
                        <Text style={styles.invShiftCount}>{shift.lignes.length} produit(s)</Text>
                      </View>
                      {shift.lignes.map((ligne, li) => {
                        const stockTheo = (ligne.stock_initial || 0) + (ligne.entrees || 0) - (ligne.sorties || 0)
                        const ecart = ligne.ecart ?? (ligne.stock_final - stockTheo)
                        const hasEcart = Math.abs(ecart) > 0.01
                        return (
                          <View key={li} style={[styles.invLigneRow, hasEcart && styles.invLigneRowAlert]}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.invLigneNom, hasEcart && { color: '#A32D2D' }]}>{ligne.produit_nom}</Text>
                              <Text style={styles.invLigneSub}>
                                Init: {ligne.stock_initial} | Sorties: {ligne.sorties} | Final: {ligne.stock_final}
                              </Text>
                              {hasEcart && ligne.explication_ecart && (
                                <Text style={[styles.invLigneSub, { color: '#185FA5' }]}>"{ligne.explication_ecart}"</Text>
                              )}
                            </View>
                            <View style={[styles.invEcartBadge, { backgroundColor: hasEcart ? '#FCEBEB' : '#EAF3DE' }]}>
                              <Text style={[styles.invEcartTxt, { color: hasEcart ? '#A32D2D' : '#3B6D11' }]}>
                                {hasEcart
                                  ? (peutVoirEcarts ? (ecart >= 0 ? '+' : '') + ecart.toFixed(1) : '⚠️')
                                  : '✅'
                                }
                              </Text>
                            </View>
                          </View>
                        )
                      })}
                    </View>
                  ))
                )}
                  </View>
                )
              })()}
              </>)}

              {ongletFiche === 'photos' && (<>
              {/* Toutes les photos du point */}
              {(() => {
                const toutes = getToutesPhotos()
                if (!toutes.length) return null
                return (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.sectionTitre}>Toutes les photos ({toutes.length})</Text>
                    <View style={styles.grillePhotos}>
                      {toutes.map((ph, i) => (
                        <PhotoVignette key={`${ph.uri}-${i}`} uri={ph.uri} label={ph.label} onPress={() => ouvriGalerie(toutes, i)} />
                      ))}
                    </View>
                  </View>
                )
              })()}

{/* ══════════════════════════════════════
                  9. PHOTOS GÉNÉRALES (séquences)
              ══════════════════════════════════════ */}
              <View style={{ marginBottom: 14 }}>
                <Text style={styles.sectionTitre}>Photos générales</Text>
                {detailPoint.sequences.filter(s => s.photo_url).length === 0 ? (
                  <View style={styles.emptySection}>
                    <Text style={styles.emptySectionTxt}>Aucune photo enregistrée</Text>
                  </View>
                ) : (
                  <View style={styles.photosGrid}>
                    {detailPoint.sequences.filter(s => s.photo_url).map((s, i) => {
                      const toutes = getToutesPhotos()
                      const idx = toutes.findIndex(x => x.uri === s.photo_url)
                      return (
                        <PhotoVignette
                          key={i}
                          uri={s.photo_url}
                          label={`Séq. ${s.numero}`}
                          montant={s.montant || 0}
                          onPress={() => ouvriGalerie(toutes, idx >= 0 ? idx : 0)}
                        />
                      )
                    })}
                  </View>
                )}
              </View>
              </>)}

              {ongletFiche === 'historique' && (<>
{/* ══════════════════════════════════════
                  10. HISTORIQUE CORRECTIONS
              ══════════════════════════════════════ */}
              {detailPoint.deverouillages.length > 0 && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.sectionTitre}>Historique des corrections</Text>
                  <View style={styles.listCard}>
                    {detailPoint.deverouillages.map((d, i) => {
                      const SECTION_ICONS = { partenaires: '🛵', fournisseurs: '🧾', photos: '📷', inventaire: '📦' }
                      const SECTION_LABELS = { partenaires: 'Partenaires', fournisseurs: 'Fournisseurs', photos: 'Photos', inventaire: 'Inventaire' }
                      const estCorrige = d.statut === 'corrige'
                      const estReferme = d.statut === 'referme'
                      const badgeBg = estCorrige ? '#EAF3DE' : estReferme ? '#E6F1FB' : '#FAEEDA'
                      const badgeTxt = estCorrige ? '#3B6D11' : estReferme ? '#185FA5' : '#854F0B'
                      const badgeLabel = estCorrige ? '✅ Corrigé' : estReferme ? '🔒 Refermé' : '⏳ En attente'
                      const fmtDt = (iso) => {
                        if (!iso) return ''
                        const dt = new Date(iso)
                        return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                      }
                      return (
                        <View key={d.id} style={[styles.listRow, i === detailPoint.deverouillages.length - 1 && { borderBottomWidth: 0 }]}>
                          <View style={styles.listLeft}>
                            <Text style={styles.listLabel}>
                              {SECTION_ICONS[d.section] || '⚙️'} {SECTION_LABELS[d.section] || d.section}
                            </Text>
                            <Text style={[styles.listSub, { fontStyle: 'italic' }]} numberOfLines={2}>"{d.motif}"</Text>
                            <Text style={styles.listSub}>Demandé le {fmtDt(d.deverouille_at)}</Text>
                            {estCorrige && d.corrige_at && (
                              <Text style={[styles.listSub, { color: '#3B6D11' }]}>Corrigé le {fmtDt(d.corrige_at)}</Text>
                            )}
                          </View>
                          <View style={[styles.statutBadge, { backgroundColor: badgeBg, alignSelf: 'flex-start' }]}>
                            <Text style={[styles.statutTxt, { color: badgeTxt }]}>{badgeLabel}</Text>
                          </View>
                        </View>
                      )
                    })}
                  </View>
                </View>
              )}
              </>)}

              <View style={{ height: 24 }} />
            </ScrollView>

            {/* Actions toujours visibles en bas */}
            <View style={styles.ficheActions}>
              {pointSelectionne?.valide && (roleActif === 'manager' || roleActif === 'directeur') && (
                <TouchableOpacity
                  style={styles.actionSecondaire}
                  onPress={() => { setSectionsSelectionnees([]); setMotifCorrection(''); setModalCorrection(true) }}
                  accessibilityRole="button" accessibilityLabel="Demander une correction"
                >
                  <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.text} />
                  <Text style={styles.actionSecondaireTxt}>Corriger</Text>
                </TouchableOpacity>
              )}
              {pointSelectionne?.verifie ? (
                <View style={styles.actionFait}>
                  <MaterialCommunityIcons name="check-decagram" size={18} color={colors.success} />
                  <Text style={[styles.actionFaitTxt, { color: colors.successDark }]}>Vérifié par {pointSelectionne.verifie_par || '—'}</Text>
                </View>
              ) : pointSelectionne?.valide ? (
                <TouchableOpacity
                  style={[styles.actionPrincipale, validating && { opacity: 0.6 }]}
                  onPress={confirmerVerification}
                  disabled={validating}
                  accessibilityRole="button" accessibilityLabel="Marquer comme vérifié"
                >
                  {validating
                    ? <ActivityIndicator color="#FFFFFF" />
                    : <>
                        <MaterialCommunityIcons name="check-circle-outline" size={20} color="#FFFFFF" />
                        <Text style={styles.actionPrincipaleTxt}>Marquer vérifié</Text>
                      </>}
                </TouchableOpacity>
              ) : (
                <View style={styles.actionFait}>
                  <MaterialCommunityIcons name="clock-outline" size={18} color={colors.textMuted} />
                  <Text style={[styles.actionFaitTxt, { color: colors.textSecondary }]}>Point pas encore validé par le gérant</Text>
                </View>
              )}
            </View>
            </>
          )}

          {/* ── GALERIE + ZOOM (un seul Modal, deux modes) ── */}
          <Modal visible={showGalerie} transparent animationType="fade">
            <View style={styles.galerieOverlay}>
              <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
                <View style={styles.galerieTopBar}>
                  {zoomActif ? (
                    <TouchableOpacity onPress={() => setZoomActif(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                      <Text style={{ fontSize: 14, color: '#aaa' }}>‹ Galerie</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.galerieCounter}>{galerieIndex + 1} / {galeriePhotos.length}</Text>
                  )}
                  <Text style={styles.galerieLabel} numberOfLines={1}>
                    {galeriePhotos[galerieIndex]?.label || ''}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                    {!zoomActif && (
                      <TouchableOpacity onPress={() => setZoomActif(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                        <Text style={{ fontSize: 22, color: '#fff' }}>🔍</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => { setZoomActif(false); setShowGalerie(false) }}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                      <Text style={styles.galerieClose}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </SafeAreaView>

              {zoomActif ? (
                /* MODE ZOOM — ScrollView seul, pinch libre */
                <>
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
                    maximumZoomScale={6}
                    minimumZoomScale={1}
                    showsHorizontalScrollIndicator={false}
                    showsVerticalScrollIndicator={false}
                    centerContent
                    bouncesZoom
                  >
                    {galeriePhotos[galerieIndex]?.uri && (
                      <PhotoJustificatif
                        uri={galeriePhotos[galerieIndex].uri}
                        style={{ width: SW, height: SW * 1.3 }}
                        resizeMode="contain"
                      />
                    )}
                  </ScrollView>
                  <TouchableOpacity style={styles.galerieFermerBtn} onPress={() => setZoomActif(false)}>
                    <Text style={styles.galerieFermerTxt}>‹ Retour galerie</Text>
                  </TouchableOpacity>
                </>
              ) : (
                /* MODE GALERIE — FlatList swipe */
                <>
                  <FlatList
                    ref={galerieRef}
                    data={galeriePhotos}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    initialScrollIndex={galerieIndex}
                    getItemLayout={(_, idx) => ({ length: SW, offset: SW * idx, index: idx })}
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
                    keyExtractor={(_, idx) => String(idx)}
                    renderItem={({ item }) => (
                      <View style={{ width: SW, flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <PhotoJustificatif
                          uri={item.uri}
                          style={{ width: SW, height: SW * 1.1 }}
                          resizeMode="contain"
                        />
                      </View>
                    )}
                  />
                  <TouchableOpacity style={styles.galerieFermerBtn} onPress={() => setShowGalerie(false)}>
                    <Text style={styles.galerieFermerTxt}>Fermer</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </Modal>

          {/* ── MODAL PHOTO SIMPLE (fournisseurs) ── */}
          <Modal visible={modalPhoto} animationType="fade" transparent>
            <View style={styles.photoModalOverlay}>
              <TouchableOpacity
                style={styles.photoModalClose} onPress={() => setModalPhoto(false)}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              >
                <Text style={styles.photoModalCloseTxt}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.photoModalLabel}>{photoSelectionnee?.label}</Text>
              <View style={styles.photoModalImgWrapper}>
                {photoSelectionnee?.uri && (
                  <PhotoJustificatif uri={photoSelectionnee.uri} style={styles.photoModalImg} resizeMode="contain" />
                )}
              </View>
              <TouchableOpacity style={styles.photoModalFermer} onPress={() => setModalPhoto(false)}>
                <Text style={styles.photoModalFermerTxt}>Fermer</Text>
              </TouchableOpacity>
            </View>
          </Modal>

        </SafeAreaView>
      </Modal>

      {/* ══════════════════════════════════════════
          MODAL SOLDER L'ÉCART
          mode 'fond'      → « Annuler » : régularise le fond
          mode 'sans_fond' → « Justifier » : ne touche à aucun fond
      ══════════════════════════════════════════ */}
      <Modal visible={modalAnnulerMachine != null} animationType="fade" transparent onRequestClose={() => setModalAnnulerMachine(null)}>
        <View style={styles.annulerOverlay}>
          <View style={styles.annulerCard}>
            <Text style={styles.annulerTitre}>
              {modalAnnulerMachine?.mode === 'sans_fond' ? "✔️ Justifier l'écart" : "🚫 Annuler l'écart"}
            </Text>
            {modalAnnulerMachine && (
              <>
                <View style={[styles.annulerSensBadge, { backgroundColor: modalAnnulerMachine.sens === 'manquant' ? '#FCEBEB' : '#FAEEDA' }]}>
                  <Text style={[styles.annulerSensTxt, { color: modalAnnulerMachine.sens === 'manquant' ? '#A32D2D' : '#854F0B' }]}>
                    {modalAnnulerMachine.sens === 'manquant' ? 'Manquant' : 'Surplus'} — reste {fmt(modalAnnulerMachine.restant)}
                  </Text>
                </View>

                <Text style={styles.annulerEffet}>
                  {modalAnnulerMachine.mode === 'sans_fond'
                    ? "→ Le fond actuel n'est pas modifié."
                    : modalAnnulerMachine.sens === 'manquant'
                      ? '→ Le fond actuel sera AUGMENTÉ du montant annulé.'
                      : '→ Le fond actuel sera DIMINUÉ du montant annulé.'}
                </Text>

                {modalAnnulerMachine.restant <= 0 ? (
                  <Text style={styles.annulerDejaTxt}>✅ Cet écart est déjà entièrement régularisé.</Text>
                ) : (
                  <>
                    <Text style={styles.annulerLabel}>
                      {modalAnnulerMachine.mode === 'sans_fond' ? 'Montant à justifier' : 'Montant à annuler'}
                    </Text>
                    <TextInput
                      style={styles.annulerInput}
                      keyboardType="numeric"
                      value={annulerMontant}
                      onChangeText={setAnnulerMontant}
                      placeholder={String(modalAnnulerMachine.restant)}
                      placeholderTextColor="#bbb"
                    />
                    <Text style={styles.annulerHint}>
                      {`Max ${fmt(modalAnnulerMachine.restant)} — justificatif repris de l'explication ${modalAnnulerMachine.source === 'pos_shift' ? 'du caissier' : 'du gérant'}.`}
                    </Text>
                    {modalAnnulerMachine.explication ? (
                      <Text style={styles.annulerExplication} numberOfLines={3}>📝 {modalAnnulerMachine.explication}</Text>
                    ) : null}
                  </>
                )}

                <View style={styles.annulerBtnRow}>
                  <TouchableOpacity
                    style={[styles.annulerBtn, styles.annulerBtnCancel]}
                    onPress={() => setModalAnnulerMachine(null)}
                    disabled={annulerSaving}
                  >
                    <Text style={styles.annulerBtnCancelTxt}>Retour</Text>
                  </TouchableOpacity>
                  {modalAnnulerMachine.restant > 0 && (
                    <TouchableOpacity
                      style={[
                        styles.annulerBtn,
                        modalAnnulerMachine.mode === 'sans_fond' ? styles.annulerBtnJustifier : styles.annulerBtnConfirm,
                        annulerSaving && { opacity: 0.5 },
                      ]}
                      onPress={confirmerAnnulationMachine}
                      disabled={annulerSaving}
                    >
                      <Text style={styles.annulerBtnConfirmTxt}>{annulerSaving ? '...' : 'Confirmer'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ══════════════════════════════════════════
          MODAL DÉCISION ÉCART INVENTAIRE (valider/refuser explication)
      ══════════════════════════════════════════ */}
      <Modal visible={decisionInv != null} animationType="fade" transparent onRequestClose={() => setDecisionInv(null)}>
        <View style={styles.annulerOverlay}>
          <View style={styles.annulerCard}>
            <Text style={styles.annulerTitre}>⚖️ Décision sur l'écart</Text>
            {decisionInv && (() => {
              const ecartAbs = Math.abs(decisionInv.ecart || 0)
              const prix = decisionInv.prix || 0
              const qAcc = Math.max(0, Math.min(ecartAbs, parseFloat(qteAcceptee) || 0))
              const montantValide = Math.round(Math.max(0, ecartAbs - qAcc) * prix)
              const montantRefuse = Math.round(ecartAbs * prix)
              return (
                <>
                  <Text style={styles.decisionModalNom}>{decisionInv.produit_nom}</Text>
                  <View style={styles.decisionModalInfo}>
                    <Text style={styles.decisionModalInfoTxt}>Écart : {ecartAbs.toFixed(2)}  ·  Prix unitaire : {fmt(prix)}</Text>
                    {decisionInv.nombreExplique > 0 && (
                      <Text style={styles.decisionModalInfoTxt}>Quantité expliquée par le caissier : {decisionInv.nombreExplique}</Text>
                    )}
                    {!!decisionInv.explication && (
                      <Text style={styles.decisionModalExpl}>💬 "{decisionInv.explication}"</Text>
                    )}
                  </View>

                  <Text style={styles.annulerLabel}>Quantité acceptée (justifiée)</Text>
                  <TextInput
                    style={styles.annulerInput}
                    keyboardType="numeric"
                    value={qteAcceptee}
                    onChangeText={setQteAcceptee}
                    placeholder="0"
                    placeholderTextColor="#bbb"
                  />
                  <Text style={styles.annulerHint}>{`Max ${ecartAbs.toFixed(2)} — accepter tout l'écart = déduction 0`}</Text>

                  <View style={styles.decisionPreviewRow}>
                    <Text style={styles.decisionPreviewTxt}>→ Si validé : déduction <Text style={{ fontWeight: '800', color: '#3B6D11' }}>{fmt(montantValide)}</Text></Text>
                    <Text style={styles.decisionPreviewTxt}>→ Si refusé : déduction <Text style={{ fontWeight: '800', color: '#A32D2D' }}>{fmt(montantRefuse)}</Text></Text>
                  </View>

                  <View style={styles.annulerBtnRow}>
                    <TouchableOpacity style={[styles.annulerBtn, styles.annulerBtnCancel]} onPress={() => setDecisionInv(null)} disabled={decisionSaving}>
                      <Text style={styles.annulerBtnCancelTxt}>Retour</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.annulerBtn, { backgroundColor: '#C62828' }, decisionSaving && { opacity: 0.5 }]} onPress={() => enregistrerDecisionInv('refusee')} disabled={decisionSaving}>
                      <Text style={styles.annulerBtnConfirmTxt}>❌ Refuser</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.annulerBtn, { backgroundColor: '#2E7D32' }, decisionSaving && { opacity: 0.5 }]} onPress={() => enregistrerDecisionInv('validee')} disabled={decisionSaving}>
                      <Text style={styles.annulerBtnConfirmTxt}>{decisionSaving ? '...' : '✅ Valider'}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )
            })()}
          </View>
        </View>
      </Modal>

      {/* ══════════════════════════════════════════
          MODAL CORRECTION NOMBRE DE COMMANDES
      ══════════════════════════════════════════ */}
      <Modal visible={corrCmdOuvert} animationType="fade" transparent onRequestClose={() => setCorrCmdOuvert(false)}>
        <View style={styles.annulerOverlay}>
          <View style={styles.annulerCard}>
            <Text style={styles.annulerTitre}>✏️ Corriger le nombre de commandes</Text>
            <Text style={styles.corrAncien}>
              Saisi par le gérant : Yango {pointSelectionne?.yango_nb_commandes || 0} ·
              Glovo {pointSelectionne?.glovo_nb_commandes || 0}
            </Text>

            <Text style={styles.annulerLabel}>Commandes Yango</Text>
            <TextInput
              style={styles.annulerInput}
              keyboardType="numeric"
              value={corrCmdYango}
              onChangeText={v => setCorrCmdYango(v.replace(/[^0-9]/g, ''))}
              placeholder="0" placeholderTextColor="#bbb"
            />

            <Text style={[styles.annulerLabel, { marginTop: 12 }]}>Commandes Glovo</Text>
            <TextInput
              style={styles.annulerInput}
              keyboardType="numeric"
              value={corrCmdGlovo}
              onChangeText={v => setCorrCmdGlovo(v.replace(/[^0-9]/g, ''))}
              placeholder="0" placeholderTextColor="#bbb"
            />

            <Text style={[styles.annulerLabel, { marginTop: 12 }]}>Motif (optionnel)</Text>
            <TextInput
              style={[styles.annulerInput, styles.corrRaisonInput]}
              value={corrCmdMotif}
              onChangeText={setCorrCmdMotif}
              placeholder="Ex. le gérant a tapé 40 au lieu de 14"
              placeholderTextColor="#bbb"
              multiline
            />

            <Text style={styles.annulerHint}>
              Le litige « contacts » est recalculé automatiquement dans Litiges et Charges. Le gérant sera notifié.
            </Text>
            {corrCmdError ? <Text style={styles.corrError}>{corrCmdError}</Text> : null}

            <View style={styles.annulerBtnRow}>
              <TouchableOpacity
                style={[styles.annulerBtn, styles.annulerBtnCancel]}
                onPress={() => setCorrCmdOuvert(false)}
                disabled={corrCmdSaving}
              >
                <Text style={styles.annulerBtnCancelTxt}>Retour</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.annulerBtn, styles.annulerBtnConfirm, corrCmdSaving && { opacity: 0.5 }]}
                onPress={sauvegarderCorrectionCommandes}
                disabled={corrCmdSaving}
              >
                <Text style={styles.annulerBtnConfirmTxt}>{corrCmdSaving ? '...' : 'Corriger'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ══════════════════════════════════════════
          MODAL CORRECTION FACTURE FOURNISSEUR
      ══════════════════════════════════════════ */}
      <Modal visible={corrFacture != null} animationType="fade" transparent onRequestClose={fermerCorrectionFacture}>
        <View style={styles.annulerOverlay}>
          <View style={styles.annulerCard}>
            <Text style={styles.annulerTitre}>✏️ Corriger la facture</Text>
            {corrFacture && (
              <>
                <Text style={styles.corrFourn}>{corrFacture.fournisseurs?.nom || 'Fournisseur'}</Text>
                <Text style={styles.corrAncien}>Montant saisi : {fmt(parseFloat(corrFacture.facture) || 0)}</Text>

                {corrFacture.photo_url ? (
                  <TouchableOpacity onPress={() => voirPhoto(corrFacture.photo_url, corrFacture.fournisseurs?.nom)} activeOpacity={0.85}>
                    <PhotoJustificatif uri={corrFacture.photo_url} style={styles.corrPhoto} />
                    <Text style={styles.corrPhotoHint}>Toucher pour agrandir la facture</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.corrPhotoHint}>Aucune photo de facture enregistrée</Text>
                )}

                <Text style={styles.annulerLabel}>Nouveau montant (d’après la facture)</Text>
                <TextInput
                  style={styles.annulerInput}
                  keyboardType="numeric"
                  value={corrMontant}
                  onChangeText={setCorrMontant}
                  placeholder={String(Math.round(parseFloat(corrFacture.facture) || 0))}
                  placeholderTextColor="#bbb"
                />

                <Text style={[styles.annulerLabel, { marginTop: 12 }]}>Raison de la correction</Text>
                <TextInput
                  style={[styles.annulerInput, styles.corrRaisonInput]}
                  value={corrRaison}
                  onChangeText={setCorrRaison}
                  placeholder="Ex. La facture indique 10 000, saisi 12 000"
                  placeholderTextColor="#bbb"
                  multiline
                />

                <Text style={styles.annulerHint}>Le gérant sera notifié. Sans impact sur le fond ; le solde du fournisseur est recalculé.</Text>
                {corrError ? <Text style={styles.corrError}>{corrError}</Text> : null}

                <View style={styles.annulerBtnRow}>
                  <TouchableOpacity
                    style={[styles.annulerBtn, styles.annulerBtnCancel]}
                    onPress={fermerCorrectionFacture}
                    disabled={corrSaving}
                  >
                    <Text style={styles.annulerBtnCancelTxt}>Retour</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.annulerBtn, styles.annulerBtnConfirm, corrSaving && { opacity: 0.5 }]}
                    onPress={sauvegarderCorrectionFacture}
                    disabled={corrSaving}
                  >
                    <Text style={styles.annulerBtnConfirmTxt}>{corrSaving ? '...' : 'Corriger'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ══════════════════════════════════════════
          MODAL DEMANDE DE CORRECTION
      ══════════════════════════════════════════ */}
      <Modal visible={modalCorrection} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
          <View style={[styles.modalHeader, { backgroundColor: '#854F0B' }]}>
            <TouchableOpacity onPress={() => setModalCorrection(false)}>
              <Text style={[styles.modalClose, { color: '#FAEEDA' }]}>✕ Annuler</Text>
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={[styles.modalTitre, { color: '#fff' }]}>Demande de correction</Text>
              <Text style={[styles.modalSub, { color: '#FAEEDA' }]}>{formatDate(pointSelectionne?.date)}</Text>
            </View>
            <View style={{ width: 70 }} />
          </View>

          <ScrollView style={{ padding: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Sections */}
            <Text style={styles.correctionLabel}>Sections à corriger</Text>
            <Text style={[styles.correctionHint, { marginBottom: 10 }]}>Sélectionnez une ou plusieurs sections</Text>
            {[
              { key: 'partenaires', label: '🛵 Partenaires', desc: 'Yango, Glovo, Wave, OM, Djamo' },
              { key: 'fournisseurs', label: '🧾 Fournisseurs', desc: 'Transactions fournisseurs, déductions gérant' },
              { key: 'photos', label: '📷 Photos', desc: 'Photos justificatives manquantes ou incorrectes' },
              { key: 'inventaire', label: '📦 Inventaire', desc: 'Stocks, entrées/sorties, écarts' },
            ].map(s => {
              const actif = sectionsSelectionnees.includes(s.key)
              return (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.correctionSectionRow, actif && styles.correctionSectionRowActive]}
                  onPress={() => toggleSection(s.key)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.correctionCheckbox, actif && styles.correctionCheckboxActive]}>
                    {actif && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.correctionSectionLabel, actif && { color: '#854F0B' }]}>{s.label}</Text>
                    <Text style={styles.correctionSectionDesc}>{s.desc}</Text>
                  </View>
                </TouchableOpacity>
              )
            })}

            {/* Motif */}
            <Text style={[styles.correctionLabel, { marginTop: 20 }]}>Motif de la correction *</Text>
            <Text style={[styles.correctionHint, { marginBottom: 8 }]}>Minimum 10 caractères — soyez précis</Text>
            <TextInput
              style={styles.correctionMotifInput}
              value={motifCorrection}
              onChangeText={setMotifCorrection}
              placeholder="Ex : Montant Yango incorrect, photo Wave manquante..."
              placeholderTextColor="#bbb"
              multiline
              numberOfLines={4}
              maxLength={500}
            />
            <Text style={styles.correctionCharCount}>{motifCorrection.length}/500</Text>

            {/* Erreur inline */}
            {!!errorCorrection && (
              <View style={{ backgroundColor: '#FCEBEB', borderRadius: 10, padding: 12, marginTop: 14, borderWidth: 1, borderColor: '#F09595' }}>
                <Text style={{ fontSize: 13, color: '#A32D2D', fontWeight: '600' }}>❌ Erreur</Text>
                <Text style={{ fontSize: 12, color: '#A32D2D', marginTop: 4 }}>{errorCorrection}</Text>
              </View>
            )}

            {/* Bouton confirmer */}
            <TouchableOpacity
              style={[styles.correctionConfirmBtn, savingCorrection && { opacity: 0.6 }]}
              onPress={demanderCorrection}
              disabled={savingCorrection}
            >
              {savingCorrection
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.correctionConfirmTxt}>⚠️ Envoyer la demande</Text>
              }
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  // ── Liste : mois, résumé, points à vérifier, historique compact ──
  moisBarre: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 14, marginTop: 12, padding: 6, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
  },
  moisFleche: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  moisTxt: { fontSize: 16, fontWeight: '800', color: colors.text },
  resumeMois: {
    flexDirection: 'row', marginHorizontal: 14, marginTop: 10, paddingVertical: 12, borderRadius: 18,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
  },
  resumeCase: { flex: 1, alignItems: 'center' },
  resumeCaseSep: { borderLeftWidth: 1, borderLeftColor: colors.borderLight },
  resumeVal: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  resumeLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '600', marginTop: 2 },
  titreListe: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 8, marginBottom: 8 },
  carteAVerifier: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 16,
    padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.borderLight, borderLeftWidth: 5,
    shadowColor: colors.cardShadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  carteDate: { fontSize: 15, fontWeight: '800', color: colors.text },
  alertes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  carteMontant: { fontSize: 16, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  puce: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  puceTxt: { fontSize: 11, fontWeight: '800' },
  listeCompacte: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.borderLight, overflow: 'hidden' },
  ligneCompacte: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, minHeight: 48 },
  ligneCompacteSep: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  pointStatut: { width: 10, height: 10, borderRadius: 5 },
  ligneDate: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  ligneMontant: { fontSize: 14, fontWeight: '700', color: colors.textSecondary, fontVariant: ['tabular-nums'] },

  // ── Fiche d'un point ──
  enteteBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  ficheResume: {
    backgroundColor: colors.surface, borderRadius: 20, padding: 16, marginBottom: 12, gap: 4,
    borderWidth: 1, borderColor: colors.borderLight,
    shadowColor: colors.cardShadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3,
  },
  ficheLabel: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8 },
  ficheGros: { fontSize: 34, fontWeight: '800', color: colors.text, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  ficheTrois: { flexDirection: 'row', gap: 8, marginTop: 8 },
  ficheCase: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 10 },
  ficheCaseLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '700' },
  ficheCaseVal: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 2, fontVariant: ['tabular-nums'] },
  ficheOnglet: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  ficheOngletActif: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 3,
  },
  ficheOngletTxt: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  ficheOngletTxtActif: { color: '#FFFFFF', fontWeight: '800' },
  barresCarte: { backgroundColor: colors.surface, borderRadius: 18, padding: 16, marginBottom: 14, gap: 10, borderWidth: 1, borderColor: colors.borderLight },
  barreLigne: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barreNom: { width: 96, fontSize: 13, fontWeight: '700', color: colors.text },
  barreFond: { flex: 1, height: 10, borderRadius: 6, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  barrePlein: { height: '100%', borderRadius: 6, backgroundColor: colors.primary },
  barreVal: { minWidth: 76, textAlign: 'right', fontSize: 13, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  grillePhotos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ficheActions: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  actionSecondaire: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 48,
    borderRadius: 14, backgroundColor: colors.surfaceAlt,
  },
  actionSecondaireTxt: { fontSize: 14, fontWeight: '700', color: colors.text },
  actionPrincipale: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48,
    borderRadius: 14, backgroundColor: colors.primary,
  },
  actionPrincipaleTxt: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  actionFait: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48 },
  actionFaitTxt: { fontSize: 14, fontWeight: '700' },

  header: {
    backgroundColor: colors.headerBg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomLeftRadius: 22, borderBottomRightRadius: 22, zIndex: 2,
    shadowColor: colors.headerBg, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
  },
  back: { fontSize: 16, color: colors.headerText, fontWeight: '700' },
  headerTitre: { fontSize: 18, fontWeight: '800', color: colors.headerText, textAlign: 'center' },
  headerSub: { fontSize: 12, color: colors.primaryText, textAlign: 'center', fontWeight: '600' },
  restoBar: { maxHeight: 56, marginTop: 12 },
  restoBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginHorizontal: 4,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignSelf: 'center',
  },
  restoBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  restoTxt: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  restoTxtActive: { color: '#FFFFFF', fontWeight: '800' },
  statsBar: { flexDirection: 'row', backgroundColor: colors.surface, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  statItem: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  statDivider: { width: 0.5, backgroundColor: '#eee', marginVertical: 6 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 50, marginBottom: 12 },
  emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  emptySub: { fontSize: 12, color: colors.textPlaceholder, marginTop: 6 },
  prioriteSection: { backgroundColor: '#E6F1FB', borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#185FA5' },
  prioriteTitre: { fontSize: 13, fontWeight: '600', color: '#185FA5', marginBottom: 10 },
  prioriteCard: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8, borderWidth: 0.5, borderColor: '#B8D4F5'
  },
  prioriteDate: { fontSize: 14, fontWeight: '600', color: colors.text },
  prioriteBSC: { fontSize: 11, color: '#3B6D11', marginTop: 2 },
  prioriteVentes: { fontSize: 14, fontWeight: '600', color: '#EF9F27' },
  prioriteVerifier: { fontSize: 11, color: '#185FA5', marginTop: 2 },
  sectionTitre: { fontSize: 11, fontWeight: '800', color: colors.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, marginTop: 6 },
  pointCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  pointCardVerifie: { borderColor: '#3B6D11', backgroundColor: '#F4FAF0' },
  pointCardAVerifier: { borderColor: '#185FA5', backgroundColor: '#F0F5FF' },
  pointCardEnCours: { borderColor: colors.border },
  pointHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  pointDate: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  pointStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pointStatTxt: { fontSize: 11, color: colors.textMuted },
  statutBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutTxt: { fontSize: 11, fontWeight: '500' },
  manquanteBadge: { backgroundColor: '#FAECE7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  manquanteTxt: { fontSize: 10, color: '#993C1D', fontWeight: '500' },
  voirDetailTxt: { fontSize: 11, color: colors.primary, marginTop: 4 },
  modalHeader: {
    backgroundColor: colors.headerBg, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16, gap: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomLeftRadius: 22, borderBottomRightRadius: 22, marginBottom: 12,
  },
  modalClose: { fontSize: 14, color: colors.primaryText, fontWeight: '500' },
  modalTitre: { fontSize: 18, fontWeight: '800', color: colors.headerText },
  modalSub: { fontSize: 11, color: colors.primaryText, textAlign: 'center' },
  verifBanner: { borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, alignItems: 'center' },
  verifBannerTxt: { fontSize: 13, fontWeight: '600' },
  // ─── Récapitulatif Financier ───
  recapCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 16, marginBottom: 4, borderWidth: 1, borderColor: colors.borderLight },
  recapRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  recapRowTotal: { backgroundColor: '#fafafa', marginHorizontal: -4, paddingHorizontal: 4, borderRadius: 6, borderBottomWidth: 0 },
  recapLabel: { fontSize: 13, color: colors.text },
  recapVal: { fontSize: 13, fontWeight: '500' },
  recapSep: { height: 8 },
  // ─── Écarts de caisse POS par shift ───
  ecartsPosCard: { backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 14, borderWidth: 0.5, borderColor: colors.border },
  ecartPosLigne: { paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  ecartPosEntete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ecartPosCaissier: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
  ecartPosBadge: { borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  ecartPosBadgeTxt: { fontSize: 11, fontWeight: '700' },
  ecartPosEspeces: { marginTop: 6, fontSize: 11, color: colors.textMuted, textAlign: 'right' },
  ecartPosExplication: { marginTop: 7, fontSize: 12, lineHeight: 18, color: colors.textMuted, fontStyle: 'italic' },
  ecartPosDecision: { marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colors.border },
  ecartPosSansExplication: { marginTop: 7, fontSize: 12, lineHeight: 18, color: '#A32D2D', fontWeight: '600' },
  ecartPosTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1.5, borderTopColor: colors.border },
  ecartPosTotalLabel: { fontSize: 12, fontWeight: '800', color: colors.text },
  ecartPosTotalValeur: { fontSize: 15, fontWeight: '800' },
  ecartPosIndisponible: { fontSize: 11, color: colors.textMuted, lineHeight: 16, paddingBottom: 12 },
  // ─── Canaux ───
  canalCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: '#EF9F27' },
  canalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0' },
  canalNom: { fontSize: 14, fontWeight: '700', color: colors.text },
  canalMontant: { fontSize: 16, fontWeight: '700', color: '#EF9F27' },
  canalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#f9f9f9' },
  canalLabel: { fontSize: 12, color: colors.textMuted },
  canalVal: { fontSize: 12, fontWeight: '500', color: colors.text },
  canalAutresTitre: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 8, letterSpacing: 0.5 },
  canalPhotoTouchable: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10, backgroundColor: '#f9f9f9', padding: 8, borderRadius: 10 },
  canalPhotoMini: { width: 60, height: 60, borderRadius: 8 },
  canalPhotoLabel: { fontSize: 11, color: colors.primary, flex: 1 },
  // ─── Listes ───
  listCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 16, marginBottom: 4, borderWidth: 1, borderColor: colors.borderLight },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  listLeft: { flex: 1, flexDirection: 'column', gap: 2, paddingRight: 8 },
  listRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listLabel: { fontSize: 13, fontWeight: '500', color: colors.text },
  listSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  listVal: { fontSize: 13, fontWeight: '600', color: colors.text },
  listAuteur: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  listSubTitre: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 4 },
  listTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border },
  listTotalLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  listTotalVal: { fontSize: 15, fontWeight: '700', color: '#EF9F27' },
  // ─── Présences ───
  statutPresenceBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start', marginTop: 3 },
  statutPresenceTxt: { fontSize: 10, fontWeight: '500' },
  // ─── Inventaire ───
  invShiftCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  invShiftHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight },
  invShiftBadge: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.orangeLight, alignItems: 'center', justifyContent: 'center' },
  invShiftBadgeTxt: { fontSize: 13, fontWeight: '600', color: colors.orangeDark },
  invShiftNom: { fontSize: 13, fontWeight: '600', color: colors.text },
  invShiftHeure: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  invShiftCount: { fontSize: 11, color: colors.textMuted },
  invLigneRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: '#f9f9f9' },
  invLigneRowAlert: { backgroundColor: '#FFF8F8', borderRadius: 6, paddingHorizontal: 6 },
  invLigneNom: { fontSize: 12, fontWeight: '500', color: colors.text },
  invLigneSub: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  invEcartBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  invEcartTxt: { fontSize: 11, fontWeight: '600' },
  // ─── Shifts ───
  shiftCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  shiftHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  shiftNumBox: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center' },
  shiftNumTxt: { fontSize: 12, fontWeight: '600', color: '#412402' },
  shiftHeures: { fontSize: 13, fontWeight: '600', color: colors.text },
  shiftCaissier: { fontSize: 11, color: colors.primary, marginTop: 2 },
  shiftVente: { fontSize: 14, fontWeight: '700', color: '#EF9F27' },
  shiftDonnees: { borderTopWidth: 0.5, borderTopColor: '#f5f5f5', paddingTop: 8, marginBottom: 10 },
  shiftRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#f9f9f9' },
  shiftLabel: { fontSize: 12, color: colors.textMuted },
  shiftVal: { fontSize: 12, fontWeight: '500', color: colors.text },
  // ─── Photos ───
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoVignette: { width: '30%', backgroundColor: colors.surface, borderRadius: 10, padding: 6, alignItems: 'center', borderWidth: 0.5, borderColor: colors.border },
  photoVignetteManquante: { backgroundColor: '#FAECE7', borderColor: '#F09595' },
  photoThumb: { width: '100%', height: 70, borderRadius: 8, marginBottom: 4 },
  photoAbsente: { width: '100%', height: 70, borderRadius: 8, backgroundColor: '#f9f9f9', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  photoAbsenteIcon: { fontSize: 24 },
  photoLabel: { fontSize: 9, color: '#3B6D11', textAlign: 'center', fontWeight: '500' },
  photoMontant: { fontSize: 8, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  photoTapTxt: { fontSize: 8, color: colors.primary, textAlign: 'center', marginTop: 1 },
  miniThumb: { width: 40, height: 40, borderRadius: 6 },
  photoAbsenteThumb: { width: 40, height: 40, borderRadius: 6, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  photoAbsenteThumbTxt: { fontSize: 18, color: '#ccc' },
  // ─── Galerie Zoom ───
  galerieOverlay: { flex: 1, backgroundColor: 'black' },
  galerieTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  galerieCounter: { fontSize: 13, color: '#aaa', minWidth: 40 },
  galerieLabel: { flex: 1, fontSize: 13, color: '#fff', textAlign: 'center', fontWeight: '500', paddingHorizontal: 8 },
  galerieClose: { fontSize: 28, color: '#fff', fontWeight: '300', minWidth: 40, textAlign: 'right' },
  galerieFermerBtn: { backgroundColor: colors.primary, marginHorizontal: 40, marginBottom: 20, padding: 14, borderRadius: 14, alignItems: 'center' },
  galerieFermerTxt: { fontSize: 14, fontWeight: '600', color: '#fff' },
  // ─── Modal photo simple ───
  photoModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', flexDirection: 'column', paddingTop: 50, paddingBottom: 30 },
  photoModalClose: { alignSelf: 'flex-end', paddingHorizontal: 20, paddingBottom: 10 },
  photoModalCloseTxt: { fontSize: 28, color: '#fff', fontWeight: '300' },
  photoModalLabel: { fontSize: 15, fontWeight: '600', color: '#fff', textAlign: 'center', paddingHorizontal: 20, marginBottom: 10 },
  photoModalImgWrapper: { flex: 1, width: '100%' },
  photoModalImg: { flex: 1, width: '100%' },
  photoModalFermer: { backgroundColor: colors.primary, marginHorizontal: 40, marginTop: 16, padding: 14, borderRadius: 14, alignItems: 'center' },
  photoModalFermerTxt: { fontSize: 14, fontWeight: '600', color: colors.surface },
  // ─── Sections vides ───
  emptySection: { backgroundColor: '#f9f9f9', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 4 },
  emptySectionTxt: { fontSize: 13, color: colors.textMuted },
  entreeFournCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: colors.border },
  entreeSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  entreeSourceBadge: { backgroundColor: '#E6F1FB', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  entreeSourceBadgeTxt: { color: '#185FA5', fontSize: 10, fontWeight: '700' },
  entreeFournHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  entreeFournNom: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 },
  entreeFournFacture: { fontSize: 12, color: '#3B6D11', fontWeight: '500' },
  entreeProdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderTopWidth: 0.5, borderTopColor: '#f5f5f5' },
  entreeProdNom: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  entreeProdMeta: { marginTop: 2, fontSize: 10, color: colors.textMuted },
  entreeProdQte: { fontSize: 12, fontWeight: '700', color: '#3B6D11' },
  // ─── Onglets ───
  // Points / Inventaire : un sélecteur à deux positions sous l'en-tête.
  // ─── Boutons ───
  verifierBtn: { backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10, marginTop: 6 },
  verifierBtnTxt: { fontSize: 15, fontWeight: '600', color: colors.surface },
  verifierBtnSub: { fontSize: 11, color: colors.primaryText, marginTop: 4 },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, marginTop: 4, borderWidth: 1.5, borderColor: colors.primary, flexWrap: 'wrap', gap: 4 },
  pdfBtnTxt: { fontSize: 14, fontWeight: '600', color: colors.primary },
  pdfBtnSub: { fontSize: 11, color: colors.textMuted, width: '100%', textAlign: 'center', marginTop: 2 },
  // ─── Correction ───
  correctionBtn: { borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 10, marginTop: 4, borderWidth: 1.5, borderColor: '#854F0B', backgroundColor: '#FAEEDA' },
  correctionBtnTxt: { fontSize: 14, fontWeight: '600', color: '#854F0B' },
  correctionBtnSub: { fontSize: 11, color: '#854F0B', marginTop: 3, opacity: 0.7 },
  correctionLabel: { fontSize: 13, fontWeight: '700', color: '#444', marginBottom: 4 },
  correctionHint: { fontSize: 11, color: '#888' },
  correctionSectionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  correctionSectionRowActive: { borderColor: '#854F0B', backgroundColor: '#FFF8F0' },
  correctionCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#ccc', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9f9f9' },
  correctionCheckboxActive: { borderColor: '#854F0B', backgroundColor: '#854F0B' },
  correctionSectionLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  correctionSectionDesc: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  correctionMotifInput: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border, minHeight: 100, textAlignVertical: 'top' },
  correctionCharCount: { fontSize: 10, color: '#bbb', textAlign: 'right', marginTop: 4, marginBottom: 6 },
  correctionConfirmBtn: { backgroundColor: '#854F0B', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 16 },
  correctionConfirmTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  // ─── Décision « vente machine » ───
  contactsCaissierBox: { marginTop: 8, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: '#ddd', gap: 2 },
  contactsCaissierTitre: { fontSize: 11.5, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  contactsCaissierAlerte: { fontSize: 11.5, color: '#B06E00', lineHeight: 16, marginTop: 1, marginBottom: 3 },
  contactsCaissierNote: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 4, lineHeight: 15 },
  machineDecisionBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: '#ddd' },
  machineDecisionHint: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 8 },
  machineStatutBadge: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 10, alignSelf: 'flex-start' },
  machineStatutTxt: { fontSize: 13, fontWeight: '700' },
  machineRetourBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#854F0B', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 10 },
  machineRetourTxt: { fontSize: 12.5, fontWeight: '700', color: '#854F0B' },
  machineBtnRow: { flexDirection: 'row', gap: 8 },
  machineBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  machineBtnJustifier: { backgroundColor: '#3B6D11' },
  machineBtnRefuser: { backgroundColor: '#A32D2D' },
  machineBtnAnnuler: { backgroundColor: '#854F0B' },
  machineBtnTxt: { fontSize: 13, fontWeight: '700', color: '#fff' },
  machineDecisionNote: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
  machineRegulRecap: { marginTop: 8, backgroundColor: '#F3F7EE', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#DDEBCB' },
  machineRegulRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  machineRegulLabel: { fontSize: 12, color: colors.text },
  machineRegulVal: { fontSize: 13, fontWeight: '700' },
  machineRegulNote: { fontSize: 10, color: colors.textMuted, marginTop: 4 },
  // ─── Modal « Annuler l'écart » ───
  annulerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  annulerCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 20 },
  annulerTitre: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: 12, textAlign: 'center' },
  annulerSensBadge: { alignSelf: 'center', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 14, marginBottom: 10 },
  annulerSensTxt: { fontSize: 13, fontWeight: '700' },
  annulerEffet: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 14 },
  annulerDejaTxt: { fontSize: 13, color: '#3B6D11', textAlign: 'center', marginVertical: 10, fontWeight: '600' },
  annulerLabel: { fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 6 },
  annulerInput: { borderRadius: 12, padding: 14, fontSize: 18, fontWeight: '700', color: colors.text, borderWidth: 1.5, borderColor: colors.border, textAlign: 'center' },
  annulerHint: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  annulerExplication: { fontSize: 12, color: '#444', fontStyle: 'italic', marginTop: 8, backgroundColor: '#f7f7f7', borderRadius: 8, padding: 8 },
  annulerBtnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  annulerBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  annulerBtnCancel: { backgroundColor: '#eee' },
  annulerBtnCancelTxt: { fontSize: 14, fontWeight: '600', color: '#555' },
  annulerBtnConfirm: { backgroundColor: '#854F0B' },
  annulerBtnJustifier: { backgroundColor: '#3B6D11' },
  annulerBtnConfirmTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
  // Correction de facture fournisseur
  corrFourn: { fontSize: 15, fontWeight: '800', color: colors.text, textAlign: 'center' },
  corrAncien: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 2, marginBottom: 10 },
  corrPhoto: { width: '100%', height: 150, borderRadius: 12, backgroundColor: colors.background, marginBottom: 4 },
  corrPhotoHint: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginBottom: 12 },
  corrRaisonInput: { fontSize: 14, fontWeight: '500', textAlign: 'left', minHeight: 60, textAlignVertical: 'top' },
  corrError: { fontSize: 12, color: '#A32D2D', fontWeight: '600', marginTop: 8, textAlign: 'center' },
  // Correction du nombre de commandes livraison (base du litige contacts)
  corrCmdBox: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginTop: 4,
    borderWidth: 0.5, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.primary,
  },
  corrCmdLitige: { fontSize: 12, color: '#A32D2D', fontWeight: '700', marginTop: 4 },
  corrCmdBadge: { fontSize: 11, color: '#854F0B', fontWeight: '600', marginTop: 4, lineHeight: 15 },
  corrCmdBtn: { alignSelf: 'flex-start', backgroundColor: '#E8F0FE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 8 },
  corrCmdBtnTxt: { fontSize: 12, color: '#1B4B9E', fontWeight: '700' },
  factCorrBadge: { fontSize: 11, color: '#854F0B', fontWeight: '700', marginBottom: 3 },
  factCorrBtn: { alignSelf: 'flex-start', backgroundColor: '#E8F0FE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginTop: 1 },
  factCorrBtnTxt: { fontSize: 12, color: '#1B4B9E', fontWeight: '700' },
  // ─── Inventaire Résumé global ───
  invResumeCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 0.5, borderColor: colors.border },
  invResumeRow: { flexDirection: 'row', gap: 10 },
  invResumeBadge: { flex: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  invResumeBadgeNum: { fontSize: 24, fontWeight: '700', marginBottom: 2 },
  invResumeBadgeLbl: { fontSize: 11, fontWeight: '500', textAlign: 'center' },
  invResumeTotalBox: { borderRadius: 10, padding: 12, marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deducAlerte: { backgroundColor: '#FFF4E0', borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#E8C98A' },
  deducAlerteTxt: { fontSize: 12, color: '#7A4800', lineHeight: 17 },
  deducMontant: { fontSize: 14, fontWeight: '800', color: '#A32D2D' },
  deducMontantAnnule: { color: colors.textMuted, textDecorationLine: 'line-through' },
  deducRetenu: { fontSize: 12, fontWeight: '800', color: '#A32D2D', marginTop: 1 },
  repartLigne: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.borderLight, gap: 8 },
  repartNom: { fontSize: 13, fontWeight: '700', color: colors.text },
  repartMeta: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  repartInput: { width: 96, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7, fontSize: 13, fontWeight: '700', color: colors.text, backgroundColor: colors.inputBg, textAlign: 'right' },
  repartRetirer: { paddingHorizontal: 6, paddingVertical: 4 },
  repartRetirerTxt: { fontSize: 15, color: '#A32D2D', fontWeight: '700' },
  repartTotalBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 2, borderTopColor: colors.border },
  repartTotalLbl: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  repartTotalVal: { fontSize: 14, fontWeight: '800' },
  repartAjoutTitre: { fontSize: 11, color: colors.textMuted, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  repartChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  repartChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.badgeBg },
  repartChipTxt: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  repartChipGerant: { backgroundColor: colors.primaryLight },
  repartChipGerantTxt: { fontSize: 12, color: colors.primaryDark, fontWeight: '700' },
  justifLigne: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  justifLbl: { fontSize: 13, fontWeight: '700', color: '#185FA5' },
  justifAide: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  deducModifier: { marginTop: 10, paddingVertical: 9, borderRadius: 8, backgroundColor: colors.badgeBg, alignItems: 'center' },
  deducModifierTxt: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  deducMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 3 },
  deducExpl: { fontSize: 12, color: colors.text, marginTop: 6, fontStyle: 'italic' },
  deducExplVide: { fontSize: 11, color: colors.textMuted, marginTop: 6, fontStyle: 'italic' },
  deducActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  deducBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  deducBtnValider: { backgroundColor: '#E6F1FB' },
  deducBtnValiderTxt: { fontSize: 12, fontWeight: '700', color: '#185FA5' },
  deducBtnRefuser: { backgroundColor: '#FCEBEB' },
  deducBtnRefuserTxt: { fontSize: 12, fontWeight: '700', color: '#A32D2D' },
  deducStatut: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  invEntreeFourn: { paddingVertical: 8 },
  invEntreeFournSep: { borderTopWidth: 1, borderTopColor: colors.borderLight, marginTop: 2 },
  invEntreeFournNom: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: 5 },
  invEntreeLigne: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 3, paddingLeft: 10 },
  invEntreeProduit: { fontSize: 12, color: colors.textSecondary },
  invEntreeAuteur: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  invEntreeQte: { fontSize: 12, fontWeight: '700', color: '#3B6D11', marginLeft: 10 },
  invResumeTotalLabel: { fontSize: 13, fontWeight: '600' },
  invResumeTotalVal: { fontSize: 16, fontWeight: '800' },
  // ─── Fiche produit avec écart ───
  invFicheCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1 },
  invFicheHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0' },
  invFicheNom: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1, marginRight: 8 },
  invFicheStatut: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  invFicheStatutTxt: { fontSize: 11, fontWeight: '600' },
  invFicheExplication: { backgroundColor: '#F5F9FF', borderRadius: 8, padding: 10, marginVertical: 8, borderLeftWidth: 3, borderLeftColor: '#185FA5' },
  invFicheExplicationLabel: { fontSize: 11, fontWeight: '600', color: '#185FA5', marginBottom: 4 },
  invFicheExplicationTxt: { fontSize: 12, color: '#444', fontStyle: 'italic', lineHeight: 18 },
  invFicheCaissier: { marginTop: 10, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: '#f0f0f0', gap: 4 },
  invFicheCaissierTxt: { fontSize: 11, color: colors.textMuted },
  annulDeducBtn: { marginTop: 10, backgroundColor: '#FCEBEB', borderWidth: 1, borderColor: '#F09595', borderRadius: 8, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  annulDeducBtnTxt: { color: '#A32D2D', fontWeight: '700', fontSize: 13 },
  deducAnnuleeBadge: { marginTop: 10, backgroundColor: '#EFEFEF', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  deducAnnuleeTxt: { color: colors.textMuted, fontWeight: '600', fontSize: 12, textDecorationLine: 'line-through' },
  decisionInvBox: { marginTop: 10, backgroundColor: '#FFF9EC', borderWidth: 1, borderColor: '#F0D28A', borderRadius: 8, padding: 10 },
  decisionInvPending: { color: '#854F0B', fontWeight: '700', fontSize: 12, textAlign: 'center', marginBottom: 8 },
  decisionInvBtn: { backgroundColor: '#EF9F27', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  decisionInvBtnTxt: { color: '#412402', fontWeight: '800', fontSize: 13 },
  decisionInvStatut: { fontWeight: '700', fontSize: 12, textAlign: 'center' },
  decisionInvModifier: { color: '#185FA5', fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 6 },
  decisionModalNom: { fontSize: 15, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 8 },
  decisionModalInfo: { backgroundColor: '#F7F7F7', borderRadius: 8, padding: 10, marginBottom: 12 },
  decisionModalInfoTxt: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  decisionModalExpl: { fontSize: 12, color: '#185FA5', marginTop: 4, fontStyle: 'italic' },
  decisionPreviewRow: { marginTop: 10, gap: 4 },
  decisionPreviewTxt: { fontSize: 12, color: colors.text },
  // ─── Bilan financier ───
  invBilanCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  invBilanRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  invBilanProduit: { fontSize: 13, color: colors.text, flex: 1, marginRight: 8 },
  invBilanMontant: { fontSize: 13, fontWeight: '600', color: '#A32D2D' },
  invBilanSep: { height: 1, backgroundColor: '#ddd', marginVertical: 8 },
  invBilanTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 },
  invBilanTotalLabel: { fontSize: 14, fontWeight: '700', color: '#A32D2D' },
  invBilanTotalVal: { fontSize: 20, fontWeight: '800', color: '#A32D2D' },
  // ─── Écarts inventaire (legacy) ───
  ecartSection: { backgroundColor: '#FFF8F8', borderRadius: 14, padding: 14, marginTop: 8, marginBottom: 4, borderWidth: 1, borderColor: '#F09595' },
  ecartSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  ecartSectionTitre: { fontSize: 14, fontWeight: '700', color: '#A32D2D' },
  ecartSectionSub: { fontSize: 11, color: '#993C1D' },
  ecartCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 0.5, borderColor: '#F09595' },
  ecartNom: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 8 },
  ecartRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: '#f5f5f5' },
  ecartLabel: { fontSize: 12, color: colors.textMuted },
  ecartVal: { fontSize: 12, fontWeight: '500', color: colors.text },
  ecartTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FCEBEB', borderRadius: 10, padding: 12, marginTop: 4, marginBottom: 10, borderWidth: 1, borderColor: '#F09595' },
  ecartTotalLabel: { fontSize: 14, fontWeight: '700', color: '#A32D2D' },
  ecartTotalVal: { fontSize: 18, fontWeight: '700', color: '#A32D2D' },
}) }

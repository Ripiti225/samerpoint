import { router } from 'expo-router'
import { estCompteTechnique } from '../lib/comptesTechniques'
import { useEffect, useMemo, useState } from 'react'
import FormulaireTravailleur from '../components/FormulaireTravailleur'
import { aujourdhuiISO } from '../lib/contrats'
import { useTheme } from '../context/ThemeContext'
import {
    ActivityIndicator,
    Alert,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    SafeAreaView, ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View
} from 'react-native'
import { useApp } from '../context/AppContext'
import { creerNotification } from '../lib/notificationsInterne'
import { supabase } from '../lib/supabase'
import { usePhoto } from '../lib/usePhoto'
import { chargerDerniersRestes } from '../lib/derniersRestesFournisseurs'
import { ecritureAjustementCredit, ecrituresFicheFournisseur } from '../lib/creditsFournisseurs'
import { libelleMois, premierDuMois } from '../lib/facturesMensuelles'
import { choixMoisDepart } from '../lib/fournisseursAdmin'
import { connecterOneDrive, deconnecterOneDrive, estatConnecte } from '../lib/onedrive'
import { ROLES_GLOBAUX } from '../lib/constants'
import { ACTIONS, journaliser } from '../lib/journal'
import { diagnosticBascule, ETAT_BASCULE, compterShiftsParRestaurant } from '../lib/basculePOS'
import { SOURCE_POS, SOURCE_SAMTRACKLY, estSurPOS } from '../lib/sourcePoint'
import { expliquerEchecSuppression } from '../lib/suppressionCompte'
import {
  TUILES, ROLES_CONFIGURABLES, LABELS_ROLES, ACCES_DEFAUT,
  chargerAccesConfig, enregistrerAccesRole,
} from '../lib/menus'

const SECTIONS = [
  { key: 'restaurants', label: '🏪 Restaurants' },
  { key: 'travailleurs', label: '👥 Travailleurs' },
  { key: 'utilisateurs', label: '🔑 Utilisateurs' },
  { key: 'fournisseurs', label: '🧾 Fournisseurs' },
  { key: 'roles', label: '🔐 Rôles & accès' },
]

export default function ParametresScreen() {
  const { isManager, userId, userNom } = useApp()
  const { colors, isDark, mode, setThemeMode } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { prendrePhoto, choisirPhoto } = usePhoto()

  const [sectionActive, setSectionActive] = useState('restaurants')
  const [restaurants, setRestaurants] = useState([])
  const [comptesShifts, setComptesShifts] = useState(null)
  const [travailleurs, setTravailleurs] = useState([])
  const [utilisateurs, setUtilisateurs] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [tousRestaurants, setTousRestaurants] = useState([])
  const [modal, setModal] = useState({ visible: false, type: '', data: null })
  const [form, setForm] = useState({})
  const [loading, setLoading] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [creditActuel, setCreditActuel] = useState(null)
  const [montantCotise, setMontantCotise] = useState(null)
  const [restaurantFiltre, setRestaurantFiltre] = useState(null)
  const [badgeTravailleur, setBadgeTravailleur] = useState(null)
  const [oneDriveConnecte, setOneDriveConnecte] = useState(false)
  const [oneDriveLoading, setOneDriveLoading] = useState(false)
  const [oneDriveEmail, setOneDriveEmail] = useState('')
  const [ongletTravailleur, setOngletTravailleur] = useState('infos')
  const [docsTravailleur, setDocsTravailleur] = useState([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [ajoutDocVisible, setAjoutDocVisible] = useState(false)
  const [formDoc, setFormDoc] = useState({ type_document: 'CNI', description: '' })
  const [uploadingDoc, setUploadingDoc] = useState(false)
  // Rôles & accès
  const [roleConfigActif, setRoleConfigActif] = useState('gerant')
  const [accesRoles, setAccesRoles] = useState(ACCES_DEFAUT)
  const [savingRoles, setSavingRoles] = useState(false)

  useEffect(() => { chargerTousRestaurants() }, [])
  useEffect(() => { chargerDonnees() }, [sectionActive])
  useEffect(() => { estatConnecte().then(setOneDriveConnecte) }, [])
  useEffect(() => {
    if (tousRestaurants.length > 0 && !restaurantFiltre) {
      setRestaurantFiltre(tousRestaurants[0].id)
    }
  }, [tousRestaurants])

  async function gererConnexionOneDrive() {
    if (oneDriveConnecte) {
      Alert.alert('OneDrive', 'Se déconnecter de OneDrive ?', [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Déconnecter', style: 'destructive', onPress: async () => {
          await deconnecterOneDrive()
          setOneDriveConnecte(false)
          setOneDriveEmail('')
        }},
      ])
      return
    }
    setOneDriveLoading(true)
    const result = await connecterOneDrive()
    setOneDriveLoading(false)
    if (result.success) {
      setOneDriveConnecte(true)
      setOneDriveEmail(result.email || '')
      Alert.alert('✅ Connecté', `OneDrive connecté${result.email ? ` (${result.email})` : ''}.`)
    } else {
      Alert.alert('Erreur', result.error || 'Impossible de se connecter à OneDrive.')
    }
  }

  /**
   * D'où viennent les shifts des 7 derniers jours, par restaurant. C'est ce qui
   * dit si la remontée du POS fonctionne pour un site — et donc s'il peut être
   * basculé sans faire disparaître ses caissières.
   *
   * Deux colonnes seulement, sur 7 jours : ~150 lignes pour les 7 sites, très
   * loin de la limite de 1000 lignes de Supabase (qui tronque en silence).
   */
  async function chargerComptesShifts() {
    const depuis = new Date(Date.now() - 7 * 86400_000).toISOString().split('T')[0]
    const { data, error } = await supabase
      .from('points_shifts')
      .select('restaurant_id, pos_service_id')
      .gte('date', depuis)
    // Colonne pos_service_id absente (migration pas passée) : on ne prétend
    // rien savoir, et aucun site ne pourra être basculé depuis cet écran.
    setComptesShifts(error ? null : compterShiftsParRestaurant(data))
  }

  async function chargerTousRestaurants() {
    const { data } = await supabase.from('restaurants').select('id, nom, couleur, photo_url, localisation').order('nom')
    setTousRestaurants(data || [])
  }

  async function chargerDonnees() {
    setLoading(true)
    if (sectionActive === 'restaurants') {
      // `source_point` avec repli : sans la migration supabase_pos_bascule.sql,
      // tous les sites restent sur Samtrackly (cf. lib/sourcePoint.js).
      const quete = (cols) => supabase.from('restaurants').select(cols).order('nom')
      let { data, error } = await quete('id, nom, couleur, photo_url, localisation, pin, source_point')
      if (error) ({ data } = await quete('id, nom, couleur, photo_url, localisation, pin'))
      setRestaurants(data || [])
      setTousRestaurants(data || [])
      await chargerComptesShifts()
    }
    if (sectionActive === 'travailleurs') {
      const { data } = await supabase.from('travailleurs').select('*, restaurants(nom)').order('nom')
      setTravailleurs(data || [])
    }
    if (sectionActive === 'utilisateurs') {
      const { data } = await supabase.from('utilisateurs').select('*, restaurants(nom)').order('nom')
      setUtilisateurs(data || [])
    }
    if (sectionActive === 'fournisseurs') {
      const { data } = await supabase.from('fournisseurs').select('*, restaurants(nom)').order('nom')
      setFournisseurs(data || [])
    }
    if (sectionActive === 'roles') {
      const cfg = await chargerAccesConfig()
      setAccesRoles(cfg)
    }
    setLoading(false)
  }

  // ─── Rôles & accès ─────────────────────────────────────────
  function toggleTuileRole(id) {
    setAccesRoles(prev => {
      const cur = prev[roleConfigActif] || []
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
      return { ...prev, [roleConfigActif]: next }
    })
  }

  function restaurerDefautRole() {
    setAccesRoles(prev => ({ ...prev, [roleConfigActif]: [...(ACCES_DEFAUT[roleConfigActif] || [])] }))
  }

  async function sauvegarderRole() {
    setSavingRoles(true)
    try {
      const ordonnes = await enregistrerAccesRole(roleConfigActif, accesRoles[roleConfigActif] || [])
      setAccesRoles(prev => ({ ...prev, [roleConfigActif]: ordonnes }))
      Alert.alert('✅ Enregistré', `Accès du rôle « ${roleConfigActif} » mis à jour. Les utilisateurs verront le changement à leur prochaine ouverture de l'app.`)
    } catch (e) {
      Alert.alert('Erreur', e?.message || "Impossible d'enregistrer les accès.")
    }
    setSavingRoles(false)
  }

  async function ouvrirModal(type, data = null, defaults = {}) {
    // Un compte technique n'a pas de vrai PIN : en donner un en fait un compte normal.
    setForm(data ? { ...data, ...(estCompteTechnique(data) ? { pin: '' } : {}) } : { ...defaults })
    setModal({ visible: true, type, data })
    setCreditActuel(null)
    setOngletTravailleur('infos')
    setDocsTravailleur([])
    setAjoutDocVisible(false)
    setFormDoc({ type_document: 'CNI', description: '' })

    if (type === 'travailleur' && data?.id) {
      chargerDocsTravailleur(data.id)
    }

    if (type === 'fournisseur' && data?.id && isManager) {
      setCreditActuel(data.credit_actuel ?? 0)
      setMontantCotise(data.montant_cotise ?? 0)
    }
  }

  // Nouveau crédit et avance cotisée deviennent des écritures de l'historique
  // (lib/creditsFournisseurs.js → ecrituresFicheFournisseur). Écrire seulement
  // credit_actuel / montant_cotise faisait diverger Crédits fournisseurs et
  // Déductions gérant, et le montant cotisé était retiré à chaque journée.
  async function modifierCredit(fournisseurId, nouveauCredit, nouveauCotise) {
    const mc = nouveauCotise === '' || nouveauCotise == null ? NaN : parseFloat(nouveauCotise)
    if (!isNaN(mc) && mc < 0) {
      Alert.alert('Erreur', 'Le montant cotisé ne peut pas être négatif.')
      return false
    }
    try {
      const derniers = await chargerDerniersRestes(supabase, [fournisseurId])
      const ecarts = ecrituresFicheFournisseur({
        resteChaine: Number(derniers[fournisseurId]?.reste) || 0,
        nouveauCredit, avance: nouveauCotise,
      })
      for (const [i, delta] of ecarts.entries()) {
        const e = ecritureAjustementCredit(delta)
        const { data: txId, error } = await supabase.rpc('inserer_transaction_hors_point', {
          p_fournisseur: fournisseurId, p_date: aujourdhuiISO(),
          p_facture: e.facture, p_paye: e.paye,
          p_saisi_par: 'manager', p_source: 'ajustement_manager', p_caissier_nom: userNom || null,
        })
        if (error) throw error
        const estAvance = i === ecarts.length - 1 && !isNaN(mc) && mc > 0
        if (txId) {
          await supabase.from('transactions_fournisseurs')
            .update({ facture_correction_raison: estAvance ? 'Montant cotisé (avance en attente de facture)' : 'Crédit corrigé dans Paramètres' })
            .eq('id', txId)
        }
      }
      // credit_actuel suit la fonction SQL ; on l'aligne sur le crédit voulu s'il avait dérivé.
      if (nouveauCredit !== '' && nouveauCredit != null && !isNaN(parseFloat(nouveauCredit))) {
        const voulu = parseFloat(nouveauCredit) - (!isNaN(mc) && mc > 0 ? mc : 0)
        await supabase.from('fournisseurs').update({ credit_actuel: voulu, montant_cotise: 0 }).eq('id', fournisseurId)
      } else {
        await supabase.from('fournisseurs').update({ montant_cotise: 0 }).eq('id', fournisseurId)
      }
      if (ecarts.length) {
        journaliser('modif_credit_fournisseur', {
          ecarts, nouveau_credit: nouveauCredit || null, avance: !isNaN(mc) && mc > 0 ? mc : null, depuis: 'parametres',
        }, { userId }).catch(() => {})
      }
    } catch (err) {
      Alert.alert('Erreur', err?.message || 'Impossible de modifier le crédit')
      return false
    }
    return true
  }

  // Colonnes de supabase_factures_mensuelles.sql. Envoyées seulement quand le
  // champ existe (fiche relue après migration, ou saisi par le manager) : sinon
  // l'enregistrement d'un fournisseur échouerait tant que la migration n'est pas passée.
  function champsFactureMensuelle() {
    if (!isManager || form.facture_mensuelle === undefined || form.facture_mensuelle === null) return {}
    const montant = Math.round(parseFloat(form.facture_mensuelle) || 0)
    return {
      facture_mensuelle: montant,
      facture_mensuelle_depuis: montant > 0 ? (form.facture_mensuelle_depuis || premierDuMois(0)) : null,
      // Colonne de supabase_fournisseurs_administratifs.sql : seulement si connue.
      ...(form.facture_periodicite !== undefined
        ? { facture_periodicite: form.facture_periodicite === 'annuel' ? 'annuel' : 'mensuel' } : {}),
    }
  }

  async function sauvegarder() {
    const { type, data } = modal
    setLoading(true)

    try {
      // ── RESTAURANT ──────────────────────────────────────────
      if (type === 'restaurant') {
        if (!form.nom) {
          Alert.alert('Erreur', 'Le nom est obligatoire')
          setLoading(false); return
        }
        if (!form.pin || form.pin.length !== 4) {
          Alert.alert('Erreur', 'Le PIN du restaurant doit avoir 4 chiffres')
          setLoading(false); return
        }
        if (data?.id) {
          const { error } = await supabase.from('restaurants')
            .update({
              nom: form.nom,
              localisation: form.localisation,
              couleur: form.couleur,
              pin: form.pin,
              photo_url: form.photo_url || null,
            })
            .eq('id', data.id)
          if (error) throw error
        } else {
          const { error } = await supabase.from('restaurants')
            .insert({
              nom: form.nom,
              localisation: form.localisation,
              couleur: form.couleur || 'orange',
              pin: form.pin,
              photo_url: form.photo_url || null,
            })
          if (error) throw error
        }
      }

      // ── TRAVAILLEUR ─────────────────────────────────────────
      if (type === 'travailleur') {
        if (!form.nom) {
          Alert.alert('Erreur', 'Le nom est obligatoire')
          setLoading(false); return
        }
        if (!form.restaurant_id) {
          Alert.alert('Erreur', 'Choisissez un restaurant')
          setLoading(false); return
        }
        if (data?.id) {
          const { error } = await supabase.from('travailleurs')
            .update({
              nom: form.nom,
              poste: form.poste,
              type_contrat: form.type_contrat,
              restaurant_id: form.restaurant_id,
              identifiant: form.identifiant || null,
              contact: form.contact || null,
              photo_url: form.photo_url || null,
              salaire_journalier: parseInt(form.salaire_journalier) || null,
              date_embauche: form.date_embauche || null,
            })
            .eq('id', data.id)
          if (error) throw error
        } else {
          const { error } = await supabase.from('travailleurs')
            .insert({
              nom: form.nom,
              poste: form.poste,
              type_contrat: form.type_contrat || 'CDD',
              restaurant_id: form.restaurant_id,
              identifiant: form.identifiant || null,
              contact: form.contact || null,
              photo_url: form.photo_url || null,
              salaire_journalier: parseInt(form.salaire_journalier) || null,
              date_embauche: form.date_embauche || null,
              actif: true,
              statut: 'actif',
            })
          if (error) throw error
          // Notifier l'ajout (comme l'écran Équipe globale) — manager + directeur.
          let restoNom = restaurants.find(r => r.id === form.restaurant_id)?.nom || ''
          if (!restoNom && form.restaurant_id) {
            const { data: r } = await supabase.from('restaurants').select('nom').eq('id', form.restaurant_id).maybeSingle()
            restoNom = r?.nom || ''
          }
          creerNotification({
            type: 'nouveau_travailleur',
            titre: '👤 Nouveau travailleur',
            message: `${form.nom}${restoNom ? ` ajouté à ${restoNom}` : ' ajouté'}`,
            restaurant_id: form.restaurant_id || null,
            cible_role: ['manager', 'directeur'],
            screen: 'equipe',
          }).catch(() => {})
        }
      }

      // ── UTILISATEUR ─────────────────────────────────────────
      if (type === 'utilisateur') {
        if (!form.nom || !form.pin) {
          Alert.alert('Erreur', 'Nom et PIN obligatoires')
          setLoading(false); return
        }
        if (form.pin.length !== 4) {
          Alert.alert('Erreur', 'Le PIN doit avoir 4 chiffres')
          setLoading(false); return
        }
        const estGlobal = ROLES_GLOBAUX.includes(form.role)
        if (!form.restaurant_id && !estGlobal) {
          Alert.alert('Erreur', 'Choisissez un restaurant pour ce rôle')
          setLoading(false); return
        }
        if (data?.id) {
          const { error } = await supabase.from('utilisateurs')
            .update({
              nom: form.nom,
              role: form.role,
              pin: form.pin,
              restaurant_id: estGlobal ? null : form.restaurant_id,
            })
            .eq('id', data.id)
          if (error) throw error
        } else {
          const { error } = await supabase.from('utilisateurs')
            .insert({
              nom: form.nom,
              role: form.role || 'caissier',
              pin: form.pin,
              actif: true,
              restaurant_id: estGlobal ? null : form.restaurant_id,
            })
          if (error) throw error
        }
      }

      // ── FOURNISSEUR ─────────────────────────────────────────
      if (type === 'fournisseur') {
        if (!form.nom) {
          Alert.alert('Erreur', 'Le nom est obligatoire')
          setLoading(false); return
        }
        if ((parseFloat(form.facture_mensuelle) || 0) < 0) {
          Alert.alert('Erreur', 'La facture mensuelle ne peut pas être négative.')
          setLoading(false); return
        }
        if (data?.id) {
          // Modification d'un fournisseur existant
          if (!form.restaurant_id) {
            Alert.alert('Erreur', 'Choisissez un restaurant')
            setLoading(false); return
          }
          const { error } = await supabase.from('fournisseurs')
            .update({
              nom: form.nom,
              type: form.type,
              restaurant_id: form.restaurant_id,
              identifiant: form.identifiant || null,
              contact: form.contact || null,
              ...champsFactureMensuelle(),
            })
            .eq('id', data.id)
          if (error) throw error

          // Modification du crédit et du montant cotisé (manager uniquement)
          // Seulement ce qui a été tapé : un champ laissé vide ne crée aucune écriture.
          if (isManager && (form.nouveau_credit || form.nouveau_montant_cotise)) {
            const ok = await modifierCredit(data.id, form.nouveau_credit || '', form.nouveau_montant_cotise || '')
            if (!ok) { setLoading(false); return }
          }
        } else {
          // Création multi-restaurants
          const ids = form.restaurant_ids || []
          if (ids.length === 0) {
            Alert.alert('Erreur', 'Choisissez au moins un restaurant')
            setLoading(false); return
          }
          for (const rId of ids) {
            const { data: newFour, error } = await supabase.from('fournisseurs')
              .insert({
                nom: form.nom,
                type: form.type || 'fournisseur',
                restaurant_id: rId,
                identifiant: form.identifiant || null,
                contact: form.contact || null,
                actif: true,
                ...champsFactureMensuelle(),
              })
              .select()
            if (error) throw error
            if (newFour?.[0]?.id) {
              await supabase.from('fournisseurs_restaurants').upsert(
                { fournisseur_id: newFour[0].id, restaurant_id: rId, credit_actuel: 0 },
                { onConflict: 'fournisseur_id,restaurant_id' }
              )
            }
          }
        }
      }

      setModal({ visible: false, type: '', data: null })
      setLoading(false)
      chargerDonnees()
      chargerTousRestaurants()
      Alert.alert('Succès', 'Enregistré !')
    } catch (error) {
      setLoading(false)
      Alert.alert('Erreur', error.message || "Impossible d'enregistrer")
    }
  }

  async function choisirPhotoResto() {
    if (Platform.OS === 'web') {
      setUploadingPhoto(true)
      const url = await choisirPhoto('restaurants')
      if (url) setForm(p => ({ ...p, photo_url: url }))
      setUploadingPhoto(false)
      return
    }
    setUploadingPhoto(true)
    Alert.alert('Photo du restaurant', 'Choisir la source', [
      {
        text: '📷 Caméra',
        onPress: async () => {
          const url = await prendrePhoto('restaurants')
          if (url) setForm(p => ({ ...p, photo_url: url }))
          setUploadingPhoto(false)
        }
      },
      {
        text: '🖼 Galerie',
        onPress: async () => {
          const url = await choisirPhoto('restaurants')
          if (url) setForm(p => ({ ...p, photo_url: url }))
          setUploadingPhoto(false)
        }
      },
      { text: 'Annuler', style: 'cancel', onPress: () => setUploadingPhoto(false) }
    ])
  }

  async function choisirPhotoProfil() {
    if (Platform.OS === 'web') {
      setUploadingPhoto(true)
      const url = await choisirPhoto('travailleurs')
      if (url) setForm(p => ({ ...p, photo_url: url }))
      setUploadingPhoto(false)
      return
    }
    setUploadingPhoto(true)
    Alert.alert('Photo de profil', 'Choisir la source', [
      {
        text: '📷 Caméra',
        onPress: async () => {
          const url = await prendrePhoto('travailleurs')
          if (url) setForm(p => ({ ...p, photo_url: url }))
          setUploadingPhoto(false)
        }
      },
      {
        text: '🖼 Galerie',
        onPress: async () => {
          const url = await choisirPhoto('travailleurs')
          if (url) setForm(p => ({ ...p, photo_url: url }))
          setUploadingPhoto(false)
        }
      },
      { text: 'Annuler', style: 'cancel', onPress: () => setUploadingPhoto(false) }
    ])
  }

  async function chargerDocsTravailleur(travailleurId) {
    setLoadingDocs(true)
    const { data } = await supabase
      .from('documents_travailleurs')
      .select('*')
      .eq('travailleur_id', travailleurId)
      .order('created_at')
    setDocsTravailleur(data || [])
    setLoadingDocs(false)
  }

  async function ajouterDocument(source) {
    setUploadingDoc(true)
    try {
      const url = source === 'camera'
        ? await prendrePhoto('documents-travailleurs')
        : await choisirPhoto('documents-travailleurs')
      if (!url) return
      const { error } = await supabase.from('documents_travailleurs').insert({
        travailleur_id: modal.data.id,
        type_document: formDoc.type_document,
        fichier_url: url,
        description: formDoc.description || null,
      })
      if (!error) {
        creerNotification({
          type: 'nouveau_document',
          titre: '📄 Document travailleur',
          message: `${formDoc.type_document} ajouté${modal.data?.nom ? ` — ${modal.data.nom}` : ''}`,
          restaurant_id: modal.data?.restaurant_id || null,
          cible_role: ['manager', 'directeur'],
          screen: 'equipe',
        }).catch(() => {})
        setAjoutDocVisible(false)
        setFormDoc({ type_document: 'CNI', description: '' })
        chargerDocsTravailleur(modal.data.id)
      } else {
        Alert.alert('Erreur', error.message || 'Impossible d\'enregistrer le document')
      }
    } finally {
      setUploadingDoc(false)
    }
  }

  function gererPhotoDoc() {
    if (Platform.OS === 'web') {
      ajouterDocument('gallery')
    } else {
      Alert.alert('Ajouter un document', 'Choisir la source', [
        { text: 'Annuler', style: 'cancel' },
        { text: '📷 Caméra', onPress: () => ajouterDocument('camera') },
        { text: '🖼 Galerie', onPress: () => ajouterDocument('gallery') },
      ])
    }
  }

  async function supprimerDocument(docId) {
    Alert.alert('Supprimer', 'Supprimer ce document ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        await supabase.from('documents_travailleurs').delete().eq('id', docId)
        chargerDocsTravailleur(modal.data.id)
      }},
    ])
  }

  async function toggleActif(table, id, actif) {
    await supabase.from(table).update({ actif: !actif }).eq('id', id)
    chargerDonnees()
  }

  async function supprimer(table, id, nom) {
    if (nom === 'Manager General' || nom === 'Administrateur') {
      Alert.alert('Impossible', 'Le Manager General et l\'Administrateur ne peuvent pas être supprimés.')
      return
    }
    Alert.alert('Confirmer', `Supprimer ${nom} ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        // L'erreur était jetée : la liste se rechargeait à l'identique et la
        // suppression paraissait ne rien faire. Un compte qui a des shifts,
        // des pointages ou des inventaires est protégé par la base.
        const { error } = await supabase.from(table).delete().eq('id', id)
        if (!error) {
          chargerDonnees()
          return
        }

        const info = expliquerEchecSuppression(table, error)
        if (!info.proposerDesactivation) {
          Alert.alert(info.titre, info.texte)
          return
        }

        Alert.alert(info.titre, info.texte, [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Désactiver', onPress: async () => {
            const { error: erreurDesactivation } = await supabase
              .from(table).update({ actif: false }).eq('id', id)
            if (erreurDesactivation) {
              Alert.alert('Désactivation impossible', erreurDesactivation.message)
              return
            }
            chargerDonnees()
          }},
        ])
      }}
    ])
  }

  /**
   * Bascule un restaurant entre Samtrackly et le POS.
   *
   * Vers le POS : refusé tant qu'aucun shift n'est arrivé du POS pour ce site.
   * C'est la garde qui aurait évité l'incident du 2026-08-17 — Angré 7E avait la
   * caisse installée mais aucune remontée, et basculer ce jour-là aurait fait
   * disparaître trois caissières sans rien mettre à la place.
   *
   * Vers Samtrackly : jamais refusé. C'est la sortie de secours du soir où un
   * mini-PC meurt, elle ne se discute pas.
   */
  async function basculerRestaurant(resto, versPOS) {
    const diag = diagnosticBascule(resto, comptesShifts?.[resto.id])

    if (versPOS && !diag.peutBasculer) {
      Alert.alert('Bascule impossible', diag.message)
      return
    }

    const titre = versPOS ? `Basculer ${resto.nom} vers le POS ?` : `Rendre la saisie à ${resto.nom} ?`
    const corps = versPOS
      ? `Les caissières de ${resto.nom} ne s'afficheront plus à la connexion. Leur point, `
        + `leurs dépenses et leur inventaire devront arriver du POS.\n\n`
        + `Leurs comptes ne sont pas supprimés : cette bascule s'annule en un geste.`
      : `Les caissières de ${resto.nom} pourront de nouveau se connecter et faire leur point ici.\n\n`
        + `À utiliser si la caisse du site est en panne. Pensez à vérifier qu'un même shift `
        + `ne soit pas saisi deux fois.`

    Alert.alert(titre, corps, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: versPOS ? 'Basculer' : 'Rendre la saisie',
        style: versPOS ? 'destructive' : 'default',
        onPress: async () => {
          const cible = versPOS ? SOURCE_POS : SOURCE_SAMTRACKLY
          const { data, error } = await supabase
            .from('restaurants')
            .update({ source_point: cible })
            .eq('id', resto.id)
            .select('id, source_point')

          // Un UPDATE qui ne touche aucune ligne ne lève pas d'erreur : sans ce
          // contrôle on croirait le site basculé alors que rien n'a bougé.
          if (error || !data?.length) {
            Alert.alert('Échec', error?.message || 'Aucune ligne modifiée — le site n\'a pas été basculé.')
            return
          }

          journaliser(
            ACTIONS.BASCULE_POS,
            { restaurant: resto.nom, vers: cible, diagnostic: diag.etat },
            { restaurantId: resto.id, userId, userNom },
          ).catch(() => {})

          Alert.alert(
            versPOS ? '✅ Site basculé' : '✅ Saisie rendue',
            versPOS
              ? `${resto.nom} est sur le POS. Ses caissières ne se connectent plus ici.`
              : `${resto.nom} est revenu sur Samtrackly. Ses caissières peuvent se reconnecter.`,
          )
          chargerDonnees()
        },
      },
    ])
  }

  function SelectRestaurant() {
    return (
      <>
        <Text style={styles.modalLabel}>Restaurant *</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 14 }}>
          {tousRestaurants.map(r => {
            const selected = form.restaurant_id === r.id
            return (
              <TouchableOpacity
                key={r.id}
                style={[styles.restoBadgeBtn, selected && styles.restoBadgeBtnSelected]}
                onPress={() => setForm(p => ({ ...p, restaurant_id: r.id }))}
              >
                {r.photo_url ? (
                  <Image source={{ uri: r.photo_url }} style={styles.restoBadgeImg} />
                ) : (
                  <View style={[styles.restoBadgeAvatar, { backgroundColor: r.couleur === 'vert' ? '#2D7D46' : '#EF9F27' }]}>
                    <Text style={styles.restoBadgeAvatarTxt}>{r.nom.slice(0, 2).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={[styles.restoBadgeTxt, selected && styles.restoBadgeTxtSelected]} numberOfLines={1}>
                  {r.nom}
                </Text>
                {selected && <Text style={styles.restoBadgeCheck}>✓</Text>}
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </>
    )
  }

  function SelectMultipleRestaurants() {
    const ids = form.restaurant_ids || []
    return (
      <>
        <Text style={styles.modalLabel}>Restaurants * (sélection multiple)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {tousRestaurants.map(r => {
            const selected = ids.includes(r.id)
            return (
              <TouchableOpacity
                key={r.id}
                style={[styles.restoBadgeBtn, selected && styles.restoBadgeBtnSelected]}
                onPress={() => setForm(p => {
                  const prev = p.restaurant_ids || []
                  return {
                    ...p,
                    restaurant_ids: selected
                      ? prev.filter(id => id !== r.id)
                      : [...prev, r.id]
                  }
                })}
              >
                {r.photo_url ? (
                  <Image source={{ uri: r.photo_url }} style={styles.restoBadgeImg} />
                ) : (
                  <View style={[styles.restoBadgeAvatar, { backgroundColor: r.couleur === 'vert' ? '#2D7D46' : '#EF9F27' }]}>
                    <Text style={styles.restoBadgeAvatarTxt}>{r.nom.slice(0, 2).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={[styles.restoBadgeTxt, selected && styles.restoBadgeTxtSelected]} numberOfLines={1}>
                  {r.nom}
                </Text>
                {selected && <Text style={styles.restoBadgeCheck}>✓</Text>}
              </TouchableOpacity>
            )
          })}
        </View>
        {ids.length > 0 && (
          <View style={styles.infoBox}>
            <Text style={styles.infoTxt}>
              {ids.length} restaurant{ids.length > 1 ? 's' : ''} sélectionné{ids.length > 1 ? 's' : ''} — un fournisseur sera créé pour chacun.
            </Text>
          </View>
        )}
      </>
    )
  }

  function FiltreRestaurants() {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.filtreBar, { flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 2, paddingBottom: 10 }}>
        {tousRestaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.filtrePill, restaurantFiltre === r.id && styles.filtrePillActive]}
            onPress={() => setRestaurantFiltre(r.id)}
          >
            <View style={[styles.filtreDot, { backgroundColor: r.couleur === 'vert' ? '#2D7D46' : '#EF9F27', opacity: restaurantFiltre === r.id ? 1 : 0.4 }]} />
            <Text style={[styles.filtrePillTxt, restaurantFiltre === r.id && styles.filtrePillTxtActive]}>
              {r.nom}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    )
  }

  // ─── RENDU RESTAURANTS ─────────────────────────────────────
  function renderRestaurants() {
    return (
      <>
        <TouchableOpacity style={styles.addBtn} onPress={() => ouvrirModal('restaurant')}>
          <Text style={styles.addTxt}>+ Ajouter un restaurant</Text>
        </TouchableOpacity>
        {restaurants.map(r => (
          <View key={r.id}>
          <View style={styles.itemCard}>
            <View style={styles.itemLeft}>
              {r.photo_url ? (
                <Image source={{ uri: r.photo_url }} style={{ width: 40, height: 40, borderRadius: 10 }} />
              ) : (
                <View style={[styles.itemDot, { width: 40, height: 40, borderRadius: 10, backgroundColor: r.couleur === 'vert' ? '#2D7D46' : '#EF9F27', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>{r.nom.slice(0, 2).toUpperCase()}</Text>
                </View>
              )}
              <View>
                <Text style={styles.itemNom}>{r.nom}</Text>
                <Text style={styles.itemSub}>{r.localisation || 'Pas de localisation'}</Text>
                <Text style={styles.itemPin}>PIN: {r.pin || '----'}</Text>
              </View>
            </View>
            <View style={styles.itemActions}>
              <TouchableOpacity style={styles.editBtn} onPress={() => ouvrirModal('restaurant', r)}>
                <Text style={styles.editTxt}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => supprimer('restaurants', r.id, r.nom)}>
                <Text style={styles.deleteTxt}>🗑</Text>
              </TouchableOpacity>
            </View>
          </View>
          <CarteBascule resto={r} />
          </View>
        ))}
      </>
    )
  }

  /**
   * Sous la carte d'un restaurant : d'où vient son point, et le geste pour
   * changer ça. Le diagnostic est toujours affiché, y compris quand la bascule
   * est impossible — c'est justement là qu'il faut expliquer pourquoi.
   */
  function CarteBascule({ resto: r }) {
    const surPOS = estSurPOS(r)
    const diag = diagnosticBascule(r, comptesShifts?.[r.id])
    const inconnu = comptesShifts === null

    const teinte = surPOS
      ? (diag.etat === ETAT_BASCULE.INCOHERENT ? colors.error : colors.success)
      : (diag.etat === ETAT_BASCULE.PRET ? colors.primary : colors.textMuted)

    return (
      <View style={[styles.bascCard, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
        <View style={styles.bascHead}>
          <View style={[styles.bascPuce, { backgroundColor: teinte }]} />
          <Text style={[styles.bascSource, { color: colors.text }]}>
            {surPOS ? 'Point reçu du POS' : 'Point saisi dans Samtrackly'}
          </Text>
          {diag.etat === ETAT_BASCULE.INCOHERENT && (
            <Text style={[styles.bascAlerte, { color: colors.error, backgroundColor: colors.errorLight }]}>
              à vérifier
            </Text>
          )}
        </View>

        <Text style={[styles.bascMsg, { color: colors.textSecondary }]}>
          {inconnu
            ? 'Impossible de savoir si la remontée du POS fonctionne pour ce site (migration supabase_pos_bascule.sql pas encore passée). La bascule reste indisponible.'
            : diag.message}
        </Text>

        {!inconnu && diag.peutBasculer && (
          <TouchableOpacity
            style={[styles.bascBtn, { backgroundColor: colors.primary }]}
            onPress={() => basculerRestaurant(r, true)}
          >
            <Text style={styles.bascBtnTxt}>Basculer vers le POS</Text>
          </TouchableOpacity>
        )}

        {diag.peutRevenir && (
          <TouchableOpacity
            style={[styles.bascBtn, { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.error }]}
            onPress={() => basculerRestaurant(r, false)}
          >
            <Text style={[styles.bascBtnTxt, { color: colors.error }]}>
              Rendre la saisie à Samtrackly
            </Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  // ─── RENDU TRAVAILLEURS ────────────────────────────────────
  function renderTravailleurs() {
    const filtres = travailleurs.filter(t => !restaurantFiltre || t.restaurant_id === restaurantFiltre)
    const restoNom = tousRestaurants.find(r => r.id === restaurantFiltre)?.nom || ''
    return (
      <>
        <FiltreRestaurants />
        <TouchableOpacity style={styles.addBtn} onPress={() => ouvrirModal('travailleur', null, { restaurant_id: restaurantFiltre, date_embauche: aujourdhuiISO() })}>
          <Text style={styles.addTxt}>+ Ajouter un travailleur {restoNom ? `— ${restoNom}` : ''}</Text>
        </TouchableOpacity>
        {filtres.length === 0 && (
          <View style={styles.emptyFiltreBox}>
            <Text style={styles.emptyFiltreTxt}>Aucun travailleur pour ce restaurant</Text>
          </View>
        )}
        {filtres.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[styles.itemCard, !t.actif && styles.itemCardInactif]}
            onPress={() => setBadgeTravailleur(t)}
            activeOpacity={0.75}
          >
            <View style={styles.itemLeft}>
              {t.photo_url ? (
                <Image source={{ uri: t.photo_url }} style={styles.avatarPhoto} />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarTxt}>
                    {t.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}
              <View>
                <Text style={[styles.itemNom, !t.actif && { color: '#aaa' }]}>{t.nom}</Text>
                <Text style={styles.itemSub}>{t.poste} — {t.type_contrat}</Text>
                {t.identifiant && <Text style={styles.itemPin}>ID: {t.identifiant}</Text>}
                {t.contact && <Text style={styles.itemSub}>{t.contact}</Text>}
              </View>
            </View>
            <View style={styles.itemActions}>
              <TouchableOpacity
                style={[styles.statutBtn, { backgroundColor: t.actif ? '#EAF3DE' : '#FAECE7' }]}
                onPress={(e) => { e.stopPropagation?.(); toggleActif('travailleurs', t.id, t.actif) }}
              >
                <Text style={[styles.statutTxt, { color: t.actif ? '#3B6D11' : '#993C1D' }]}>
                  {t.actif ? 'Actif' : 'Inactif'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.editBtn}
                onPress={(e) => { e.stopPropagation?.(); ouvrirModal('travailleur', t) }}
              >
                <Text style={styles.editTxt}>✏️</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}
      </>
    )
  }

  // ─── RENDU UTILISATEURS ────────────────────────────────────
  function renderUtilisateurs() {
    const isManagerOuAdmin = (u) => u.nom === 'Manager General' || u.nom === 'Administrateur'
    const globaux = utilisateurs.filter(u => isManagerOuAdmin(u))
    const filtres = utilisateurs.filter(u => !isManagerOuAdmin(u) && (!restaurantFiltre || u.restaurant_id === restaurantFiltre))
    const restoNom = tousRestaurants.find(r => r.id === restaurantFiltre)?.nom || ''
    return (
      <>
        <FiltreRestaurants />
        <TouchableOpacity style={styles.addBtn} onPress={() => ouvrirModal('utilisateur', null, { restaurant_id: restaurantFiltre })}>
          <Text style={styles.addTxt}>+ Ajouter un utilisateur {restoNom ? `— ${restoNom}` : ''}</Text>
        </TouchableOpacity>

        {globaux.map(u => (
          <View key={u.id} style={[styles.itemCard, styles.itemCardManager]}>
            <View style={styles.itemLeft}>
              <View style={[styles.avatar, { backgroundColor: '#534AB7' }]}>
                <Text style={styles.avatarTxt}>
                  {u.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.itemNom}>{u.nom}</Text>
                <Text style={styles.itemSub}>{u.role} — PIN: {u.pin}</Text>
                <Text style={styles.itemSub2}>Accès global — tous les restaurants</Text>
              </View>
            </View>
            <View style={styles.itemActions}>
              <View style={styles.globalBadge}>
                <Text style={styles.globalTxt}>Global</Text>
              </View>
              <TouchableOpacity style={styles.editBtn} onPress={() => ouvrirModal('utilisateur', u)}>
                <Text style={styles.editTxt}>✏️</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {filtres.length === 0 ? (
          <View style={styles.emptyFiltreBox}>
            <Text style={styles.emptyFiltreTxt}>Aucun utilisateur pour ce restaurant</Text>
          </View>
        ) : (
          <>
            <Text style={styles.separateur}>Utilisateurs — {restoNom}</Text>
            {filtres.map(u => (
              <View key={u.id} style={[styles.itemCard, !u.actif && styles.itemCardInactif]}>
                <View style={styles.itemLeft}>
                  <View style={[styles.avatar, { backgroundColor: u.role === 'gerant' ? '#EF9F27' : '#888' }]}>
                    <Text style={styles.avatarTxt}>
                      {u.nom.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View>
                    <Text style={[styles.itemNom, !u.actif && { color: '#aaa' }]}>{u.nom}</Text>
                    <Text style={styles.itemSub}>
                      {estCompteTechnique(u) ? `${u.role} — sans connexion (compte du POS)` : `${u.role} — PIN: ${u.pin}`}
                    </Text>
                  </View>
                </View>
                <View style={styles.itemActions}>
                  <TouchableOpacity
                    style={[styles.statutBtn, { backgroundColor: u.actif ? '#EAF3DE' : '#FAECE7' }]}
                    onPress={() => toggleActif('utilisateurs', u.id, u.actif)}
                  >
                    <Text style={[styles.statutTxt, { color: u.actif ? '#3B6D11' : '#993C1D' }]}>
                      {u.actif ? 'Actif' : 'Inactif'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editBtn} onPress={() => ouvrirModal('utilisateur', u)}>
                    <Text style={styles.editTxt}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => supprimer('utilisateurs', u.id, u.nom)}>
                    <Text style={styles.deleteTxt}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}
      </>
    )
  }

  // ─── RENDU FOURNISSEURS ────────────────────────────────────
  function renderFournisseurs() {
    const filtres = fournisseurs.filter(f => !restaurantFiltre || f.restaurant_id === restaurantFiltre)
    const restoNom = tousRestaurants.find(r => r.id === restaurantFiltre)?.nom || ''
    return (
      <>
        <FiltreRestaurants />
        <TouchableOpacity style={styles.addBtn} onPress={() => ouvrirModal('fournisseur', null, { restaurant_ids: restaurantFiltre ? [restaurantFiltre] : [] })}>
          <Text style={styles.addTxt}>+ Ajouter un fournisseur {restoNom ? `— ${restoNom}` : ''}</Text>
        </TouchableOpacity>
        {filtres.length === 0 && (
          <View style={styles.emptyFiltreBox}>
            <Text style={styles.emptyFiltreTxt}>Aucun fournisseur pour ce restaurant</Text>
          </View>
        )}
        {filtres.map(f => (
          <View key={f.id} style={[styles.itemCard, !f.actif && styles.itemCardInactif]}>
            <View style={styles.itemLeft}>
              <View style={[styles.typeBadge, f.type === 'cotisation' && styles.typeBadgeCotis, f.type === 'administratif' && styles.typeBadgeAdmin]}>
                <Text style={[styles.typeTxt, f.type === 'cotisation' && styles.typeTxtCotis, f.type === 'administratif' && styles.typeTxtAdmin]}>
                  {f.type === 'cotisation' ? 'Cotis.' : f.type === 'administratif' ? 'Admin.' : 'Fourn.'}
                </Text>
              </View>
              <View>
                <Text style={[styles.itemNom, !f.actif && { color: '#aaa' }]}>{f.nom}</Text>
                {f.identifiant && <Text style={styles.itemPin}>ID: {f.identifiant}</Text>}
                {f.contact && <Text style={styles.itemSub}>{f.contact}</Text>}
              </View>
            </View>
            <View style={styles.itemActions}>
              <TouchableOpacity
                style={[styles.statutBtn, { backgroundColor: f.actif ? '#EAF3DE' : '#FAECE7' }]}
                onPress={() => toggleActif('fournisseurs', f.id, f.actif)}
              >
                <Text style={[styles.statutTxt, { color: f.actif ? '#3B6D11' : '#993C1D' }]}>
                  {f.actif ? 'Actif' : 'Inactif'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editBtn} onPress={() => ouvrirModal('fournisseur', f)}>
                <Text style={styles.editTxt}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => supprimer('fournisseurs', f.id, f.nom)}>
                <Text style={styles.deleteTxt}>🗑</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </>
    )
  }

  // ─── CONTENU MODAL ─────────────────────────────────────────
  function renderModalContent() {
    const { type } = modal
    const estGlobal = ROLES_GLOBAUX.includes(form.role)

    if (type === 'restaurant') return (
      <>
        <Text style={styles.modalTitre}>{modal.data ? 'Modifier restaurant' : 'Nouveau restaurant'}</Text>

        {/* Photo du restaurant */}
        <View style={styles.photoProfilBox}>
          {form.photo_url ? (
            <Image source={{ uri: form.photo_url }} style={styles.restoPhotoPreview} />
          ) : (
            <View style={[styles.photoProfilVide, { borderRadius: 14 }]}>
              <Text style={styles.photoProfilVideEmoji}>🏪</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.photoProfilBtn}
            onPress={choisirPhotoResto}
            disabled={uploadingPhoto}
          >
            <Text style={styles.photoProfilBtnTxt}>
              {uploadingPhoto ? '⏳ Chargement...' : form.photo_url ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.modalLabel}>Nom du restaurant *</Text>
        <TextInput
          style={styles.modalInput}
          value={form.nom || ''}
          onChangeText={v => setForm(p => ({ ...p, nom: v }))}
          placeholder="Ex: Samer Angré 7E"
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Localisation</Text>
        <TextInput
          style={styles.modalInput}
          value={form.localisation || ''}
          onChangeText={v => setForm(p => ({ ...p, localisation: v }))}
          placeholder="Ex: Angré 7e, Abidjan"
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Code PIN du restaurant * (4 chiffres)</Text>
        <TextInput
          style={styles.modalInput}
          value={form.pin || ''}
          onChangeText={v => setForm(p => ({ ...p, pin: v }))}
          placeholder="Ex: 1234"
          keyboardType="numeric"
          maxLength={4}
          placeholderTextColor="#bbb"
          secureTextEntry={false}
        />
        <View style={styles.pinInfo}>
          <Text style={styles.pinInfoTxt}>
            🔒 Ce code sera demandé à tous les utilisateurs avant d'accéder au restaurant
          </Text>
        </View>

        <Text style={styles.modalLabel}>Famille</Text>
        <View style={styles.couleurRow}>
          {[
            { val: 'orange', label: '🟡 Samer', bg: '#EF9F27' },
            { val: 'vert', label: '🟢 Al Kayan', bg: '#2D7D46' }
          ].map(c => (
            <TouchableOpacity
              key={c.val}
              style={[
                styles.couleurBtn,
                { backgroundColor: c.bg },
                form.couleur === c.val && styles.couleurBtnSelected
              ]}
              onPress={() => setForm(p => ({ ...p, couleur: c.val }))}
            >
              <Text style={styles.couleurTxt}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </>
    )

    if (type === 'travailleur') return (
      <>
        <Text style={styles.modalTitre}>{modal.data ? 'Modifier travailleur' : 'Nouveau travailleur'}</Text>

        {/* Onglets Infos / Documents */}
        <View style={styles.ongletRow}>
          {[
            { key: 'infos', label: '📋 Infos' },
            { key: 'documents', label: `📄 Documents${docsTravailleur.length > 0 ? ` (${docsTravailleur.length})` : ''}` },
          ].map(o => (
            <TouchableOpacity
              key={o.key}
              style={[styles.ongletBtn, ongletTravailleur === o.key && styles.ongletBtnActive]}
              onPress={() => setOngletTravailleur(o.key)}
            >
              <Text style={[styles.ongletTxt, ongletTravailleur === o.key && styles.ongletTxtActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {ongletTravailleur === 'infos' && (
          <>
            {/* Photo de profil */}
            <View style={styles.photoProfilBox}>
              {form.photo_url ? (
                <Image source={{ uri: form.photo_url }} style={styles.photoProfilPreview} />
              ) : (
                <View style={styles.photoProfilVide}>
                  <Text style={styles.photoProfilVideEmoji}>👤</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.photoProfilBtn}
                onPress={choisirPhotoProfil}
                disabled={uploadingPhoto}
              >
                <Text style={styles.photoProfilBtnTxt}>
                  {uploadingPhoto ? '⏳ Chargement...' : form.photo_url ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
                </Text>
              </TouchableOpacity>
            </View>

            <FormulaireTravailleur form={form} setForm={setForm} colors={colors} />

            <Text style={styles.modalLabel}>Identifiant unique</Text>
            <View style={styles.identifiantRow}>
              <TextInput
                style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
                value={form.identifiant || ''}
                onChangeText={v => setForm(p => ({ ...p, identifiant: v }))}
                placeholder="Ex: EMP-001"
                placeholderTextColor="#bbb"
                autoCapitalize="characters"
              />
              <TouchableOpacity
                style={styles.genererBtn}
                onPress={() => setForm(p => ({ ...p, identifiant: 'EMP-' + Date.now().toString().slice(-5) }))}
              >
                <Text style={styles.genererTxt}>Générer</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 14 }} />

            <SelectRestaurant />
          </>
        )}

        {ongletTravailleur === 'documents' && (
          <>
            {!modal.data ? (
              <View style={styles.infoBox}>
                <Text style={styles.infoTxt}>💡 Enregistrez d'abord le travailleur pour pouvoir ajouter des documents.</Text>
              </View>
            ) : (
              <>
                {loadingDocs ? (
                  <ActivityIndicator size="small" color="#EF9F27" style={{ marginVertical: 20 }} />
                ) : (
                  <>
                    {docsTravailleur.length === 0 && !ajoutDocVisible && (
                      <View style={styles.emptyFiltreBox}>
                        <Text style={styles.emptyFiltreTxt}>Aucun document enregistré</Text>
                      </View>
                    )}

                    {docsTravailleur.map(doc => (
                      <View key={doc.id} style={styles.docCard}>
                        <Image source={{ uri: doc.fichier_url }} style={styles.docThumb} />
                        <View style={styles.docInfo}>
                          <Text style={styles.docType}>{doc.type_document}</Text>
                          {doc.description ? <Text style={styles.docDesc}>{doc.description}</Text> : null}
                        </View>
                        <TouchableOpacity style={styles.docDelBtn} onPress={() => supprimerDocument(doc.id)}>
                          <Text style={{ fontSize: 16 }}>🗑</Text>
                        </TouchableOpacity>
                      </View>
                    ))}

                    {ajoutDocVisible ? (
                      <View style={styles.ajoutDocBox}>
                        <Text style={styles.modalLabel}>Type de document</Text>
                        <View style={styles.docTypeRow}>
                          {['CNI', 'Contrat', 'CNPS', 'Attestation', 'Autre'].map(t => (
                            <TouchableOpacity
                              key={t}
                              style={[styles.docTypeBtn, formDoc.type_document === t && styles.docTypeBtnActive]}
                              onPress={() => setFormDoc(p => ({ ...p, type_document: t }))}
                            >
                              <Text style={[styles.docTypeTxt, formDoc.type_document === t && styles.docTypeTxtActive]}>{t}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <Text style={styles.modalLabel}>Description (optionnel)</Text>
                        <TextInput
                          style={styles.modalInput}
                          value={formDoc.description}
                          onChangeText={v => setFormDoc(p => ({ ...p, description: v }))}
                          placeholder="Ex: CNI recto-verso"
                          placeholderTextColor="#bbb"
                        />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            style={[styles.modalCancel, { flex: 1 }]}
                            onPress={() => setAjoutDocVisible(false)}
                          >
                            <Text style={styles.modalCancelTxt}>Annuler</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.modalConfirm, { flex: 2 }, uploadingDoc && { opacity: 0.6 }]}
                            onPress={gererPhotoDoc}
                            disabled={uploadingDoc}
                          >
                            <Text style={styles.modalConfirmTxt}>
                              {uploadingDoc ? '⏳ Upload...' : '📷 Choisir la photo'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.addBtn, { marginTop: 10 }]}
                        onPress={() => setAjoutDocVisible(true)}
                      >
                        <Text style={styles.addTxt}>+ Ajouter un document</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </>
    )

    if (type === 'utilisateur') return (
      <>
        <Text style={styles.modalTitre}>{modal.data ? 'Modifier utilisateur' : 'Nouvel utilisateur'}</Text>

        <Text style={styles.modalLabel}>Nom complet *</Text>
        <TextInput
          style={styles.modalInput}
          value={form.nom || ''}
          onChangeText={v => setForm(p => ({ ...p, nom: v }))}
          placeholder="Ex: Séraphin Pokou"
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Code PIN personnel * (4 chiffres)</Text>
        <TextInput
          style={styles.modalInput}
          value={form.pin || ''}
          onChangeText={v => setForm(p => ({ ...p, pin: v }))}
          placeholder="Ex: 1234"
          keyboardType="numeric"
          maxLength={4}
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Rôle</Text>
        <View style={styles.contratRow}>
          {['caissier', 'gerant', 'manager', 'verificateur'].map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.contratBtn, form.role === r && styles.contratBtnSelected]}
              onPress={() => setForm(p => ({ ...p, role: r }))}
            >
              <Text style={[styles.contratTxt, form.role === r && styles.contratTxtSelected]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {estGlobal ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoTxt}>
              ℹ️ Ce rôle a un accès global à tous les restaurants — pas besoin de choisir un restaurant spécifique.
            </Text>
          </View>
        ) : (
          <SelectRestaurant />
        )}
      </>
    )

    if (type === 'fournisseur') return (
      <>
        <Text style={styles.modalTitre}>{modal.data ? 'Modifier fournisseur' : 'Nouveau fournisseur'}</Text>

        <Text style={styles.modalLabel}>Nom du fournisseur *</Text>
        <TextInput
          style={styles.modalInput}
          value={form.nom || ''}
          onChangeText={v => setForm(p => ({ ...p, nom: v }))}
          placeholder="Ex: Anicet — Viande & Filet"
          placeholderTextColor="#bbb"
        />

        <Text style={styles.modalLabel}>Identifiant unique</Text>
        <View style={styles.identifiantRow}>
          <TextInput
            style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
            value={form.identifiant || ''}
            onChangeText={v => setForm(p => ({ ...p, identifiant: v }))}
            placeholder="Ex: FOUR-001"
            placeholderTextColor="#bbb"
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={styles.genererBtn}
            onPress={() => setForm(p => ({ ...p, identifiant: 'FOUR-' + Date.now().toString().slice(-5) }))}
          >
            <Text style={styles.genererTxt}>Générer</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 14 }} />

        <Text style={styles.modalLabel}>Contact (téléphone)</Text>
        <TextInput
          style={styles.modalInput}
          value={form.contact || ''}
          onChangeText={v => setForm(p => ({ ...p, contact: v }))}
          placeholder="Ex: +225 07 00 00 00 00"
          placeholderTextColor="#bbb"
          keyboardType="phone-pad"
        />

        <Text style={styles.modalLabel}>Type</Text>
        <View style={styles.contratRow}>
          {['fournisseur', 'cotisation', 'administratif'].map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.contratBtn, form.type === t && styles.contratBtnSelected]}
              onPress={() => setForm(p => ({ ...p, type: t }))}
            >
              <Text style={[styles.contratTxt, form.type === t && styles.contratTxtSelected]}>
                {{ fournisseur: 'Fournisseur', cotisation: 'Cotisation', administratif: 'Administratif' }[t]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {modal.data ? <SelectRestaurant /> : <SelectMultipleRestaurants />}

        {isManager && (() => {
          const ceMois = premierDuMois(0)
          const depuis = form.facture_mensuelle_depuis || ceMois
          const annuel = form.facture_periodicite === 'annuel'
          const choix = choixMoisDepart(annuel ? 'annuel' : 'mensuel', ceMois, depuis)
          const actif = (parseFloat(form.facture_mensuelle) || 0) > 0
          return (
            <>
              <View style={styles.creditSeparateur} />
              <Text style={styles.modalLabel}>Facture automatique</Text>
              <TextInput
                style={styles.modalInput}
                value={form.facture_mensuelle ? String(form.facture_mensuelle) : ''}
                onChangeText={v => setForm(p => ({ ...p, facture_mensuelle: v.replace(/[^0-9]/g, '') }))}
                keyboardType="numeric"
                placeholder="Montant par échéance (ex: 20000) — vide = aucune"
                placeholderTextColor="#bbb"
              />
              {actif && (
                <>
                  <Text style={styles.modalLabel}>Revient</Text>
                  <View style={styles.contratRow}>
                    {[['mensuel', 'Chaque mois'], ['annuel', 'Chaque année']].map(([v, l]) => (
                      <TouchableOpacity
                        key={v}
                        style={[styles.contratBtn, (annuel ? 'annuel' : 'mensuel') === v && styles.contratBtnSelected]}
                        onPress={() => setForm(p => ({ ...p, facture_periodicite: v }))}
                      >
                        <Text style={[styles.contratTxt, (annuel ? 'annuel' : 'mensuel') === v && styles.contratTxtSelected]}>{l}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.modalLabel}>{annuel ? 'Mois de l\'échéance' : 'À partir de'}</Text>
                  <View style={styles.contratRow}>
                    {choix.map(m => (
                      <TouchableOpacity
                        key={m}
                        style={[styles.contratBtn, depuis === m && styles.contratBtnSelected]}
                        onPress={() => setForm(p => ({ ...p, facture_mensuelle_depuis: m }))}
                      >
                        <Text style={[styles.contratTxt, depuis === m && styles.contratTxtSelected]}>{libelleMois(m)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <View style={styles.infoBox}>
                <Text style={styles.infoTxt}>
                  {annuel
                    ? 'Le 1er de ce mois, chaque année, ce montant s\'ajoute au reste dû du fournisseur (une seule fois par an).'
                    : 'Le 1er de chaque mois, ce montant s\'ajoute au reste dû du fournisseur (une seule fois par mois).'}
                  {!modal.data ? ' Même montant pour tous les restaurants cochés : corrigez ensuite la fiche d\'un restaurant dont le montant diffère.' : ''}
                </Text>
              </View>
            </>
          )
        })()}

        {isManager && modal.data && (
          <>
            <View style={styles.creditSeparateur} />
            <Text style={styles.modalLabel}>Modifier le crédit (Manager)</Text>
            {creditActuel !== null && (
              <View style={styles.creditActuelBanner}>
                <Text style={styles.creditActuelLabel}>Crédit actuel enregistré</Text>
                <Text style={styles.creditActuelVal}>
                  {Math.round(creditActuel).toLocaleString('fr-FR')} FCFA
                </Text>
              </View>
            )}
            <TextInput
              style={styles.modalInput}
              value={form.nouveau_credit || ''}
              onChangeText={v => setForm(p => ({ ...p, nouveau_credit: v }))}
              keyboardType="numeric"
              placeholder="Nouveau montant du crédit (ex: 15000)"
              placeholderTextColor="#bbb"
            />
            <View style={styles.infoBox}>
              <Text style={styles.infoTxt}>
                ⚠️ Corrige le crédit à cette valeur : l'écart est enregistré dans l'historique du fournisseur. À utiliser uniquement pour corriger une erreur.
              </Text>
            </View>

            <View style={styles.creditSeparateur} />
            <Text style={styles.modalLabel}>Montant Cotisé</Text>
            <Text style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
              Somme versée une fois en attente de facture : retirée une seule fois du crédit (ligne dans l'historique)
            </Text>
            {montantCotise !== null && (
              <View style={[styles.creditActuelBanner, { backgroundColor: '#E6F1FB', borderColor: '#B8D4F5' }]}>
                <Text style={[styles.creditActuelLabel, { color: '#185FA5' }]}>Montant cotisé enregistré</Text>
                <Text style={[styles.creditActuelVal, { color: '#185FA5' }]}>
                  {Math.round(montantCotise).toLocaleString('fr-FR')} FCFA
                </Text>
              </View>
            )}
            <TextInput
              style={styles.modalInput}
              value={form.nouveau_montant_cotise || ''}
              onChangeText={v => setForm(p => ({ ...p, nouveau_montant_cotise: v }))}
              keyboardType="numeric"
              placeholder="Montant cotisé (ex: 20000)"
              placeholderTextColor="#bbb"
            />
            {(() => {
              const credit = parseFloat(form.nouveau_credit || creditActuel) || 0
              const cotise = parseFloat(form.nouveau_montant_cotise || montantCotise) || 0
              const reste = credit - cotise
              if (credit === 0 && cotise === 0) return null
              return (
                <View style={[styles.creditActuelBanner, {
                  backgroundColor: reste === 0 ? '#EAF3DE' : reste < 0 ? '#E6F1FB' : '#FAEEDA',
                  borderColor: reste === 0 ? '#3B6D11' : reste < 0 ? '#185FA5' : '#EF9F27',
                }]}>
                  <Text style={[styles.creditActuelLabel, {
                    color: reste === 0 ? '#3B6D11' : reste < 0 ? '#185FA5' : '#854F0B',
                  }]}>
                    {reste === 0 ? '✅ Reste dû' : reste < 0 ? '💙 Avance excédentaire' : '🟡 Reste dû'}
                  </Text>
                  <Text style={[styles.creditActuelVal, {
                    color: reste === 0 ? '#3B6D11' : reste < 0 ? '#185FA5' : '#A32D2D',
                  }]}>
                    {Math.abs(Math.round(reste)).toLocaleString('fr-FR')} FCFA
                  </Text>
                </View>
              )
            })()}
          </>
        )}
      </>
    )
  }

  // ─── RENDU RÔLES & ACCÈS ───────────────────────────────────
  function renderRoles() {
    const ids = accesRoles[roleConfigActif] || []
    const actives = new Set(ids)
    const admin = TUILES.filter(t => t.admin)
    const ops = TUILES.filter(t => !t.admin)

    const renderTuile = (t) => {
      const on = actives.has(t.id)
      return (
        <TouchableOpacity
          key={t.id}
          style={[styles.roleTuileRow, on && styles.roleTuileRowOn]}
          activeOpacity={0.7}
          onPress={() => toggleTuileRole(t.id)}
        >
          <Text style={styles.roleTuileIcon}>{t.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.roleTuileTitre}>{t.titre}</Text>
            <Text style={styles.roleTuileSous} numberOfLines={1}>{t.sous}</Text>
          </View>
          {/* Switch purement visuel : c'est la ligne qui bascule (évite le
              double toggle web où l'input + la propagation s'annulent). */}
          <View pointerEvents="none">
            <Switch
              value={on}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
        </TouchableOpacity>
      )
    }

    return (
      <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.filtreBar, { flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 2, paddingBottom: 10 }}>
          {ROLES_CONFIGURABLES.map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.filtrePill, roleConfigActif === r && styles.filtrePillActive]}
              onPress={() => setRoleConfigActif(r)}
            >
              <Text style={[styles.filtrePillTxt, roleConfigActif === r && styles.filtrePillTxtActive]}>
                {LABELS_ROLES[r] || r}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.infoBox}>
          <Text style={styles.infoTxt}>
            👑 Manager & 🏢 Directeur ont accès à tout (non modifiable). 🔍 Vérificateur a son écran dédié. Coche/décoche ce que « {roleConfigActif} » voit sur son accueil.
          </Text>
        </View>

        <View style={styles.roleHeaderRow}>
          <Text style={styles.roleCountTxt}>{ids.length} tuile{ids.length > 1 ? 's' : ''} activée{ids.length > 1 ? 's' : ''}</Text>
          <TouchableOpacity onPress={restaurerDefautRole}>
            <Text style={styles.roleResetTxt}>↩︎ Valeurs par défaut</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.separateur}>Administration</Text>
        {admin.map(renderTuile)}
        <Text style={styles.separateur}>Opérations (shift)</Text>
        {ops.map(renderTuile)}

        <TouchableOpacity
          style={[styles.saveRoleBtn, savingRoles && { opacity: 0.6 }]}
          onPress={sauvegarderRole}
          disabled={savingRoles}
        >
          <Text style={styles.saveRoleTxt}>
            {savingRoles ? '⏳ Enregistrement…' : `💾 Enregistrer les accès — ${roleConfigActif}`}
          </Text>
        </TouchableOpacity>
      </>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Paramètres</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.tabs, { flexGrow: 0 }]}>
        {SECTIONS.map(s => (
          <TouchableOpacity
            key={s.key}
            style={[styles.tab, sectionActive === s.key && styles.tabActive]}
            onPress={() => setSectionActive(s.key)}
          >
            <Text style={[styles.tabTxt, sectionActive === s.key && styles.tabTxtActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {sectionActive === 'restaurants' && renderRestaurants()}
        {sectionActive === 'travailleurs' && renderTravailleurs()}
        {sectionActive === 'utilisateurs' && renderUtilisateurs()}
        {sectionActive === 'fournisseurs' && renderFournisseurs()}
        {sectionActive === 'roles' && renderRoles()}

        {/* ── Apparence (masquée sur l'onglet Rôles pour rester focalisé) ── */}
        {sectionActive !== 'roles' && (<>
        <View style={styles.section}>
          <Text style={styles.sectionTitreApp}>Apparence</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Mode sombre</Text>
            <Switch
              value={isDark}
              onValueChange={(val) => setThemeMode(val ? 'dark' : 'light')}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={isDark ? colors.primaryText : colors.surface}
            />
          </View>
          <TouchableOpacity
            onPress={() => setThemeMode('auto')}
            style={[styles.autoBtn, mode === 'auto' && styles.autoBtnActif]}
          >
            <Text style={[styles.autoBtnTxt, mode === 'auto' && styles.autoBtnTxtActif]}>
              🔄 Suivre le thème système {mode === 'auto' ? '(actif)' : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── OneDrive ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitreApp}>Sauvegarde OneDrive</Text>
          <Text style={[styles.rowSub, { marginBottom: 10 }]}>
            Sauvegarde automatique des points journaliers en Excel sur votre OneDrive Microsoft.
          </Text>
          <TouchableOpacity
            style={[styles.oneDriveBtn, oneDriveConnecte && styles.oneDriveBtnConnecte]}
            onPress={gererConnexionOneDrive}
            disabled={oneDriveLoading}
          >
            <Text style={styles.oneDriveBtnTxt}>
              {oneDriveLoading ? '⏳ Connexion…' : oneDriveConnecte ? '✅ Connecté à OneDrive' : '🔗 Connecter OneDrive'}
            </Text>
            {oneDriveConnecte && oneDriveEmail ? (
              <Text style={styles.oneDriveEmail}>{oneDriveEmail}</Text>
            ) : null}
          </TouchableOpacity>
        </View>
        </>)}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── BADGE TRAVAILLEUR ── */}
      <Modal visible={!!badgeTravailleur} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={() => setBadgeTravailleur(null)}>
          <View style={styles.badgeOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.badgeCard}>
                {/* En-tête coloré */}
                <View style={styles.badgeHeader}>
                  <Text style={styles.badgeHeaderTxt}>
                    {tousRestaurants.find(r => r.id === badgeTravailleur?.restaurant_id)?.nom || 'Samtrackly'}
                  </Text>
                  <TouchableOpacity onPress={() => setBadgeTravailleur(null)}>
                    <Text style={styles.badgeClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Photo */}
                <View style={styles.badgeAvatarBox}>
                  {badgeTravailleur?.photo_url ? (
                    <Image source={{ uri: badgeTravailleur.photo_url }} style={styles.badgePhoto} />
                  ) : (
                    <View style={styles.badgeAvatarVide}>
                      <Text style={styles.badgeAvatarTxt}>
                        {(badgeTravailleur?.nom || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.badgeStatutDot, {
                    backgroundColor: badgeTravailleur?.actif ? '#3B6D11' : '#A32D2D'
                  }]} />
                </View>

                {/* Infos */}
                <Text style={styles.badgeNom}>{badgeTravailleur?.nom}</Text>
                <Text style={styles.badgePoste}>{badgeTravailleur?.poste || '—'}</Text>

                <View style={styles.badgeSeparateur} />

                <View style={styles.badgeInfoGrid}>
                  <View style={styles.badgeInfoItem}>
                    <Text style={styles.badgeInfoLabel}>Contrat</Text>
                    <Text style={styles.badgeInfoVal}>{badgeTravailleur?.type_contrat || '—'}</Text>
                  </View>
                  <View style={styles.badgeInfoItem}>
                    <Text style={styles.badgeInfoLabel}>Statut</Text>
                    <Text style={[styles.badgeInfoVal, { color: badgeTravailleur?.actif ? '#3B6D11' : '#A32D2D' }]}>
                      {badgeTravailleur?.actif ? 'Actif' : 'Inactif'}
                    </Text>
                  </View>
                  {badgeTravailleur?.contact && (
                    <View style={styles.badgeInfoItem}>
                      <Text style={styles.badgeInfoLabel}>Contact</Text>
                      <Text style={styles.badgeInfoVal}>{badgeTravailleur.contact}</Text>
                    </View>
                  )}
                </View>

                {/* ID unique */}
                {badgeTravailleur?.identifiant && (
                  <View style={styles.badgeId}>
                    <Text style={styles.badgeIdTxt}>{badgeTravailleur.identifiant}</Text>
                  </View>
                )}

                {/* Bouton modifier */}
                <TouchableOpacity
                  style={styles.badgeEditBtn}
                  onPress={() => {
                    setBadgeTravailleur(null)
                    ouvrirModal('travailleur', badgeTravailleur)
                  }}
                >
                  <Text style={styles.badgeEditTxt}>✏️ Modifier le profil</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal visible={modal.visible} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Platform.OS === 'web' ? undefined : Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            {/* Plafond sur l'enveloppe (hauteur connue) : posé sur la fenêtre, il valait
                92 % d'un parent sans hauteur, et le haut du formulaire sortait de l'écran. */}
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={{ width: '100%', maxHeight: '92%' }}
            >
              <ScrollView
                style={styles.modal}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 40 }}
              >
                {renderModalContent()}
                <View style={styles.modalBtns}>
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => setModal({ visible: false, type: '', data: null })}
                  >
                    <Text style={styles.modalCancelTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalConfirm, loading && { opacity: 0.6 }]}
                    onPress={sauvegarder}
                    disabled={loading}
                  >
                    <Text style={styles.modalConfirmTxt}>
                      {loading ? 'Enregistrement...' : 'Enregistrer'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 30 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.headerBg, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface },
  tabs: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  tab: { paddingHorizontal: 16, paddingVertical: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabTxt: { fontSize: 13, color: colors.textMuted },
  tabTxtActive: { color: colors.primary, fontWeight: '600' },
  body: { flex: 1, padding: 14 },
  addBtn: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary,
    borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12
  },
  addTxt: { fontSize: 14, color: colors.primary, fontWeight: '500' },
  separateur: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase', marginVertical: 10
  },
  itemCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 0.5, borderColor: colors.border
  },
  itemCardInactif: { opacity: 0.5 },
  itemCardManager: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  itemDot: { width: 12, height: 12, borderRadius: 6 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#EF9F27', alignItems: 'center', justifyContent: 'center'
  },
  avatarTxt: { fontSize: 13, fontWeight: '600', color: '#fff' },
  itemNom: { fontSize: 14, fontWeight: '600', color: colors.text },
  itemSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  itemSub2: { fontSize: 10, color: colors.textPlaceholder, marginTop: 1 },
  itemPin: { fontSize: 10, color: colors.primary, marginTop: 2, fontWeight: '500' },
  // Bascule POS ↔ Samtrackly (sous chaque carte restaurant)
  bascCard:   { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: -6, marginBottom: 12, gap: 8 },
  bascHead:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bascPuce:   { width: 8, height: 8, borderRadius: 4 },
  bascSource: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  bascAlerte: { fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  bascMsg:    { fontSize: 12, lineHeight: 17 },
  bascBtn:    { minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  bascBtnTxt: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  itemActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: { padding: 6 },
  editTxt: { fontSize: 16 },
  deleteBtn: { padding: 6 },
  deleteTxt: { fontSize: 16 },
  statutBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statutTxt: { fontSize: 11, fontWeight: '500' },
  globalBadge: { backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  globalTxt: { fontSize: 11, color: colors.surface, fontWeight: '500' },
  typeBadge: { backgroundColor: colors.orangeLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  typeBadgeCotis: { backgroundColor: '#E6F1FB' },
  typeBadgeAdmin: { backgroundColor: '#EDE9FE' },
  typeTxt: { fontSize: 10, color: colors.orangeDark, fontWeight: '500' },
  typeTxtCotis: { color: '#185FA5' },
  typeTxtAdmin: { color: '#7C3AED' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, flexShrink: 1 },
  modalTitre: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 20 },
  modalLabel: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase'
  },
  modalInput: {
    backgroundColor: colors.surfaceAlt, borderRadius: 12,
    padding: 14, fontSize: 15, color: colors.text, marginBottom: 14
  },
  pinInfo: {
    backgroundColor: colors.primaryLight, borderRadius: 10,
    padding: 10, marginBottom: 14
  },
  pinInfoTxt: { fontSize: 12, color: colors.primaryDark, lineHeight: 18 },
  couleurRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  couleurBtn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center', opacity: 0.6 },
  couleurBtnSelected: { opacity: 1, borderWidth: 2, borderColor: colors.text },
  couleurTxt: { fontSize: 13, color: '#fff', fontWeight: '600' },
  contratRow: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  contratBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: colors.surfaceAlt, borderWidth: 0.5, borderColor: colors.border
  },
  contratBtnSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  contratTxt: { fontSize: 13, color: colors.textMuted },
  contratTxtSelected: { color: colors.surface, fontWeight: '600' },
  restoBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: colors.surfaceAlt, borderWidth: 0.5, borderColor: colors.border, marginRight: 8
  },
  restoBtnSelected: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  restoTxt: { fontSize: 12, color: colors.textMuted },
  restoTxtSelected: { color: '#412402', fontWeight: '600' },
  infoBox: { backgroundColor: '#EAF3DE', borderRadius: 10, padding: 10, marginBottom: 14 },
  infoTxt: { fontSize: 12, color: '#3B6D11', lineHeight: 18 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  modalCancelTxt: { fontSize: 14, color: colors.textMuted },
  modalConfirm: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  modalConfirmTxt: { fontSize: 14, fontWeight: '600', color: colors.surface },
  filtreBar: { marginBottom: 4, marginHorizontal: -14 },
  filtrePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.borderLight, marginRight: 8, borderWidth: 1, borderColor: 'transparent' },
  filtrePillActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  filtreDot: { width: 8, height: 8, borderRadius: 4 },
  filtrePillTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  filtrePillTxtActive: { color: colors.primary, fontWeight: '600' },
  emptyFiltreBox: { alignItems: 'center', paddingVertical: 30 },
  emptyFiltreTxt: { fontSize: 13, color: colors.textPlaceholder },
  identifiantRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 0 },
  genererBtn: { backgroundColor: colors.primaryLight, paddingHorizontal: 12, paddingVertical: 14, borderRadius: 12 },
  genererTxt: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  avatarPhoto: { width: 40, height: 40, borderRadius: 20 },
  photoProfilBox: { alignItems: 'center', marginBottom: 20 },
  photoProfilPreview: { width: 100, height: 100, borderRadius: 50, marginBottom: 10 },
  photoProfilVide: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  photoProfilVideEmoji: { fontSize: 40 },
  photoProfilBtn: {
    backgroundColor: colors.primaryLight, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
  },
  photoProfilBtnTxt: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  badgeOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  badgeCard: {
    backgroundColor: colors.surface, borderRadius: 24, width: '100%',
    overflow: 'hidden', alignItems: 'center',
  },
  badgeHeader: {
    backgroundColor: colors.primary, width: '100%', paddingHorizontal: 20,
    paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  badgeHeaderTxt: { fontSize: 13, fontWeight: '600', color: colors.primaryText },
  badgeClose: { fontSize: 18, color: colors.surface },
  badgeAvatarBox: { marginTop: 24, marginBottom: 12, position: 'relative' },
  badgePhoto: { width: 110, height: 110, borderRadius: 55, borderWidth: 3, borderColor: colors.primary },
  badgeAvatarVide: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.primary,
  },
  badgeAvatarTxt: { fontSize: 36, fontWeight: '700', color: colors.primary },
  badgeStatutDot: {
    position: 'absolute', bottom: 4, right: 4,
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.surface,
  },
  badgeNom: { fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center', paddingHorizontal: 20 },
  badgePoste: { fontSize: 14, color: colors.primary, fontWeight: '500', marginTop: 4, marginBottom: 16 },
  badgeSeparateur: { height: 1, backgroundColor: colors.borderLight, width: '85%', marginBottom: 16 },
  badgeInfoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  badgeInfoItem: { backgroundColor: colors.surfaceAlt, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', minWidth: '40%' },
  badgeInfoLabel: { fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  badgeInfoVal: { fontSize: 14, fontWeight: '600', color: colors.text },
  badgeId: {
    backgroundColor: colors.primaryLight, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8,
    marginBottom: 20, borderWidth: 1, borderColor: colors.primaryText,
  },
  badgeIdTxt: { fontSize: 13, fontWeight: '700', color: colors.primary, letterSpacing: 1 },
  badgeEditBtn: {
    backgroundColor: colors.primary, marginHorizontal: 24, marginBottom: 24,
    padding: 14, borderRadius: 14, alignItems: 'center', width: '85%',
  },
  badgeEditTxt: { fontSize: 14, fontWeight: '600', color: colors.surface },
  creditSeparateur: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
  creditActuelBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.warningLight, borderRadius: 10, padding: 12, marginBottom: 10 },
  creditActuelLabel: { fontSize: 12, color: colors.warningDark, fontWeight: '500' },
  creditActuelVal: { fontSize: 15, fontWeight: '700', color: '#A32D2D' },
  restoPhotoPreview: { width: 100, height: 100, borderRadius: 14, marginBottom: 10 },
  restoBadgeBtn: {
    alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, marginRight: 8, minWidth: 72,
  },
  restoBadgeBtnSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  restoBadgeImg: { width: 44, height: 44, borderRadius: 10, marginBottom: 4 },
  restoBadgeAvatar: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  restoBadgeAvatarTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
  restoBadgeTxt: { fontSize: 10, color: colors.textMuted, textAlign: 'center', maxWidth: 70 },
  restoBadgeTxtSelected: { color: colors.primary, fontWeight: '600' },
  restoBadgeCheck: { fontSize: 12, color: colors.primary, fontWeight: '700', marginTop: 2 },
  // Section Apparence
  section: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginTop: 16, borderWidth: 0.5, borderColor: colors.border },
  sectionTitreApp: { fontSize: 13, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  rowLabel: { fontSize: 15, color: colors.text },
  autoBtn: { marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  autoBtnActif: { backgroundColor: colors.primaryLight },
  autoBtnTxt: { fontSize: 13, color: colors.textMuted },
  autoBtnTxtActif: { color: colors.primary, fontWeight: '600' },
  // Rôles & accès
  roleHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 6 },
  roleCountTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  roleResetTxt: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  roleTuileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  roleTuileRowOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roleTuileIcon: { fontSize: 22 },
  roleTuileTitre: { fontSize: 14, fontWeight: '600', color: colors.text },
  roleTuileSous: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  saveRoleBtn: {
    marginTop: 16, marginBottom: 8, padding: 15, borderRadius: 14,
    backgroundColor: colors.primary, alignItems: 'center',
  },
  saveRoleTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  // Onglets travailleur
  ongletRow: { flexDirection: 'row', marginBottom: 16, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  ongletBtn: { flex: 1, padding: 10, alignItems: 'center', backgroundColor: colors.surfaceAlt },
  ongletBtnActive: { backgroundColor: colors.primary },
  ongletTxt: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  ongletTxtActive: { color: colors.surface, fontWeight: '600' },
  // Documents travailleur
  docCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 10, marginBottom: 8, gap: 12, borderWidth: 0.5, borderColor: colors.border },
  docThumb: { width: 56, height: 56, borderRadius: 8 },
  docInfo: { flex: 1 },
  docType: { fontSize: 13, fontWeight: '600', color: colors.text },
  docDesc: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  docDelBtn: { padding: 6 },
  ajoutDocBox: { backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: colors.border },
  docTypeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  docTypeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.bg, borderWidth: 0.5, borderColor: colors.border },
  docTypeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  docTypeTxt: { fontSize: 12, color: colors.textMuted },
  docTypeTxtActive: { color: colors.surface, fontWeight: '600' },
  // OneDrive
  oneDriveBtn: { backgroundColor: colors.primaryLight, borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.primary },
  oneDriveBtnConnecte: { backgroundColor: colors.successLight, borderColor: colors.success },
  oneDriveBtnTxt: { fontSize: 14, fontWeight: '700', color: colors.primary },
  oneDriveEmail: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  rowSub: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
}) }
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  SafeAreaView, ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import PhotoJustificatif from '../components/PhotoJustificatif'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { cloturesPOS, resumerEcartsGlobaux } from '../lib/cloturesCaisse'
import { COEFFICIENTS } from '../lib/constants'
import { estRempliParLePOS, peutSaisirVenteMachineManuellement, venteMachineEstRecue, venteMachineVientDuPOS } from '../lib/sourcePoint'
import { useFondTresorerie } from '../lib/useFondTresorerie'
import { supabase } from '../lib/supabase'
import { usePhoto } from '../lib/usePhoto'

export default function VentesScreen() {
  const {
    pointId, pointValide, estBloque,
    ventesJour, setVentesJour,
    resteEspeces, fc, beneficeSC,
    roleActif, restaurantId, dateJour,
  } = useApp()

  const { prendrePhoto, choisirPhoto } = usePhoto()
  const { colors } = useTheme()
  // « FC reçu » prérempli avec le fond donné par la Trésorerie (modifiable).
  useFondTresorerie({ pointId, restaurantId, dateJour, pointValide, setVentesJour })
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [etape, setEtape] = useState(1)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [photosAlertVisible, setPhotosAlertVisible] = useState(false)
  const [chargementShifts, setChargementShifts] = useState(false)
  const [cumulShifts, setCumulShifts] = useState(null)
  const [travailleursEquipe, setTravailleursEquipe] = useState([])
  const [showResponsablePicker, setShowResponsablePicker] = useState(false)
  const [saisieManuelleVenteMachine, setSaisieManuelleVenteMachine] = useState(false)
  // Fiche du restaurant, pour savoir si son point vient du POS. Un site
  // basculé remplit lui-même la vente machine : le gérant ne doit plus
  // pouvoir la retaper par-dessus celle du système.
  const [restaurant, setRestaurant] = useState(null)
  const isGerant = roleActif === 'gerant'
  const isManager = roleActif === 'manager'
  const bloque = estBloque(pointValide)
  // Sur un site dont le point vient du POS, la vente machine est écrite par le
  // pont : le gérant la lit, il ne la saisit plus. Repli sûr — tant que la
  // fiche restaurant n'est pas chargée, on garde la saisie ouverte.
  const venteMachineDuPOS = estRempliParLePOS(restaurant, 'vente_machine')
  const secoursVenteMachineDisponible = peutSaisirVenteMachineManuellement(
    restaurant, ventesJour.venteMachine, pointValide
  )
  // Reçue ≠ non nulle : une journée à 0 FCFA transmise par le POS est une
  // mesure, pas une absence (lib/sourcePoint.js).
  const venteMachineRecue = venteMachineEstRecue(ventesJour.venteMachine)
  // Le POS est la source : Samtrackly ne réécrit `vente_machine` que sur un
  // site non basculé, ou après ouverture explicite du secours manuel. Sans ce
  // garde-fou, un enregistrement du gérant renvoyait une valeur locale périmée
  // par-dessus le chiffre du système.
  const peutEcrireVenteMachine = !venteMachineDuPOS || saisieManuelleVenteMachine
  // La vente machine de CE point a-t-elle été écrite par le système ?
  // Deux preuves, et la seconde compte autant que la première : le drapeau
  // `source_point` du restaurant, OU un shift qui a réellement transmis
  // `vente_systeme_pos`. Un site sans POS n'a jamais ni l'un ni l'autre et
  // garde exactement le comportement d'avant. Le secours manuel rouvre la
  // saisie : dans ce cas plus rien ne vient du système.
  //
  // Ce qui en découle, sur les sites POS uniquement :
  //  - plus de photo de la vente machine : il n'y a aucun écran à
  //    photographier pour prouver un chiffre que la machine a écrit ;
  //  - plus d'explication ni de responsable à saisir ici : la caisse les a
  //    déjà recueillis shift par shift au comptage à l'aveugle
  //    (`points_shifts.ecart_pos` / `explication_ecart`, cf. lib/ecartPOS.js).
  //    Les redemander au gérant, c'est lui faire retaper le même écart.
  const venteMachineDuSysteme =
    (venteMachineDuPOS || !!cumulShifts?.venteMachineDuPOS) && !saisieManuelleVenteMachine

  useEffect(() => {
    if ((isGerant || isManager) && pointId) chargerCumulShifts()
  }, [pointId])

  // La synchro POS peut arriver APRÈS l'ouverture du point : le gérant ouvre sa
  // journée le matin, la caissière clôture son service à midi. On relit donc
  // `points.vente_machine` (somme des vente_systeme_pos, cf.
  // supabase_pos_vente_systeme.sql) chaque fois que l'écran revient au premier
  // plan, plutôt que d'imposer une reconnexion pour voir le chiffre arriver.
  //
  // ⚠ Deux garde-fous : on ne touche à rien quand le secours manuel est ouvert
  // (sinon on effacerait ce que le gérant est en train de taper), et `null`
  // reste vide — une remontée absente ne devient jamais 0.
  const chargerVenteMachinePOS = useCallback(async () => {
    if (!pointId || !venteMachineDuPOS || saisieManuelleVenteMachine) return
    const { data, error } = await supabase
      .from('points').select('vente_machine').eq('id', pointId).maybeSingle()
    if (error) {
      console.warn('Vente machine POS illisible :', error.message)
      return
    }
    setVentesJour(prev => ({
      ...prev,
      venteMachine: data?.vente_machine == null ? '' : String(data.vente_machine),
    }))
  }, [pointId, venteMachineDuPOS, saisieManuelleVenteMachine, setVentesJour])

  useFocusEffect(useCallback(() => { chargerVenteMachinePOS() }, [chargerVenteMachinePOS]))

  // `source_point` avec repli : sans la migration supabase_pos_bascule.sql, ou
  // si la lecture échoue, on retombe sur le comportement historique (saisie
  // ouverte) plutôt que de bloquer un gérant qui a besoin de travailler.
  useEffect(() => {
    if (!restaurantId) return
    supabase.from('restaurants').select('id, nom, source_point').eq('id', restaurantId).maybeSingle()
      .then(({ data }) => setRestaurant(data || null))
      .catch(() => setRestaurant(null))
  }, [restaurantId])

  // Responsables possibles d'un manquant — uniquement caissiers et gérants du restaurant
  useEffect(() => {
    if (!restaurantId) return
    supabase.from('utilisateurs')
      .select('id, nom, role')
      .eq('restaurant_id', restaurantId)
      .in('role', ['caissier', 'gerant'])
      .eq('actif', true)
      .order('nom')
      .then(({ data }) => setTravailleursEquipe(data || []))
  }, [restaurantId])

  async function chargerCumulShifts() {
    setChargementShifts(true)

    const { data: shifts } = await supabase
      .from('points_shifts')
      .select('*')
      .eq('point_id', pointId)

    if (shifts && shifts.length > 0) {
      const cumul = {
        yangoCse: shifts.reduce((s, sh) => s + (sh.yango_cse || 0), 0),
        glovoCse: shifts.reduce((s, sh) => s + (sh.glovo_cse || 0), 0),
        wave: shifts.reduce((s, sh) => s + (sh.wave || 0), 0),
        djamo: shifts.reduce((s, sh) => s + (sh.djamo || 0), 0),
        om: shifts.reduce((s, sh) => s + (sh.om || 0), 0),
        kdo: shifts.reduce((s, sh) => s + (sh.kdo || 0), 0),
        retour: shifts.reduce((s, sh) => s + (sh.retour || 0), 0),
        depenses: shifts.reduce((s, sh) => s + (sh.depenses || 0), 0),
        fournisseurs: shifts.reduce((s, sh) => s + (sh.fournisseurs || 0), 0),
        espece: shifts.reduce((s, sh) => s + (sh.espece || 0), 0),
        venteTotal: shifts.reduce((s, sh) => s + (sh.vente_shift || 0), 0),
        nbShifts: shifts.length,
        // Une clôture POS = un rapport Z figé. `ecart_reconciliation` est sa
        // valeur officielle; `ecart_pos` reste le détail du tiroir espèces.
        cloturesPOS: cloturesPOS(shifts),
        ecartsGlobaux: resumerEcartsGlobaux(shifts),
        // Preuve que le trigger POS a écrit `points.vente_machine`.
        venteMachineDuPOS: venteMachineVientDuPOS(shifts),
      }
      setCumulShifts(cumul)

      // Charger le FC de la veille depuis le dernier point validé.
      // Fond reporté = reste_fc (calculé sur les ventes) + ajustement_fond (corrections d'écart
      // déposées sur ce jour via la régularisation des litiges).
      const queteFcVeille = (cols) => supabase
        .from('points')
        .select(cols)
        .eq('restaurant_id', restaurantId)
        .eq('valide', true)
        .neq('id', pointId)
        .order('date', { ascending: false })
        .limit(1)
        .single()

      let { data: pointPrec, error: errFc } = await queteFcVeille('reste_fc, ajustement_fond')
      // Fallback si la colonne ajustement_fond n'est pas encore créée en DB
      if (errFc) ({ data: pointPrec } = await queteFcVeille('reste_fc'))

      const fcVeille = (pointPrec?.reste_fc || 0) + (pointPrec?.ajustement_fond || 0)

      setVentesJour(prev => ({
        ...prev,
        yangoCse: String(cumul.yangoCse || ''),
        glovoCse: String(cumul.glovoCse || ''),
        wave: String(cumul.wave || ''),
        djamo: String(cumul.djamo || ''),
        om: String(cumul.om || ''),
        kdo: String(cumul.kdo || ''),
        retour: String(cumul.retour || ''),
        fcVeille: String(fcVeille || ''),
        espece_shifts: cumul.espece,
      }))
    }

    setChargementShifts(false)
  }

  function setVente(champ, valeur) {
    if (bloque && !isManager) return
    setVentesJour(prev => ({ ...prev, [champ]: valeur }))
  }

  function gererPhoto(setter, dossier) {
    if (bloque && !isManager) return

    async function executer(source) {
      setUploading(true)
      try {
        const url = source === 'camera'
          ? await prendrePhoto(dossier)
          : await choisirPhoto(dossier)
        if (url) setter(url)
      } finally {
        setUploading(false)
      }
    }

    if (Platform.OS === 'web') {
      executer('gallery')
    } else {
      Alert.alert(
        'Ajouter une photo',
        'Choisissez la source',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: '📷 Caméra', onPress: () => executer('camera') },
          { text: '🖼 Galerie', onPress: () => executer('gallery') },
        ]
      )
    }
  }

  function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

  // ─── Responsables d'un manquant (répartition du montant) ───────────────────
  function ajouterResponsable(trav) {
    if (bloque && !isManager) return
    setVentesJour(prev => {
      const liste = prev.ecartResponsables || []
      if (liste.some(r => r.travailleur_id === trav.id)) return prev // déjà désigné
      return { ...prev, ecartResponsables: [...liste, { travailleur_id: trav.id, nom: trav.nom, role: trav.role || null, montant: '' }] }
    })
    setShowResponsablePicker(false)
  }

  function modifierMontantResponsable(travailleurId, montant) {
    if (bloque && !isManager) return
    setVentesJour(prev => ({
      ...prev,
      ecartResponsables: (prev.ecartResponsables || []).map(r =>
        r.travailleur_id === travailleurId ? { ...r, montant } : r
      ),
    }))
  }

  function retirerResponsable(travailleurId) {
    if (bloque && !isManager) return
    setVentesJour(prev => ({
      ...prev,
      ecartResponsables: (prev.ecartResponsables || []).filter(r => r.travailleur_id !== travailleurId),
    }))
  }

  function ajouterPhotoEcart(url) {
    if (!url) return
    setVentesJour(prev => ({ ...prev, ecartPhotos: [...(prev.ecartPhotos || []), url] }))
  }

  function retirerPhotoEcart(index) {
    if (bloque && !isManager) return
    setVentesJour(prev => ({ ...prev, ecartPhotos: (prev.ecartPhotos || []).filter((_, i) => i !== index) }))
  }

  function verifierPhotosObligatoires() {
    const manquantes = []
    if (parseFloat(ventesJour.yangoTab) > 0 && !ventesJour.photo_yango_tab) manquantes.push('Yango TAB')
    if (parseFloat(ventesJour.glovoTab) > 0 && !ventesJour.photo_glovo_tab) manquantes.push('Glovo TAB')
    if (!venteMachineDuSysteme && (isGerant || isManager) && parseFloat(ventesJour.venteMachine) > 0 && !ventesJour.photoVenteMachine) {
      manquantes.push('Photo vente machine')
    }
    return manquantes
  }

  async function sauvegarderPhotosPoints() {
    if (!pointId) return
    const updates = {}
    const photos = ['photo_yango_tab', 'photo_glovo_tab']
    photos.forEach(p => { if (ventesJour[p]) updates[p] = ventesJour[p] })
    if (ventesJour.photoVenteMachine) updates.photo_vente_machine = ventesJour.photoVenteMachine
    if (venteMachineRecue) {
      if (peutEcrireVenteMachine) {
        updates.vente_machine = parseFloat(ventesJour.venteMachine) || 0
      }
      // Flux historique sans POS uniquement. Une clôture POS fournit déjà
      // rapport_z.diff : Samtrackly ne recalcule et n'écrit aucun écart global.
      if (!cumulShifts?.cloturesPOS?.length) {
        const venteTheo = cumulShifts?.venteTotal || 0
        const ecart = venteTheo - (parseFloat(ventesJour.venteMachine) || 0)
        updates.ecart_caisse = ecart
        // Écart (manquant ou surplus) : responsables imputés + photos justificatives
        if (ecart !== 0) {
          updates.ecart_responsables = (ventesJour.ecartResponsables || []).map(r => ({
            travailleur_id: r.travailleur_id,
            nom: r.nom,
            montant: parseFloat(r.montant) || 0,
          }))
          updates.ecart_photos = ventesJour.ecartPhotos || []
        } else {
          // Plus d'écart → on purge d'éventuelles données obsolètes
          updates.ecart_responsables = []
          updates.ecart_photos = []
        }
      }
    }
    if (ventesJour.explicacionEcartMachine) {
      updates.explication_ecart_machine = ventesJour.explicacionEcartMachine
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('points').update(updates).eq('id', pointId)
    }
    await syncLitigesResponsables()
  }

  // Réplique les responsables de l'écart dans la table relationnelle litiges_responsables
  // (delete + insert pour ce point → pas de doublon). Silencieux si la table n'existe pas.
  async function syncLitigesResponsables() {
    if (!pointId) return
    // Les clôtures POS portent déjà leurs écarts espèces par caissier. Ne pas
    // les remplacer par l'ancien calcul Samtrackly vente théorique − machine.
    if (cumulShifts?.cloturesPOS?.length) return
    try {
      await supabase.from('litiges_responsables').delete().eq('point_id', pointId)
      const venteTheo = cumulShifts?.venteTotal || 0
      const ecart = venteTheo - (parseFloat(ventesJour.venteMachine) || 0)
      if (!venteMachineRecue || ecart === 0) return
      const type = ecart < 0 ? 'manquant' : 'surplus'
      const lignes = (ventesJour.ecartResponsables || [])
        .filter(r => (parseFloat(r.montant) || 0) > 0)
        .map(r => ({
          point_id: pointId,
          restaurant_id: restaurantId || null,
          date: dateJour || new Date().toISOString().split('T')[0],
          responsable_id: r.travailleur_id || null,
          responsable_nom: r.nom || null,
          role: r.role || null,
          montant: parseFloat(r.montant) || 0,
          type,
        }))
      if (lignes.length > 0) await supabase.from('litiges_responsables').insert(lignes)
    } catch (_) { /* table pas encore créée — ignoré */ }
  }

  async function allerAuRecap() {
    if (!pointId) { Alert.alert('Erreur', 'Aucun point actif'); return }
    if (!isManager) {
      // Vérifier explication écart machine obligatoire
      // Sur un site POS, l'écart est déjà mesuré, expliqué et rattaché à sa
      // caissière dans la caisse : on ne le refait pas saisir ici.
      if (cumulShifts && venteMachineRecue && !venteMachineDuSysteme) {
        const ecartSigne = cumulShifts.venteTotal - (parseFloat(ventesJour.venteMachine) || 0)
        const ecart = Math.abs(ecartSigne)
        if (ecart > 0 && (ventesJour.explicacionEcartMachine || '').trim().length < 10) {
          Alert.alert(
            'Explication requise',
            'Un écart a été détecté entre la vente théorique et la vente machine.\n\nVeuillez saisir une explication d\'au moins 10 caractères avant de continuer.'
          )
          return
        }
        // Écart (manquant ou surplus) : la répartition doit couvrir tout l'écart
        if (ecart > 0) {
          const libelle = ecartSigne < 0 ? 'manquant' : 'surplus'
          const responsables = ventesJour.ecartResponsables || []
          const totalImpute = responsables.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0)
          if (responsables.length === 0) {
            Alert.alert('Responsable requis', `Un ${libelle} a été détecté.\n\nDésignez au moins un responsable et imputez-lui un montant avant de continuer.`)
            return
          }
          if (responsables.some(r => !(parseFloat(r.montant) > 0))) {
            Alert.alert('Montant manquant', 'Chaque responsable doit avoir un montant supérieur à 0.')
            return
          }
          if (Math.round(totalImpute) !== Math.round(ecart)) {
            Alert.alert('Répartition incomplète', `La somme imputée aux responsables (${fmt(totalImpute)}) doit être égale au ${libelle} total (${fmt(ecart)}).`)
            return
          }
        }
      }
      const manquantes = verifierPhotosObligatoires()
      if (manquantes.length > 0) {
        setPhotosAlertVisible(true)
        return
      }
    }
    await sauvegarderEtContinuer()
  }

  async function sauvegarderEtContinuer() {
    setSaving(true)
    await sauvegarderPhotosPoints()
    setSaving(false)
    router.push('/recap-point')
  }

  // ─── Composant Photo ───────────────────────────────────────
  function PhotoBlock({ uri, setter, label, dossier, obligatoireSi = true }) {
    const aPhoto = !!uri
    const estRequis = obligatoireSi && !aPhoto
    return (
      <View style={[styles.photoBlock, estRequis && styles.photoBlockRequired]}>
        <View style={styles.photoBlockHeader}>
          <Text style={styles.photoBlockLabel}>
            📷 {label}
            {obligatoireSi && <Text style={{ color: '#A32D2D' }}> *</Text>}
          </Text>
          {aPhoto ? (
            <View style={styles.photoBadgeOk}><Text style={styles.photoBadgeOkTxt}>✅ OK</Text></View>
          ) : obligatoireSi ? (
            <View style={styles.photoBadgeReq}><Text style={styles.photoBadgeReqTxt}>⚠️ Requis</Text></View>
          ) : null}
        </View>
        {uri && <PhotoJustificatif uri={uri} style={styles.photoPreview} />}
        {(!bloque || isManager) && (
          <TouchableOpacity style={styles.photoBtn} onPress={() => gererPhoto(setter, dossier)} disabled={uploading}>
            {uploading ? (
              <ActivityIndicator size="small" color="#412402" />
            ) : (
              <Text style={styles.photoBtnTxt}>{aPhoto ? '🔄 Changer la photo' : '📷 Ajouter une photo'}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (etape > 1) setEtape(etape - 1)
          else if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitre}>Saisie des ventes</Text>
          <Text style={styles.headerSub}>
            {etape === 1 ? 'Étape 1 — Livraisons TAB' : 'Étape 2 — Résultats'}
          </Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Barre progression */}
      <View style={styles.progressBar}>
        {[1, 2].map(i => (
          <TouchableOpacity key={i} style={styles.progressItem} onPress={() => setEtape(i)}>
            <View style={[styles.progressNum, etape >= i && styles.progressNumActive]}>
              <Text style={[styles.progressNumTxt, etape >= i && styles.progressNumTxtActive]}>
                {etape > i ? '✓' : i}
              </Text>
            </View>
            <Text style={[styles.progressLabel, etape === i && styles.progressLabelActive]}>
              {i === 1 ? 'TAB' : 'Résultats'}
            </Text>
            {i < 2 && <View style={[styles.progressLine, etape > i && styles.progressLineActive]} />}
          </TouchableOpacity>
        ))}
      </View>

      {pointValide && !isManager && (
        <View style={styles.valideBanner}>
          <Text style={styles.valideTxt}>🔒 Point validé — lecture seule</Text>
        </View>
      )}

      {(isGerant || isManager) && (
        <View style={styles.cumulBanner}>
          <Text style={styles.cumulBannerTxt}>
            {cumulShifts
              ? `📊 ${cumulShifts.nbShifts} shift(s) validé(s) — Vente : ${fmt(cumulShifts.venteTotal)}`
              : '📊 Aucun shift chargé'}
          </Text>
          <TouchableOpacity
            onPress={chargerCumulShifts}
            disabled={chargementShifts}
            style={styles.cumulRefreshBtn}
          >
            <Text style={styles.cumulRefreshTxt}>{chargementShifts ? '...' : '🔄'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {chargementShifts && (
        <View style={styles.chargementBanner}>
          <ActivityIndicator size="small" color="#EF9F27" />
          <Text style={styles.chargementTxt}>Chargement des shifts et FC veille...</Text>
        </View>
      )}

      {uploading && (
        <View style={styles.uploadBanner}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.uploadTxt}>Upload de la photo en cours...</Text>
        </View>
      )}

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ══════════════════════════════════════════
            ÉTAPE 1 — Livraisons TAB
        ══════════════════════════════════════════ */}
        {etape === 1 && (
          <>
            {(isGerant || isManager) && cumulShifts && (
              <View style={styles.infoShiftsCard}>
                <Text style={styles.infoShiftsTitre}>
                  📊 {cumulShifts.nbShifts} shift(s) déjà intégrés
                </Text>
                <Text style={styles.infoShiftsTxt}>
                  Yango/Glovo CSE, Wave, OM, Djamo, KDO, Retours et espèces sont pré-chargés depuis les shifts caissiers.
                  Seuls les canaux TAB restent à saisir.
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitre}>À saisir manuellement</Text>
            <Text style={styles.sectionSub}>
              Seuls ces canaux ne sont pas dans les shifts
            </Text>

            {/* Yango TAB */}
            <View style={styles.canalCard}>
              <View style={styles.canalHeader}>
                <Text style={styles.canalTitre}>🛵 Yango TAB</Text>
                <Text style={styles.canalCoeff}>×0,77</Text>
              </View>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Montant (FCFA)</Text>
                <TextInput
                  style={styles.inputField}
                  value={ventesJour.yangoTab || ''}
                  onChangeText={v => setVente('yangoTab', v)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                  editable={!bloque || isManager}
                />
              </View>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Nb commandes</Text>
                <TextInput
                  style={styles.inputField}
                  value={ventesJour.yangoNbCommandes || ''}
                  onChangeText={v => setVente('yangoNbCommandes', v)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                  editable={!bloque || isManager}
                />
              </View>
              <PhotoBlock
                uri={ventesJour.photo_yango_tab}
                setter={url => setVentesJour(prev => ({ ...prev, photo_yango_tab: url }))}
                label="Photo Yango TAB"
                dossier="yango_tab"
                obligatoireSi={parseFloat(ventesJour.yangoTab) > 0}
              />
            </View>

            {/* Glovo TAB */}
            <View style={styles.canalCard}>
              <View style={styles.canalHeader}>
                <Text style={styles.canalTitre}>🛵 Glovo TAB</Text>
                <Text style={styles.canalCoeff}>×0,705</Text>
              </View>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Montant (FCFA)</Text>
                <TextInput
                  style={styles.inputField}
                  value={ventesJour.glovoTab || ''}
                  onChangeText={v => setVente('glovoTab', v)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                  editable={!bloque || isManager}
                />
              </View>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Nb commandes</Text>
                <TextInput
                  style={styles.inputField}
                  value={ventesJour.glovoNbCommandes || ''}
                  onChangeText={v => setVente('glovoNbCommandes', v)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                  editable={!bloque || isManager}
                />
              </View>
              <PhotoBlock
                uri={ventesJour.photo_glovo_tab}
                setter={url => setVentesJour(prev => ({ ...prev, photo_glovo_tab: url }))}
                label="Photo Glovo TAB"
                dossier="glovo_tab"
                obligatoireSi={parseFloat(ventesJour.glovoTab) > 0}
              />
            </View>

            {/* Récap shifts en lecture seule */}
            {(isGerant || isManager) && cumulShifts && (
              <>
                <Text style={styles.sectionTitre}>Récap shifts (auto)</Text>
                <View style={styles.recapShiftsCard}>
                  {[
                    { label: 'Dépenses + Fournisseurs', val: cumulShifts.depenses + cumulShifts.fournisseurs },
                    { label: 'Yango CSE', val: cumulShifts.yangoCse },
                    { label: 'Glovo CSE', val: cumulShifts.glovoCse },
                    { label: 'Wave', val: cumulShifts.wave },
                    { label: 'Orange Money', val: cumulShifts.om },
                    { label: 'Djamo', val: cumulShifts.djamo },
                    { label: 'KDO', val: cumulShifts.kdo },
                    { label: 'Retours', val: cumulShifts.retour },
                    { label: 'Espèces en caisse', val: cumulShifts.espece },
                  ].filter(r => r.val > 0).map((r, i) => (
                    <View key={i} style={styles.recapRow}>
                      <Text style={styles.recapLabel}>{r.label}</Text>
                      <Text style={styles.recapVal}>{fmt(r.val)}</Text>
                    </View>
                  ))}
                  <View style={[styles.recapRow, {
                    borderBottomWidth: 0, marginTop: 6, paddingTop: 6,
                    borderTopWidth: 1, borderTopColor: '#EF9F27'
                  }]}>
                    <Text style={[styles.recapLabel, { fontWeight: '700', color: '#412402' }]}>
                      Vente shifts total
                    </Text>
                    <Text style={[styles.recapVal, { fontWeight: '700', color: '#EF9F27', fontSize: 15 }]}>
                      {fmt(cumulShifts.venteTotal)}
                    </Text>
                  </View>
                </View>
              </>
            )}

            <TouchableOpacity style={styles.nextBtn} onPress={() => setEtape(2)}>
              <Text style={styles.nextTxt}>Voir les résultats ›</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ══════════════════════════════════════════
            ÉTAPE 2 — Résultats
        ══════════════════════════════════════════ */}
        {etape === 2 && (
          <>
            {/* Fond de caisse */}
            <Text style={styles.sectionTitre}>Fond de caisse</Text>
            <View style={styles.fcCard}>
              <View style={styles.fcRow}>
                <View style={styles.fcRowLeft}>
                  <Text style={styles.fcLabel}>FC de la veille</Text>
                  <View style={styles.autoBadge}><Text style={styles.autoBadgeTxt}>Auto</Text></View>
                </View>
                <Text style={styles.fcValAuto}>{fmt(parseFloat(ventesJour.fcVeille) || 0)}</Text>
              </View>

              {/* FC reçu — ajustement administratif */}
              <View style={[styles.fcRow, { alignItems: 'flex-start', paddingTop: 14 }]}>
                <View style={styles.fcRowLeft}>
                  <Text style={[styles.fcLabel, { fontWeight: '600', color: colors.text }]}>FC reçu</Text>
                  <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                    Ajustement admin (+ complément / − déduction)
                  </Text>
                  {(ventesJour.fc_recu_detail || []).length > 0 && (
                    <Text style={{ fontSize: 10, color: colors.primary, marginTop: 4, fontWeight: '600' }}>
                      Trésorerie : {ventesJour.fc_recu_detail.map(l => `${l.montant >= 0 ? '+' : '−'} ${fmt(Math.abs(l.montant))} (${l.type === 'fond' ? 'fond donné' : 'repris'} le ${l.date.slice(8, 10)}/${l.date.slice(5, 7)})`).join(' · ')}
                      {String(ventesJour.fc_recu ?? '') !== String(ventesJour.fc_recu_auto ?? '') ? ' — montant corrigé à la main' : ''}
                    </Text>
                  )}
                </View>
                <TextInput
                  style={styles.fcInput}
                  value={ventesJour.fc_recu || ''}
                  onChangeText={v => setVente('fc_recu', v)}
                  keyboardType="numbers-and-punctuation"
                  placeholder="0"
                  placeholderTextColor="#bbb"
                  editable={!bloque || isManager}
                />
              </View>

              <View style={styles.fcRow}>
                <View style={styles.fcRowLeft}>
                  <Text style={styles.fcLabel}>Espèces en caisse</Text>
                  <View style={styles.autoBadge}><Text style={styles.autoBadgeTxt}>Shifts</Text></View>
                </View>
                <Text style={styles.fcValAuto}>{fmt(resteEspeces())}</Text>
              </View>

              <View style={[styles.fcRow, { borderBottomWidth: 0 }]}>
                <View style={styles.fcRowLeft}>
                  <Text style={[styles.fcLabel, { fontWeight: '600', color: colors.primary }]}>FC calculé</Text>
                  <View style={[styles.autoBadge, { backgroundColor: colors.primaryLight }]}>
                    <Text style={[styles.autoBadgeTxt, { color: colors.primary }]}>veille + reçu + espèces</Text>
                  </View>
                </View>
                <Text style={[styles.fcValAuto, { fontWeight: '700', color: colors.primary, fontSize: 15 }]}>
                  {fmt(fc())}
                </Text>
              </View>
            </View>

            {/* Bénéfice SC */}
            <Text style={styles.sectionTitre}>Bénéfice SC</Text>
            <View style={styles.beneficeCard}>
              {[
                { label: `Yango TAB ×${COEFFICIENTS.YANGO}`, val: (parseFloat(ventesJour.yangoTab) || 0) * COEFFICIENTS.YANGO },
                { label: `Glovo TAB ×${COEFFICIENTS.GLOVO}`, val: (parseFloat(ventesJour.glovoTab) || 0) * COEFFICIENTS.GLOVO },
                { label: `Wave ×${COEFFICIENTS.WAVE}`, val: (parseFloat(ventesJour.wave) || 0) * COEFFICIENTS.WAVE },
                { label: `Orange Money ×${COEFFICIENTS.OM}`, val: (parseFloat(ventesJour.om) || 0) * COEFFICIENTS.OM },
                { label: `Djamo ×${COEFFICIENTS.DJAMO}`, val: (parseFloat(ventesJour.djamo) || 0) * COEFFICIENTS.DJAMO },
              ].filter(r => r.val > 0).map((r, i) => (
                <View key={i} style={styles.beneficeRow}>
                  <Text style={styles.beneficeLabel}>{r.label}</Text>
                  <Text style={styles.beneficeVal}>{fmt(r.val)}</Text>
                </View>
              ))}
              {/* Reste espèces — toujours affiché même si négatif */}
              <View style={styles.beneficeRow}>
                <Text style={styles.beneficeLabel}>Reste espèces</Text>
                <Text style={[styles.beneficeVal, resteEspeces() < 0 && { color: '#A32D2D' }]}>
                  {resteEspeces() >= 0 ? fmt(resteEspeces()) : `− ${fmt(Math.abs(resteEspeces()))}`}
                </Text>
              </View>
              <View style={[styles.beneficeRow, {
                borderBottomWidth: 0, marginTop: 8, paddingTop: 8,
                borderTopWidth: 1.5, borderTopColor: '#3B6D11'
              }]}>
                <Text style={[styles.beneficeLabel, { fontWeight: '700', color: colors.text, fontSize: 14 }]}>
                  Bénéfice SC total
                </Text>
                <Text style={[styles.beneficeVal, { fontWeight: '700', color: '#3B6D11', fontSize: 18 }]}>
                  {fmt(beneficeSC())}
                </Text>
              </View>
            </View>

            {/* Vente machine */}
            {(isGerant || isManager) && (
              <>
                <Text style={styles.sectionTitre}>Vente machine</Text>
                <View style={styles.venteMachineCard}>
                  {/* Vente théorique */}
                  {cumulShifts && (
                    <View style={styles.vmRow}>
                      <View style={styles.vmRowLeft}>
                        <Text style={styles.vmLabel}>Vente théorique</Text>
                        <View style={styles.autoBadge}><Text style={styles.autoBadgeTxt}>Shifts</Text></View>
                      </View>
                      <Text style={styles.vmValAuto}>{fmt(cumulShifts.venteTotal)}</Text>
                    </View>
                  )}

                  {/* Clôtures POS : le rapport Z est l'indicateur principal.
                      L'écart du tiroir reste visible comme détail secondaire,
                      sans jamais servir de repli si le rapport Z est absent. */}
                  {cumulShifts?.cloturesPOS?.length > 0 && (
                    <View style={styles.ecpBloc}>
                      <View style={styles.ecpHead}>
                        <Text style={styles.ecpTitre}>Clôtures de caisse POS</Text>
                        <View style={styles.ecpBadge}><Text style={styles.ecpBadgeTxt}>Rapport Z</Text></View>
                      </View>

                      {cumulShifts.cloturesPOS.map((cloture, i) => (
                        <View key={cloture.pos_service_id || cloture.id || i} style={styles.ecpEntree}>
                          <View style={styles.ecpLigne}>
                            <Text style={styles.ecpNom} numberOfLines={1}>
                              {cloture.caissier_nom || 'Caissier non identifié'}
                            </Text>
                            <Text style={[styles.ecpVal, {
                              color: cloture.ecartGlobal == null ? colors.textMuted
                                : cloture.ecartGlobal < 0 ? colors.error
                                : cloture.ecartGlobal > 0 ? colors.success : colors.textMuted,
                            }]}>
                              Écart global · {cloture.ecartGlobalTexte}
                            </Text>
                          </View>
                          <Text style={styles.ecpSecondaire}>
                            Écart espèces · {cloture.ecartEspecesTexte}
                          </Text>
                          {cloture.explication_ecart && (
                            <Text style={styles.ecpExplication}>« {cloture.explication_ecart} »</Text>
                          )}
                        </View>
                      ))}

                      <View style={styles.ecpTotal}>
                        <Text style={styles.ecpTotalLbl}>Écart global</Text>
                        <Text style={[styles.ecpTotalVal, {
                          color: cumulShifts.ecartsGlobaux.total == null ? colors.textMuted
                            : cumulShifts.ecartsGlobaux.total < 0 ? colors.error
                            : cumulShifts.ecartsGlobaux.total > 0 ? colors.success : colors.textMuted,
                        }]}>
                          {cumulShifts.ecartsGlobaux.totalTexte}
                        </Text>
                      </View>

                      {cumulShifts.ecartsGlobaux.indisponibles > 0 && (
                        <Text style={styles.ecpNote}>
                          {cumulShifts.ecartsGlobaux.indisponibles} clôture
                          {cumulShifts.ecartsGlobaux.indisponibles > 1 ? 's historiques exclues' : ' historique exclue'} du total : rapport Z non disponible.
                        </Text>
                      )}
                    </View>
                  )}

                  {/* Saisie vente machine — grisée sur un site dont le point
                      vient du POS : la machine connaît son chiffre exactement,
                      le retaper à la main ne pourrait que le contredire. */}
                  <View style={[styles.vmRow, { alignItems: 'flex-start', paddingTop: 14 }]}>
                    <View style={styles.vmRowLeft}>
                      <Text style={[styles.vmLabel, { fontWeight: '600', color: colors.text }]}>
                        Vente machine
                      </Text>
                      <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                        {venteMachineDuPOS
                          ? 'Remplie automatiquement par le POS'
                          : 'Montant lu sur la caisse / POS'}
                      </Text>
                    </View>
                    {venteMachineDuPOS && !saisieManuelleVenteMachine ? (
                      <View style={styles.vmVerrou}>
                        <Text style={styles.vmVerrouVal}>
                          {venteMachineRecue
                            ? fmt(parseFloat(ventesJour.venteMachine) || 0)
                            : 'en attente du POS'}
                        </Text>
                        <Text style={styles.vmVerrouTxt}>🔒 Rempli par le POS</Text>
                        {secoursVenteMachineDisponible && (
                          <TouchableOpacity
                            style={styles.vmSecoursBtn}
                            onPress={() => Alert.alert(
                              'Saisie manuelle de secours',
                              'Le POS n’a transmis aucune vente machine. Confirmez uniquement après avoir vérifié que sa synchronisation est terminée.',
                              [
                                { text: 'Annuler', style: 'cancel' },
                                { text: 'Saisir manuellement', onPress: () => setSaisieManuelleVenteMachine(true) },
                              ]
                            )}
                          >
                            <Text style={styles.vmSecoursBtnTxt}>Saisir manuellement</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : (
                      <TextInput
                        style={styles.vmInput}
                        value={ventesJour.venteMachine || ''}
                        onChangeText={v => setVente('venteMachine', v)}
                        keyboardType="numeric"
                        placeholder="Saisir..."
                        placeholderTextColor="#bbb"
                        editable={!bloque || isManager}
                      />
                    )}
                  </View>

                  {/* Photo vente machine — sans objet quand le chiffre vient du
                      système : il n'y a plus d'écran à photographier pour
                      prouver un montant que la machine a écrit elle-même. */}
                  {!venteMachineDuSysteme && (!bloque || isManager) && (
                    <View style={[styles.photoBlock,
                      !ventesJour.photoVenteMachine && styles.photoBlockRequired
                    ]}>
                      <View style={styles.photoBlockHeader}>
                        <Text style={styles.photoBlockLabel}>
                          📷 Photo vente machine
                          <Text style={{ color: '#A32D2D' }}> *</Text>
                        </Text>
                        {ventesJour.photoVenteMachine ? (
                          <View style={styles.photoBadgeOk}><Text style={styles.photoBadgeOkTxt}>✅ OK</Text></View>
                        ) : (
                          <View style={styles.photoBadgeReq}><Text style={styles.photoBadgeReqTxt}>⚠️ Requis</Text></View>
                        )}
                      </View>
                      {ventesJour.photoVenteMachine && (
                        <PhotoJustificatif uri={ventesJour.photoVenteMachine} style={styles.photoPreview} />
                      )}
                      <TouchableOpacity
                        style={styles.photoBtn}
                        onPress={() => gererPhoto(url => setVentesJour(prev => ({ ...prev, photoVenteMachine: url })), 'vente-machine')}
                        disabled={uploading}
                      >
                        {uploading ? (
                          <ActivityIndicator size="small" color="#412402" />
                        ) : (
                          <Text style={styles.photoBtnTxt}>
                            {ventesJour.photoVenteMachine ? '🔄 Changer la photo' : '📷 Ajouter une photo'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Écart */}
                  {venteMachineRecue && cumulShifts && !cumulShifts.cloturesPOS?.length && (() => {
                    const ecart = cumulShifts.venteTotal - (parseFloat(ventesJour.venteMachine) || 0)
                    const parfait = Math.abs(ecart) === 0
                    const surplus = ecart > 0
                    return (
                      <View style={[styles.ecartBanner, {
                        backgroundColor: parfait ? '#EAF3DE' : surplus ? '#E6F1FB' : '#FAECE7',
                        borderColor: parfait ? '#3B6D11' : surplus ? '#185FA5' : '#A32D2D',
                        marginTop: 10,
                      }]}>
                        <Text style={[styles.ecartTxt, {
                          color: parfait ? '#3B6D11' : surplus ? '#185FA5' : '#A32D2D'
                        }]}>
                          {parfait ? '✅ Aucun écart — ' : surplus ? '📈 Surplus — ' : '📉 Manquant — '}
                          Écart : {ecart >= 0 ? '+' : ''}{fmt(ecart)}
                        </Text>
                      </View>
                    )
                  })()}

                  {/* Explication écart obligatoire */}
                  {venteMachineRecue && !venteMachineDuSysteme && cumulShifts && Math.abs(cumulShifts.venteTotal - (parseFloat(ventesJour.venteMachine) || 0)) > 0 && (!bloque || isManager) && (
                    <View style={styles.explicacionCard}>
                      <Text style={styles.explicacionLabel}>📝 Explication obligatoire</Text>
                      <Text style={styles.explicacionSub}>
                        Justifiez l&apos;écart avant de continuer (min. 10 caractères)
                      </Text>
                      <TextInput
                        style={styles.explicacionInput}
                        value={ventesJour.explicacionEcartMachine || ''}
                        onChangeText={v => setVente('explicacionEcartMachine', v)}
                        placeholder="Ex : Erreur de saisie caissier, remboursement client..."
                        placeholderTextColor="#bbb"
                        multiline
                        numberOfLines={3}
                        editable={!bloque || isManager}
                      />
                      {(() => {
                        const len = (ventesJour.explicacionEcartMachine || '').trim().length
                        return len > 0 ? (
                          <Text style={{ fontSize: 11, marginTop: 4, color: len >= 10 ? '#3B6D11' : '#993C1D' }}>
                            {len}/10 caractères minimum {len >= 10 ? '✅' : ''}
                          </Text>
                        ) : null
                      })()}
                    </View>
                  )}

                  {/* Écart (manquant ou surplus) — responsables imputés + photos justificatives */}
                  {venteMachineRecue && !venteMachineDuSysteme && cumulShifts && (!bloque || isManager) && (() => {
                    const ecart = cumulShifts.venteTotal - (parseFloat(ventesJour.venteMachine) || 0)
                    if (ecart === 0) return null
                    const estManquant = ecart < 0
                    const libelle = estManquant ? 'manquant' : 'surplus'
                    const montantEcart = Math.abs(ecart)
                    const responsables = ventesJour.ecartResponsables || []
                    const totalImpute = responsables.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0)
                    const reste = montantEcart - totalImpute
                    const complet = Math.round(reste) === 0
                    const photos = ventesJour.ecartPhotos || []
                    const dejaChoisis = new Set(responsables.map(r => r.travailleur_id))
                    const dispo = travailleursEquipe.filter(t => !dejaChoisis.has(t.id))
                    return (
                      <View style={styles.responsablesCard}>
                        <Text style={styles.explicacionLabel}>👤 Responsables du {libelle}</Text>
                        <Text style={styles.explicacionSub}>
                          Répartissez le {libelle} de {fmt(montantEcart)} entre les responsables.
                        </Text>

                        {responsables.map(r => (
                          <View key={r.travailleur_id} style={styles.respRow}>
                            <Text style={styles.respNom} numberOfLines={1}>{r.nom}</Text>
                            <TextInput
                              style={styles.respMontantInput}
                              value={String(r.montant ?? '')}
                              onChangeText={v => modifierMontantResponsable(r.travailleur_id, v.replace(/[^0-9]/g, ''))}
                              placeholder="Montant"
                              placeholderTextColor="#bbb"
                              keyboardType="numeric"
                              editable={!bloque || isManager}
                            />
                            {(!bloque || isManager) && (
                              <TouchableOpacity onPress={() => retirerResponsable(r.travailleur_id)} style={styles.respDelBtn}>
                                <Text style={styles.respDelTxt}>✕</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        ))}

                        {(!bloque || isManager) && dispo.length > 0 && (
                          <TouchableOpacity style={styles.respAddBtn} onPress={() => setShowResponsablePicker(true)}>
                            <Text style={styles.respAddTxt}>+ Ajouter un responsable</Text>
                          </TouchableOpacity>
                        )}

                        <View style={[styles.respRecap, { backgroundColor: complet ? '#EAF3DE' : '#FAECE7' }]}>
                          <Text style={[styles.respRecapTxt, { color: complet ? '#3B6D11' : '#A32D2D' }]}>
                            {complet
                              ? `✅ Réparti : ${fmt(totalImpute)} / ${fmt(montantEcart)}`
                              : `Réparti : ${fmt(totalImpute)} / ${fmt(montantEcart)} — reste ${fmt(reste)}`}
                          </Text>
                        </View>

                        {/* Photos justificatives (une ou plusieurs) */}
                        <Text style={[styles.explicacionLabel, { marginTop: 14 }]}>📷 Photos justificatives</Text>
                        <Text style={styles.explicacionSub}>Optionnel — ajoutez une ou plusieurs photos.</Text>
                        <View style={styles.respPhotosRow}>
                          {photos.map((uri, i) => (
                            <View key={i} style={styles.respPhotoThumb}>
                              <PhotoJustificatif uri={uri} style={styles.respPhotoImg} compact />
                              {(!bloque || isManager) && (
                                <TouchableOpacity style={styles.respPhotoDel} onPress={() => retirerPhotoEcart(i)}>
                                  <Text style={styles.respPhotoDelTxt}>✕</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          ))}
                          {(!bloque || isManager) && (
                            <TouchableOpacity
                              style={styles.respPhotoAdd}
                              disabled={uploading}
                              onPress={() => gererPhoto(ajouterPhotoEcart, 'ecart-manquant')}
                            >
                              <Text style={styles.respPhotoAddTxt}>{uploading ? '…' : '＋'}</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    )
                  })()}
                </View>
              </>
            )}

            {/* Statut photos */}
            {!isManager && (() => {
              const manquantes = verifierPhotosObligatoires()
              return (
                <View style={[styles.photosStatutCard, {
                  backgroundColor: manquantes.length === 0 ? '#EAF3DE' : '#FAECE7',
                  borderColor: manquantes.length === 0 ? '#3B6D11' : '#A32D2D',
                }]}>
                  {manquantes.length === 0 ? (
                    <Text style={[styles.photosStatutTxt, { color: '#3B6D11' }]}>
                      ✅ Toutes les photos sont présentes
                    </Text>
                  ) : (
                    <>
                      <Text style={[styles.photosStatutTxt, { color: '#A32D2D', marginBottom: 6 }]}>
                        ⚠️ Photos manquantes ({manquantes.length}) :
                      </Text>
                      {manquantes.map((m, i) => (
                        <Text key={i} style={{ fontSize: 12, color: '#993C1D', marginTop: 2 }}>• {m}</Text>
                      ))}
                    </>
                  )}
                </View>
              )
            })()}

            {(!bloque || isManager) && (
              <TouchableOpacity
                style={[styles.recapBtn, saving && { opacity: 0.6 }]}
                onPress={allerAuRecap}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.recapTxt}>📋 Voir le récapitulatif complet</Text>
                )}
              </TouchableOpacity>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={photosAlertVisible} transparent animationType="fade">
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitre}>⚠️ Photos manquantes</Text>
            <Text style={styles.confirmMsg}>
              {verifierPhotosObligatoires().map(m => `• ${m}`).join('\n')}
              {'\n\n'}Veuillez ajouter les photos manquantes.
            </Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setPhotosAlertVisible(false)}>
                <Text style={styles.confirmCancelTxt}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmOk} onPress={() => { setPhotosAlertVisible(false); sauvegarderEtContinuer() }}>
                <Text style={styles.confirmOkTxt}>Continuer quand même</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Sélecteur de responsable (équipe active) */}
      <Modal visible={showResponsablePicker} transparent animationType="fade" onRequestClose={() => setShowResponsablePicker(false)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.confirmTitre}>👤 Choisir un responsable</Text>
            {(() => {
              const dejaChoisis = new Set((ventesJour.ecartResponsables || []).map(r => r.travailleur_id))
              const dispo = travailleursEquipe.filter(t => !dejaChoisis.has(t.id))
              if (dispo.length === 0) {
                return <Text style={styles.confirmMsg}>Aucun autre travailleur disponible.</Text>
              }
              return (
                <ScrollView style={{ maxHeight: 320 }}>
                  {dispo.map(t => (
                    <TouchableOpacity key={t.id} style={styles.pickerRow} onPress={() => ajouterResponsable(t)}>
                      <Text style={styles.pickerNom}>{t.nom}</Text>
                      {t.role ? <Text style={styles.pickerPoste}>{t.role === 'gerant' ? 'Gérant' : 'Caissier'}</Text> : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )
            })()}
            <TouchableOpacity style={[styles.confirmCancel, { marginTop: 12 }]} onPress={() => setShowResponsablePicker(false)}>
              <Text style={styles.confirmCancelTxt}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: '#EF9F27', padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  back: { fontSize: 16, color: '#412402', fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: '#412402', textAlign: 'center' },
  headerSub: { fontSize: 11, color: '#854F0B', textAlign: 'center' },
  progressBar: {
    flexDirection: 'row', backgroundColor: colors.surface, padding: 14,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
    alignItems: 'center', justifyContent: 'center'
  },
  progressItem: { flexDirection: 'row', alignItems: 'center' },
  progressNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', marginRight: 6,
    borderWidth: 0.5, borderColor: colors.border
  },
  progressNumActive: { backgroundColor: '#EF9F27', borderColor: '#EF9F27' },
  progressNumTxt: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  progressNumTxtActive: { color: '#412402' },
  progressLine: { width: 40, height: 1.5, backgroundColor: colors.border, marginHorizontal: 6 },
  progressLineActive: { backgroundColor: '#EF9F27' },
  progressLabel: { fontSize: 11, color: colors.textMuted, marginRight: 6 },
  progressLabelActive: { color: '#EF9F27', fontWeight: '600' },
  valideBanner: { backgroundColor: '#FAECE7', padding: 10, alignItems: 'center' },
  valideTxt: { fontSize: 12, color: '#993C1D', fontWeight: '500' },
  cumulBanner: {
    backgroundColor: colors.primaryLight, padding: 8, paddingHorizontal: 14,
    borderBottomWidth: 0.5, borderBottomColor: colors.primaryText,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  cumulBannerTxt: { fontSize: 12, color: colors.primary, fontWeight: '500', flex: 1 },
  cumulRefreshBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  cumulRefreshTxt: { fontSize: 16 },
  chargementBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surfaceAlt, padding: 8, paddingHorizontal: 14
  },
  chargementTxt: { fontSize: 12, color: colors.textMuted },
  uploadBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary, padding: 8, paddingHorizontal: 14
  },
  uploadTxt: { fontSize: 12, color: colors.surface, fontWeight: '500' },
  body: { flex: 1, padding: 16 },
  sectionTitre: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8
  },
  sectionSub: { fontSize: 12, color: colors.textPlaceholder, marginBottom: 12 },
  infoShiftsCard: {
    backgroundColor: colors.primaryLight, borderRadius: 12, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.primaryText
  },
  infoShiftsTitre: { fontSize: 13, fontWeight: '600', color: colors.primary, marginBottom: 6 },
  infoShiftsTxt: { fontSize: 12, color: colors.primary, lineHeight: 18 },
  canalCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 12, borderWidth: 0.5, borderColor: colors.border
  },
  canalHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10
  },
  canalTitre: { fontSize: 14, fontWeight: '600', color: colors.text },
  canalCoeff: {
    fontSize: 12, color: colors.textMuted, backgroundColor: colors.bg,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8
  },
  inputRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  inputLabel: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  inputField: {
    width: 130, backgroundColor: colors.bg, borderRadius: 8,
    padding: 8, fontSize: 14, color: colors.text, textAlign: 'right'
  },
  photoBlock: {
    marginTop: 10, backgroundColor: colors.surfaceAlt,
    borderRadius: 10, padding: 10, borderWidth: 0.5, borderColor: colors.border
  },
  photoBlockRequired: { backgroundColor: '#FAECE7', borderColor: '#F09595' },
  photoBlockHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 8
  },
  photoBlockLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  photoBadgeOk: { backgroundColor: '#EAF3DE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoBadgeOkTxt: { fontSize: 10, color: '#3B6D11', fontWeight: '500' },
  photoBadgeReq: { backgroundColor: '#FAECE7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  photoBadgeReqTxt: { fontSize: 10, color: '#993C1D', fontWeight: '500' },
  photoPreview: { width: '100%', height: 140, borderRadius: 10, marginBottom: 8 },
  photoBtn: { backgroundColor: '#EF9F27', borderRadius: 10, padding: 10, alignItems: 'center' },
  photoBtnTxt: { fontSize: 13, color: '#412402', fontWeight: '500' },
  recapShiftsCard: {
    backgroundColor: colors.orangeLight, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: '#EF9F27'
  },
  recapRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#F5D9A0'
  },
  recapLabel: { fontSize: 13, color: '#854F0B' },
  recapVal: { fontSize: 13, fontWeight: '500', color: '#412402' },
  nextBtn: {
    backgroundColor: '#EF9F27', borderRadius: 14,
    padding: 16, alignItems: 'center', marginBottom: 10, marginTop: 4
  },
  nextTxt: { fontSize: 15, fontWeight: '600', color: '#412402' },
  // ── Vente machine ──
  venteMachineCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.border
  },
  vmRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  vmRowLeft: { flex: 1 },
  vmLabel: { fontSize: 13, color: colors.textSecondary },
  vmValAuto: { fontSize: 14, fontWeight: '600', color: colors.text },
  // Vente machine verrouillée (site alimenté par le POS)
  vmVerrou:    { alignItems: 'flex-end', gap: 3 },
  vmVerrouVal: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  vmVerrouTxt: { fontSize: 9.5, fontWeight: '800', color: colors.primary, backgroundColor: colors.primaryLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  vmSecoursBtn: { marginTop: 7, borderWidth: 1, borderColor: '#EF9F27', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  vmSecoursBtnTxt: { fontSize: 11, fontWeight: '700', color: '#854F0B' },
  // Écarts mesurés par le POS, ventilés par caissier
  ecpBloc:     { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderLight, gap: 6 },
  ecpHead:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  ecpTitre:    { fontSize: 12, fontWeight: '700', color: colors.text, flexShrink: 1 },
  ecpBadge:    { backgroundColor: colors.primaryLight, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  ecpBadgeTxt: { fontSize: 9, fontWeight: '800', color: colors.primary },
  ecpEntree:   { paddingVertical: 3 },
  ecpLigne:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 3 },
  ecpNom:      { fontSize: 13, color: colors.textSecondary, flexShrink: 1 },
  ecpVal:      { fontSize: 13, fontWeight: '700' },
  ecpSecondaire: { fontSize: 11, color: colors.textMuted, marginTop: 2, textAlign: 'right' },
  ecpExplication: { fontSize: 11, lineHeight: 16, color: colors.textMuted, fontStyle: 'italic', paddingRight: 8 },
  ecpTotal:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4, paddingTop: 8, borderTopWidth: 1.5, borderTopColor: colors.border },
  ecpTotalLbl: { fontSize: 11, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase' },
  ecpTotalVal: { fontSize: 17, fontWeight: '700' },
  ecpNote:     { fontSize: 11, color: colors.textMuted, lineHeight: 15, marginTop: 4 },
  vmInput: {
    width: 140, backgroundColor: colors.bg, borderRadius: 10,
    padding: 10, fontSize: 15, color: colors.text, textAlign: 'right',
    borderWidth: 1, borderColor: '#EF9F27'
  },
  // ── FC ──
  fcCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.border
  },
  fcRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  fcRowLeft: { flex: 1 },
  fcLabel: { fontSize: 13, color: colors.textSecondary },
  fcValAuto: { fontSize: 14, fontWeight: '600', color: colors.text },
  fcInput: {
    width: 140, backgroundColor: colors.bg, borderRadius: 10,
    padding: 10, fontSize: 15, color: colors.text, textAlign: 'right',
    borderWidth: 1, borderColor: colors.primary
  },
  autoBadge: {
    backgroundColor: '#EAF3DE', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8, alignSelf: 'flex-start', marginTop: 3
  },
  autoBadgeTxt: { fontSize: 9, color: '#3B6D11', fontWeight: '600' },
  ecartBanner: {
    borderRadius: 10, padding: 10, marginTop: 10,
    borderWidth: 1
  },
  ecartTxt: { fontSize: 13, fontWeight: '600' },
  explicacionCard: {
    backgroundColor: '#FAEEDA', borderRadius: 12, padding: 14,
    marginTop: 10, borderWidth: 1, borderColor: '#EF9F27'
  },
  explicacionLabel: { fontSize: 13, fontWeight: '700', color: '#854F0B', marginBottom: 4 },
  explicacionSub: { fontSize: 11, color: '#A06010', marginBottom: 8 },
  explicacionInput: {
    backgroundColor: '#fff', borderRadius: 10, padding: 10,
    fontSize: 13, color: '#333', minHeight: 70, textAlignVertical: 'top',
    borderWidth: 1, borderColor: '#EF9F27'
  },
  // ── Responsables du manquant ──
  responsablesCard: {
    backgroundColor: '#FBE9E7', borderRadius: 12, padding: 14,
    marginTop: 10, borderWidth: 1, borderColor: '#A32D2D'
  },
  respRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  respNom: { flex: 1, fontSize: 13, fontWeight: '600', color: '#333' },
  respMontantInput: {
    width: 110, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13, color: '#333', borderWidth: 1, borderColor: '#E0A3A3', textAlign: 'right'
  },
  respDelBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F5C6C0', alignItems: 'center', justifyContent: 'center' },
  respDelTxt: { fontSize: 14, color: '#A32D2D', fontWeight: '700' },
  respAddBtn: { paddingVertical: 8, alignItems: 'center', marginBottom: 6 },
  respAddTxt: { fontSize: 13, fontWeight: '600', color: '#185FA5' },
  respRecap: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginTop: 4 },
  respRecapTxt: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  respPhotosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  respPhotoThumb: { width: 64, height: 64, borderRadius: 8, overflow: 'hidden', position: 'relative' },
  respPhotoImg: { width: '100%', height: '100%' },
  respPhotoDel: { position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  respPhotoDelTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  respPhotoAdd: { width: 64, height: 64, borderRadius: 8, borderWidth: 1.5, borderColor: '#A32D2D', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  respPhotoAddTxt: { fontSize: 26, color: '#A32D2D', fontWeight: '300' },
  pickerBox: {
    backgroundColor: colors.surface, borderRadius: 18,
    padding: 20, width: '100%', maxWidth: 380
  },
  pickerRow: { paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  pickerNom: { fontSize: 15, fontWeight: '600', color: colors.text },
  pickerPoste: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  // ── Bénéfice SC ──
  beneficeCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 0.5, borderColor: colors.border
  },
  beneficeRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: colors.bg
  },
  beneficeLabel: { fontSize: 13, color: colors.textSecondary },
  beneficeVal: { fontSize: 13, fontWeight: '500', color: colors.text },
  photosStatutCard: { borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1.5 },
  photosStatutTxt: { fontSize: 13, fontWeight: '600' },
  recapBtn: {
    backgroundColor: '#3B6D11', borderRadius: 14,
    padding: 16, alignItems: 'center', marginBottom: 10
  },
  recapTxt: { fontSize: 15, fontWeight: '600', color: '#fff' },
  confirmOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 24
  },
  confirmBox: {
    backgroundColor: colors.surface, borderRadius: 18,
    padding: 24, width: '100%', maxWidth: 380
  },
  confirmTitre: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 12 },
  confirmMsg: { fontSize: 14, color: colors.textSecondary, lineHeight: 22, marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: {
    flex: 1, padding: 14, borderRadius: 12,
    backgroundColor: colors.bg, alignItems: 'center'
  },
  confirmCancelTxt: { fontSize: 14, color: colors.textMuted },
  confirmOk: {
    flex: 1, padding: 14, borderRadius: 12,
    backgroundColor: '#EF9F27', alignItems: 'center'
  },
  confirmOkTxt: { fontSize: 14, fontWeight: '600', color: '#412402' },
}) }

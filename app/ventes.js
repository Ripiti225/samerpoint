import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Platform, SafeAreaView, ScrollView, Text, View } from 'react-native'
import {
  Bandeau, BarreBas, BarreEtapes, BoutonDegrade, BoutonSecondaire, Choix, EnTete, Feuille, Vide, contexteJour,
  useStyleChaleureux,
} from '../components/ui/StyleChaleureux'
import EtapeFondBenefice from '../components/ventes/EtapeFondBenefice'
import EtapeMachineEcart from '../components/ventes/EtapeMachineEcart'
import EtapeTab from '../components/ventes/EtapeTab'
import { useApp } from '../context/AppContext'
import { cloturesPOS, resumerEcartsGlobaux } from '../lib/cloturesCaisse'
import { depensesSalairesShift } from '../lib/depensesShift'
import { manquantsVentes, photosManquantesVentes } from '../lib/manquantsSaisie'
import { estRempliParLePOS, peutSaisirVenteMachineManuellement, venteMachineEstRecue, venteMachineVientDuPOS } from '../lib/sourcePoint'
import { useFondTresorerie } from '../lib/useFondTresorerie'
import { supabase } from '../lib/supabase'
import { usePhoto } from '../lib/usePhoto'

const ETAPES = ['Livraisons TAB', 'Fond & bénéfice', 'Vente machine & écart']
const ETAPES_COURTES = ['TAB', 'Fond & bénéfice', 'Machine']

export default function VentesScreen() {
  const {
    pointId, pointValide, estBloque,
    ventesJour, setVentesJour,
    resteEspeces, fc, beneficeSC,
    roleActif, restaurantId, restaurantNom, dateJour,
  } = useApp()

  const { prendrePhoto, choisirPhoto } = usePhoto()
  const { styles } = useStyleChaleureux()
  // « FC reçu » rempli par la Trésorerie (fond donné), non modifiable.
  useFondTresorerie({ pointId, restaurantId, dateJour, pointValide, setVentesJour })
  const fcRecuAuto = ventesJour.fc_recu_auto != null

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
        pointsFidelite: shifts.reduce((s, sh) => s + (Number(sh.points_fidelite) || 0), 0),
        retour: shifts.reduce((s, sh) => s + (sh.retour || 0), 0),
        depenses: shifts.reduce((s, sh) => s + depensesSalairesShift(sh), 0),
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
      // Seulement les jours AVANT celui-ci : sans ce filtre, valider le 20 avant
      // le 19 faisait prendre au 19 le fond du 20 (À la Braise, 20/10/2026).
      const queteFcVeille = (cols) => {
        let q = supabase
          .from('points')
          .select(cols)
          .eq('restaurant_id', restaurantId)
          .eq('valide', true)
          .neq('id', pointId)
        if (dateJour) q = q.lt('date', dateJour)
        return q.order('date', { ascending: false }).limit(1).single()
      }

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
        pointsFidelite: String(cumul.pointsFidelite || ''),
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

  const voitShifts = isGerant || isManager
  const modifiable = !bloque || isManager
  // Une seule source pour « Il manque » et pour le contrôle du bouton (lib/manquantsSaisie.js).
  const photosManquantes = photosManquantesVentes({ ventesJour, venteMachineDuSysteme, voitMachine: voitShifts })
  const manquants = manquantsVentes({
    ventesJour, cumulShifts, venteMachineRecue, venteMachineDuSysteme, voitMachine: voitShifts, isManager,
  })
  const dejaChoisis = new Set((ventesJour.ecartResponsables || []).map(r => r.travailleur_id))
  const responsablesDispo = travailleursEquipe.filter(t => !dejaChoisis.has(t.id))

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
      // Sur un site POS, l'écart est déjà mesuré, expliqué et rattaché à sa
      // caissière dans la caisse : manquantsVentes ne le redemande pas.
      const bloquant = manquants.find(m => m.bloquant)
      if (bloquant) {
        Alert.alert(bloquant.alerte.titre, bloquant.alerte.message)
        return
      }
      if (photosManquantes.length > 0) {
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

  function revenir() {
    if (etape > 1) setEtape(etape - 1)
    else if (router.canGoBack()) router.back()
    else router.replace('/accueil')
  }

  function ouvrirSecours() {
    Alert.alert(
      'Saisie manuelle de secours',
      'Le POS n’a transmis aucune vente machine. Confirmez uniquement après avoir vérifié que sa synchronisation est terminée.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Saisir manuellement', onPress: () => setSaisieManuelleVenteMachine(true) },
      ]
    )
  }

  const manquantsAffiches = etape === 3 ? manquants : manquants.filter(m => m.etape === etape)

  return (
    <SafeAreaView style={styles.ecran}>
      <EnTete surtitre="Saisie des ventes" titre={ETAPES[etape - 1]} contexte={contexteJour(restaurantNom, dateJour)}
        onRetour={revenir} libelleRetour={etape > 1 ? `‹ Étape ${etape - 1}` : '‹ Retour'}>
        <BarreEtapes etapes={ETAPES_COURTES} actuelle={etape} onChoisir={setEtape} />
      </EnTete>

      {pointValide && !isManager ? <Bandeau ton="erreur" texte="🔒 Point validé — lecture seule" /> : null}
      {voitShifts ? (
        <Bandeau ton="neutre" chargement={chargementShifts}
          texte={cumulShifts ? `📊 ${cumulShifts.nbShifts} shift(s) validé(s) — Vente : ${fmt(cumulShifts.venteTotal)}` : '📊 Aucun shift chargé'}
          action={{ icone: '🔄', libelle: 'Recharger les shifts', onPress: chargerCumulShifts, disabled: chargementShifts }} />
      ) : null}
      {uploading ? <Bandeau chargement texte="Envoi de la photo en cours…" /> : null}

      <ScrollView style={styles.corps} contentContainerStyle={styles.corpsContenu}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {etape === 1 ? (
          <EtapeTab ventesJour={ventesJour} setVente={setVente} setVentesJour={setVentesJour} modifiable={modifiable}
            cumulShifts={cumulShifts} voitShifts={voitShifts} onPhoto={gererPhoto} uploading={uploading} fmt={fmt} />
        ) : null}
        {etape === 2 ? (
          <EtapeFondBenefice ventesJour={ventesJour} setVente={setVente} modifiable={modifiable} fcRecuAuto={fcRecuAuto}
            resteEspeces={resteEspeces} fc={fc} beneficeSC={beneficeSC} fmt={fmt} />
        ) : null}
        {etape === 3 ? (
          <EtapeMachineEcart
            ventesJour={ventesJour} setVente={setVente} setVentesJour={setVentesJour} modifiable={modifiable}
            cumulShifts={cumulShifts} voitMachine={voitShifts}
            venteMachineDuPOS={venteMachineDuPOS} saisieManuelle={saisieManuelleVenteMachine}
            secoursDisponible={secoursVenteMachineDisponible} onSecours={ouvrirSecours}
            venteMachineRecue={venteMachineRecue} venteMachineDuSysteme={venteMachineDuSysteme}
            onPhoto={gererPhoto} uploading={uploading}
            responsablesDispo={responsablesDispo} onChoisirResponsable={() => setShowResponsablePicker(true)}
            onMontantResponsable={modifierMontantResponsable} onRetirerResponsable={retirerResponsable}
            onAjouterPhotoEcart={ajouterPhotoEcart} onRetirerPhotoEcart={retirerPhotoEcart}
            fmt={fmt}
          />
        ) : null}
      </ScrollView>

      {etape < 3 || modifiable ? (
        <BarreBas manquants={manquantsAffiches}>
          {etape < 3 ? (
            <BoutonDegrade label={`Continuer › ${ETAPES[etape]}`} onPress={() => setEtape(etape + 1)} />
          ) : (
            <BoutonDegrade label="Voir le récapitulatif" onPress={allerAuRecap} chargement={saving}
              attenue={manquants.some(m => m.bloquant)} />
          )}
        </BarreBas>
      ) : null}

      <Feuille visible={photosAlertVisible} titre="⚠️ Photos manquantes" onFermer={() => setPhotosAlertVisible(false)}>
        <Text style={styles.texte}>
          {photosManquantes.map(m => `• ${m}`).join('\n')}
          {'\n\n'}Veuillez ajouter les photos manquantes.
        </Text>
        <View style={[styles.ligneChamps, { marginTop: 16, alignItems: 'center' }]}>
          <BoutonSecondaire style={{ flex: 1, marginBottom: 0 }} label="Annuler" onPress={() => setPhotosAlertVisible(false)} />
          <BoutonDegrade style={{ flex: 1 }} label="Continuer quand même"
            onPress={() => { setPhotosAlertVisible(false); sauvegarderEtContinuer() }} />
        </View>
      </Feuille>

      <Feuille visible={showResponsablePicker} titre="👤 Choisir un responsable" onFermer={() => setShowResponsablePicker(false)}>
        {responsablesDispo.length === 0 ? (
          <Vide texte="Aucun autre travailleur disponible." />
        ) : responsablesDispo.map(t => (
          <Choix key={t.id} nom={t.nom} sous={t.role ? (t.role === 'gerant' ? 'Gérant' : 'Caissier') : null}
            onPress={() => ajouterResponsable(t)} />
        ))}
      </Feuille>
    </SafeAreaView>
  )
}

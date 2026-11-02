import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, Platform } from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { getRestaurants, getUtilisateurs, getUtilisateursGlobaux } from '../lib/api'
import { ROLES_GLOBAUX } from '../lib/constants'
import { separerComptesPOS } from '../lib/sourcePoint'
import { destinationApresDeverrouillage } from '../lib/inactivityLock'
import { controlerEnrolement, peutProposerActivation } from '../lib/biometrie'
import {
  activer, aRefuse, estSupportee, lireEnrolements, messageErreur,
  noterRefus, oublierEnrolement, signature, verifier,
} from '../lib/biometrieAppareil'
import {
  ajouterReconnu, ecranDeDepart, estReconnu, nettoyerReconnus, trierRestaurants,
} from '../lib/restosReconnus'
import { ecrireReconnus, lireReconnus } from '../lib/restosReconnusStockage'
import AccueilLogin from '../components/login/AccueilLogin'
import QuiEtesVous from '../components/login/QuiEtesVous'
import ClavierCode from '../components/login/ClavierCode'
import ActivationFaceID from '../components/login/ActivationFaceID'
import { couleurResto, couleurRole, initiales, libelleRole, themeLogin } from '../components/login/themeLogin'
import '../lib/webAlert'   // remplace Alert.alert par les dialogues du navigateur
import AsyncStorage from '@react-native-async-storage/async-storage'
import { empreinteHorsLigne, LONGUEUR_NOUVEAU_CODE, libelleAttente, longueurCode, problemeNouveauCode } from '../lib/codes'
import { changerMonCode, connexionUtilisateur, messageReponse } from '../lib/codesDb'

// Sans internet, on ne se reconnecte que sur un téléphone où ce compte s'est
// déjà connecté (empreinte du code, jamais le code lui-même).
const cleHorsLigne = id => `samtrackly_code_hors_ligne_${id}`
async function enregistrerHorsLigne(id, code) {
  try { await AsyncStorage.setItem(cleHorsLigne(id), empreinteHorsLigne(id, code)) } catch {}
}
async function verifierHorsLigne(id, code) {
  try { return (await AsyncStorage.getItem(cleHorsLigne(id))) === empreinteHorsLigne(id, code) } catch { return false }
}

// ─── Écran principal ─────────────────────────────────────────
export default function LoginScreen() {
  const { isDark } = useTheme()
  const t = themeLogin(isDark)
  const [etape, setEtape] = useState(1)
  const [restaurants, setRestaurants] = useState([])
  const [utilisateurs, setUtilisateurs] = useState([])
  const [selectedResto, setSelectedResto] = useState(null)
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState('')
  const [loadingRestos, setLoadingRestos] = useState(true)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [pinError, setPinError] = useState(false)
  const [tentativesResto, setTentativesResto] = useState(0)
  // Code vérifié par le serveur (supabase_codes_securises.sql).
  const [verifEnCours, setVerifEnCours] = useState(false)
  const [erreurCode, setErreurCode] = useState(null)
  const [veutChanger, setVeutChanger] = useState(false)
  // Changement de code : { ancien, nouveau (1re saisie), oblige }.
  const [changement, setChangement] = useState(null)
  const [bloqueJusquaResto, setBloqueJusquaResto] = useState(null)
  const [bloqueJusquaUser, setBloqueJusquaUser] = useState(null)
  const [secondesRestantes, setSecondesRestantes] = useState(0)
  // Face ID / empreinte (web, ou appli installée avec le module natif —
  // cf. lib/biometrieAppareil.js)
  const [bioSupportee, setBioSupportee] = useState(false)
  const [enrolements, setEnrolements] = useState([])
  const [bioEnCours, setBioEnCours] = useState(false)
  const [bioMessage, setBioMessage] = useState('')
  const [activationEnAttente, setActivationEnAttente] = useState(null)
  // Restaurants dont ce téléphone connaît déjà le code (lib/restosReconnus.js)
  const [reconnus, setReconnus] = useState([])

  const {
    setRoleActif, resetJour, setLastRoute,
    setRestaurantId, setRestaurantNom,
    setUserId, setUserNom,
    userId: userIdEnSession, restaurantId: restaurantIdEnSession,
    sessionVerrouille, deverrouillerSession, lastRoute,
  } = useApp()

  useEffect(() => {
    if (!bloqueJusquaResto && !bloqueJusquaUser) return
    const interval = setInterval(() => {
      const cible = bloqueJusquaResto || bloqueJusquaUser
      const reste = Math.ceil((cible - Date.now()) / 1000)
      if (reste <= 0) {
        setBloqueJusquaResto(null)
        setBloqueJusquaUser(null)
        setSecondesRestantes(0)
        clearInterval(interval)
      } else {
        setSecondesRestantes(reste)
      }
    }, 500)
    return () => clearInterval(interval)
  }, [bloqueJusquaResto, bloqueJusquaUser])

  useEffect(() => { fetchRestaurants() }, [])
  useEffect(() => {
    estSupportee().then(setBioSupportee)
    lireEnrolements().then(setEnrolements)
  }, [])

  async function fetchRestaurants() {
    setLoadingRestos(true)
    const [data, liste] = await Promise.all([getRestaurants(), lireReconnus()])
    // Un code restaurant modifié fait oublier le restaurant sur ce téléphone.
    const nette = nettoyerReconnus(liste, data)
    if (nette.length !== liste.length) ecrireReconnus(nette)
    setReconnus(nette)
    setRestaurants(trierRestaurants(data, nette))
    setLoadingRestos(false)
    if (sessionVerrouille) {
      const resto = data.find(r => r.id === restaurantIdEnSession)
      if (resto) choisirRestaurant(resto, nette)
      else chargerUtilisateursGlobaux()
      return
    }
    const depart = ecranDeDepart({
      valides: data.filter(r => estReconnu(nette, r)),
      enrolements: await lireEnrolements(),
      verrouille: false,
    })
    if (depart.ecran === 'quiEtesVous') {
      setSelectedResto(depart.restaurant)
      chargerUtilisateurs(depart.restaurant)
    }
  }

  function choisirRestaurant(resto, liste = reconnus) {
    setSelectedResto(resto)
    setBioMessage('')
    setPin('')
    setPinError(false)
    setTentativesResto(0)
    setBloqueJusquaResto(null)
    if (estReconnu(liste, resto)) {
      chargerUtilisateurs(resto)
      return
    }
    if (Platform.OS === 'web') {
      try {
        const stored = localStorage.getItem(`sam_lockout_resto_${resto.id}`)
        if (stored) {
          const until = parseInt(stored)
          if (Date.now() < until) setBloqueJusquaResto(until)
          else localStorage.removeItem(`sam_lockout_resto_${resto.id}`)
        }
      } catch {}
    }
    setEtape(2)
  }

  function verifierPinRestaurant(pinSaisi) {
    if (bloqueJusquaResto && Date.now() < bloqueJusquaResto) return
    const ok = pinSaisi === String(selectedResto.pin)
    if (ok) {
      setPinError(false)
      setPin('')
      setTentativesResto(0)
      if (Platform.OS === 'web') {
        try { localStorage.removeItem(`sam_lockout_resto_${selectedResto.id}`) } catch {}
      }
      const liste = ajouterReconnu(reconnus, selectedResto)
      setReconnus(liste)
      ecrireReconnus(liste)
      chargerUtilisateurs(selectedResto)
    } else {
      const nouvellesTentatives = tentativesResto + 1
      setTentativesResto(nouvellesTentatives)
      setPinError(true)
      setPin('')
      if (nouvellesTentatives >= 3) {
        const until = Date.now() + 30_000
        setBloqueJusquaResto(until)
        if (Platform.OS === 'web') {
          try { localStorage.setItem(`sam_lockout_resto_${selectedResto.id}`, String(until)) } catch {}
        }
        setTentativesResto(0)
      }
    }
  }

  async function chargerUtilisateurs(resto) {
    setLoadingUsers(true)
    setEtape(3)
    const data = await getUtilisateurs(resto.id)
    setUtilisateurs(data)
    setLoadingUsers(false)
    if (sessionVerrouille) {
      const utilisateur = data.find(u => u.id === userIdEnSession)
      if (utilisateur) choisirUtilisateur(utilisateur)
    }
  }

  async function chargerUtilisateursGlobaux() {
    setSelectedResto(null)
    setLoadingUsers(true)
    setEtape(3)
    const data = await getUtilisateursGlobaux()
    setUtilisateurs(data)
    setLoadingUsers(false)
    if (sessionVerrouille) {
      const utilisateur = data.find(u => u.id === userIdEnSession)
      if (utilisateur) choisirUtilisateur(utilisateur)
    }
  }

  function choisirUtilisateur(user) {
    setBioMessage('')
    setSelected(user)
    setPin('')
    setPinError(false)
    setErreurCode(null)
    setVeutChanger(false)
    setChangement(null)
    setBloqueJusquaUser(null)
    setEtape(4)
  }

  // Avatar 🔐 : Face ID part tout de suite (dans l'appui, exigence Safari) ;
  // en cas d'annulation on reste sur le clavier, touche 🔐 disponible.
  function toucherAvatar(user) {
    choisirUtilisateur(user)
    const e = enrolementsDe(user, selectedResto)[0]
    if (bioSupportee && e) entrerAvecBiometrie(e)
  }

  // Nombre de chiffres attendus : code du restaurant, ancien code (4) ou
  // nouveau code (6) de la personne, nouveau code en cours de choix.
  const longueurAttendue = etape === 2 ? (String(selectedResto?.pin ?? '').length || 4)
    : etape === 6 ? LONGUEUR_NOUVEAU_CODE : longueurCode(selected)

  function appuyerChiffre(chiffre) {
    if (verifEnCours || pin.length >= longueurAttendue) return
    const newPin = pin + chiffre
    setPin(newPin)
    if (pinError) { setPinError(false); setErreurCode(null) }
    if (newPin.length === longueurAttendue) {
      if (etape === 2) verifierPinRestaurant(newPin)
      else if (etape === 4) verifierPinUtilisateur(newPin)
      else if (etape === 6) saisirNouveauCode(newPin)
    }
  }

  function supprimer() {
    setPin(pin.slice(0, -1))
    setPinError(false)
  }

  async function verifierPinUtilisateur(pinSaisi) {
    if (bloqueJusquaUser && Date.now() < bloqueJusquaUser) return
    setVerifEnCours(true)
    let r = await connexionUtilisateur(selected.id, pinSaisi)
    if (r.statut === 'hors_ligne') {
      r = (await verifierHorsLigne(selected.id, pinSaisi))
        ? { statut: 'ok', code_a_changer: false }
        : { statut: 'erreur', message: 'Pas d\'internet. Connectez-vous une première fois avec internet sur ce téléphone.' }
    }
    setVerifEnCours(false)
    setPin('')
    if (r.statut === 'bloque') {
      setBloqueJusquaUser(new Date(r.bloque_jusqua).getTime())
      setPinError(true)
      setErreurCode(messageReponse(r))
      return
    }
    if (r.statut !== 'ok') {
      setPinError(true)
      setErreurCode(messageReponse(r))
      return
    }
    setPinError(false)
    setErreurCode(null)
    enregistrerHorsLigne(selected.id, pinSaisi)
    const user = { ...selected, code_version: r.code_version ?? selected.code_version, code_a_changer: !!r.code_a_changer }
    setSelected(user)
    // Code à changer (imposé), ou « Changer mon code » demandé : on choisit
    // le nouveau code avant d'entrer.
    if (user.code_a_changer || veutChanger) {
      setChangement({ ancien: pinSaisi, nouveau: null, oblige: user.code_a_changer })
      setEtape(6)
      return
    }
    await apresCodeJuste(user)
  }

  // Nouveau code : 1re saisie (règles), puis confirmation, puis serveur.
  async function saisirNouveauCode(code) {
    setPin('')
    if (!changement.nouveau) {
      const probleme = problemeNouveauCode(code, changement.ancien)
      if (probleme) { setPinError(true); setErreurCode(probleme); return }
      setChangement(c => ({ ...c, nouveau: code }))
      return
    }
    if (code !== changement.nouveau) {
      setChangement(c => ({ ...c, nouveau: null }))
      setPinError(true)
      setErreurCode('Les deux codes ne sont pas pareils. Recommencez.')
      return
    }
    setVerifEnCours(true)
    const r = await changerMonCode(selected.id, changement.ancien, code)
    setVerifEnCours(false)
    if (r.statut !== 'ok') {
      setChangement(c => ({ ...c, nouveau: null }))
      setPinError(true)
      setErreurCode(messageReponse(r))
      return
    }
    enregistrerHorsLigne(selected.id, code)
    const user = { ...selected, code_version: r.code_version, code_a_changer: false, pin_longueur: LONGUEUR_NOUVEAU_CODE }
    setSelected(user)
    setChangement(null)
    setVeutChanger(false)
    Alert.alert('Code changé', 'Votre nouveau code à 6 chiffres est enregistré. C\'est lui qui servira désormais. Si Face ID était activé, réactivez-le.')
    await apresCodeJuste(user)
  }

  async function apresCodeJuste(user) {
    // Codes justes : c'est le seul moment où l'on peut proposer Face ID,
    // la personne venant de prouver qui elle est.
    const dejaActive = enrolementsDe(user, selectedResto).length > 0
    if (peutProposerActivation({
      supporte: bioSupportee, role: user.role,
      dejaActive, refuse: await aRefuse(user.id),
    })) {
      setBioMessage('')
      setActivationEnAttente({ utilisateur: user, restaurant: selectedResto })
      setEtape(5)
      return
    }
    ouvrirSession(user, selectedResto)
  }

  async function activerBiometrie() {
    if (bioEnCours || !activationEnAttente) return
    const { utilisateur, restaurant } = activationEnAttente
    setBioEnCours(true)
    setBioMessage('')
    try {
      setEnrolements(await activer(utilisateur, restaurant))
      ouvrirSession(utilisateur, restaurant)
    } catch (err) {
      setBioMessage(messageErreur(err))
    } finally {
      setBioEnCours(false)
    }
  }

  function passerActivation(definitivement) {
    const { utilisateur, restaurant } = activationEnAttente
    if (definitivement) noterRefus(utilisateur.id)
    ouvrirSession(utilisateur, restaurant)
  }

  // navigator.credentials.get part en premier, directement depuis l'appui :
  // Safari refuse Face ID si un chargement réseau le précède.
  async function entrerAvecBiometrie(enrolement) {
    if (!enrolement || bioEnCours) return
    setBioEnCours(true)
    setBioMessage('')
    try {
      await verifier(enrolement)
    } catch (err) {
      setBioMessage(messageErreur(err))
      setBioEnCours(false)
      return
    }
    try {
      // restaurantId null = compte administration (manager, directeur, RH)
      const global = !enrolement.restaurantId
      const resto = global ? null : restaurants.find(r => r.id === enrolement.restaurantId) || null
      const users = global ? await getUtilisateursGlobaux() : resto ? await getUtilisateurs(resto.id) : []
      const user = users.find(u => u.id === enrolement.userId) || null
      const sig = user && (resto || global) ? await signature(user, resto) : null
      const controle = controlerEnrolement(enrolement, { utilisateur: user, restaurant: resto, signature: sig })
      if (!controle.ok) {
        if (controle.oublier) setEnrolements(await oublierEnrolement(enrolement.credentialId))
        setBioMessage(controle.message)
        return
      }
      setSelectedResto(resto)
      setSelected(user)
      if (user.code_a_changer) {
        setPin('')
        setEtape(4)
        setBioMessage('Vous devez changer votre code : entrez d\'abord votre code actuel.')
        return
      }
      ouvrirSession(user, resto)
    } catch {
      setBioMessage('Connexion impossible pour le moment. Entrez vos codes.')
    } finally {
      setBioEnCours(false)
    }
  }

  function retirerBiometrie(enrolement) {
    Alert.alert(
      `Retirer Face ID de ce téléphone pour ${enrolement.userNom} (${enrolement.restaurantNom}) ?`,
      'Vous devrez entrer vos codes à la prochaine connexion. Vous pourrez le réactiver ensuite.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Retirer', style: 'destructive', onPress: () => {
          oublierEnrolement(enrolement.credentialId).then(setEnrolements)
          setBioMessage('')
        } },
      ],
    )
  }

  // Comptes activés pour cet utilisateur à cet endroit (null = administration).
  function enrolementsDe(utilisateur, resto) {
    return enrolements.filter(e => e.userId === utilisateur?.id && e.restaurantId === (resto?.id ?? null))
  }

  // Ouverture commune aux deux chemins : codes PIN ou Face ID.
  function ouvrirSession(utilisateur, resto) {
    const memeUtilisateur = userIdEnSession === utilisateur.id
    if (!memeUtilisateur) {
      resetJour()
    } else if (!sessionVerrouille && (utilisateur.role === 'caissier' || utilisateur.role === 'gerant')) {
      setLastRoute(null)
    }

    setRoleActif(utilisateur.role)
    setUserId(utilisateur.id)
    setUserNom(utilisateur.nom)

    const estGlobal = ROLES_GLOBAUX.includes(utilisateur.role)
    const restoId = estGlobal ? null : resto?.id
    const restoNom = estGlobal ? null : resto?.nom
    setRestaurantId(restoId)
    setRestaurantNom(restoNom)

    const destination = sessionVerrouille && destinationApresDeverrouillage(lastRoute)
    if (sessionVerrouille) {
      deverrouillerSession()
      if (destination) {
        router.replace(destination)
        return
      }
    }

    if (utilisateur.role === 'manager' || utilisateur.role === 'directeur') {
      router.replace({ pathname: '/accueil', params: { userId: utilisateur.id, nom: utilisateur.nom, role: utilisateur.role } })
    } else if (utilisateur.role === 'rh') {
      router.replace({ pathname: '/accueil', params: { userId: utilisateur.id, nom: utilisateur.nom, role: utilisateur.role } })
    } else if (utilisateur.role === 'verificateur') {
      router.replace({ pathname: '/verificateur', params: { userId: utilisateur.id, nom: utilisateur.nom, role: utilisateur.role } })
    } else if (utilisateur.role === 'superviseur') {
      router.replace({ pathname: '/superviseur', params: { userId: utilisateur.id, nom: utilisateur.nom, role: utilisateur.role } })
    } else if (utilisateur.role === 'gerant') {
      router.replace({ pathname: '/choix-date', params: { userId: utilisateur.id, nom: utilisateur.nom, role: utilisateur.role } })
    } else {
      router.replace({ pathname: '/selectionner-journee', params: { userId: utilisateur.id, nom: utilisateur.nom, role: utilisateur.role, restoId } })
    }
  }

  const enrolementsAffiches = bioSupportee ? enrolements : []

  if (etape === 1) {
    return (
      <AccueilLogin
        t={t}
        restaurants={restaurants}
        chargement={loadingRestos}
        reconnusIds={restaurants.filter(r => estReconnu(reconnus, r)).map(r => r.id)}
        enrolements={enrolementsAffiches}
        bioSupportee={bioSupportee}
        bioEnCours={bioEnCours}
        bioMessage={bioMessage}
        onFaceID={entrerAvecBiometrie}
        onRetirerFaceID={retirerBiometrie}
        onResto={(r) => choisirRestaurant(r)}
        onGlobal={chargerUtilisateursGlobaux}
      />
    )
  }

  if (etape === 2) {
    const ici = enrolementsAffiches.filter(e => e.restaurantId === selectedResto?.id)
    return (
      <ClavierCode
        t={t}
        entete={{
          initialesTexte: initiales(selectedResto?.nom),
          couleur: couleurResto(selectedResto),
          titre: selectedResto?.nom,
          sousTitre: selectedResto?.localisation || 'Abidjan',
        }}
        consigne="Code du restaurant"
        longueur={longueurAttendue}
        pin={pin} pinError={pinError} secondesRestantes={libelleAttente(secondesRestantes)}
        bloque={!!(bloqueJusquaResto && Date.now() < bloqueJusquaResto)}
        couleur={couleurResto(selectedResto)}
        appuyerChiffre={appuyerChiffre} supprimer={supprimer}
        toucheFaceID={ici.length === 1}
        onFaceID={() => entrerAvecBiometrie(ici[0])}
        bioEnCours={bioEnCours} bioMessage={bioMessage}
        lienBas={{ texte: 'Changer de restaurant', onPress: () => { setEtape(1); setPin(''); setPinError(false) } }}
      />
    )
  }

  if (etape === 3) {
    const modeGlobal = !selectedResto
    const globaux = utilisateurs.filter(u => ROLES_GLOBAUX.includes(u.role))
    // Sur un site passé au POS, les caissiers ne saisissent plus ici : leurs
    // comptes sortent de la liste (jamais désactivés — un UPDATE sur
    // restaurants.source_point les fait revenir au prochain chargement).
    const { visibles: specifiques, reprisParLePOS } = separerComptesPOS(
      selectedResto,
      utilisateurs.filter(u => !ROLES_GLOBAUX.includes(u.role)),
    )
    return (
      <QuiEtesVous
        t={t}
        restaurant={selectedResto}
        utilisateurs={modeGlobal ? globaux : specifiques}
        chargement={loadingUsers}
        reconnu={estReconnu(reconnus, selectedResto)}
        idsFaceID={enrolementsAffiches
          .filter(e => e.restaurantId === (selectedResto?.id ?? null))
          .map(e => e.userId)}
        reprisParLePOS={modeGlobal ? [] : reprisParLePOS}
        onChoisir={toucherAvatar}
        onRetour={() => { setPin(''); setPinError(false); setBioMessage(''); setEtape(1) }}
      />
    )
  }

  if (etape === 5 && activationEnAttente) {
    const { utilisateur, restaurant } = activationEnAttente
    return (
      <ActivationFaceID
        t={t}
        utilisateur={utilisateur}
        restaurant={restaurant}
        enCours={bioEnCours}
        message={bioMessage}
        onActiver={activerBiometrie}
        onPlusTard={() => passerActivation(false)}
        onJamais={() => passerActivation(true)}
      />
    )
  }

  if (etape === 6 && changement) {
    return (
      <ClavierCode
        t={t}
        entete={{
          initialesTexte: initiales(selected?.nom),
          couleur: couleurRole(selected?.role),
          titre: selected?.nom,
          sousTitre: changement.oblige ? 'Nouveau code obligatoire' : 'Changer mon code',
        }}
        bandeau={changement.oblige
          ? { titre: 'Changez votre code', texte: 'Pour la sécurité de tous, choisissez un nouveau code personnel à 6 chiffres. C\'est lui qui servira désormais. Évitez 123456, 111111, votre date de naissance…' }
          : { titre: 'Nouveau code', texte: '6 chiffres, pas trop simples.' }}
        consigne={changement.nouveau ? 'Retapez le nouveau code' : 'Nouveau code à 6 chiffres'}
        longueur={LONGUEUR_NOUVEAU_CODE}
        pin={pin} pinError={pinError} messageErreur={erreurCode} verification={verifEnCours}
        secondesRestantes={libelleAttente(secondesRestantes)} bloque={false}
        couleur={couleurRole(selected?.role)}
        appuyerChiffre={appuyerChiffre} supprimer={supprimer}
        toucheFaceID={false}
        lienBas={changement.oblige
          ? { texte: 'Ce n’est pas moi', onPress: () => { setChangement(null); setEtape(3); setPin(''); setPinError(false) } }
          : { texte: 'Annuler', onPress: () => { setChangement(null); setVeutChanger(false); apresCodeJuste(selected) } }}
      />
    )
  }

  const ici = enrolementsDe(selected, selectedResto)
  return (
    <ClavierCode
      t={t}
      entete={{
        initialesTexte: initiales(selected?.nom),
        couleur: couleurRole(selected?.role),
        titre: selected?.nom,
        sousTitre: ROLES_GLOBAUX.includes(selected?.role)
          ? `${libelleRole(selected?.role)} · tous les restaurants`
          : `${selectedResto?.nom} · ${libelleRole(selected?.role)}`,
      }}
      consigne={veutChanger ? 'Entrez votre code actuel' : 'Votre code personnel'}
      longueur={longueurAttendue}
      pin={pin} pinError={pinError} messageErreur={erreurCode} verification={verifEnCours}
      secondesRestantes={libelleAttente(secondesRestantes)}
      bloque={!!(bloqueJusquaUser && Date.now() < bloqueJusquaUser)}
      couleur={couleurRole(selected?.role)}
      appuyerChiffre={appuyerChiffre} supprimer={supprimer}
      toucheFaceID={bioSupportee && ici.length > 0}
      onFaceID={() => entrerAvecBiometrie(ici[0])}
      bioEnCours={bioEnCours} bioMessage={bioMessage}
      liensBas={[
        { texte: 'Ce n’est pas moi', onPress: () => { setEtape(3); setPin(''); setPinError(false); setBioMessage(''); setVeutChanger(false) } },
        ...(veutChanger ? [] : [{ texte: 'Changer mon code', onPress: () => { setVeutChanger(true); setPin(''); setPinError(false); setErreurCode(null) } }]),
      ]}
    />
  )
}

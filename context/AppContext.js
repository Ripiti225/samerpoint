import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'

const AppContext = createContext()

// ─── Persistance session web (résout écran blanc après sélecteur photo) ───
const SESSION_KEY = 'samerpoint_session'

function lireSession() {
  if (Platform.OS !== 'web') return null
  try {
    const s = localStorage.getItem(SESSION_KEY)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

function sauvegarderSession(data) {
  if (Platform.OS !== 'web') return
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data))
  } catch {}
}

function effacerSession() {
  if (Platform.OS !== 'web') return
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {}
}

export function AppProvider({ children }) {
  const session = lireSession()

  // ─── Identité & session ────────────────────────────────────
  const [pointId, setPointId] = useState(session?.pointId || null)
  const [dateJour, setDateJour] = useState(session?.dateJour || null)
  const [pointValide, setPointValide] = useState(session?.pointValide || false)
  const [inventaireTermine, setInventaireTermine] = useState(false)
  const [roleActif, setRoleActif] = useState(session?.roleActif || null)
  const [restaurantId, setRestaurantId] = useState(session?.restaurantId || null)
  const [restaurantNom, setRestaurantNom] = useState(session?.restaurantNom || null)
  const [userId, setUserId] = useState(session?.userId || null)
  const [userNom, setUserNom] = useState(session?.userNom || null)
  const [lastRoute, setLastRoute] = useState(session?.lastRoute || null)

  // ─── Données du jour (restaurées après rechargement iOS) ───
  const [paiesJour, setPaiesJour] = useState(session?.paiesJour || {})
  const [presencesJour, setPresencesJour] = useState(session?.presencesJour || {})
  const [depensesJour, setDepensesJour] = useState(session?.depensesJour || {
    'Marché': [],
    'Légumes': [],
    'Fruits': [],
    'Dépenses annexes': [],
  })
  const [fournisseursJour, setFournisseursJour] = useState(session?.fournisseursJour || {})
  const [livraisonsJour, setLivraisonsJour] = useState(session?.livraisonsJour || {
    Yango: [], Glovo: [], OM: [], Wave: [], Djamo: [], Client: []
  })
  const [inventaireJour, setInventaireJour] = useState(session?.inventaireJour || {})
  const [shiftsJour, setShiftsJour] = useState([])
  const [stocksParShift, setStocksParShift] = useState({})
  const [ventesJour, setVentesJour] = useState(session?.ventesJour || {
    sequences: [],
    yangoCse: '', yangoTab: '', yangoNbCommandes: '',
    glovoCse: '', glovoTab: '', glovoNbCommandes: '',
    wave: '', om: '', djamo: '',
    kdo: '', retour: '',
    fcVeille: '', fc_actuel: '',
    espece_shifts: 0,
    venteMachine: '',
    photoVenteMachine: null,
    photo_yango_cse: null,
    photo_glovo_cse: null,
    photo_wave: null,
    photo_om: null,
    photo_djamo: null,
    photo_yango_tab: null,
    photo_glovo_tab: null,
    photo_kdo: null,
    photo_retour: null,
  })
  const [depensesGerantCaisse, setDepensesGerantCaisse] = useState(session?.depensesGerantCaisse || [])

  // ─── Ref toujours à jour — utilisée dans pagehide (pas de closure stale) ───
  const sessionRef = useRef({})
  sessionRef.current = {
    roleActif, restaurantId, restaurantNom, userId, userNom,
    pointId, dateJour, pointValide, lastRoute,
    fournisseursJour, depensesJour, presencesJour,
    livraisonsJour, ventesJour, paiesJour, inventaireJour,
    depensesGerantCaisse,
  }

  // ─── Sauvegarder toutes les données à chaque changement ───
  useEffect(() => {
    if (roleActif) {
      sauvegarderSession({
        roleActif, restaurantId, restaurantNom, userId, userNom,
        pointId, dateJour, pointValide, lastRoute,
        fournisseursJour, depensesJour, presencesJour,
        livraisonsJour, ventesJour, paiesJour, inventaireJour,
        depensesGerantCaisse,
      })
    }
  }, [
    roleActif, restaurantId, restaurantNom, userId, userNom,
    pointId, dateJour, pointValide, lastRoute,
    fournisseursJour, depensesJour, presencesJour,
    livraisonsJour, ventesJour, paiesJour, inventaireJour,
    depensesGerantCaisse,
  ])

  // ─── Sur iPhone : iOS décharge la page avant d'ouvrir le sélecteur photo ───
  useEffect(() => {
    if (Platform.OS !== 'web') return
    function onPageHide(event) {
      // Si event.persisted = true, la page va en bfcache (sélecteur photo iOS)
      // → ne PAS écrire dans le storage, sinon on empêche le bfcache et iOS recharge la page
      if (event.persisted) return
      if (sessionRef.current.roleActif) sauvegarderSession(sessionRef.current)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

  const isManager = roleActif === 'manager'

  function estBloque(flag) {
    if (isManager) return false
    return flag
  }

  // ─── Totaux ────────────────────────────────────────────────

  function totalPaie() {
    return Object.values(paiesJour).reduce((sum, v) => sum + (parseFloat(v) || 0), 0)
  }

  function totalFournisseurs() {
    return Object.values(fournisseursJour).reduce((sum, t) => sum + (parseFloat(t?.paye) || 0), 0)
  }

  function totalDepensesCat() {
    return Object.values(depensesJour).reduce((sum, lignes) => {
      return sum + (lignes || []).reduce((s, l) => s + (parseFloat(l.montant) || 0), 0)
    }, 0)
  }

  function totalDepenses() {
    return totalDepensesCat() + totalPaie() + totalFournisseurs()
  }

  function totalVentes() {
    return (ventesJour.sequences || []).reduce((sum, s) => sum + (parseFloat(s.montant) || 0), 0)
  }

  function totalDepensesGerantCaisse() {
    return depensesGerantCaisse.reduce((sum, d) => sum + (parseFloat(d.montant) || 0), 0)
  }

  function resteEspeces() {
    const deduc = totalDepensesGerantCaisse()
    if (ventesJour.espece_shifts !== 0 && ventesJour.espece_shifts !== '') {
      return (parseFloat(ventesJour.espece_shifts) || 0) - deduc
    }
    return totalVentes() - totalDepenses()
      - (parseFloat(ventesJour.yangoCse) || 0)
      - (parseFloat(ventesJour.glovoCse) || 0)
      - (parseFloat(ventesJour.wave) || 0)
      - (parseFloat(ventesJour.om) || 0)
      - (parseFloat(ventesJour.djamo) || 0)
      - (parseFloat(ventesJour.kdo) || 0)
      - (parseFloat(ventesJour.retour) || 0)
      - deduc
  }

  function fc() {
    return resteEspeces() + (parseFloat(ventesJour.fcVeille) || 0)
  }

  function beneficeSC() {
    return ((parseFloat(ventesJour.yangoTab) || 0) * 0.77)
      + ((parseFloat(ventesJour.glovoTab) || 0) * 0.705)
      + ((parseFloat(ventesJour.om) || 0) * 0.99)
      + ((parseFloat(ventesJour.wave) || 0) * 0.99)
      + ((parseFloat(ventesJour.djamo) || 0) * 0.99)
      + resteEspeces()
  }

  // ─── Reset données du jour ─────────────────────────────────
  function resetJour() {
    setPointId(null)
    setDateJour(null)
    setPointValide(false)
    setInventaireTermine(false)
    setPaiesJour({})
    setPresencesJour({})
    setDepensesJour({ 'Marché': [], 'Légumes': [], 'Fruits': [], 'Dépenses annexes': [] })
    setFournisseursJour({})
    setLivraisonsJour({ Yango: [], Glovo: [], OM: [], Wave: [], Djamo: [], Client: [] })
    setInventaireJour({})
    setShiftsJour([])
    setStocksParShift({})
    setLastRoute(null)
    setDepensesGerantCaisse([])
    setVentesJour({
      sequences: [],
      yangoCse: '', yangoTab: '', yangoNbCommandes: '',
      glovoCse: '', glovoTab: '', glovoNbCommandes: '',
      wave: '', om: '', djamo: '',
      kdo: '', retour: '',
      fcVeille: '', fc_actuel: '',
      espece_shifts: 0,
      venteMachine: '',
      photoVenteMachine: null,
      photo_yango_cse: null,
      photo_glovo_cse: null,
      photo_wave: null,
      photo_om: null,
      photo_djamo: null,
      photo_yango_tab: null,
      photo_glovo_tab: null,
      photo_kdo: null,
      photo_retour: null,
    })
  }

  // ─── Déconnexion complète ──────────────────────────────────
  function deconnecter() {
    effacerSession()
    setRoleActif(null)
    setRestaurantId(null)
    setRestaurantNom(null)
    setUserId(null)
    setUserNom(null)
    resetJour()
  }

  // ─── Reset shift ───────────────────────────────────────────
  function resetShift() {
    setPaiesJour({})
    setPresencesJour({})
    setDepensesJour({
      'Marché': [],
      'Légumes': [],
      'Fruits': [],
      'Dépenses annexes': [],
    })
    setFournisseursJour({})
  }

  return (
    <AppContext.Provider value={{
      pointId, setPointId,
      dateJour, setDateJour,
      pointValide, setPointValide,
      inventaireTermine, setInventaireTermine,
      roleActif, setRoleActif,
      restaurantId, setRestaurantId,
      restaurantNom, setRestaurantNom,
      userId, setUserId,
      userNom, setUserNom,
      lastRoute, setLastRoute,
      isManager,
      estBloque,
      paiesJour, setPaiesJour,
      presencesJour, setPresencesJour,
      depensesJour, setDepensesJour,
      fournisseursJour, setFournisseursJour,
      livraisonsJour, setLivraisonsJour,
      inventaireJour, setInventaireJour,
      shiftsJour, setShiftsJour,
      stocksParShift, setStocksParShift,
      ventesJour, setVentesJour,
      depensesGerantCaisse, setDepensesGerantCaisse,
      totalPaie,
      totalFournisseurs,
      totalDepenses,
      totalVentes,
      totalDepensesGerantCaisse,
      resteEspeces,
      fc,
      beneficeSC,
      resetJour,
      deconnecter,
      resetShift,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}

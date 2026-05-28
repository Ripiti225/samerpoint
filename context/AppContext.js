import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { COEFFICIENTS, depensesVides } from '../lib/constants'

const AppContext = createContext()

const SESSION_KEY = 'samerpoint_session'
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000

let _sessionLoggedInAt = null

function lireSession() {
  if (Platform.OS !== 'web') return null
  try {
    const s = localStorage.getItem(SESSION_KEY)
    if (!s) return null
    const parsed = JSON.parse(s)
    if (parsed.logged_in_at && (Date.now() - parsed.logged_in_at) > SESSION_MAX_AGE) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    _sessionLoggedInAt = parsed.logged_in_at || null
    return parsed
  } catch { return null }
}

function sauvegarderSession(data) {
  if (Platform.OS !== 'web') return
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      ...data,
      logged_in_at: _sessionLoggedInAt || Date.now(),
    }))
  } catch {}
}

// Sauvegarde uniquement les données opérationnelles (sans identité).
// Appelé au logout pour que les données du shift survivent à la déconnexion.
function sauvegarderDonneesOperationnelles(data) {
  if (Platform.OS !== 'web') return
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      pointId:                  data.pointId,
      dateJour:                 data.dateJour,
      pointValide:              data.pointValide,
      inventaireTermine:        data.inventaireTermine,
      lastRoute:                data.lastRoute,
      livraisonsJour:           data.livraisonsJour,
      depensesJour:             data.depensesJour,
      fournisseursJour:         data.fournisseursJour,
      presencesJour:            data.presencesJour,
      paiesJour:                data.paiesJour,
      inventaireJour:           data.inventaireJour,
      ventesJour:               data.ventesJour,
      depensesGerantCaisse:     data.depensesGerantCaisse,
      fournisseursGerantCaisse: data.fournisseursGerantCaisse,
      paiesGerantCaisse:        data.paiesGerantCaisse,
      logged_in_at: _sessionLoggedInAt || Date.now(),
    }))
  } catch {}
}


export function AppProvider({ children }) {
  const session = lireSession()

  const [pointId, setPointId] = useState(session?.pointId || null)
  const [dateJour, setDateJour] = useState(session?.dateJour || null)
  const [pointValide, setPointValide] = useState(session?.pointValide || false)
  const [inventaireTermine, setInventaireTermine] = useState(session?.inventaireTermine || false)
  const [roleActif, setRoleActif] = useState(session?.roleActif || null)
  const [restaurantId, setRestaurantId] = useState(session?.restaurantId || null)
  const [restaurantNom, setRestaurantNom] = useState(session?.restaurantNom || null)
  const [userId, setUserId] = useState(session?.userId || null)
  const [userNom, setUserNom] = useState(session?.userNom || null)
  const [lastRoute, setLastRoute] = useState(session?.lastRoute || null)

  const [paiesJour, setPaiesJour] = useState(session?.paiesJour || {})
  const [presencesJour, setPresencesJour] = useState(session?.presencesJour || {})
  const [depensesJour, setDepensesJour] = useState(session?.depensesJour || depensesVides())
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
    fcVeille: '', fc_recu: '',
    espece_shifts: 0,
    venteMachine: '',
    explicacionEcartMachine: '',
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
  const [depensesGerantCaisse, setDepensesGerantCaisse] = useState(session?.depensesGerantCaisse || depensesVides())
  const [fournisseursGerantCaisse, setFournisseursGerantCaisse] = useState(session?.fournisseursGerantCaisse || {})
  const [paiesGerantCaisse, setPaiesGerantCaisse] = useState(session?.paiesGerantCaisse || [])

  const sessionRef = useRef({})
  sessionRef.current = {
    roleActif, restaurantId, restaurantNom, userId, userNom,
    pointId, dateJour, pointValide, inventaireTermine, lastRoute,
    fournisseursJour, depensesJour, presencesJour,
    livraisonsJour, ventesJour, paiesJour, inventaireJour,
    depensesGerantCaisse, fournisseursGerantCaisse, paiesGerantCaisse,
  }

  useEffect(() => {
    if (roleActif) {
      sauvegarderSession({
        roleActif, restaurantId, restaurantNom, userId, userNom,
        pointId, dateJour, pointValide, inventaireTermine, lastRoute,
        fournisseursJour, depensesJour, presencesJour,
        livraisonsJour, ventesJour, paiesJour, inventaireJour,
        depensesGerantCaisse, fournisseursGerantCaisse, paiesGerantCaisse,
      })
    }
  }, [
    roleActif, restaurantId, restaurantNom, userId, userNom,
    pointId, dateJour, pointValide, inventaireTermine, lastRoute,
    fournisseursJour, depensesJour, presencesJour,
    livraisonsJour, ventesJour, paiesJour, inventaireJour,
    depensesGerantCaisse, fournisseursGerantCaisse, paiesGerantCaisse,
  ])

  useEffect(() => {
    if (Platform.OS !== 'web') return
    function onPageHide(event) {
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

  function totalPaie() {
    return Math.round(Object.values(paiesJour).reduce((sum, v) => sum + (parseFloat(v) || 0), 0))
  }

  function totalFournisseurs() {
    return Math.round(Object.values(fournisseursJour).reduce((sum, t) => sum + (parseFloat(t?.paye) || 0), 0))
  }

  function totalDepensesCat() {
    return Math.round(Object.values(depensesJour).reduce((sum, lignes) => {
      return sum + (lignes || []).reduce((s, l) => s + (parseFloat(l.montant) || 0), 0)
    }, 0))
  }

  function totalDepenses() {
    return Math.round(totalDepensesCat() + totalPaie() + totalFournisseurs())
  }

  function totalVentes() {
    return Math.round((ventesJour.sequences || []).reduce((sum, s) => sum + (parseFloat(s.montant) || 0), 0))
  }

  function totalDepensesGerantCaisse() {
    const cats = Object.values(depensesGerantCaisse).reduce((sum, lignes) => {
      return sum + (lignes || []).reduce((s, l) => s + (parseFloat(l.montant) || 0), 0)
    }, 0)
    const fours = Object.values(fournisseursGerantCaisse).reduce((sum, f) => sum + (parseFloat(f?.paye) || 0), 0)
    const paies = paiesGerantCaisse.reduce((sum, p) => sum + (parseFloat(p.montant) || 0), 0)
    return Math.round(cats + fours + paies)
  }

  function resteEspeces() {
    const deduc = totalDepensesGerantCaisse()
    if (ventesJour.espece_shifts !== 0 && ventesJour.espece_shifts !== '') {
      return Math.round((parseFloat(ventesJour.espece_shifts) || 0) - deduc)
    }
    return Math.round(totalVentes() - totalDepenses()
      - (parseFloat(ventesJour.yangoCse) || 0)
      - (parseFloat(ventesJour.glovoCse) || 0)
      - (parseFloat(ventesJour.wave) || 0)
      - (parseFloat(ventesJour.om) || 0)
      - (parseFloat(ventesJour.djamo) || 0)
      - (parseFloat(ventesJour.kdo) || 0)
      - (parseFloat(ventesJour.retour) || 0)
      - deduc)
  }

  function fc() {
    return Math.round(resteEspeces() + (parseFloat(ventesJour.fcVeille) || 0) + (parseFloat(ventesJour.fc_recu) || 0))
  }

  function beneficeSC() {
    return Math.round(
      ((parseFloat(ventesJour.yangoTab) || 0) * COEFFICIENTS.YANGO)
      + ((parseFloat(ventesJour.glovoTab) || 0) * COEFFICIENTS.GLOVO)
      + ((parseFloat(ventesJour.om) || 0) * COEFFICIENTS.OM)
      + ((parseFloat(ventesJour.wave) || 0) * COEFFICIENTS.WAVE)
      + ((parseFloat(ventesJour.djamo) || 0) * COEFFICIENTS.DJAMO)
      + resteEspeces()
    )
  }

  // ─── Reset données du jour — appelé UNIQUEMENT après validation du shift ───
  function resetJour() {
    _sessionLoggedInAt = Date.now()
    setPointId(null)
    setDateJour(null)
    setPointValide(false)
    setInventaireTermine(false)
    setPaiesJour({})
    setPresencesJour({})
    setDepensesJour(depensesVides())
    setFournisseursJour({})
    setLivraisonsJour({ Yango: [], Glovo: [], OM: [], Wave: [], Djamo: [], Client: [] })
    setInventaireJour({})
    setShiftsJour([])
    setStocksParShift({})
    setLastRoute(null)
    setDepensesGerantCaisse(depensesVides())
    setFournisseursGerantCaisse({})
    setPaiesGerantCaisse([])
    setVentesJour({
      sequences: [],
      yangoCse: '', yangoTab: '', yangoNbCommandes: '',
      glovoCse: '', glovoTab: '', glovoNbCommandes: '',
      wave: '', om: '', djamo: '',
      kdo: '', retour: '',
      fcVeille: '', fc_recu: '',
      espece_shifts: 0,
      venteMachine: '',
      explicacionEcartMachine: '',
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

  // ─── Déconnexion — conserve les données opérationnelles, efface l'identité ──
  // Les données du jour (livraisonsJour, dépenses, etc.) survivent au logout
  // et sont restaurées au re-login, jusqu'à la validation du shift (resetJour).
  function deconnecter() {
    sauvegarderDonneesOperationnelles(sessionRef.current)
    setRoleActif(null)
    setRestaurantId(null)
    setRestaurantNom(null)
    setUserId(null)
    setUserNom(null)
  }

  // ─── Flag éphémère : indique que resetShift vient d'être appelé ──────────
  // Permet à fournisseurs.js de NE PAS restaurer depuis la DB après reset shift
  const [postShiftReset, setPostShiftReset] = useState(false)

  // ─── Reset shift — appelé après validation du shift caissier ─────────────
  function resetShift() {
    setPostShiftReset(true)
    setPaiesJour({})
    setPresencesJour({})
    setDepensesJour(depensesVides())
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
      fournisseursGerantCaisse, setFournisseursGerantCaisse,
      paiesGerantCaisse, setPaiesGerantCaisse,
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
      postShiftReset, setPostShiftReset,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}

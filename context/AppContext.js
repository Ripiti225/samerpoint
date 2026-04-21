import { createContext, useContext, useState } from 'react'

const AppContext = createContext()

export function AppProvider({ children }) {
  const [pointId, setPointId] = useState(null)
  const [dateJour, setDateJour] = useState(null)
  const [pointValide, setPointValide] = useState(false)
  const [inventaireTermine, setInventaireTermine] = useState(false)
  const [roleActif, setRoleActif] = useState(null)
  const [restaurantId, setRestaurantId] = useState(null)
  const [restaurantNom, setRestaurantNom] = useState(null)
  const [userId, setUserId] = useState(null)
  const [userNom, setUserNom] = useState(null)
  const [paiesJour, setPaiesJour] = useState({})
  const [presencesJour, setPresencesJour] = useState({})
  const [depensesJour, setDepensesJour] = useState({
    'Marché': [],
    'Légumes': [],
    'Fruits': [],
    'Dépenses annexes': [],
  })
  const [fournisseursJour, setFournisseursJour] = useState({})
  const [livraisonsJour, setLivraisonsJour] = useState({
    Yango: [], Glovo: [], OM: [], Wave: [], Djamo: [], Client: []
  })
  const [inventaireJour, setInventaireJour] = useState({})
  const [shiftsJour, setShiftsJour] = useState([])
  const [stocksParShift, setStocksParShift] = useState({})
  const [ventesJour, setVentesJour] = useState({
    sequences: [],
    yangoCse: '', yangoTab: '', yangoNbCommandes: '',
    glovoCse: '', glovoTab: '', glovoNbCommandes: '',
    wave: '', om: '', djamo: '',
    kdo: '', retour: '',
    fcVeille: '', fc_actuel: '',
    espece_shifts: 0,
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
    // Dépenses + Salaires (paies) + Fournisseurs
    return totalDepensesCat() + totalPaie() + totalFournisseurs()
  }

  function totalVentes() {
    return (ventesJour.sequences || []).reduce((sum, s) => sum + (parseFloat(s.montant) || 0), 0)
  }

  function resteEspeces() {
    // Gérant/manager : espèces viennent directement du cumul shifts
    if (ventesJour.espece_shifts !== 0 && ventesJour.espece_shifts !== '') {
      return parseFloat(ventesJour.espece_shifts) || 0
    }
    // Caissier : calcul classique depuis séquences
    return totalVentes() - totalDepenses()
      - (parseFloat(ventesJour.yangoCse) || 0)
      - (parseFloat(ventesJour.glovoCse) || 0)
      - (parseFloat(ventesJour.wave) || 0)
      - (parseFloat(ventesJour.om) || 0)
      - (parseFloat(ventesJour.djamo) || 0)
      - (parseFloat(ventesJour.kdo) || 0)
      - (parseFloat(ventesJour.retour) || 0)
  }

  function fc() {
    // FC calculé = espèces en caisse + FC de la veille (auto-chargé)
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

  // ─── Reset complet — déconnexion ───────────────────────────
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
    setVentesJour({
      sequences: [],
      yangoCse: '', yangoTab: '', yangoNbCommandes: '',
      glovoCse: '', glovoTab: '', glovoNbCommandes: '',
      wave: '', om: '', djamo: '',
      kdo: '', retour: '',
      fcVeille: '', fc_actuel: '',
      espece_shifts: 0,
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

  // ─── Reset shift — après validation shift caissier ─────────
  // Remet à 0 uniquement les données locales du caissier
  // Le pointId reste le même — c'est le même jour
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
      totalPaie,
      totalFournisseurs,
      totalDepenses,
      totalVentes,
      resteEspeces,
      fc,
      beneficeSC,
      resetJour,
      resetShift,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}
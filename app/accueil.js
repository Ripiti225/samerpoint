import { router, useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useApp } from '../context/AppContext'

export default function AccueilScreen() {
  const { nom, role } = useLocalSearchParams()
  const { pointValide, inventaireTermine, estBloque, roleActif } = useApp()

  const roleEffectif = role || roleActif

  // Sur web, si le contexte est vide après un refresh → redirect login
  useEffect(() => {
    if (!roleEffectif) {
      const t = setTimeout(() => router.replace('/login'), 800)
      return () => clearTimeout(t)
    }
  }, [roleEffectif])

  const isManager = roleEffectif === 'manager'
  const isGerant = roleEffectif === 'gerant'
  const isCaissier = roleEffectif === 'caissier'
  const isRH = roleEffectif === 'rh'

  const menuManager = [
    { icon: '🏪', titre: 'Tous les restaurants', sous: 'Vue globale', route: '/restaurants', bloque: false },
    { icon: '📊', titre: 'Dashboard global', sous: 'Classement & stats', route: '/dashboard-global', bloque: false },
    { icon: '✏️', titre: 'Modifier un point', sous: 'Choisir restaurant + date', route: '/modifier-point', bloque: false },
    { icon: '📦', titre: 'Modifier inventaire', sous: 'Choisir restaurant + date', route: '/modifier-inventaire', bloque: false },
    { icon: '👥', titre: 'Équipe globale', sous: 'Tous les travailleurs', route: '/equipe', bloque: false },
    { icon: '🧑‍💼', titre: 'Ressources Humaines', sous: 'Présences & salaires', route: '/rh', bloque: false },
    { icon: '💳', titre: 'Charges du mois', sous: 'Saisir & voir bénéfice réel', route: '/charges', bloque: false },
    { icon: '📁', titre: 'Documents', sous: 'Documents administratifs', route: '/documents', bloque: false },
    { icon: '🔍', titre: 'Vérification', sous: 'Photos & points à vérifier', route: '/verification', bloque: false },
    { icon: '📲', titre: 'Contacts', sous: 'SMS & WhatsApp groupés', route: '/contacts', bloque: false },
    { icon: '⚙️', titre: 'Paramètres', sous: 'Configuration', route: '/parametres', bloque: false },
  ]

  const menuRH = [
    { icon: '🧑‍💼', titre: 'Ressources Humaines', sous: 'Présences & salaires', route: '/rh', bloque: false },
    { icon: '💳', titre: 'Charges du mois', sous: 'Saisir les charges', route: '/charges', bloque: false },
    { icon: '📁', titre: 'Documents', sous: 'Ajouter des documents', route: '/documents', bloque: false },
  ]

  const menuGerantFinance = [
    { icon: '💰', titre: 'Saisir les ventes', sous: 'Séquences + photos', route: '/ventes', bloque: estBloque(pointValide) },
    { icon: '📊', titre: 'Tableau de bord', sous: 'Résultats du jour', route: '/dashboard', bloque: false },
    { icon: '🧾', titre: 'Fournisseurs', sous: 'Factures & paiements', route: '/fournisseurs', bloque: estBloque(pointValide) },
    { icon: '📋', titre: 'Dépenses', sous: 'Marché, paie…', route: '/depenses', bloque: estBloque(pointValide) },
  ]

  const menuGerantOperations = [
    { icon: '⏱️', titre: 'Point / Shift', sous: 'Voir les shifts du jour', route: '/point-shift', bloque: false },
    { icon: '📦', titre: 'Inventaire', sous: 'Entrées & sorties', route: '/inventaire', bloque: estBloque(inventaireTermine) },
    { icon: '👥', titre: 'Présences', sous: 'Statuts équipe', route: '/presences', bloque: estBloque(pointValide) },
    { icon: '🛵', titre: 'Livraisons', sous: 'Yango, Glovo…', route: '/livraisons', bloque: false },
    { icon: '📁', titre: 'Documents', sous: 'Documents du restaurant', route: '/documents', bloque: false },
  ]

  const menuCaissier = [
    { icon: '⏱️', titre: 'Point / Shift', sous: 'Faire mon point de shift', route: '/point-shift', bloque: false },
    { icon: '📋', titre: 'Dépenses', sous: 'Marché, paie…', route: '/depenses', bloque: estBloque(pointValide) },
    { icon: '🧾', titre: 'Fournisseurs', sous: 'Factures & paiements', route: '/fournisseurs', bloque: estBloque(pointValide) },
    { icon: '📦', titre: 'Inventaire', sous: 'Entrées & sorties', route: '/inventaire', bloque: estBloque(inventaireTermine) },
    { icon: '👥', titre: 'Présences', sous: 'Statuts équipe', route: '/presences', bloque: estBloque(pointValide) },
    { icon: '🛵', titre: 'Livraisons', sous: 'Yango, Glovo…', route: '/livraisons', bloque: false },
  ]

  function renderMenu(items, titre) {
    return (
      <View style={styles.section}>
        {titre && <Text style={styles.sectionTitre}>{titre}</Text>}
        <View style={styles.grid}>
          {items.map((item, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.card, item.bloque && styles.cardBloque]}
              onPress={() => !item.bloque && router.push(item.route)}
              disabled={item.bloque}
            >
              <Text style={styles.cardIcon}>{item.icon}</Text>
              <Text style={[styles.cardTitre, item.bloque && styles.cardTitreBloque]}>
                {item.titre}
              </Text>
              <Text style={[styles.cardSous, item.bloque && styles.cardSousBloque]}>
                {item.bloque ? '🔒 Verrouillé' : item.sous}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    )
  }

  function getHeaderColor() {
    if (isManager) return '#534AB7'
    if (isRH) return '#185FA5'
    return '#EF9F27'
  }

  function getRoleLabel() {
    if (isManager) return '👑 Manager'
    if (isRH) return '🧑‍💼 RH'
    if (isGerant) return '🔑 Gérant'
    return '💼 Caissier'
  }

  function getRoleBadgeBg() {
    if (isManager) return '#3C3489'
    if (isRH) return '#0F4880'
    return '#BA7517'
  }

  function getRoleBadgeText() {
    if (isManager) return '#CECBF6'
    if (isRH) return '#B8D4F5'
    return '#FAEEDA'
  }

  function getHeaderTextColor() {
    if (isManager || isRH) return '#fff'
    return '#412402'
  }

  function getSubtitle() {
    if (isManager) return 'Accès total — tous les restaurants'
    if (isRH) return 'Ressources Humaines'
    if (isGerant) return 'Vue gérant'
    return 'Mon point du jour'
  }

  if (!roleEffectif) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ fontSize: 16, color: '#888', marginBottom: 20 }}>Chargement...</Text>
        <TouchableOpacity style={styles.logoutBtn} onPress={() => router.replace('/login')}>
          <Text style={styles.logoutText}>⏻ Retour à la connexion</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={[styles.header, { backgroundColor: getHeaderColor() }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerSub, { color: getRoleBadgeText() }]}>
            {getSubtitle()}
          </Text>
          <Text style={[styles.headerTitre, { color: getHeaderTextColor() }]}>
            Bonjour, {nom?.split(' ')[0] || 'Utilisateur'} 👋
          </Text>
          <Text style={[styles.headerDate, { color: getRoleBadgeText() }]}>
            {new Date().toLocaleDateString('fr-FR', {
              weekday: 'long', day: 'numeric', month: 'long'
            })}
          </Text>
        </View>
        <View style={[styles.roleBadge, { backgroundColor: getRoleBadgeBg() }]}>
          <Text style={[styles.roleText, { color: getRoleBadgeText() }]}>
            {getRoleLabel()}
          </Text>
        </View>
      </View>

      {/* Bannières */}
      {pointValide && !isManager && !isRH && (
        <View style={styles.valideBanner}>
          <Text style={styles.valideTxt}>✅ Point du jour validé — lecture seule</Text>
        </View>
      )}

      {isManager && (
        <View style={styles.managerBanner}>
          <Text style={styles.managerTxt}>👑 Accès total — toutes modifications autorisées</Text>
        </View>
      )}

      {isRH && (
        <View style={[styles.managerBanner, { backgroundColor: '#E6F1FB', borderBottomColor: '#B8D4F5' }]}>
          <Text style={[styles.managerTxt, { color: '#185FA5' }]}>
            🧑‍💼 Accès RH — Présences, salaires, charges & documents
          </Text>
        </View>
      )}

      {isCaissier && (
        <View style={[styles.managerBanner, { backgroundColor: '#FAEEDA', borderBottomColor: '#EF9F27' }]}>
          <Text style={[styles.managerTxt, { color: '#854F0B' }]}>
            💼 Données sauvegardées automatiquement
          </Text>
        </View>
      )}

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>

        {/* ── Manager ── */}
        {isManager && renderMenu(menuManager, null)}

        {/* ── RH ── */}
        {isRH && renderMenu(menuRH, null)}

        {/* ── Gérant ── */}
        {isGerant && renderMenu(menuGerantFinance, 'Ventes & finance')}
        {isGerant && renderMenu(menuGerantOperations, 'Opérations & administratif')}

        {/* ── Caissier ── */}
        {isCaissier && renderMenu(menuCaissier, 'Mon point du jour')}

        {/* Déconnexion */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => router.replace('/login')}
        >
          <Text style={styles.logoutText}>⏻ Se déconnecter</Text>
        </TouchableOpacity>

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    padding: 20, paddingBottom: 24,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'
  },
  headerSub: { fontSize: 12, marginBottom: 4 },
  headerTitre: { fontSize: 22, fontWeight: '700' },
  headerDate: { fontSize: 12, marginTop: 4 },
  roleBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginTop: 4 },
  roleText: { fontSize: 12, fontWeight: '600' },
  valideBanner: {
    backgroundColor: '#EAF3DE', padding: 10, alignItems: 'center',
    borderBottomWidth: 0.5, borderBottomColor: '#C0DD97'
  },
  valideTxt: { fontSize: 12, color: '#3B6D11', fontWeight: '500' },
  managerBanner: {
    backgroundColor: '#EEEDFE', padding: 10, alignItems: 'center',
    borderBottomWidth: 0.5, borderBottomColor: '#CECBF6'
  },
  managerTxt: { fontSize: 12, color: '#3C3489', fontWeight: '500' },
  body: { flex: 1, padding: 16 },
  section: { marginBottom: 16 },
  sectionTitre: {
    fontSize: 11, fontWeight: '600', color: '#888',
    letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase'
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    width: '47%', backgroundColor: '#fff', borderRadius: 14,
    padding: 14, borderWidth: 0.5, borderColor: '#eee'
  },
  cardBloque: { backgroundColor: '#f9f9f9', borderColor: '#e0e0e0', opacity: 0.6 },
  cardIcon: { fontSize: 26, marginBottom: 8 },
  cardTitre: { fontSize: 13, fontWeight: '600', color: '#1a1a1a' },
  cardTitreBloque: { color: '#aaa' },
  cardSous: { fontSize: 11, color: '#888', marginTop: 3 },
  cardSousBloque: { color: '#ccc' },
  logoutBtn: {
    marginTop: 6, marginBottom: 10, padding: 14,
    backgroundColor: '#fff', borderRadius: 12, alignItems: 'center',
    borderWidth: 0.5, borderColor: '#eee'
  },
  logoutText: { fontSize: 14, color: '#888' },
})
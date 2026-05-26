import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, Modal, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { useApp } from '../context/AppContext'
import { useNotifications } from '../context/NotificationsContext'
import { useTheme } from '../context/ThemeContext'
import { enregistrerTokenDirecteur } from '../lib/notifications'
import SignatureFooter from '../components/SignatureFooter'
import { supabase } from '../lib/supabase'

export default function AccueilScreen() {
  const { nom, role } = useLocalSearchParams()
  const {
    pointValide, estBloque, roleActif, deconnecter,
    userId, restaurantId,
  } = useApp()
  const [nbCorrections, setNbCorrections] = useState(0)

  const { colors, isDark, toggleTheme } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const {
    notifications, nonLues, panelVisible,
    ouvrirPanel, fermerPanel,
    supprimerUne, supprimerTout, naviguerDepuisNotif,
  } = useNotifications()

  const roleEffectif = role || roleActif

  // Sur web, si le contexte est vide après un refresh → redirect login
  useEffect(() => {
    if (!roleEffectif) {
      const t = setTimeout(() => router.replace('/login'), 800)
      return () => clearTimeout(t)
    }
  }, [roleEffectif])

  // Directeur : enregistrer le token push dès la connexion (silencieux si déjà accordé)
  useEffect(() => {
    if (roleEffectif === 'directeur' && userId) {
      enregistrerTokenDirecteur(userId)
    }
  }, [roleEffectif, userId])

  // Gérant : charger les corrections en attente
  useEffect(() => {
    if (roleEffectif === 'gerant' && restaurantId) {
      supabase
        .from('deverouillages_points')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('statut', 'ouvert')
        .then(({ count }) => setNbCorrections(count || 0))
    }
  }, [roleEffectif, restaurantId])

  const isManager = roleEffectif === 'manager'
  const isDirecteur = roleEffectif === 'directeur'
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
    { icon: '💳', titre: 'Crédits fournisseurs', sous: 'Crédit, avances & paiements', route: '/credits-fournisseurs', bloque: false },
    { icon: '⚖️', titre: 'Litiges', sous: 'Écarts, avis & réclamations', route: '/litiges', bloque: false },
    { icon: '🔍', titre: 'Vérification', sous: 'Photos & points à vérifier', route: '/verification', bloque: false },
    { icon: '📊', titre: 'Rapports hebdo', sous: 'Synthèse automatique semaine', route: '/rapports', bloque: false },
    { icon: '👤', titre: 'Stats caissiers', sous: 'Performance par caissier', route: '/stats-caissiers', bloque: false },
    { icon: '📋', titre: 'Journal activité', sous: 'Historique des actions', route: '/journal', bloque: false },
    { icon: '📲', titre: 'Contacts', sous: 'SMS & WhatsApp groupés', route: '/contacts', bloque: false },
    { icon: '⚙️', titre: 'Paramètres', sous: 'Configuration', route: '/parametres', bloque: false },
  ]

  const menuRH = [
    { icon: '🧑‍💼', titre: 'Ressources Humaines', sous: 'Présences & salaires', route: '/rh', bloque: false },
    { icon: '👥', titre: 'Équipe globale', sous: 'Tous les travailleurs', route: '/equipe', bloque: false },
    { icon: '📲', titre: 'Contacts', sous: 'Contacts équipe', route: '/contacts', bloque: false },
    { icon: '💳', titre: 'Charges du mois', sous: 'Saisir les charges', route: '/charges', bloque: false },
    { icon: '📁', titre: 'Documents', sous: 'Ajouter des documents', route: '/documents', bloque: false },
  ]

  const menuGerant = [
    { icon: '💰', titre: 'Saisir les ventes', sous: 'Séquences + photos', route: '/ventes', bloque: estBloque(pointValide) },
    { icon: '📊', titre: 'Tableau de bord', sous: 'Résultats du jour', route: '/dashboard', bloque: false },
    { icon: '📁', titre: 'Documents', sous: 'Documents du restaurant', route: '/documents', bloque: false },
    { icon: '🛵', titre: 'Livraisons', sous: 'Yango, Glovo…', route: '/livraisons', bloque: false },
    { icon: '👤', titre: 'Espace Caissier', sous: 'Point, dépenses, présences, inventaire…', route: '/gerant-caissier', bloque: false },
    { icon: '💸', titre: 'Déductions Gérant', sous: 'Fournisseurs, marché, divers', route: '/deductions-gerant', bloque: false },
    { icon: '💳', titre: 'Crédits fournisseurs', sous: 'Crédit, avances & paiements', route: '/credits-fournisseurs', bloque: false },
    { icon: '📲', titre: 'Contacts', sous: 'SMS & WhatsApp équipe', route: '/contacts', bloque: false },
  ]

  const menuCaissier = [
    { icon: '⏱️', titre: 'Point / Shift', sous: 'Faire mon point de shift', route: '/point-shift', bloque: false },
    { icon: '📋', titre: 'Dépenses', sous: 'Marché, paie…', route: '/depenses', bloque: estBloque(pointValide) },
    { icon: '🧾', titre: 'Fournisseurs', sous: 'Factures & paiements', route: '/fournisseurs', bloque: estBloque(pointValide) },
    { icon: '📦', titre: 'Inventaire', sous: 'Stock par shift', route: '/inventaire', bloque: false },
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
    if (isManager || isDirecteur) return '#534AB7'
    if (isRH) return '#185FA5'
    return '#EF9F27'
  }

  function getRoleLabel() {
    if (isManager) return '👑 Manager'
    if (isDirecteur) return '🏢 Directeur'
    if (isRH) return '🧑‍💼 RH'
    if (isGerant) return '🔑 Gérant'
    return '💼 Caissier'
  }

  function getRoleBadgeBg() {
    if (isManager || isDirecteur) return '#3C3489'
    if (isRH) return '#0F4880'
    return '#BA7517'
  }

  function getRoleBadgeText() {
    if (isManager || isDirecteur) return '#CECBF6'
    if (isRH) return '#B8D4F5'
    return '#FAEEDA'
  }

  function getHeaderTextColor() {
    if (isManager || isDirecteur || isRH) return '#fff'
    return '#412402'
  }

  function getSubtitle() {
    if (isManager) return 'Accès total — tous les restaurants'
    if (isDirecteur) return 'Direction générale'
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
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          {!isCaissier && (
            <TouchableOpacity onPress={ouvrirPanel} style={styles.bellBtn}>
              <Text style={styles.bellIcon}>🔔</Text>
              {nonLues > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeTxt}>{nonLues > 9 ? '9+' : nonLues}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          <View style={[styles.roleBadge, { backgroundColor: getRoleBadgeBg() }]}>
            <Text style={[styles.roleText, { color: getRoleBadgeText() }]}>
              {getRoleLabel()}
            </Text>
          </View>
        </View>
      </View>

      {/* Bannières */}
      {pointValide && !isManager && !isDirecteur && !isRH && (
        <View style={styles.valideBanner}>
          <Text style={styles.valideTxt}>✅ Point du jour validé — lecture seule</Text>
        </View>
      )}

      {isGerant && nbCorrections > 0 && (
        <TouchableOpacity style={styles.correctionBanner} onPress={() => router.push('/correction-point')}>
          <Text style={styles.correctionBannerTxt}>
            ⚠️ {nbCorrections} correction(s) demandée(s) par le manager
          </Text>
          <Text style={styles.correctionBannerSub}>Appuyer pour voir et corriger ›</Text>
        </TouchableOpacity>
      )}

      {isManager && (
        <View style={styles.managerBanner}>
          <Text style={styles.managerTxt}>👑 Accès total — toutes modifications autorisées</Text>
        </View>
      )}

      {isDirecteur && (
        <View style={styles.managerBanner}>
          <Text style={styles.managerTxt}>🏢 Direction générale — vue consolidée</Text>
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

        {/* ── Directeur : même vue que Manager ── */}
        {isDirecteur && renderMenu(menuManager, null)}

        {/* ── RH ── */}
        {isRH && renderMenu(menuRH, null)}

        {/* ── Gérant ── */}
        {isGerant && renderMenu(menuGerant, null)}

        {/* ── Caissier ── */}
        {isCaissier && renderMenu(menuCaissier, 'Mon point du jour')}

        {/* Mode sombre */}
        <View style={styles.themeRow}>
          <Text style={styles.themeLabel}>{isDark ? '🌙 Mode sombre' : '☀️ Mode clair'}</Text>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: '#ddd', true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        {/* Déconnexion */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => { deconnecter(); router.replace('/login') }}
        >
          <Text style={styles.logoutText}>⏻ Se déconnecter</Text>
        </TouchableOpacity>

        <View style={{ height: 60 }} />
      </ScrollView>
      <SignatureFooter />

      {/* ── Panneau notifications ── */}
      <Modal visible={panelVisible} transparent animationType="slide" onRequestClose={fermerPanel}>
        <View style={styles.notifOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={fermerPanel} />
          <View style={styles.notifPanel}>
            <View style={styles.notifPanelHeader}>
              <Text style={styles.notifPanelTitre}>🔔 Notifications</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {notifications.length > 0 && (
                  <TouchableOpacity onPress={supprimerTout}>
                    <Text style={styles.notifEffacer}>Tout effacer</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={fermerPanel}>
                  <Text style={styles.notifPanelClose}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            {notifications.length === 0 ? (
              <View style={styles.notifEmpty}>
                <Text style={styles.notifEmptyTxt}>Aucune notification</Text>
              </View>
            ) : (
              <FlatList
                data={notifications}
                keyExtractor={n => n.id}
                contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
                renderItem={({ item: n }) => {
                  const nonLue = !n.lu_par?.includes(userId)
                  const aUneLigne = !!(n.screen || (n.type && ['point_valide','shift_valide','correction_demandee','nouveau_document','nouveau_travailleur'].includes(n.type)))
                  return (
                    <TouchableOpacity
                      activeOpacity={aUneLigne ? 0.75 : 1}
                      onPress={aUneLigne ? () => naviguerDepuisNotif(n) : undefined}
                      style={[styles.notifCard, nonLue && styles.notifCardNonLue]}
                    >
                      {nonLue && <View style={styles.notifDot} />}
                      <TouchableOpacity
                        style={styles.notifDeleteBtn}
                        onPress={() => supprimerUne(n.id)}
                        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                      >
                        <Text style={styles.notifDeleteTxt}>✕</Text>
                      </TouchableOpacity>
                      <Text style={styles.notifCardTitre}>{n.titre}</Text>
                      <Text style={styles.notifCardMsg}>{n.message}</Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                        <Text style={styles.notifCardDate}>
                          {new Date(n.created_at).toLocaleDateString('fr-FR', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                          })}
                        </Text>
                        {aUneLigne && (
                          <Text style={styles.notifVoir}>Voir ›</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  )
                }}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  correctionBanner: {
    backgroundColor: '#FAEEDA', padding: 12, alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#EF9F27',
  },
  correctionBannerTxt: { fontSize: 13, color: '#854F0B', fontWeight: '700' },
  correctionBannerSub: { fontSize: 11, color: '#854F0B', marginTop: 3 },
  managerBanner: {
    backgroundColor: colors.primaryLight, padding: 10, alignItems: 'center',
    borderBottomWidth: 0.5, borderBottomColor: colors.primaryText
  },
  managerTxt: { fontSize: 12, color: colors.primaryDark, fontWeight: '500' },
  body: { flex: 1, padding: 16 },
  section: { marginBottom: 16 },
  sectionTitre: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase'
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    width: '47%', backgroundColor: colors.surface, borderRadius: 14,
    padding: 14, borderWidth: 0.5, borderColor: colors.borderLight
  },
  cardBloque: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, opacity: 0.6 },
  cardIcon: { fontSize: 26, marginBottom: 8 },
  cardTitre: { fontSize: 13, fontWeight: '600', color: colors.text },
  cardTitreBloque: { color: '#aaa' },
  cardSous: { fontSize: 11, color: colors.textMuted, marginTop: 3 },
  cardSousBloque: { color: '#ccc' },
  themeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    marginBottom: 8, borderWidth: 0.5, borderColor: colors.borderLight
  },
  themeLabel: { fontSize: 14, color: colors.text, fontWeight: '500' },
  logoutBtn: {
    marginTop: 0, marginBottom: 10, padding: 14,
    backgroundColor: colors.surface, borderRadius: 12, alignItems: 'center',
    borderWidth: 0.5, borderColor: colors.borderLight
  },
  logoutText: { fontSize: 14, color: colors.textMuted },
  bellBtn: { position: 'relative', padding: 4 },
  bellIcon: { fontSize: 22 },
  bellBadge: {
    position: 'absolute', top: 0, right: 0,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#E53535', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  bellBadgeTxt: { fontSize: 9, color: '#fff', fontWeight: '700' },
  notifOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  notifPanel: {
    backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    maxHeight: '75%', minHeight: 200,
  },
  notifPanelHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 18, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
  },
  notifPanelTitre: { fontSize: 16, fontWeight: '700', color: colors.text },
  notifPanelClose: { fontSize: 18, color: colors.textMuted, paddingHorizontal: 4 },
  notifEmpty: { padding: 40, alignItems: 'center' },
  notifEmptyTxt: { fontSize: 14, color: colors.textMuted },
  notifCard: {
    backgroundColor: colors.bg, borderRadius: 12, padding: 12,
    marginBottom: 8, borderWidth: 0.5, borderColor: colors.borderLight, position: 'relative',
  },
  notifCardNonLue: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  notifDot: {
    position: 'absolute', top: 12, right: 12,
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary,
  },
  notifEffacer: { fontSize: 12, color: '#E53535', fontWeight: '600' },
  notifCardTitre: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 3, paddingRight: 22 },
  notifCardMsg: { fontSize: 12, color: colors.textSecondary, marginBottom: 4, paddingRight: 8 },
  notifCardDate: { fontSize: 10, color: colors.textMuted },
  notifDeleteBtn: { position: 'absolute', top: 10, right: 10, padding: 2 },
  notifDeleteTxt: { fontSize: 12, color: colors.textMuted },
  notifVoir: { fontSize: 11, color: colors.primary, fontWeight: '600' },
}) }
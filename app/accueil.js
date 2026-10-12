import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import Animated, {
  FadeInDown,
  FadeInRight,
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated'
import { useApp } from '../context/AppContext'
import { useNotifications } from '../context/NotificationsContext'
import { useTheme } from '../context/ThemeContext'
import { texteRetard } from '../lib/avisPlateformes'
import { enregistrerTokenDirecteur } from '../lib/notifications'
import {
  pushSupporte, etatPermissionPush, synchroniserWebPush, activerNotificationsPush, iPhoneHorsApplication, iPhoneTropAncien,
} from '../lib/webPush'
import SignatureFooter from '../components/SignatureFooter'
import { SPRINGS, staggerDelay } from '../lib/animations'
import AccueilManager from '../components/accueil/AccueilManager'
import { tuilesPourRole, chargerAccesConfig, ACCES_DEFAUT } from '../lib/menus'
import { useLargeurCase } from '../lib/grille'

function MenuCard({ item, index }) {
  const { colors } = useTheme()
  const largeur = useLargeurCase(12)
  const styles = useMemo(() => makeStyles(colors), [colors])
  const scale = useSharedValue(1)
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <Animated.View
      entering={FadeInDown.delay(staggerDelay(index, 55)).springify().damping(18).stiffness(190)}
      style={[styles.cardWrap, largeur, aStyle]}
    >
      <Pressable
        onPressIn={() => { if (!item.bloque) scale.value = withSpring(0.93, SPRINGS.snappy) }}
        onPressOut={() => { scale.value = withSpring(1, SPRINGS.gentle) }}
        // Souris (web) : la tuile grossit un peu pour montrer qu'on est dessus.
        onHoverIn={() => { if (!item.bloque) scale.value = withSpring(1.05, SPRINGS.gentle) }}
        onHoverOut={() => { scale.value = withSpring(1, SPRINGS.gentle) }}
        onPress={() => !item.bloque && router.push(item.route)}
        style={[styles.card, item.bloque && styles.cardBloque]}
        disabled={item.bloque}
      >
        <View style={styles.cardIconWrap}>
          <Text style={styles.cardIcon}>{item.icon}</Text>
        </View>
        <Text style={[styles.cardTitre, item.bloque && styles.cardTitreBloque]} numberOfLines={1}>
          {item.titre}
        </Text>
        <Text style={[styles.cardSous, item.bloque && styles.cardSousBloque]} numberOfLines={2}>
          {item.bloque ? '🔒 Verrouillé' : item.sous}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

export default function AccueilScreen() {
  const { nom, role } = useLocalSearchParams()
  const {
    pointValide, estBloque, roleActif, deconnecter,
    userId, restaurantId,
  } = useApp()
  const [pushEtat, setPushEtat] = useState('unsupported')
  const [pushMsg, setPushMsg] = useState('')

  const { colors, isDark, toggleTheme } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const {
    notifications, explicationsEnRetard, avisEnRetard, nonLues, panelVisible,
    ouvrirPanel, fermerPanel,
    supprimerUne, supprimerTout, naviguerDepuisNotif, ouvrirExplicationEnRetard, ouvrirAvisEnRetard,
  } = useNotifications()

  const roleEffectif = role || roleActif

  // Sur web, si le contexte est vide après un refresh → redirect login
  useEffect(() => {
    if (!roleEffectif) {
      const t = setTimeout(() => router.replace('/login'), 800)
      return () => clearTimeout(t)
    }
  }, [roleEffectif])

  // Enregistrer le token push pour tous les rôles qui reçoivent des notifications
  useEffect(() => {
    if (['manager', 'directeur', 'gerant', 'rh'].includes(roleEffectif) && userId) {
      enregistrerTokenDirecteur(userId)
    }
  }, [roleEffectif, userId])

  // Web Push (PWA) : à chaque connexion, si la permission est déjà accordée,
  // on ré-abonne et on rafraîchit le mapping user_id/restaurant_id de cet
  // appareil (essentiel sur le tel du resto où gérant/caissier alternent).
  useEffect(() => {
    if (!userId || !roleEffectif) return
    const etat = etatPermissionPush()
    setPushEtat(etat)
    if (etat === 'granted') {
      synchroniserWebPush({ userId, restaurantId, role: roleEffectif })
    }
  }, [userId, roleEffectif, restaurantId])

  async function activerPush() {
    setPushMsg('')
    const res = await activerNotificationsPush({ userId, restaurantId, role: roleEffectif })
    if (res === 'granted') {
      setPushEtat('granted')
      setPushMsg('✅ Alertes activées sur ce téléphone.')
    } else if (res === 'denied') {
      setPushEtat('denied')
      setPushMsg('Notifications refusées. Réactivez-les dans les réglages du téléphone.')
    } else if (res === 'ios-standalone-requis') {
      setPushMsg("Sur iPhone : ajoutez d'abord l'app à l'écran d'accueil (Partager → « Sur l'écran d'accueil »), puis rouvrez-la depuis son icône.")
    } else if (res === 'unsupported') {
      setPushMsg('Ce navigateur ne supporte pas les notifications.')
    } else {
      setPushMsg("Impossible d'activer les alertes pour le moment.")
    }
  }

  const isManager = roleEffectif === 'manager'
  const isDirecteur = roleEffectif === 'directeur'
  const isGerant = roleEffectif === 'gerant'
  const isCaissier = roleEffectif === 'caissier'
  const isRH = roleEffectif === 'rh'

  // Config d'accès par rôle, chargée depuis la base (repli sur les défauts).
  // Manager & directeur ignorent cette config : accès total non configurable.
  const [accesConfig, setAccesConfig] = useState(ACCES_DEFAUT)
  useEffect(() => {
    let vivant = true
    chargerAccesConfig().then(cfg => { if (vivant) setAccesConfig(cfg) })
    return () => { vivant = false }
  }, [])

  // Construit le menu du rôle actif depuis le catalogue central + la config.
  const menuItems = useMemo(() => {
    const tuiles = tuilesPourRole(roleEffectif, accesConfig)
    return tuiles.map(t => ({
      id: t.id,
      icon: t.icon,
      titre: t.titre,
      sous: t.sous,
      route: t.route,
      bloque: t.verrouSiPointValide ? estBloque(pointValide) : false,
    }))
  }, [roleEffectif, accesConfig, pointValide])

  function renderMenu(items, titre) {
    return (
      <View style={styles.section}>
        {titre && <Text style={styles.sectionTitre}>{titre}</Text>}
        <View style={styles.grid}>
          {items.map((item, i) => (
            <MenuCard key={i} item={item} index={i} />
          ))}
        </View>
      </View>
    )
  }

  function getHeaderColor() {
    if (isManager || isDirecteur || isGerant) return '#534AB7'
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
    if (isManager || isDirecteur || isGerant) return '#3C3489'
    if (isRH) return '#0F4880'
    return '#BA7517'
  }

  function getRoleBadgeText() {
    if (isManager || isDirecteur || isGerant) return '#CECBF6'
    if (isRH) return '#B8D4F5'
    return '#FAEEDA'
  }

  function getHeaderTextColor() {
    if (isManager || isDirecteur || isRH || isGerant) return '#fff'
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
      <Animated.View
        entering={FadeInDown.springify().damping(22).stiffness(180)}
        style={[styles.header, { backgroundColor: getHeaderColor() }]}
      >
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
          <View style={styles.iconesHeader}>
          {(isManager || isGerant || isRH) && (
            <TouchableOpacity onPress={() => router.push('/recherche')} style={styles.bellBtn}
              accessibilityRole="button" accessibilityLabel="Rechercher partout">
              <Text style={styles.bellIcon}>🔍</Text>
            </TouchableOpacity>
          )}
          {!isCaissier && (
            <TouchableOpacity onPress={ouvrirPanel} style={styles.bellBtn}>
              <Text style={styles.bellIcon}>🔔</Text>
              {nonLues > 0 && (
                <Animated.View
                  entering={FadeIn.delay(600).springify()}
                  style={styles.bellBadge}
                >
                  <Text style={styles.bellBadgeTxt}>{nonLues > 9 ? '9+' : nonLues}</Text>
                </Animated.View>
              )}
            </TouchableOpacity>
          )}
          </View>
          <Animated.View
            entering={FadeInRight.delay(200).springify().damping(18)}
            style={[styles.roleBadge, { backgroundColor: getRoleBadgeBg() }]}
          >
            <Text style={[styles.roleText, { color: getRoleBadgeText() }]}>
              {getRoleLabel()}
            </Text>
          </Animated.View>
        </View>
      </Animated.View>

      {/* Bannières */}
      {pushSupporte() && pushEtat === 'default' && (
        <TouchableOpacity style={styles.pushBanner} onPress={activerPush}>
          <Text style={styles.pushBannerTxt}>🔔 Activer les alertes sur ce téléphone</Text>
          <Text style={styles.pushBannerSous}>{"Pour être prévenu même sans ouvrir l'app"}</Text>
        </TouchableOpacity>
      )}
      {iPhoneHorsApplication() && (
        <View style={styles.pushBanner}>
          <Text style={styles.pushBannerTxt}>🔔 Pour recevoir les alertes sur iPhone</Text>
          <Text style={styles.pushBannerSous}>
            {"1. Appuyez sur Partager (le carré avec une flèche), puis « Sur l'écran d'accueil ».\n2. Ouvrez SAMER depuis sa nouvelle icône.\n3. Appuyez sur « Activer les alertes »."}
          </Text>
        </View>
      )}
      {iPhoneTropAncien() && (
        <View style={styles.pushBanner}>
          <Text style={styles.pushBannerTxt}>🔔 Alertes indisponibles sur cet iPhone</Text>
          <Text style={styles.pushBannerSous}>{"Mettez l'iPhone à jour (iOS 16.4 ou plus récent) pour recevoir les alertes."}</Text>
        </View>
      )}
      {pushMsg ? <Text style={styles.pushMsg}>{pushMsg}</Text> : null}

      {pointValide && !isManager && !isDirecteur && !isRH && (
        <View style={styles.valideBanner}>
          <Text style={styles.valideTxt}>✅ Point du jour validé — lecture seule</Text>
        </View>
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

        {/* Menu construit depuis le catalogue central + config par rôle.
            Manager & directeur : accès total. RH/gérant/caissier : configurable. */}
        {(isManager || isDirecteur || isRH || isGerant)
          ? <AccueilManager items={menuItems} role={roleEffectif} userId={userId} restaurantId={restaurantId} />
          : renderMenu(menuItems, isCaissier ? 'Mon point du jour' : null)}

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
            {notifications.length === 0 && explicationsEnRetard.length === 0 && avisEnRetard.length === 0 ? (
              <View style={styles.notifEmpty}>
                <Text style={styles.notifEmptyTxt}>Aucune notification</Text>
              </View>
            ) : (
              <FlatList
                data={notifications}
                keyExtractor={n => n.id}
                contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
                ListHeaderComponent={explicationsEnRetard.length > 0 || avisEnRetard.length > 0 ? (
                  <View style={{ marginBottom: 6 }}>
                    {avisEnRetard.length > 0 ? (
                      <>
                        <Text style={styles.notifSection}>⭐ Avis à envoyer ({avisEnRetard.length})</Text>
                        {avisEnRetard.map(a => (
                          <TouchableOpacity
                            key={a.platform}
                            activeOpacity={0.75}
                            onPress={ouvrirAvisEnRetard}
                            style={[styles.notifCard, styles.notifCardRetard]}
                            accessibilityRole="button"
                            accessibilityLabel={texteRetard(a)}
                          >
                            <Text style={styles.notifCardTitre}>{texteRetard(a)}</Text>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                              <Text style={[styles.notifCardDate, styles.notifRetardTxt]}>
                                Cliquez sur le bouton avis depuis le portail {a.label}
                              </Text>
                              <Text style={styles.notifVoir}>Voir ›</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </>
                    ) : null}
                    {explicationsEnRetard.length > 0 ? (
                      <>
                        <Text style={styles.notifSection}>
                          ⏰ Explications sans réponse ({explicationsEnRetard.length})
                        </Text>
                        {explicationsEnRetard.map(d => (
                          <TouchableOpacity
                            key={d.id}
                            activeOpacity={0.75}
                            onPress={() => ouvrirExplicationEnRetard(d)}
                            style={[styles.notifCard, styles.notifCardRetard]}
                            accessibilityRole="button"
                            accessibilityLabel={`Explication de ${d.travailleur_nom || 'travailleur'} sans réponse depuis ${d.joursDepuisEnvoi} jours`}
                          >
                            <Text style={styles.notifCardTitre}>
                              {d.travailleur_nom || 'Travailleur'}{d.numero > 1 ? ' · relance' : ''}
                            </Text>
                            <Text style={styles.notifCardMsg}>
                              {d.motif}{d.restaurant_nom ? ` — ${d.restaurant_nom}` : ''}
                            </Text>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                              <Text style={[styles.notifCardDate, styles.notifRetardTxt]}>
                                Envoyée il y a {d.joursDepuisEnvoi} jours · jour de réponse dépassé
                              </Text>
                              <Text style={styles.notifVoir}>Voir ›</Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </>
                    ) : null}
                    {notifications.length > 0 && <Text style={styles.notifSection}>Notifications</Text>}
                  </View>
                ) : null}
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
    padding: 22, paddingBottom: 26,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  headerSub: { fontSize: 11, marginBottom: 5, letterSpacing: 0.3, opacity: 0.8 },
  headerTitre: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  headerDate: { fontSize: 12, marginTop: 5, opacity: 0.75 },
  roleBadge: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 22, marginTop: 4 },
  roleText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  valideBanner: {
    backgroundColor: '#E0F9EE', padding: 10, alignItems: 'center',
    borderBottomWidth: 0.5, borderBottomColor: '#A8E8CC',
  },
  valideTxt: { fontSize: 12, color: '#157548', fontWeight: '600' },
  pushBanner: {
    backgroundColor: '#E8F0FE', padding: 12, alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#AFC8F5',
  },
  pushBannerTxt: { fontSize: 13, color: '#1B4B9E', fontWeight: '700' },
  pushBannerSous: { fontSize: 11, color: '#1B4B9E', marginTop: 3, opacity: 0.85 },
  pushMsg: {
    fontSize: 12, color: colors.textSecondary || '#666', textAlign: 'center',
    paddingHorizontal: 18, paddingVertical: 8,
  },
  managerBanner: {
    backgroundColor: colors.primaryLight, padding: 10, alignItems: 'center',
    borderBottomWidth: 0.5, borderBottomColor: colors.primaryText,
  },
  managerTxt: { fontSize: 12, color: colors.primaryDark, fontWeight: '500' },
  body: { flex: 1, padding: 14 },
  section: { marginBottom: 14 },
  sectionTitre: {
    fontSize: 10, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cardWrap: {},
  card: {
    backgroundColor: colors.surface, borderRadius: 18,
    padding: 16, overflow: 'hidden',
    shadowColor: colors.cardShadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 5,
    borderWidth: 1, borderColor: colors.borderLight,
    minHeight: 110,
  },
  cardBloque: {
    backgroundColor: colors.surfaceAlt, borderColor: colors.border,
    opacity: 0.55, shadowOpacity: 0,
  },
  cardIconWrap: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  cardIcon: { fontSize: 24 },
  cardTitre: { fontSize: 13, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  cardTitreBloque: { color: colors.textMuted },
  cardSous: { fontSize: 11, color: colors.textMuted, marginTop: 4, lineHeight: 15 },
  cardSousBloque: { color: colors.textPlaceholder },
  themeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: 16, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: colors.borderLight,
    shadowColor: colors.cardShadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  themeLabel: { fontSize: 14, color: colors.text, fontWeight: '600' },
  logoutBtn: {
    marginBottom: 12, padding: 16,
    backgroundColor: colors.surface, borderRadius: 16, alignItems: 'center',
    borderWidth: 1, borderColor: colors.borderLight,
    shadowColor: colors.cardShadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
  },
  logoutText: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  iconesHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bellBtn: { position: 'relative', padding: 4, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  bellIcon: { fontSize: 24 },
  bellBadge: {
    position: 'absolute', top: 0, right: 0,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#EE4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  bellBadgeTxt: { fontSize: 10, color: '#fff', fontWeight: '800' },
  notifOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  notifPanel: {
    backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    maxHeight: '75%', minHeight: 200,
  },
  notifPanelHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 0.5, borderBottomColor: colors.borderLight,
  },
  notifPanelTitre: { fontSize: 17, fontWeight: '700', color: colors.text },
  notifPanelClose: { fontSize: 18, color: colors.textMuted, paddingHorizontal: 4 },
  notifEmpty: { padding: 40, alignItems: 'center' },
  notifEmptyTxt: { fontSize: 14, color: colors.textMuted },
  notifCard: {
    backgroundColor: colors.bg, borderRadius: 14, padding: 14,
    marginBottom: 8, borderWidth: 0.5, borderColor: colors.borderLight, position: 'relative',
  },
  notifCardNonLue: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  notifDot: {
    position: 'absolute', top: 14, right: 14,
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary,
  },
  notifEffacer: { fontSize: 12, color: '#EE4444', fontWeight: '700' },
  notifCardTitre: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 3, paddingRight: 22 },
  notifCardMsg: { fontSize: 12, color: colors.textSecondary, marginBottom: 4, paddingRight: 8 },
  notifCardDate: { fontSize: 10, color: colors.textMuted },
  notifDeleteBtn: { position: 'absolute', top: 10, right: 10, padding: 4 },
  notifDeleteTxt: { fontSize: 12, color: colors.textMuted },
  notifVoir: { fontSize: 11, color: colors.primary, fontWeight: '700' },
  notifSection: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, marginBottom: 8, marginTop: 2 },
  notifCardRetard: { backgroundColor: colors.errorLight, borderColor: colors.errorDark, borderLeftWidth: 4 },
  notifRetardTxt: { color: colors.errorDark, fontWeight: '700', flex: 1, paddingRight: 8 },
}) }
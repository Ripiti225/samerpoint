/*
 * Corbeille — suppressions de shifts des derniers jours, et leur restauration.
 * Écran manager. Voir lib/corbeille.js pour le mécanisme.
 */

import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, RefreshControl, SafeAreaView, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import {
  RETENTION_JOURS, chargerCorbeille, purgerAnciennes, restaurerSuppression,
} from '../lib/corbeille'
import '../lib/webAlert'

function formatHeure(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function formatDatePoint(d) {
  if (!d) return '—'
  const [y, m, j] = String(d).split('-')
  return `${j}/${m}/${y}`
}

// « 3 dépenses · 5 présences · 2 factures » — ce que la restauration remettra.
function decrireContenu(contenu) {
  const c = contenu || {}
  const parts = []
  if (c.depenses?.length) parts.push(`${c.depenses.length} dépense${c.depenses.length > 1 ? 's' : ''}`)
  if (c.presences?.length) parts.push(`${c.presences.length} présence${c.presences.length > 1 ? 's' : ''}`)
  if (c.transactions_fournisseurs?.length) parts.push(`${c.transactions_fournisseurs.length} facture${c.transactions_fournisseurs.length > 1 ? 's' : ''}`)
  return parts.length > 0 ? parts.join(' · ') : 'Shift seul'
}

export default function CorbeilleScreen() {
  const { userNom } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [lignes, setLignes] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [migration, setMigration] = useState(false)
  const [enCours, setEnCours] = useState(null)
  const [confirmation, setConfirmation] = useState(null)

  async function charger() {
    const { lignes: data, migration: manque } = await chargerCorbeille()
    setLignes(data)
    setMigration(manque)
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => {
    purgerAnciennes().finally(charger)
  }, [])

  async function restaurer(archive) {
    setConfirmation(null)
    setEnCours(archive.id)
    try {
      const { nb } = await restaurerSuppression(archive, { userNom })
      await charger()
      Alert.alert('Restauré', `${nb} ligne(s) remises en place. Le total du point a été recalculé.`)
    } catch (e) {
      Alert.alert('Restauration impossible', e.message || 'Erreur inconnue')
    } finally {
      setEnCours(null)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backTxt}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Corbeille</Text>
        <Text style={styles.headerSub}>
          Shifts supprimés — conservés {RETENTION_JOURS} jours
        </Text>
      </View>

      {loading ? (
        <View style={styles.centre}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : migration ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>⚙️</Text>
          <Text style={styles.emptyTxt}>Corbeille indisponible</Text>
          <Text style={styles.emptySub}>La migration supabase_corbeille.sql n’a pas été passée.</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); charger() }} tintColor={colors.primary} />}
        >
          {lignes.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🗑️</Text>
              <Text style={styles.emptyTxt}>Aucune suppression</Text>
              <Text style={styles.emptySub}>Rien n’a été supprimé ces {RETENTION_JOURS} derniers jours.</Text>
            </View>
          ) : lignes.map(a => (
            <View key={a.id} style={[styles.carte, a.restaure_at && styles.carteRestauree]}>
              <View style={styles.carteHaut}>
                <Text style={styles.resume}>{a.resume}</Text>
                <Text style={styles.heure}>{formatHeure(a.created_at)}</Text>
              </View>

              <Text style={styles.contexte}>
                {a.restaurants?.nom || 'Restaurant inconnu'} · journée du {formatDatePoint(a.date_point)}
              </Text>
              <Text style={styles.contenu}>{decrireContenu(a.contenu)}</Text>
              {a.supprime_par_nom && (
                <Text style={styles.auteur}>Supprimé par {a.supprime_par_nom.trim()}</Text>
              )}

              {a.restaure_at ? (
                <Text style={styles.restaure}>
                  ✅ Restauré le {formatHeure(a.restaure_at)}
                  {a.restaure_par_nom ? ` par ${a.restaure_par_nom.trim()}` : ''}
                </Text>
              ) : confirmation === a.id ? (
                <View style={styles.confirmRow}>
                  <TouchableOpacity style={styles.btnAnnuler} onPress={() => setConfirmation(null)}>
                    <Text style={styles.btnAnnulerTxt}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnConfirmer} onPress={() => restaurer(a)}>
                    <Text style={styles.btnConfirmerTxt}>Oui, restaurer</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.btnRestaurer}
                  disabled={enCours === a.id}
                  onPress={() => setConfirmation(a.id)}
                >
                  <Text style={styles.btnRestaurerTxt}>
                    {enCours === a.id ? 'Restauration…' : '↩️ Restaurer'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: { backgroundColor: colors.headerBg, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
    backBtn: { marginBottom: 8 },
    backTxt: { color: colors.primaryText, fontSize: 14 },
    headerTitre: { fontSize: 22, fontWeight: '700', color: colors.headerText },
    headerSub: { fontSize: 13, color: colors.primaryText, marginTop: 3 },

    body: { flex: 1 },
    centre: { flex: 1, justifyContent: 'center', alignItems: 'center' },

    emptyBox: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 30 },
    emptyIcon: { fontSize: 40, marginBottom: 12 },
    emptyTxt: { fontSize: 15, color: colors.textMuted },
    emptySub: { fontSize: 12.5, color: colors.textMuted, marginTop: 6, textAlign: 'center' },

    carte: { backgroundColor: colors.surface, marginHorizontal: 12, marginTop: 12, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
    carteRestauree: { opacity: 0.7 },
    carteHaut: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    resume: { fontSize: 14.5, fontWeight: '700', color: colors.text, flex: 1 },
    heure: { fontSize: 11, color: colors.textMuted, marginLeft: 8 },
    contexte: { fontSize: 12.5, color: colors.textSecondary, marginTop: 4 },
    contenu: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    auteur: { fontSize: 11.5, color: colors.textMuted, marginTop: 4, fontStyle: 'italic' },

    btnRestaurer: { marginTop: 10, alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.primaryLight },
    btnRestaurerTxt: { fontSize: 12.5, fontWeight: '700', color: colors.primaryDark },

    confirmRow: { flexDirection: 'row', marginTop: 10 },
    btnAnnuler: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.border, marginRight: 8 },
    btnAnnulerTxt: { fontSize: 12.5, color: colors.textSecondary },
    btnConfirmer: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.primary },
    btnConfirmerTxt: { fontSize: 12.5, fontWeight: '700', color: '#fff' },

    restaure: { fontSize: 12, color: colors.success, marginTop: 10, fontWeight: '600' },
  })
}

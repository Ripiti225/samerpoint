/*
 * Comptabilité → Clôture du mois (manager seulement).
 *
 * Un mois terminé se clôture pour tout le groupe une fois toutes ses journées
 * validées ET vérifiées ; la base refuse ensuite toute modification de ses
 * journées (supabase_cloture_mois.sql). Réouverture possible avec un motif.
 * Logique d'état : lib/clotureMois.js.
 */

import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'

import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { bornesMois, etatMois, libelleMois, listeMois } from '../lib/clotureMois'
import { exporterJournalCaisse } from '../lib/exportJournalCaisse'
import { nomCourtResto } from '../lib/groupesAccueil'
import { journaliser } from '../lib/journal'
import { retour } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import { aujourdhuiISO, formatDateFR } from '../lib/tresorerie'

const NB_MOIS = 12
const PAGE = 1000

function formatQuand(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Tous les points du mois, page par page (limite silencieuse de 1 000 lignes).
async function chargerPointsDuMois(mois) {
  const { debut, fin } = bornesMois(mois)
  const out = []
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await supabase.from('points')
      .select('id, restaurant_id, date, valide, verifie')
      .gte('date', debut).lt('date', fin)
      .order('date').order('id')
      .range(de, de + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

async function chargerClotures() {
  const { data, error } = await supabase.from('clotures_mois').select('*')
  if (error) {
    const manque = error.code === '42P01' || /clotures_mois/.test(error.message || '')
    return { clotures: {}, noms: {}, manque }
  }
  const ids = [...new Set((data || []).flatMap(c => [c.cloture_par, c.rouvert_par]).filter(Boolean))]
  const { data: users } = ids.length
    ? await supabase.from('utilisateurs').select('id, nom').in('id', ids)
    : { data: [] }
  return {
    clotures: Object.fromEntries((data || []).map(c => [String(c.mois).slice(0, 7), c])),
    noms: Object.fromEntries((users || []).map(u => [u.id, u.nom])),
    manque: false,
  }
}

export default function ClotureMoisScreen() {
  const { userId, userNom, roleActif } = useApp()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const aujourdhui = aujourdhuiISO()
  const mois = useMemo(() => listeMois(aujourdhui, NB_MOIS), [aujourdhui])
  const [restaurants, setRestaurants] = useState([])
  const [clotures, setClotures] = useState({})
  const [noms, setNoms] = useState({})
  const [manque, setManque] = useState(false)
  const [chargement, setChargement] = useState(true)
  const [choisi, setChoisi] = useState(null)
  const [etat, setEtat] = useState(null)
  const [chargementMois, setChargementMois] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [confirmer, setConfirmer] = useState(false)
  const [motif, setMotif] = useState('')
  const [enCours, setEnCours] = useState(false)
  const [exportResto, setExportResto] = useState(null)
  const [exportMsg, setExportMsg] = useState('')
  const [exportEnCours, setExportEnCours] = useState(false)

  const chargerTout = useCallback(async () => {
    const [{ data: restos }, c] = await Promise.all([
      supabase.from('restaurants').select('id, nom').order('nom'),
      chargerClotures(),
    ])
    setRestaurants((restos || []).map(r => ({ id: r.id, nom: nomCourtResto(r.nom) })))
    setClotures(c.clotures)
    setNoms(c.noms)
    setManque(c.manque)
    setChargement(false)
  }, [])

  useEffect(() => { chargerTout() }, [chargerTout])

  const ouvrirMois = useCallback(async m => {
    setChoisi(m); setEtat(null); setErreur(null); setConfirmer(false); setMotif(''); setExportMsg('')
    setChargementMois(true)
    try {
      const points = await chargerPointsDuMois(m)
      setEtat(etatMois({ mois: m, points, restaurants, aujourdhui }))
    } catch (e) {
      setErreur(e?.message || 'Impossible de charger les journées du mois.')
    } finally {
      setChargementMois(false)
    }
  }, [restaurants, aujourdhui])

  async function cloturer() {
    setEnCours(true); setErreur(null)
    const { error } = await supabase.rpc('cloturer_mois', { p_mois: `${choisi}-01`, p_user: userId })
    if (error) {
      setErreur(error.message)
    } else {
      journaliser('cloture_mois', { mois: choisi }, { userId, userNom }).catch(() => {})
      await chargerTout()
      setConfirmer(false)
    }
    setEnCours(false)
  }

  async function rouvrir() {
    if (!motif.trim()) { setErreur('Écrivez pourquoi vous rouvrez le mois.'); return }
    setEnCours(true); setErreur(null)
    const { error } = await supabase.rpc('rouvrir_mois', { p_mois: `${choisi}-01`, p_user: userId, p_motif: motif.trim() })
    if (error) {
      setErreur(error.message)
    } else {
      journaliser('reouverture_mois', { mois: choisi, motif: motif.trim() }, { userId, userNom }).catch(() => {})
      await chargerTout()
      setMotif('')
    }
    setEnCours(false)
  }

  // Export comptable SYSCOHADA : Caisse, Banque, OD (lib/exportJournalCaisse.js) ; mois ouvert = PROVISOIRE.
  async function exporter() {
    setExportEnCours(true); setExportMsg(''); setErreur(null)
    try {
      const r = await exporterJournalCaisse({
        mois: choisi, restaurantId: exportResto, provisoire: clotures[choisi]?.statut !== 'cloture', onProgres: setExportMsg,
      })
      const exclues = r.nbExclues ? `, ${r.nbExclues} journée(s) des anciens Sheets laissée(s) de côté` : ''
      setExportMsg(`✅ ${r.nomFichier} : ${r.nbLignes} lignes${exclues}.`)
    } catch (e) {
      setExportMsg('')
      setErreur(e?.message || 'Export impossible pour le moment.')
    } finally {
      setExportEnCours(false)
    }
  }

  function ouvrirJournee(b) {
    if (b.raison === 'non_valide') {
      router.push({ pathname: '/modifier-point', params: { restaurant_id: b.restaurantId, date: b.date } })
    } else {
      router.push({ pathname: '/verification', params: { restaurant_id: b.restaurantId, point_id: b.pointId } })
    }
  }

  const entete = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => retour()} style={styles.backBtn}>
        <Text style={styles.backTxt}>← Retour</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitre}>Clôture du mois</Text>
      <Text style={styles.headerSub}>Un mois clôturé ne peut plus être modifié</Text>
    </View>
  )

  if (roleActif !== 'manager') {
    return (
      <SafeAreaView style={styles.container}>
        {entete}
        <Text style={styles.vide}>🔒 Réservé au manager.</Text>
      </SafeAreaView>
    )
  }

  if (chargement) {
    return (
      <SafeAreaView style={styles.container}>
        {entete}
        <View style={styles.centre}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    )
  }

  const c = choisi ? clotures[choisi] : null
  const estCloture = c?.statut === 'cloture'

  return (
    <SafeAreaView style={styles.container}>
      {entete}
      <ScrollView style={styles.body}>
        {manque && (
          <Text style={styles.alerte}>⚙️ La clôture n’est pas encore installée : le fichier supabase_cloture_mois.sql doit être passé dans Supabase.</Text>
        )}

        {mois.map(m => {
          const cm = clotures[m]
          const statut = cm?.statut === 'cloture'
            ? `🔒 Clôturé le ${formatQuand(cm.cloture_le)}${noms[cm.cloture_par] ? ` par ${noms[cm.cloture_par]}` : ''}`
            : cm?.statut === 'rouvert'
              ? `🔓 Rouvert le ${formatQuand(cm.rouvert_le)} : ${cm.motif_reouverture}`
              : 'Ouvert'
          const actif = m === choisi
          return (
            <View key={m} style={[styles.carte, actif && styles.carteActive]}>
              <TouchableOpacity onPress={() => (actif ? setChoisi(null) : ouvrirMois(m))} accessibilityRole="button">
                <Text style={styles.titreMois}>{libelleMois(m)}</Text>
                <Text style={[styles.statut, cm?.statut === 'cloture' && styles.statutCloture]}>{statut}</Text>
              </TouchableOpacity>

              {actif && (
                <View style={styles.detail}>
                  {chargementMois && <ActivityIndicator color={colors.primary} />}

                  {etat && !estCloture && (
                    <>
                      <Text style={styles.sousTitre}>
                        {etat.bloquants.length
                          ? `🔴 ${etat.bloquants.length} journée${etat.bloquants.length > 1 ? 's' : ''} à régler avant de clôturer`
                          : '✅ Toutes les journées sont validées et vérifiées'}
                      </Text>
                      {etat.bloquants.map(b => (
                        <TouchableOpacity key={b.pointId} style={styles.ligne} onPress={() => ouvrirJournee(b)}>
                          <Text style={styles.ligneTxt}>{b.nom} · {formatDateFR(b.date)}</Text>
                          <Text style={styles.ligneRaison}>{b.raison === 'non_valide' ? 'Pas validée ›' : 'Pas vérifiée ›'}</Text>
                        </TouchableOpacity>
                      ))}

                      {etat.joursVides.length > 0 && (
                        <>
                          <Text style={styles.sousTitre}>🟡 Jours sans point (à vérifier, ne bloque pas)</Text>
                          {etat.joursVides.map(r => (
                            <Text key={r.restaurantId} style={styles.info}>
                              {r.nom} : {r.dates.map(d => Number(d.slice(8, 10))).join(', ')}
                            </Text>
                          ))}
                        </>
                      )}

                      {confirmer ? (
                        <View style={styles.rangee}>
                          <TouchableOpacity style={styles.btnSecondaire} onPress={() => setConfirmer(false)}>
                            <Text style={styles.btnSecondaireTxt}>Annuler</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.btnPrincipal} onPress={cloturer} disabled={enCours}>
                            <Text style={styles.btnPrincipalTxt}>{enCours ? 'Clôture…' : 'Oui, clôturer'}</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[styles.btnPrincipal, !etat.peutCloturer && styles.btnInactif]}
                          disabled={!etat.peutCloturer || manque}
                          onPress={() => setConfirmer(true)}
                        >
                          <Text style={styles.btnPrincipalTxt}>🔒 Clôturer {libelleMois(m)}</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}

                  {estCloture && (
                    <>
                      <Text style={styles.info}>Les journées de ce mois ne peuvent plus être modifiées. Pour corriger une erreur, rouvrez le mois.</Text>
                      <TextInput
                        style={styles.champ}
                        value={motif}
                        onChangeText={setMotif}
                        placeholder="Pourquoi rouvrir ? (obligatoire)"
                        placeholderTextColor={colors.textMuted}
                        multiline
                      />
                      <TouchableOpacity
                        style={[styles.btnSecondaire, !motif.trim() && styles.btnInactif]}
                        disabled={!motif.trim() || enCours}
                        onPress={rouvrir}
                      >
                        <Text style={styles.btnSecondaireTxt}>{enCours ? 'Réouverture…' : '🔓 Rouvrir le mois'}</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {etat && (
                    <View style={styles.export}>
                      <Text style={styles.sousTitre}>
                        📥 Export comptable{estCloture ? '' : ' — provisoire, le mois n’est pas clôturé'}
                      </Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.puces}>
                        {[{ id: null, nom: 'Tout le groupe' }, ...restaurants].map(r => {
                          const choisiR = exportResto === r.id
                          return (
                            <TouchableOpacity key={r.id || 'groupe'} style={[styles.puce, choisiR && styles.puceActive]}
                              onPress={() => setExportResto(r.id)} accessibilityRole="button" accessibilityState={{ selected: choisiR }}>
                              <Text style={[styles.puceTxt, choisiR && styles.puceTxtActive]}>{r.nom}</Text>
                            </TouchableOpacity>
                          )
                        })}
                      </ScrollView>
                      <TouchableOpacity style={[styles.btnSecondaire, exportEnCours && styles.btnInactif]} disabled={exportEnCours} onPress={exporter}>
                        <Text style={styles.btnSecondaireTxt}>{exportEnCours ? (exportMsg || 'Export…') : '📥 Télécharger l’export comptable (Excel)'}</Text>
                      </TouchableOpacity>
                      {!!exportMsg && !exportEnCours && <Text style={styles.info}>{exportMsg}</Text>}
                    </View>
                  )}

                  {erreur && <Text style={styles.erreur}>{erreur}</Text>}
                </View>
              )}
            </View>
          )
        })}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: { backgroundColor: colors.headerBg, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
    backBtn: { marginBottom: 8, minHeight: 32, justifyContent: 'center' },
    backTxt: { color: colors.primaryText, fontSize: 14 },
    headerTitre: { fontSize: 22, fontWeight: '700', color: colors.headerText },
    headerSub: { fontSize: 13, color: colors.primaryText, marginTop: 3 },
    body: { flex: 1 },
    centre: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    vide: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: 60 },
    alerte: { margin: 12, padding: 12, borderRadius: 10, backgroundColor: colors.primaryLight, color: colors.text, fontSize: 13 },

    carte: { backgroundColor: colors.surface, marginHorizontal: 12, marginTop: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
    carteActive: { borderColor: colors.primary },
    titreMois: { fontSize: 16, fontWeight: '700', color: colors.text },
    statut: { fontSize: 12.5, color: colors.textMuted, marginTop: 3 },
    statutCloture: { color: colors.primary, fontWeight: '600' },

    detail: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
    sousTitre: { fontSize: 13.5, fontWeight: '700', color: colors.text, marginTop: 8, marginBottom: 6 },
    ligne: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.bg, marginBottom: 6 },
    ligneTxt: { fontSize: 13.5, color: colors.text },
    ligneRaison: { fontSize: 12.5, color: colors.error, fontWeight: '600' },
    info: { fontSize: 12.5, color: colors.textSecondary, marginBottom: 4 },

    rangee: { flexDirection: 'row', gap: 8, marginTop: 12 },
    btnPrincipal: { marginTop: 12, minHeight: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, flexGrow: 1 },
    btnPrincipalTxt: { fontSize: 14.5, fontWeight: '700', color: '#FFFFFF' },
    btnSecondaire: { marginTop: 12, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, flexGrow: 1 },
    btnSecondaireTxt: { fontSize: 14.5, fontWeight: '700', color: colors.primary },
    btnInactif: { opacity: 0.45 },
    champ: { marginTop: 10, minHeight: 64, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, color: colors.text, backgroundColor: colors.bg, fontSize: 14 },
    erreur: { marginTop: 10, fontSize: 13, color: colors.error, fontWeight: '600' },
    export: { marginTop: 16, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
    puces: { gap: 8, paddingVertical: 4 },
    puce: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.bg },
    puceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    puceTxt: { fontSize: 13, color: colors.text },
    puceTxtActive: { color: '#FFFFFF', fontWeight: '700' },
  })
}

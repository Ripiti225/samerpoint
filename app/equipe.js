// ──────────────────────────────────────────────────────────────────────────────
// Équipe globale — fusion de l'ancienne « Équipe globale » et de l'écran
// « Ressources Humaines » (design RH modernisé).
// Tous les restaurants ou un seul, période, recherche ; onglets Dashboard,
// Travailleurs, Présences, Salaires, Archivés ; fiche complète du travailleur.
// Logique pure : lib/equipe.js — Base : lib/equipeDb.js — Morceaux : components/equipe/
// ──────────────────────────────────────────────────────────────────────────────
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import * as XLSX from 'xlsx'
import FicheTravailleur from '../components/equipe/FicheTravailleur'
import FormulaireDemande from '../components/contrats/FormulaireDemande'
import { ModalArchive, ModalCalendrier, ModalDroitsDus, ModalFormTravailleur, ModalTransfert } from '../components/equipe/Modales'
import OngletArchives from '../components/equipe/OngletArchives'
import OngletDashboard from '../components/equipe/OngletDashboard'
import OngletPresences from '../components/equipe/OngletPresences'
import OngletSalaires from '../components/equipe/OngletSalaires'
import OngletTravailleurs from '../components/equipe/OngletTravailleurs'
import { makeStyles } from '../components/equipe/styles'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import {
  BLEU, ONGLETS, PERIODES, correspondRecherche, feuillesExcel, lignesPaiesGerant, plageDates, statsGlobales,
  rattacherPaiesGerant, statsParTravailleur, tauxParRestaurant, titrePeriode,
} from '../lib/equipe'
import { chargerTousTravailleurs } from '../lib/contratsSignesDb'
import * as db from '../lib/equipeDb'
import { aujourdhuiISO } from '../lib/contrats'
import { proposerDroits } from '../lib/droitsAnciensTravailleurs'
import { creerDroitAncien } from '../lib/droitsAnciensTravailleursDb'
import { completerPresences } from '../lib/joursRepos'
import { supabase } from '../lib/supabase'
import { enregistrer } from '../lib/exportRapportMensuel'

export default function EquipeScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { roleActif, isManager, userId, userNom } = useApp() ?? {}
  const params = useLocalSearchParams()

  // Lecture seule pour les rôles à qui la tuile a été donnée dans Paramètres.
  const peutEditer = isManager || ['manager', 'directeur', 'rh'].includes(roleActif)
  const peutSupprimer = isManager || roleActif === 'directeur'

  const [restaurants, setRestaurants] = useState([])
  const [restoId, setRestoId] = useState(typeof params.restaurant_id === 'string' ? params.restaurant_id : null) // null = Tous
  const [onglet, setOnglet] = useState('Dashboard')
  const [periodeKey, setPeriodeKey] = useState('month')
  const [perso, setPerso] = useState({})
  const [recherche, setRecherche] = useState('')

  const [travailleurs, setTravailleurs] = useState([])
  const [presences, setPresences] = useState([])
  const [paiesGerant, setPaiesGerant] = useState([])
  const [points, setPoints] = useState([])
  const [analyse, setAnalyse] = useState(false)
  const [archives, setArchives] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingArchives, setLoadingArchives] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [fiche, setFiche] = useState(null)
  const [form, setForm] = useState({ visible: false, edition: null })   // modification d'une fiche
  // Ajout : le formulaire complet du gérant (identité, CNI, papiers), en direct.
  const [ajout, setAjout] = useState(false)
  const [connus, setConnus] = useState([])                              // actifs et archivés, pour les doublons
  const [aArchiver, setAArchiver] = useState(null)
  const [aTransferer, setATransferer] = useState(null)
  const [droitsDus, setDroitsDus] = useState(null)   // { trav, motif } après archivage d'un CDI
  const [calendrier, setCalendrier] = useState(false)

  const tous = restoId === null
  const resto = restaurants.find(r => r.id === restoId) || null
  const restoParId = useMemo(() => Object.fromEntries(restaurants.map(r => [r.id, r])), [restaurants])
  const nomResto = useCallback(id => restoParId[id]?.nom || '', [restoParId])
  const plage = useMemo(() => plageDates(periodeKey, perso), [periodeKey, perso])
  const titre = titrePeriode(periodeKey, perso)

  useEffect(() => { db.chargerRestaurants().then(setRestaurants).catch(() => {}) }, [])

  const charger = useCallback(async () => {
    if (!plage) return
    setLoading(true)
    try {
      const [t, p, g, pts] = await Promise.all([
        db.chargerTravailleurs(restoId),
        db.chargerPresences(plage, restoId),
        db.chargerPaiesGerant(plage, restoId),
        db.chargerPoints(plage, restoId),
      ])
      setTravailleurs(t); setPresences(p); setPaiesGerant(g); setPoints(pts)
    } catch {
      Alert.alert('Erreur', 'Impossible de charger les données. Vérifiez la connexion.')
    }
    setLoading(false)
  }, [restoId, plage])

  // Les fiches connues (archivées comprises) servent à repérer un ancien
  // employé qui revient : réactiver sa fiche plutôt que d'en créer une.
  function ouvrirAjout() {
    setAjout(true)
    chargerTousTravailleurs().then(setConnus).catch(() => setConnus([]))
  }

  const chargerArchives = useCallback(async () => {
    setLoadingArchives(true)
    setArchives(await db.chargerArchives(restoId).catch(() => []))
    setLoadingArchives(false)
  }, [restoId])

  useEffect(() => { charger() }, [charger])
  useEffect(() => { if (onglet === 'Archivés') chargerArchives() }, [onglet, chargerArchives])

  // Le POS ne transmet que les présences : les jours d'ouverture non pointés
  // deviennent Repos / Absent / Non pointé selon le jour de repos (lib/joursRepos.js).
  const presencesCompletes = useMemo(
    () => completerPresences({ presences, travailleurs, points, aujourdhui: aujourdhuiISO() }),
    [presences, travailleurs, points],
  )

  // ── Recherche (nom, poste) appliquée à tous les onglets ──
  const travFiltres = useMemo(
    () => travailleurs.filter(t => correspondRecherche(recherche, t.nom, t.poste)),
    [travailleurs, recherche],
  )
  const presFiltrees = useMemo(
    () => (recherche ? presencesCompletes.filter(p => correspondRecherche(recherche, p.travailleur_nom)) : presencesCompletes),
    [presencesCompletes, recherche],
  )
  const paiesFiltrees = useMemo(
    () => (recherche ? paiesGerant.filter(d => correspondRecherche(recherche, d.libelle)) : paiesGerant),
    [paiesGerant, recherche],
  )
  const archivesFiltrees = useMemo(
    () => archives.filter(t => correspondRecherche(recherche, t.nom, t.poste)),
    [archives, recherche],
  )

  const travParId = useMemo(() => Object.fromEntries(travailleurs.map(t => [t.id, t])), [travailleurs])
  // Salaires payés par le gérant, rattachés à la fiche de chaque travailleur.
  const paiesRattachees = useMemo(() => rattacherPaiesGerant(paiesFiltrees, travailleurs), [paiesFiltrees, travailleurs])
  const stats = useMemo(
    () => statsParTravailleur(travFiltres, presFiltrees, paiesRattachees).map(s => ({ ...s, photo_url: travParId[s.id]?.photo_url })),
    [travFiltres, presFiltrees, paiesRattachees, travParId],
  )
  const statsParId = useMemo(() => Object.fromEntries(stats.map(s => [s.id, s])), [stats])
  const globales = useMemo(() => statsGlobales(travFiltres, presFiltrees, paiesFiltrees), [travFiltres, presFiltrees, paiesFiltrees])
  const tauxRestos = useMemo(() => (tous ? tauxParRestaurant(restaurants, presFiltrees) : []), [tous, restaurants, presFiltrees])
  // Seules les paies sans fiche retrouvée restent à part.
  const lignesGerant = useMemo(
    () => lignesPaiesGerant(paiesRattachees.filter(d => !d.travailleur_id), nomResto),
    [paiesRattachees, nomResto],
  )

  // ── Actions ──
  // Depuis une ligne de stats : le travailleur peut être parti (archivé ou
  // transféré hors du restaurant affiché) ; on ouvre alors une fiche minimale.
  // Recherche globale : ouvre la fiche du travailleur cherché (archivé compris).
  const ficheRechercheTraitee = useRef(false)
  useEffect(() => {
    if (loading || ficheRechercheTraitee.current || typeof params.focus !== 'string') return
    ficheRechercheTraitee.current = true
    if (travParId[params.focus]) ouvrirFiche(params.focus)
    else {
      supabase.from('travailleurs').select('*').eq('id', params.focus).maybeSingle()
        .then(({ data }) => { if (data) ouvrirFiche(data.id, data) })
    }
  }, [loading, travParId]) // eslint-disable-line react-hooks/exhaustive-deps

  function ouvrirFiche(id, repli) {
    setFiche(travParId[id] || { id, nom: repli?.nom, poste: repli?.poste, restaurant_id: repli?.restaurant_id, actif: false })
  }

  async function archiver(trav, motif, badgeRendu) {
    await db.archiverTravailleur(trav, motif, badgeRendu)
    setAArchiver(null); setFiche(null)
    charger()
    // CDI : ses droits de fin de contrat se saisissent tout de suite.
    if (proposerDroits(trav)) setDroitsDus({ trav, motif })
    else Alert.alert('Archivé', `${trav.nom} a été archivé.`)
  }

  async function enregistrerDroits(montant) {
    const { trav, motif } = droitsDus
    try {
      await creerDroitAncien({
        restaurantId: trav.restaurant_id, nom: trav.nom, travailleurId: trav.id,
        departLe: aujourdhuiISO(), motif, montant,
      }, { userId, userNom })
      setDroitsDus(null)
      Alert.alert('Enregistré', `${trav.nom} a été archivé. Ses droits sont dans Trésorerie → À payer → Anciens travailleurs.`)
    } catch (e) {
      Alert.alert('Droits non enregistrés', `${trav.nom} est bien archivé. ${e?.message || 'Réessayez depuis Trésorerie → À payer.'}`)
    }
  }

  async function transferer(trav, cible) {
    await db.transfererTravailleur(trav, cible)
    setATransferer(null); setFiche(null)
    charger()
    Alert.alert('Transféré', `${trav.nom} a été transféré vers ${cible.nom}.`)
  }

  async function reactiver(trav) {
    await db.reactiverTravailleur(trav)
    chargerArchives(); charger()
    Alert.alert('Réactivé', `${trav.nom} a été réactivé.`)
  }

  function supprimer(trav) {
    setAArchiver(null)
    Alert.alert(
      '⚠️ Suppression définitive',
      `Supprimer définitivement ${trav.nom} ? Sa fiche, ses documents et ses contrats seront effacés. Ses présences et salaires passés restent dans les points. Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer définitivement', style: 'destructive',
          onPress: () => Alert.alert('Dernière confirmation', `Confirmer la suppression de ${trav.nom} ?`, [
            { text: 'Annuler', style: 'cancel' },
            {
              text: 'Oui, supprimer', style: 'destructive',
              onPress: async () => {
                await db.supprimerTravailleur(trav)
                setFiche(null)
                chargerArchives(); charger()
                Alert.alert('Supprimé', `${trav.nom} a été supprimé définitivement.`)
              },
            },
          ]),
        },
      ],
    )
  }

  async function analyserJoursRepos() {
    setAnalyse(true)
    try {
      const r = await db.lancerAnalyseJoursRepos()
      const lignes = [
        r.nouveaux && `${r.nouveaux} jour(s) de repos trouvé(s)`,
        r.changes && `${r.changes} jour(s) de repos changé(s)`,
        r.confirmes && `${r.confirmes} confirmé(s), inchangé(s)`,
        r.manuels && `${r.manuels} fixé(s) à la main, non touché(s)`,
        r.sansJour && `${r.sansJour} sans jour de repos net (non touché(s))`,
        r.pasAssez && `${r.pasAssez} avec trop peu de semaines de données (non touché(s))`,
      ].filter(Boolean)
      Alert.alert('Analyse des jours de repos', `12 dernières semaines :\n\n${lignes.join('\n')}`)
      charger()
    } catch {
      Alert.alert('Erreur', "L'analyse a échoué. Vérifiez la connexion et réessayez.")
    }
    setAnalyse(false)
  }

  async function exporterExcel() {
    setExporting(true)
    try {
      const { resume, detail, salaires } = feuillesExcel({
        travailleurs: travFiltres, presences: presFiltrees, paiesGerant: paiesFiltrees, tous, nomResto,
      })
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resume), 'Résumé')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), 'Présences')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salaires), 'Salaires')
      const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
      const nom = `Equipe_${tous ? 'Tous' : resto?.nom}_${plage.debut}_${plage.fin}.xlsx`.replace(/\s+/g, '_')
      await enregistrer(nom, { base64 }, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    } catch (e) {
      Alert.alert('Erreur', `Impossible d'exporter : ${e.message}`)
    }
    setExporting(false)
  }

  const sousTitre = tous ? 'Tous les restaurants' : resto?.nom || ''

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/accueil'))}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: 8 }}>
          <Text style={styles.headerTitre}>Équipe globale</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{sousTitre}</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={() => router.replace('/login')}>
          <Text style={styles.logoutTxt}>⏻ Quitter</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Rechercher un travailleur ou un poste…"
          value={recherche}
          onChangeText={setRecherche}
          placeholderTextColor={colors.textPlaceholder}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsBar} contentContainerStyle={styles.chipsContent}>
        {[{ id: null, nom: 'Tous' }, ...restaurants].map(r => {
          const actif = restoId === r.id
          return (
            <TouchableOpacity key={r.id || 'tous'} style={[styles.chip, actif && styles.chipActive]} onPress={() => setRestoId(r.id)}>
              <Text style={[styles.chipTxt, actif && styles.chipTxtActive]}>{r.nom}</Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {onglet !== 'Archivés' && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.chipsBar, { marginTop: 8 }]} contentContainerStyle={styles.chipsContent}>
            {PERIODES.map(p => {
              const actif = periodeKey === p.key
              return (
                <TouchableOpacity key={p.key} style={[styles.chipPetit, actif && styles.chipPetitActive]}
                  onPress={() => (p.key === 'custom' ? setCalendrier(true) : setPeriodeKey(p.key))}>
                  <Text style={[styles.chipPetitTxt, actif && styles.chipPetitTxtActive]}>{p.label}</Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
          <View style={styles.periodeInfo}>
            <Text style={styles.periodeInfoTxt}>📅 {titre}</Text>
            <Text style={styles.periodeInfoSub}>{presFiltrees.filter(p => !p.deduit).length} pointage(s)</Text>
          </View>
        </>
      )}

      <View style={styles.ongletsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ongletsContent}>
          {ONGLETS.map(o => (
            <TouchableOpacity key={o} style={[styles.onglet, onglet === o && styles.ongletActive]} onPress={() => setOnglet(o)}>
              <Text style={[styles.ongletTxt, onglet === o && styles.ongletTxtActive]}>{o}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading && onglet !== 'Archivés' ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={BLEU} />
          <Text style={styles.loadingTxt}>Chargement de l'équipe…</Text>
        </View>
      ) : (
        <View style={styles.body}>
          {onglet === 'Dashboard' && (
            <OngletDashboard styles={styles} globales={globales} stats={stats} tauxRestos={tauxRestos} tous={tous}
              titre={titre} sousTitre={sousTitre} restoParId={restoParId}
              exporting={exporting} onExporter={exporterExcel} onOuvrir={ouvrirFiche} />
          )}
          {onglet === 'Travailleurs' && (
            <OngletTravailleurs styles={styles} travailleurs={travFiltres} statsParId={statsParId} tous={tous}
              peutEditer={peutEditer} recherche={recherche}
              analyse={analyse} onAnalyser={analyserJoursRepos}
              onAjouter={ouvrirAjout}
              onOuvrir={t => setFiche(t)}
              onModifier={t => setForm({ visible: true, edition: t })}
              onMenu={t => setAArchiver(t)} />
          )}
          {onglet === 'Présences' && <OngletPresences styles={styles} presences={presFiltrees} tous={tous} restoParId={restoParId} />}
          {onglet === 'Salaires' && (
            <OngletSalaires styles={styles} colors={colors} stats={stats} paiesGerant={lignesGerant} tous={tous}
              totalGerant={globales.totalPayeGerant}
              titre={titre} restoParId={restoParId} onOuvrir={ouvrirFiche} />
          )}
          {onglet === 'Archivés' && (
            <OngletArchives styles={styles} archives={archivesFiltrees} loading={loadingArchives} tous={tous}
              peutEditer={peutEditer} peutSupprimer={peutSupprimer}
              onOuvrir={t => setFiche(t)} onReactiver={reactiver} onSupprimer={supprimer} />
          )}
        </View>
      )}

      <FicheTravailleur
        visible={!!fiche && !form.visible && !aArchiver && !aTransferer}
        trav={fiche}
        resto={fiche ? restoParId[fiche.restaurant_id] : null}
        styles={styles} colors={colors} perso={perso} peutEditer={peutEditer}
        onFermer={() => setFiche(null)}
        onModifier={t => setForm({ visible: true, edition: t })}
        onTransferer={t => setATransferer(t)}
        onArchiver={t => setAArchiver(t)}
      />
      <FormulaireDemande
        direct visible={ajout} restaurants={restaurants} restoParDefaut={restoId}
        travailleursConnus={connus} ctx={{ userId: userId || null, userNom: userNom || null }}
        onFermer={() => setAjout(false)}
        onEnvoye={() => { setAjout(false); charger() }}
      />
      <ModalFormTravailleur
        visible={form.visible} edition={form.edition} restaurants={restaurants} restoParDefaut={restoId}
        styles={styles} colors={colors}
        onFermer={() => setForm({ visible: false, edition: null })}
        onEnregistre={() => { setForm({ visible: false, edition: null }); setFiche(null); charger() }}
      />
      <ModalArchive trav={aArchiver} styles={styles} peutSupprimer={peutSupprimer}
        onFermer={() => setAArchiver(null)} onArchiver={archiver} onSupprimer={supprimer} />
      <ModalDroitsDus trav={droitsDus?.trav} motif={droitsDus?.motif} styles={styles}
        onFermer={() => { const t = droitsDus?.trav; setDroitsDus(null); if (t) Alert.alert('Archivé', `${t.nom} a été archivé.`) }}
        onEnregistrer={enregistrerDroits} />
      <ModalTransfert trav={aTransferer} restaurants={restaurants} styles={styles}
        onFermer={() => setATransferer(null)} onTransferer={transferer} />
      <ModalCalendrier visible={calendrier} styles={styles} colors={colors}
        onFermer={() => setCalendrier(false)}
        onValider={p => { setPerso(p); setPeriodeKey('custom'); setCalendrier(false) }} />
    </SafeAreaView>
  )
}

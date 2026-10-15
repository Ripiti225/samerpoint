/*
 * SUPERVISION — ce que le superviseur a vu dans les restaurants.
 *
 *   Gérant ........ la fiche de son restaurant : sa note, ses tâches (« C'est
 *                   fait » avec photo), les visites (lire, répondre, contester).
 *   Manager, directeur, RH :
 *     Classement .. les restaurants par note (60 % visites + 40 % données),
 *                   ceux à visiter, contestations en attente, matériel en
 *                   panne et achats à examiner ; un restaurant ouvre sa fiche.
 *     Travailleurs  la note « terrain » de chaque travailleur vu (90 jours).
 *     Grille ...... les points notés et leur poids (manager, directeur).
 *
 * Le superviseur a son propre écran : app/superviseur.js.
 */
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, RefreshControl, SafeAreaView, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native'
import FicheRestaurant from '../components/supervision/FicheRestaurant'
import { PastilleNote, SARCELLE, TONS, dateCourte, texteJoursSansVisite } from '../components/supervision/Elements'
import { Bouton, Champ, EnTete, Feuille, Info, Libelle, Puces, useEcranModerne, Vide } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { notesTravailleurs } from '../lib/supervision'
import { chargerCriteres, chargerLignesTravailleurs, chargerRestaurants, chargerSynthese, enregistrerCritere } from '../lib/supervisionDb'

const ADMIN = ['manager', 'directeur']

export default function SupervisionScreen() {
  const { roleActif, userId, userNom, restaurantId, restaurantNom } = useApp() ?? {}
  const { styles, colors } = useEcranModerne('sarcelle')
  const retour = () => (router.canGoBack() ? router.back() : router.replace('/accueil'))

  useEffect(() => {
    if (roleActif) return
    const t = setTimeout(() => router.replace('/login'), 800)
    return () => clearTimeout(t)
  }, [roleActif])

  if (roleActif === 'gerant') {
    if (!restaurantId) return <SafeAreaView style={styles.container}><EnTete titre="Supervision" onRetour={retour} styles={styles} /></SafeAreaView>
    return (
      <SafeAreaView style={styles.container}>
        <EnTete titre="Supervision" sous={restaurantNom || undefined} onRetour={retour} styles={styles} />
        <FicheRestaurant restaurant={{ id: restaurantId, nom: restaurantNom || 'Mon restaurant' }} role="gerant"
          userId={userId} userNom={userNom} styles={styles} colors={colors} />
      </SafeAreaView>
    )
  }
  return <VueDirection role={roleActif} userId={userId} userNom={userNom} retour={retour} styles={styles} colors={colors} />
}

function VueDirection({ role, userId, userNom, retour, styles, colors }) {
  const [onglet, setOnglet] = useState('classement')
  const [resto, setResto] = useState(null)
  const onglets = [['classement', 'Classement'], ['travailleurs', 'Travailleurs'], ...(ADMIN.includes(role) ? [['grille', 'Grille']] : [])]

  if (resto) {
    return (
      <SafeAreaView style={styles.container}>
        <EnTete titre={resto.nom} sous="Supervision" onRetour={() => setResto(null)} styles={styles} />
        <FicheRestaurant restaurant={resto} role={role} userId={userId} userNom={userNom} styles={styles} colors={colors} />
      </SafeAreaView>
    )
  }
  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Supervision" sous="Visites du superviseur" onRetour={retour} styles={styles} />
      <View style={styles.ongletsWrap}>
        {onglets.map(([cle, label]) => (
          <TouchableOpacity key={cle} onPress={() => setOnglet(cle)} style={[styles.onglet, onglet === cle && styles.ongletActive]}>
            <Text style={[styles.ongletTxt, onglet === cle && styles.ongletTxtActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {onglet === 'classement' ? <Classement onOuvrir={setResto} styles={styles} colors={colors} /> : null}
      {onglet === 'travailleurs' ? <Travailleurs styles={styles} colors={colors} /> : null}
      {onglet === 'grille' ? <Grille styles={styles} colors={colors} /> : null}
    </SafeAreaView>
  )
}

// ── Classement ──────────────────────────────────────────────────────────────

function Classement({ onOuvrir, styles, colors }) {
  const [s, setS] = useState(null)
  const [erreur, setErreur] = useState(false)
  const [rafraichir, setRafraichir] = useState(false)
  const charger = useCallback(async () => {
    try { setErreur(false); setS(await chargerSynthese()) } catch { setErreur(true) }
  }, [])
  useEffect(() => { charger() }, [charger])

  const liste = useMemo(() => (s?.liste || []).slice().sort((a, b) => (b.note ?? -1) - (a.note ?? -1)), [s])
  const contestations = liste.reduce((t, r) => t + r.contestations, 0)
  const aVisiter = liste.filter(r => r.sansVisite).length
  const achatsAExaminer = liste.reduce((t, r) => t + (r.achatsAExaminer || 0), 0)

  return (
    <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={rafraichir} onRefresh={async () => { setRafraichir(true); await charger(); setRafraichir(false) }} />}>
      {!s && !erreur ? <ActivityIndicator color={SARCELLE} style={{ marginTop: 40 }} /> : null}
      {erreur ? <><Vide icone="📡" texte="Lecture impossible" sous="Vérifiez le réseau." styles={styles} /><Bouton label="Réessayer" onPress={charger} couleur={SARCELLE} styles={styles} /></> : null}
      {s ? (
        <>
          {contestations ? <Info icone="✋" styles={styles} couleur={TONS.orange} gras>{contestations} contestation{contestations > 1 ? 's' : ''} à trancher</Info> : null}
          {achatsAExaminer ? <Info icone="💡" styles={styles} couleur={TONS.orange} gras>{achatsAExaminer} suggestion{achatsAExaminer > 1 ? 's' : ''} d'achat à examiner (fiche du restaurant → Matériel)</Info> : null}
          {aVisiter ? <Info icone="📍" styles={styles} couleur={TONS.orange}>{aVisiter} restaurant{aVisiter > 1 ? 's' : ''} sans visite depuis plus de 14 jours</Info> : null}
          {s.donneesErreur ? <Info icone="ℹ️" styles={styles} couleur={TONS.orange}>Notes des caissiers indisponibles : notes calculées sans elles.</Info> : null}
          <View style={{ height: 10 }} />
          <Text style={styles.resultat}>Note sur 30 jours · 60 % visites + 40 % données</Text>
          {liste.map((r, i) => (
            <TouchableOpacity key={r.restaurant.id} onPress={() => onOuvrir(r.restaurant)} activeOpacity={0.8}
              style={[styles.carte, r.contestations > 0 && styles.carteAlerte]}>
              <View style={styles.carteTop}>
                <Text style={{ fontSize: 15, fontWeight: '900', color: colors.textMuted, width: 22 }}>{r.note === null ? '–' : i + 1}</Text>
                <PastilleNote note={r.note} petite />
                <View style={{ flex: 1 }}>
                  <Text style={styles.carteTitre}>{r.restaurant.nom}</Text>
                  <Text style={[styles.carteSous, r.sansVisite && { color: TONS.orange, fontWeight: '700' }]}>{texteJoursSansVisite(r)}</Text>
                  <Text style={styles.carteSous}>
                    {r.tachesOuvertes ? `${r.tachesOuvertes} tâche${r.tachesOuvertes > 1 ? 's' : ''} ouverte${r.tachesOuvertes > 1 ? 's' : ''}` : 'Aucune tâche ouverte'}
                    {r.contestations ? ` · ✋ ${r.contestations} contestée${r.contestations > 1 ? 's' : ''}` : ''}
                    {r.pannesOuvertes ? ` · 🔧 ${r.pannesOuvertes} en panne` : ''}
                    {r.achatsAExaminer ? ` · 💡 ${r.achatsAExaminer} achat${r.achatsAExaminer > 1 ? 's' : ''}` : ''}
                  </Text>
                </View>
                <Text style={{ fontSize: 20, color: colors.textMuted }}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      ) : null}
    </ScrollView>
  )
}

// ── Travailleurs ────────────────────────────────────────────────────────────

function Travailleurs({ styles, colors }) {
  const [lignes, setLignes] = useState(null)
  const [restos, setRestos] = useState([])
  const [filtre, setFiltre] = useState(null)
  const [erreur, setErreur] = useState(false)
  useEffect(() => {
    (async () => {
      try {
        const [l, s] = await Promise.all([chargerLignesTravailleurs(), chargerRestaurants()])
        setLignes(l); setRestos(s)
      } catch { setErreur(true) }
    })()
  }, [])
  const notes = useMemo(() => notesTravailleurs(lignes || []).filter(t => !filtre || t.restaurantId === filtre), [lignes, filtre])
  const nomResto = id => restos.find(r => r.id === id)?.nom || ''

  if (erreur) return <View style={styles.body}><Vide icone="📡" texte="Lecture impossible" styles={styles} /></View>
  if (!lignes) return <ActivityIndicator color={SARCELLE} style={{ marginTop: 40 }} />
  return (
    <View style={{ flex: 1 }}>
      <Puces ligne petit styles={styles} actif={filtre} onChoisir={c => setFiltre(c === filtre ? null : c)}
        elements={[{ cle: null, label: 'Tous' }, ...restos.map(r => ({ cle: r.id, label: r.nom }))]} />
      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.resultat}>Notes terrain · 90 derniers jours · les plus basses d'abord</Text>
        {!notes.length ? <Vide icone="👥" texte="Aucun travailleur noté" sous="Le superviseur note les travailleurs qu'il voit pendant ses visites." styles={styles} /> : null}
        {notes.map(t => (
          <View key={t.cle} style={styles.carte}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.carteTitre}>{t.nom}</Text>
                <Text style={styles.carteSous}>{[t.poste, nomResto(t.restaurantId)].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={{ fontSize: 18, fontWeight: '900', color: t.moyenne === null ? colors.textMuted : t.moyenne >= 4 ? TONS.vert : t.moyenne >= 3 ? TONS.orange : TONS.rouge }}>
                {t.moyenne === null ? '—' : String(t.moyenne).replace('.', ',')}<Text style={{ fontSize: 12, color: '#F5A524' }}> ★</Text>
              </Text>
            </View>
            <Text style={styles.carteSous}>
              Vu {t.nbVisites} fois{t.retards ? ` · ⏰ ${t.retards} retard${t.retards > 1 ? 's' : ''}` : ''}{t.absences ? ` · 🚫 ${t.absences} absence${t.absences > 1 ? 's' : ''}` : ''} · dernière fois le {dateCourte(t.derniereDate)}
            </Text>
            {t.dernierCommentaire ? <Text style={styles.citation}>{t.dernierCommentaire}</Text> : null}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

// ── Grille ──────────────────────────────────────────────────────────────────

const CRITERE_VIDE = { libelle: '', aide: '', poids: 2, ordre: 0, actif: true }

function Grille({ styles, colors }) {
  const [criteres, setCriteres] = useState(null)
  const [form, setForm] = useState(null)
  const [envoi, setEnvoi] = useState(false)
  const charger = useCallback(async () => {
    try { setCriteres(await chargerCriteres({ tous: true })) } catch { setCriteres([]) }
  }, [])
  useEffect(() => { charger() }, [charger])

  async function enregistrer(c) {
    if (!String(c.libelle || '').trim()) { Alert.alert('Nom manquant', 'Donnez un nom au point à noter.'); return }
    setEnvoi(true)
    try { await enregistrerCritere(c); setForm(null); await charger() }
    catch { Alert.alert('Erreur', "Le point n'a pas pu être enregistré.") } finally { setEnvoi(false) }
  }

  if (!criteres) return <ActivityIndicator color={SARCELLE} style={{ marginTop: 40 }} />
  const totalPoids = criteres.filter(c => c.actif).reduce((s, c) => s + c.poids, 0)
  return (
    <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.carteSous}>Chaque point est noté de 1 à 5 étoiles. Le poids dit combien il compte dans la note /20 de la visite. Un point retiré reste dans les visites passées.</Text>
      <View style={{ height: 12 }} />
      {criteres.map(c => (
        <TouchableOpacity key={c.id} onPress={() => setForm({ ...c })} activeOpacity={0.8} style={[styles.carte, !c.actif && { opacity: 0.55 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.carteTitre}>{c.libelle}</Text>
              {c.aide ? <Text style={styles.carteSous}>{c.aide}</Text> : null}
            </View>
            <Text style={{ fontSize: 13, fontWeight: '800', color: SARCELLE }}>
              {c.actif ? `poids ${c.poids} · ${totalPoids ? Math.round((c.poids / totalPoids) * 100) : 0} %` : 'retiré'}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
      <Bouton label="＋ Ajouter un point" onPress={() => setForm({ ...CRITERE_VIDE, ordre: criteres.length + 1 })} couleur={SARCELLE} grand styles={styles} />

      <Feuille visible={!!form} titre={form?.id ? 'Modifier le point' : 'Nouveau point'} onFermer={() => setForm(null)} styles={styles}>
        {form ? (
          <>
            <Libelle styles={styles}>Nom</Libelle>
            <Champ styles={styles} colors={colors} value={form.libelle} onChangeText={v => setForm(p => ({ ...p, libelle: v }))} placeholder="Ex. : Propreté et hygiène" />
            <Libelle styles={styles}>Ce qu'il faut regarder</Libelle>
            <Champ styles={styles} colors={colors} value={form.aide || ''} onChangeText={v => setForm(p => ({ ...p, aide: v }))} placeholder="Ex. : salle, cuisine, toilettes" />
            <Libelle styles={styles}>Poids</Libelle>
            <Puces styles={styles} actif={form.poids} onChoisir={v => setForm(p => ({ ...p, poids: v }))}
              elements={[1, 2, 3, 4, 5].map(v => ({ cle: v, label: String(v) }))} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 14, color: colors.text, fontWeight: '600' }}>Point utilisé dans les visites</Text>
              <Switch value={!!form.actif} onValueChange={v => setForm(p => ({ ...p, actif: v }))} trackColor={{ true: SARCELLE }} />
            </View>
            <Bouton label={envoi ? 'Enregistrement…' : 'Enregistrer'} onPress={() => enregistrer(form)} couleur={SARCELLE} variante="plein" grand disabled={envoi} styles={styles} />
          </>
        ) : null}
      </Feuille>
    </ScrollView>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Écran Contrats — une ligne par travailleur, sur le contrat qui fait foi.
//
// Un travailleur qui a enchaîné trois stages n'apparaît qu'une fois, sur le
// stage en cours. Ses contrats précédents sont dans sa fiche : ils comptent
// comme historique, pas comme lignes à traiter.
//
// Le filtre « Sans contrat » est le seul à lister des travailleurs plutôt que
// des contrats — c'est la liste de ce qui reste à faire.
// ──────────────────────────────────────────────────────────────────────────────
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native'

import FicheContrat from '../components/FicheContrat'
import FormulaireContrat from '../components/FormulaireContrat'
import SelecteurTravailleur from '../components/SelecteurTravailleur'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import {
  aujourdhuiISO, contratAffiche, formatFR, joursRestants, ordinalFR,
  rangParType, statutContrat,
} from '../lib/contrats'
import { journaliser } from '../lib/journal'
import { creerNotification } from '../lib/notificationsInterne'
import { supabase } from '../lib/supabase'

const FILTRES = ['Travailleurs', 'Expire bientôt', 'En cours', 'Expirés', 'Sans contrat']
const SEUIL_BADGE_JOURS = 30

export default function ContratsScreen() {
  const { colors } = useTheme()
  const { userId, userNom } = useApp() ?? {}
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [restaurants, setRestaurants] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [contrats, setContrats] = useState([])
  const [loading, setLoading] = useState(true)

  const [recherche, setRecherche] = useState('')
  const [filtreResto, setFiltreResto] = useState('tous')
  const [filtreEtat, setFiltreEtat] = useState('Travailleurs')

  const [ficheVisible, setFicheVisible] = useState(false)
  const [travSelectionne, setTravSelectionne] = useState(null)
  const [selecteurVisible, setSelecteurVisible] = useState(false)
  const [formVisible, setFormVisible] = useState(false)
  const [contratEdite, setContratEdite] = useState(null)

  const jour = aujourdhuiISO()

  useEffect(() => {
    charger()
  }, [])

  async function charger() {
    setLoading(true)
    const { data: restos } = await supabase
      .from('restaurants').select('id, nom').order('nom')
    setRestaurants(restos || [])

    // .range explicite : sans lui, PostgREST tronque silencieusement à 1000
    // lignes. Le piège a déjà coûté cher sur d'autres écrans.
    const { data: travs } = await supabase
      .from('travailleurs')
      .select('*, restaurants(nom)')
      .neq('statut', 'archive')
      .order('nom')
      .range(0, 4999)
    setTravailleurs(travs || [])

    const { data: ctrs } = await supabase
      .from('contrats_travailleurs')
      .select('*')
      .order('date_debut', { ascending: true })
      .range(0, 4999)
    setContrats(ctrs || [])

    setLoading(false)
  }

  function contratsDe(travailleurId) {
    return contrats.filter(c => c.travailleur_id === travailleurId)
  }

  // Une ligne par travailleur : son contrat courant, ou null s'il n'en a aucun.
  const lignes = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    return travailleurs
      .filter(t => t.actif !== false)
      .filter(t => filtreResto === 'tous' || t.restaurant_id === filtreResto)
      .filter(t => !terme || t.nom?.toLowerCase().includes(terme))
      .map(t => {
        const siens = contrats.filter(c => c.travailleur_id === t.id)
        return { travailleur: t, contrat: contratAffiche(siens, jour), total: siens.length }
      })
  }, [travailleurs, contrats, filtreResto, recherche, jour])

  function badge(contrat) {
    if (!contrat || contrat.cloture_le || !contrat.date_fin) return null
    if (statutContrat(contrat, jour) !== 'en_cours') return null
    const restants = joursRestants(contrat, jour)
    if (restants === null || restants < 0 || restants > SEUIL_BADGE_JOURS) return null
    if (restants === 0) return { texte: 'Dernier jour', couleur: '#993C1D' }
    return { texte: `Expire dans ${restants} j`, couleur: restants <= 7 ? '#993C1D' : '#854F0B' }
  }

  const compteurs = useMemo(() => {
    let expire = 0, enCours = 0, sans = 0
    for (const l of lignes) {
      if (!l.contrat) { sans++; continue }
      const s = statutContrat(l.contrat, jour)
      if (s === 'en_cours' || s === 'a_venir') enCours++
      if (badge(l.contrat)) expire++
    }
    return { expire, enCours, sans }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lignes, jour])

  const affichees = lignes.filter(l => {
    // L'onglet « Travailleurs » montre tout l'effectif du restaurant choisi,
    // avec ou sans contrat : c'est la vue d'entrée, celle où l'on cherche
    // quelqu'un par son nom plutôt que par l'état de son contrat.
    if (filtreEtat === 'Travailleurs') return true
    // Aucune exception de type : un journalier sans contrat est un travailleur
    // sans contrat, tant qu'on ne lui en a pas enregistré un.
    if (filtreEtat === 'Sans contrat') return !l.contrat
    if (!l.contrat) return false
    const s = statutContrat(l.contrat, jour)
    if (filtreEtat === 'En cours') return s === 'en_cours' || s === 'a_venir'
    if (filtreEtat === 'Expirés') return s === 'expire' || s === 'rompu'
    return badge(l.contrat) !== null   // Expire bientôt
  })

  // Une carte « Sans contrat » ouvre la fiche du travailleur, d'où le bouton
  // « + Enregistrer un contrat » mène droit au formulaire : le sélecteur de
  // travailleur est bien sauté, puisqu'on sait déjà de qui il s'agit.
  function ouvrirFiche(travailleur) {
    setTravSelectionne(travailleur)
    setFicheVisible(true)
  }

  function nouveauContratPour(travailleur) {
    setTravSelectionne(travailleur)
    setContratEdite(null)
    setSelecteurVisible(false)
    setFormVisible(true)
  }

  const contexteJournal = { userId: userId || null, userNom: userNom || null }

  function messageErreur(error) {
    const txt = String(error?.message || '')
    if (txt.includes('contrats_sans_chevauchement')) {
      return 'Ce travailleur a déjà un contrat sur cette période. Vérifie les dates.'
    }
    // Deux noms possibles : `contrat_duree_bornee` après la migration des durées
    // libres, `contrats_travailleurs_duree_mois_check` tant qu'elle n'est pas
    // passée. Sans le second, un contrat de 4 mois renvoyait un message générique
    // qui n'expliquait rien.
    if (txt.includes('duree_mois') || txt.includes('contrat_duree_bornee')) {
      return 'Cette durée est refusée par la base. Si la migration des durées libres n\'a pas encore été passée, seules 3, 6 et 12 mois sont acceptées.'
    }
    if (txt.includes('contrat_cdi_sans_fin')) {
      return "Un CDI n'a pas de date de fin, et un Stage ou un CDD doit en avoir une."
    }
    return "Impossible d'enregistrer. Vérifie ta connexion et réessaie."
  }

  async function enregistrerContrat(contrat) {
    const trav = travSelectionne
    if (!trav) return

    if (contratEdite) {
      const { error } = await supabase.from('contrats_travailleurs')
        .update({
          type: contrat.type,
          date_debut: contrat.date_debut,
          date_fin: contrat.date_fin,
          duree_mois: contrat.duree_mois,
          photo_url: contrat.photo_url,
          photo_type: contrat.photo_type,
        })
        .eq('id', contratEdite.id)
      if (error) { Alert.alert('Correction impossible', messageErreur(error)); return }

      journaliser('CONTRAT_CORRIGE', {
        travailleur: trav.nom,
        contrat_id: contratEdite.id,
        avant: { type: contratEdite.type, date_debut: contratEdite.date_debut, date_fin: contratEdite.date_fin },
        apres: { type: contrat.type, date_debut: contrat.date_debut, date_fin: contrat.date_fin },
      }, { ...contexteJournal, restaurantId: trav.restaurant_id || null }).catch(() => {})
    } else {
      const { error } = await supabase.from('contrats_travailleurs').insert({
        travailleur_id: trav.id,
        restaurant_id: trav.restaurant_id || null,
        type: contrat.type,
        date_debut: contrat.date_debut,
        date_fin: contrat.date_fin,
        duree_mois: contrat.duree_mois,
        photo_url: contrat.photo_url,
        photo_type: contrat.photo_type,
        cree_par: userId || null,
      })
      if (error) { Alert.alert('Contrat non enregistré', messageErreur(error)); return }

      // La colonne s'appelle `description` : documents_travailleurs n'a pas de
      // colonne fichier_type, c'est là que le reste de l'app range le format.
      await supabase.from('documents_travailleurs').insert({
        travailleur_id: trav.id,
        type_document: 'Contrat',
        fichier_url: contrat.photo_url,
        description: contrat.photo_type === 'pdf' ? 'pdf' : 'image',
      }).then(() => {}, () => {})

      await supabase.from('travailleurs')
        .update({ type_contrat: contrat.type })
        .eq('id', trav.id)

      creerNotification({
        type: 'contrat_ajoute',
        titre: '📝 Contrat enregistré',
        message: `${contrat.type} pour ${trav.nom}${contrat.date_fin ? ` — jusqu'au ${formatFR(contrat.date_fin)}` : ''}`,
        restaurant_id: trav.restaurant_id || null,
        cible_role: ['manager', 'directeur'],
        screen: 'contrats',
      }).catch(() => {})
    }

    setFormVisible(false)
    setContratEdite(null)
    await charger()
  }

  async function rompreContrat(contrat, dateCloture, motif) {
    const trav = travSelectionne
    const { error } = await supabase.from('contrats_travailleurs')
      .update({ cloture_le: dateCloture, cloture_motif: motif })
      .eq('id', contrat.id)
    if (error) {
      Alert.alert('Rupture impossible',
        `La date de rupture doit être comprise entre le ${formatFR(contrat.date_debut)} et le ${formatFR(contrat.date_fin)}.`)
      return
    }
    journaliser('CONTRAT_ROMPU', {
      travailleur: trav?.nom, contrat_id: contrat.id, type: contrat.type,
      cloture_le: dateCloture, motif,
    }, { ...contexteJournal, restaurantId: trav?.restaurant_id || null }).catch(() => {})

    creerNotification({
      type: 'contrat_rompu',
      titre: '⛔ Contrat rompu',
      message: `${contrat.type} de ${trav?.nom} rompu au ${formatFR(dateCloture)} — ${motif}`,
      restaurant_id: trav?.restaurant_id || null,
      cible_role: ['manager', 'directeur'],
      screen: 'contrats',
    }).catch(() => {})

    await charger()
  }

  async function supprimerContrat(contrat) {
    const trav = travSelectionne
    await supabase.from('contrats_travailleurs').delete().eq('id', contrat.id)
    // On efface la ligne de document qui pointe le même fichier. Le fichier
    // lui-même reste dans le stockage : une autre ligne pourrait le référencer.
    if (contrat.photo_url) {
      await supabase.from('documents_travailleurs')
        .delete()
        .eq('travailleur_id', contrat.travailleur_id)
        .eq('fichier_url', contrat.photo_url)
    }
    journaliser('CONTRAT_SUPPRIME', {
      travailleur: trav?.nom, contrat_id: contrat.id, type: contrat.type,
      date_debut: contrat.date_debut, date_fin: contrat.date_fin,
    }, { ...contexteJournal, restaurantId: trav?.restaurant_id || null }).catch(() => {})
    await charger()
  }

  // Le pied de carte répond à une seule question : cette personne a-t-elle un
  // contrat valable aujourd'hui ? Un contrat terminé n'en est pas un.
  function pied(l) {
    const c = l.contrat
    if (!c) return { txt: '⚠ Aucun contrat', couleur: '#993C1D' }
    const s = statutContrat(c, jour)
    if (s === 'en_cours') return { txt: '✓ Sous contrat', couleur: '#3B6D11' }
    if (s === 'a_venir') return { txt: '✓ Contrat à venir', couleur: '#185FA5' }
    return { txt: '⚠ Contrat terminé — à renouveler', couleur: '#993C1D' }
  }

  function renderLigne(l) {
    const c = l.contrat
    const b = badge(c)
    const pd = pied(l)
    const rang = c ? rangParType(contratsDe(l.travailleur.id), c) : 0
    const statut = c ? statutContrat(c, jour) : null

    return (
      <TouchableOpacity key={l.travailleur.id} style={styles.card} onPress={() => ouvrirFiche(l.travailleur)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.nom}>{l.travailleur.nom}</Text>
          <Text style={styles.sous}>
            {l.travailleur.restaurants?.nom || 'Sans restaurant'} · {l.travailleur.poste || 'Sans poste'}
          </Text>

          {c ? (
            <>
              <Text style={styles.contratLigne}>
                {c.type}{rang > 0 ? ` · ${ordinalFR(rang)} contrat` : ''}
                {c.date_fin
                  ? ` · ${formatFR(c.date_debut)} → ${formatFR(c.date_fin)}`
                  : ` · depuis le ${formatFR(c.date_debut)}`}
              </Text>
              {statut === 'a_venir' && (
                <Text style={styles.mention}>Débute le {formatFR(c.date_debut)}</Text>
              )}
              {(statut === 'expire' || statut === 'rompu') && (() => {
                const suivant = contratsDe(l.travailleur.id)
                  .filter(x => statutContrat(x, jour) === 'a_venir')
                  .sort((a, b2) => (a.date_debut < b2.date_debut ? -1 : 1))[0]
                return suivant
                  ? <Text style={styles.mention}>Suite prévue le {formatFR(suivant.date_debut)}</Text>
                  : <Text style={styles.mentionAlerte}>À renouveler</Text>
              })()}
              {l.total > 1 && (
                <Text style={styles.historique}>{l.total} contrats ›</Text>
              )}
            </>
          ) : (
            <Text style={styles.mention}>Aucun contrat enregistré</Text>
          )}

          <Text style={[styles.pied, { color: pd.couleur }]}>{pd.txt}</Text>
        </View>

        {b && (
          <View style={[styles.badge, { backgroundColor: b.couleur }]}>
            <Text style={styles.badgeTxt}>{b.texte}</Text>
          </View>
        )}
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/accueil')
        }}>
          <Text style={styles.back}>‹ Retour</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitre}>Contrats</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Rechercher un travailleur…"
          value={recherche}
          onChangeText={setRecherche}
          placeholderTextColor="#bbb"
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.filtreBar, { flexGrow: 0 }]}>
        <TouchableOpacity
          style={[styles.filtreBtn, filtreResto === 'tous' && styles.filtreBtnActive]}
          onPress={() => setFiltreResto('tous')}
        >
          <Text style={[styles.filtreTxt, filtreResto === 'tous' && styles.filtreTxtActive]}>Tous</Text>
        </TouchableOpacity>
        {restaurants.map(r => (
          <TouchableOpacity
            key={r.id}
            style={[styles.filtreBtn, filtreResto === r.id && styles.filtreBtnActive]}
            onPress={() => setFiltreResto(r.id)}
          >
            <Text style={[styles.filtreTxt, filtreResto === r.id && styles.filtreTxtActive]}>{r.nom}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#185FA5" />
          <Text style={styles.loadingTxt}>Chargement des contrats…</Text>
        </View>
      ) : (
        <ScrollView style={styles.body}>
          <Text style={styles.resume}>
            {lignes.length} travailleur{lignes.length > 1 ? 's' : ''} · {compteurs.expire} expirent bientôt · {compteurs.sans} sans contrat
          </Text>

          <View style={styles.etatBar}>
            {FILTRES.map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.etatBtn, filtreEtat === f && styles.etatBtnActive]}
                onPress={() => setFiltreEtat(f)}
              >
                <Text style={[styles.etatTxt, filtreEtat === f && styles.etatTxtActive]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {affichees.length === 0 && (
            <Text style={styles.vide}>
              {filtreEtat === 'Travailleurs'
                ? 'Aucun travailleur ne correspond.'
                : filtreEtat === 'Expire bientôt'
                  ? "Aucun contrat n'arrive à échéance dans les 30 jours."
                  : filtreEtat === 'Sans contrat'
                    ? 'Tous les travailleurs ont un contrat.'
                    : 'Rien à afficher.'}
            </Text>
          )}

          {affichees.map(renderLigne)}
          <View style={{ height: 90 }} />
        </ScrollView>
      )}

      <TouchableOpacity style={styles.fab} onPress={() => setSelecteurVisible(true)}>
        <Text style={styles.fabTxt}>+ Nouveau contrat</Text>
      </TouchableOpacity>

      <SelecteurTravailleur
        visible={selecteurVisible}
        travailleurs={travailleurs}
        restaurants={restaurants}
        colors={colors}
        onFermer={() => setSelecteurVisible(false)}
        onChoisir={nouveauContratPour}
      />

      <FicheContrat
        visible={ficheVisible}
        travailleur={travSelectionne}
        contrats={travSelectionne ? contratsDe(travSelectionne.id) : []}
        colors={colors}
        onFermer={() => setFicheVisible(false)}
        onRenouveler={() => { setContratEdite(null); setFormVisible(true) }}
        onCorriger={c => { setContratEdite(c); setFormVisible(true) }}
        onSupprimer={supprimerContrat}
        onRompre={rompreContrat}
      />

      <FormulaireContrat
        visible={formVisible}
        travailleur={travSelectionne}
        contratsExistants={travSelectionne ? contratsDe(travSelectionne.id) : []}
        contratEdite={contratEdite}
        colors={colors}
        onFermer={() => { setFormVisible(false); setContratEdite(null) }}
        onEnregistrer={enregistrerContrat}
      />
    </SafeAreaView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: 16, color: colors.primaryText, fontWeight: '500' },
  headerTitre: { fontSize: 16, fontWeight: '600', color: colors.surface },
  searchBar: { backgroundColor: colors.surface, padding: 10, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  searchInput: { backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 10, fontSize: 14, color: colors.text },
  filtreBar: { backgroundColor: colors.surface, maxHeight: 46, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  filtreBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  filtreBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  filtreTxt: { fontSize: 12, color: colors.textMuted },
  filtreTxtActive: { color: colors.primary, fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
  body: { flex: 1, padding: 14 },
  resume: { fontSize: 13, color: colors.textMuted, marginBottom: 12, textAlign: 'center' },
  etatBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  etatBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border },
  etatBtnActive: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  etatTxt: { fontSize: 12, color: colors.textMuted },
  etatTxtActive: { color: '#fff', fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 0.5, borderColor: colors.border },
  nom: { fontSize: 14, fontWeight: '600', color: colors.text },
  sous: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  contratLigne: { fontSize: 13, color: colors.text, marginTop: 6 },
  mention: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  mentionAlerte: { fontSize: 12, color: '#993C1D', marginTop: 4, fontWeight: '600' },
  historique: { fontSize: 12, color: '#185FA5', marginTop: 4 },
  pied: { fontSize: 12, fontWeight: '600', marginTop: 8 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeTxt: { fontSize: 11, color: '#fff', fontWeight: '600' },
  vide: { fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingVertical: 40 },
  fab: { position: 'absolute', bottom: 24, alignSelf: 'center', backgroundColor: '#185FA5', borderRadius: 24, paddingHorizontal: 22, paddingVertical: 14 },
  fabTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
}) }

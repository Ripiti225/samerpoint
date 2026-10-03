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
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import FicheContrat, { STATUTS_CONTRAT } from '../components/FicheContrat'
import FormulaireContrat from '../components/FormulaireContrat'
import SelecteurTravailleur from '../components/SelecteurTravailleur'
import Avatar from '../components/equipe/Avatar'
import { Compteurs, EnTete, Puces, Recherche, Vide, teinte, useEcranModerne } from '../components/ui/EcranModerne'
import Jauge from '../components/ui/Jauge'
import { useApp } from '../context/AppContext'
import {
  FILTRES_CONTRAT, aujourdhuiISO, compterContrats, contratAffiche, correspondFiltreContrat, expireBientot,
  formatFR, ordinalFR, progressionContrat, rangParType, resumeContrats, statutContrat,
} from '../lib/contrats'
import { journaliser } from '../lib/journal'
import { creerNotification } from '../lib/notificationsInterne'
import { supabase } from '../lib/supabase'

// Couleur de chaque compteur.
const COULEURS_FILTRES = {
  bientot: '#C27C1A', en_cours: STATUTS_CONTRAT.en_cours.couleur, expires: STATUTS_CONTRAT.expire.couleur, sans: '#C2462B',
}

export default function ContratsScreen() {
  const { userId, userNom } = useApp() ?? {}
  const { styles, colors, accent, principale } = useEcranModerne('orange')

  const [restaurants, setRestaurants] = useState([])
  const [travailleurs, setTravailleurs] = useState([])
  const [contrats, setContrats] = useState([])
  const [loading, setLoading] = useState(true)

  const [recherche, setRecherche] = useState('')
  const [filtreResto, setFiltreResto] = useState('tous')
  const [filtreEtat, setFiltreEtat] = useState('tous')

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
      .from('restaurants').select('id, nom, couleur').order('nom')
    setRestaurants(restos || [])

    // .range explicite : sans lui, PostgREST tronque silencieusement à 1000
    // lignes. Le piège a déjà coûté cher sur d'autres écrans.
    const { data: travs } = await supabase
      .from('travailleurs')
      .select('*, restaurants(nom, couleur)')
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

  const comptes = useMemo(() => compterContrats(lignes, jour), [lignes, jour])
  // Jauge « sous contrat » : le restaurant choisi, sans tenir compte de la recherche.
  const resume = useMemo(() => resumeContrats(
    travailleurs.filter(t => filtreResto === 'tous' || t.restaurant_id === filtreResto), contrats, jour,
  ), [travailleurs, contrats, filtreResto, jour])

  // L'onglet « Travailleurs » montre tout l'effectif du restaurant choisi, avec
  // ou sans contrat : c'est la vue d'entrée, celle où l'on cherche quelqu'un par
  // son nom. Aucune exception de type : un journalier sans contrat est un
  // travailleur sans contrat, tant qu'on ne lui en a pas enregistré un.
  const affichees = lignes.filter(l => correspondFiltreContrat(filtreEtat, l.contrat, jour))

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
    if (!c) return { txt: '⚠ Aucun contrat', couleur: '#C2462B' }
    const s = statutContrat(c, jour)
    if (s === 'en_cours') return { txt: '✓ Sous contrat', couleur: STATUTS_CONTRAT.en_cours.couleur }
    if (s === 'a_venir') return { txt: '✓ Contrat à venir', couleur: STATUTS_CONTRAT.a_venir.couleur }
    return { txt: '⚠ Contrat terminé — à renouveler', couleur: '#C2462B' }
  }

  function renderLigne(l) {
    const c = l.contrat
    const restants = expireBientot(c, jour)
    const pd = pied(l)
    const rang = c ? rangParType(contratsDe(l.travailleur.id), c) : 0
    const statut = c ? statutContrat(c, jour) : null
    const pct = c ? progressionContrat(c, jour) : null
    const couleurBarre = restants !== null ? (restants <= 7 ? '#C2462B' : '#C27C1A') : principale
    const suivant = (statut === 'expire' || statut === 'rompu')
      ? contratsDe(l.travailleur.id)
        .filter(x => statutContrat(x, jour) === 'a_venir')
        .sort((a, b2) => (a.date_debut < b2.date_debut ? -1 : 1))[0]
      : null

    return (
      <TouchableOpacity key={l.travailleur.id} style={styles.carte} onPress={() => ouvrirFiche(l.travailleur)} activeOpacity={0.8}>
        <View style={styles.carteTop}>
          <Avatar nom={l.travailleur.nom} photo={l.travailleur.photo_url} resto={l.travailleur.restaurants} taille={44} />
          <View style={{ flex: 1 }}>
            <Text style={styles.carteTitre}>{l.travailleur.nom}</Text>
            <Text style={styles.carteSous}>
              {l.travailleur.restaurants?.nom || 'Sans restaurant'} · {l.travailleur.poste || 'Sans poste'}
            </Text>
          </View>
          {restants !== null && (
            <View style={[styles.pastille, { marginTop: 0, backgroundColor: restants <= 7 ? '#C2462B' : '#C27C1A' }]}>
              <Text style={[styles.pastilleTxt, { color: '#fff' }]}>{restants === 0 ? 'Dernier jour' : `J-${restants}`}</Text>
            </View>
          )}
        </View>

        <View style={styles.carteCorps}>
          {c ? (
            <>
              <Text style={[styles.infoTxt, { color: colors.text, fontWeight: '700' }]}>
                {c.type}{rang > 0 ? ` · ${ordinalFR(rang)} contrat` : ''}
                <Text style={{ fontWeight: '400', color: colors.textSecondary }}>
                  {c.date_fin ? `  ${formatFR(c.date_debut)} → ${formatFR(c.date_fin)}` : `  depuis le ${formatFR(c.date_debut)}`}
                </Text>
              </Text>
              {pct !== null && statut !== 'expire' && statut !== 'rompu' && (
                <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden', marginTop: 4 }}>
                  <View style={{ height: '100%', width: `${Math.max(2, pct)}%`, borderRadius: 3, backgroundColor: couleurBarre }} />
                </View>
              )}
              {statut === 'a_venir' && <Text style={styles.infoTxt}>Débute le {formatFR(c.date_debut)}</Text>}
              {suivant ? <Text style={styles.infoTxt}>Suite prévue le {formatFR(suivant.date_debut)}</Text> : null}
            </>
          ) : (
            <Text style={styles.infoTxt}>Aucun contrat enregistré</Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <View style={[styles.pastille, { marginTop: 0, backgroundColor: teinte(pd.couleur, '1F') }]}>
            <Text style={[styles.pastilleTxt, { color: pd.couleur }]}>{pd.txt}</Text>
          </View>
          {l.total > 1 && <Text style={[styles.infoTxt, { flex: 0, color: accent, fontWeight: '700' }]}>{l.total} contrats ›</Text>}
        </View>
      </TouchableOpacity>
    )
  }

  const compteurs = FILTRES_CONTRAT.map(f => ({
    cle: f.cle, label: f.label, valeur: comptes[f.cle], couleur: COULEURS_FILTRES[f.cle] || accent,
  }))
  const restoChoisi = restaurants.find(r => r.id === filtreResto)

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Contrats" sous={restoChoisi?.nom || 'Tous les restaurants'} styles={styles}
        onRetour={() => (router.canGoBack() ? router.back() : router.replace('/accueil'))} />

      <Recherche value={recherche} onChange={setRecherche} placeholder="🔍 Rechercher un travailleur…" styles={styles} colors={colors} />
      <Puces ligne styles={styles} actif={filtreResto} onChoisir={setFiltreResto}
        elements={[{ cle: 'tous', label: 'Tous' }, ...restaurants.map(r => ({ cle: r.id, label: r.nom }))]} />

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={accent} />
          <Text style={[styles.infoTxt, { flex: 0, marginTop: 12 }]}>Chargement des contrats…</Text>
        </View>
      ) : (
        <>
          <Compteurs elements={compteurs} actif={filtreEtat} styles={styles}
            onChoisir={cle => setFiltreEtat(cle ?? 'tous')} />
          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <View style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' }]}>
              <Jauge pct={resume.pct} taille={150} epaisseur={14} libelle="sous contrat" />
              <View style={{ flex: 1, minWidth: 140, gap: 6 }}>
                <Text style={[styles.carteTitre, { fontSize: 16 }]}>{resume.sousContrat} / {resume.total} en règle</Text>
                <Text style={styles.infoTxt}>Travailleurs actifs avec un contrat valable aujourd'hui, ou dont la suite est déjà enregistrée.</Text>
                {resume.bientot > 0 && (
                  <Text style={[styles.infoTxt, { color: '#C27C1A', fontWeight: '700' }]}>
                    ⏰ {resume.bientot} expire{resume.bientot > 1 ? 'nt' : ''} bientôt
                    {resume.plusProche !== null ? ` · le plus proche ${resume.plusProche === 0 ? "aujourd'hui" : `dans ${resume.plusProche} j`}` : ''}
                  </Text>
                )}
                {resume.aRenouveler > 0 && <Text style={[styles.infoTxt, { color: '#C2462B', fontWeight: '700' }]}>🔁 {resume.aRenouveler} à renouveler</Text>}
                {resume.sans > 0 && <Text style={[styles.infoTxt, { color: '#C2462B', fontWeight: '700' }]}>⚠ {resume.sans} sans contrat</Text>}
              </View>
            </View>

            {affichees.length > 0 && (
              <Text style={styles.resultat}>
                {affichees.length} travailleur{affichees.length > 1 ? 's' : ''}
                {filtreEtat !== 'tous' ? ` · ${FILTRES_CONTRAT.find(f => f.cle === filtreEtat).label.toLowerCase()}` : ''}
              </Text>
            )}
            {affichees.length === 0 && (
              <Vide icone="📝" styles={styles}
                texte={filtreEtat === 'tous'
                  ? 'Aucun travailleur ne correspond.'
                  : filtreEtat === 'bientot'
                    ? "Aucun contrat n'arrive à échéance dans les 30 jours."
                    : filtreEtat === 'sans'
                      ? 'Tous les travailleurs ont un contrat.'
                      : 'Rien à afficher.'} />
            )}
            {affichees.map(renderLigne)}
            <View style={{ height: 100 }} />
          </ScrollView>
        </>
      )}

      <TouchableOpacity style={{
        position: 'absolute', bottom: 24, alignSelf: 'center', backgroundColor: principale, borderRadius: 26,
        paddingHorizontal: 24, paddingVertical: 15, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 }, elevation: 4,
      }} onPress={() => setSelecteurVisible(true)}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>+ Nouveau contrat</Text>
      </TouchableOpacity>

      <SelecteurTravailleur
        visible={selecteurVisible}
        travailleurs={travailleurs}
        restaurants={restaurants}
        onFermer={() => setSelecteurVisible(false)}
        onChoisir={nouveauContratPour}
      />

      <FicheContrat
        visible={ficheVisible}
        travailleur={travSelectionne}
        contrats={travSelectionne ? contratsDe(travSelectionne.id) : []}
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
        onFermer={() => { setFormVisible(false); setContratEdite(null) }}
        onEnregistrer={enregistrerContrat}
      />
    </SafeAreaView>
  )
}

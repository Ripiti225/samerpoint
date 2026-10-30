// ──────────────────────────────────────────────────────────────────────────────
// Nouveaux travailleurs — écran RH / manager / directeur.
//
// Les demandes d'embauche envoyées par les gérants (app/recrutement.js), à
// part de l'écran Contrats : accepter quelqu'un dans l'équipe et lui faire un
// contrat sont deux décisions distinctes.
//
//   À valider   demandes envoyées : vérifier, accepter ou refuser avec motif.
//   Refusées    renvoyées au gérant, qui corrige et renvoie la même demande.
//   Acceptées   historique ; la carte ouvre la fiche contrat du travailleur.
//
// Accepter puis « Générer le contrat » ouvre l'écran Contrats directement sur
// le formulaire de génération de ce travailleur.
// ──────────────────────────────────────────────────────────────────────────────
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import FeuilleDemandeRH from '../components/contrats/FeuilleDemandeRH'
import FeuilleMiseAJourRH from '../components/contrats/FeuilleMiseAJourRH'
import OngletSuiviCampagne from '../components/contrats/OngletSuiviCampagne'
import Avatar from '../components/equipe/Avatar'
import { EnTete, Pastille, Puces, Vide, useEcranModerne } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { aujourdhuiISO, formatFR } from '../lib/contrats'
import { chargerDemandes, chargerTousTravailleurs } from '../lib/contratsSignesDb'
import { resumeCampagne } from '../lib/miseAJourFiches'
import { chargerCampagne, relancerGerants } from '../lib/miseAJourFichesDb'
import { STATUTS_DEMANDE_TRAV, nomComplet } from '../lib/recrutement'
import { supabase } from '../lib/supabase'

const ONGLETS = { valider: 'envoyee', refusees: 'refusee', acceptees: 'acceptee' }

export default function EmbauchesScreen() {
  const { userId, userNom } = useApp() ?? {}
  const ctx = { userId: userId || null, userNom: userNom || null }
  const { styles, accent } = useEcranModerne('orange')
  const params = useLocalSearchParams()

  const [restaurants, setRestaurants] = useState([])
  const [demandes, setDemandes] = useState([])
  const [connus, setConnus] = useState([])
  const [loading, setLoading] = useState(true)
  const [onglet, setOnglet] = useState('valider')
  const [filtreResto, setFiltreResto] = useState(typeof params.restaurant_id === 'string' ? params.restaurant_id : 'tous')
  const [demandeOuverte, setDemandeOuverte] = useState(null)
  const [majOuverte, setMajOuverte] = useState(null)
  const [campagne, setCampagne] = useState({ travailleurs: [], contrats: [] })

  useEffect(() => { charger() }, [])

  async function charger() {
    setLoading(true)
    try {
      const [{ data: restos }, d, t, cp] = await Promise.all([
        supabase.from('restaurants').select('id, nom').order('nom'),
        chargerDemandes(),
        chargerTousTravailleurs(),
        chargerCampagne().catch(() => ({ travailleurs: [], contrats: [] })),
      ])
      setRestaurants(restos || [])
      setDemandes(d)
      setConnus(t)
      setCampagne(cp)
    } catch (_) {
      setDemandes([])
    } finally {
      setLoading(false)
    }
  }

  const restoNom = id => restaurants.find(r => r.id === id)?.nom || ''
  const dansResto = d => filtreResto === 'tous' || d.restaurant_id === filtreResto
  const nb = statut => demandes.filter(d => d.statut === statut && dansResto(d)).length
  const affichees = onglet === 'suivi' ? [] : demandes.filter(d => d.statut === ONGLETS[onglet] && dansResto(d))

  const resume = useMemo(() => resumeCampagne({
    travailleurs: campagne.travailleurs, demandes, contrats: campagne.contrats,
    restaurants: restaurants.filter(r => filtreResto === 'tous' || r.id === filtreResto), aujourdhui: aujourdhuiISO(),
  }), [campagne, demandes, restaurants, filtreResto])

  async function relancer(l) {
    try { await relancerGerants({ restaurantId: l.restaurant_id, nombre: l.aCompleter }); Alert.alert('Relance envoyée', `Les gérants de ${l.nom} ont reçu un rappel.`) }
    catch { Alert.alert('Relance', "La notification n'est pas partie. Réessaie.") }
  }
  async function prevenirTous() {
    const cibles = resume.lignes.filter(l => l.aCompleter > 0)
    await Promise.all(cibles.map(l => relancerGerants({ restaurantId: l.restaurant_id, nombre: l.aCompleter }).catch(() => {})))
    Alert.alert('Gérants prévenus', `${cibles.length} restaurant${cibles.length > 1 ? 's' : ''} prévenu${cibles.length > 1 ? 's' : ''}.`)
  }

  const estMaj = d => d.type === 'mise_a_jour'
  const nomDemande = d => nomComplet(d) || connus.find(t => t.id === d.travailleur_id)?.nom || ''

  function ouvrir(d) {
    if (d.statut === 'envoyee' && estMaj(d)) { setMajOuverte(d); return }
    if (d.statut === 'envoyee') setDemandeOuverte(d)
    else if (d.statut === 'acceptee' && d.travailleur_id) {
      router.push({ pathname: '/contrats', params: { travailleur_id: d.travailleur_id, restaurant_id: d.restaurant_id || '' } })
    }
  }

  function renderDemande(d) {
    const cfg = STATUTS_DEMANDE_TRAV[d.statut] || STATUTS_DEMANDE_TRAV.envoyee
    const cliquable = d.statut === 'envoyee' || (d.statut === 'acceptee' && d.travailleur_id)
    return (
      <TouchableOpacity key={d.id} style={styles.carte} activeOpacity={cliquable ? 0.8 : 1}
        onPress={cliquable ? () => ouvrir(d) : undefined}>
        <View style={styles.carteTop}>
          <Avatar nom={nomDemande(d)} photo={d.photo_url} taille={44} />
          <View style={{ flex: 1 }}>
            <Text style={styles.carteTitre}>{nomDemande(d)}</Text>
            <Text style={styles.carteSous}>
              {restoNom(d.restaurant_id) || 'Sans restaurant'} · {d.poste}{d.date_embauche ? ` · dès le ${formatFR(d.date_embauche)}` : ''}
            </Text>
          </View>
          {d.statut === 'envoyee' && <Text style={{ color: accent, fontWeight: '800' }}>Valider ›</Text>}
          {d.statut === 'acceptee' && d.travailleur_id && <Text style={{ color: accent, fontWeight: '800' }}>Contrat ›</Text>}
        </View>
        <Pastille cfg={cfg} styles={styles} />
        {estMaj(d) && (
          <Text style={{ alignSelf: 'flex-start', marginTop: 6, color: '#2F6FD8', fontWeight: '800', fontSize: 12 }}>📋 Mise à jour de fiche</Text>
        )}
        {d.statut === 'refusee' && d.motif_refus
          ? <Text style={[styles.infoTxt, { color: cfg.couleur, marginTop: 8, flex: 0 }]}>Raison : {d.motif_refus}</Text>
          : null}
        <Text style={[styles.infoTxt, { marginTop: 6, flex: 0 }]}>
          {estMaj(d) ? 'Envoyée' : 'Demandée'} par {d.cree_par_nom || 'le gérant'} le {formatFR(String(d.created_at).slice(0, 10))}
          {d.statut === 'acceptee' && d.traite_le ? ` · acceptée le ${formatFR(String(d.traite_le).slice(0, 10))}${d.traite_par_nom ? ` par ${d.traite_par_nom}` : ''}` : ''}
        </Text>
      </TouchableOpacity>
    )
  }

  const vides = {
    valider: { icone: '✅', texte: 'Aucune demande à valider.', sous: 'Quand un gérant propose un nouveau travailleur, sa demande arrive ici.' },
    refusees: { icone: '❌', texte: 'Aucune demande refusée en attente.', sous: 'Une demande refusée repart chez le gérant, qui la corrige et la renvoie.' },
    acceptees: { icone: '🧑‍🍳', texte: 'Aucune demande acceptée.', sous: null },
  }[onglet] || {}
  const nbValider = nb('envoyee')
  const nbRefusees = nb('refusee')

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Nouveaux travailleurs" sous={restaurants.find(r => r.id === filtreResto)?.nom || 'Tous les restaurants'} styles={styles}
        onRetour={() => (router.canGoBack() ? router.back() : router.replace('/accueil'))} />

      <Puces ligne styles={styles} actif={filtreResto} onChoisir={setFiltreResto}
        elements={[{ cle: 'tous', label: 'Tous' }, ...restaurants.map(r => ({ cle: r.id, label: r.nom }))]} />
      <Puces ligne styles={styles} actif={onglet} onChoisir={setOnglet} elements={[
        { cle: 'valider', label: `🟡 À valider${nbValider ? ` (${nbValider})` : ''}` },
        { cle: 'refusees', label: `❌ Refusées${nbRefusees ? ` (${nbRefusees})` : ''}` },
        { cle: 'acceptees', label: '✅ Acceptées' },
        { cle: 'suivi', label: '📊 Suivi' },
      ]} />

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color={accent} /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {onglet === 'suivi'
            ? <OngletSuiviCampagne styles={styles} accent={accent} resume={resume} onRelancer={relancer} onPrevenirTous={prevenirTous} />
            : affichees.length
              ? affichees.map(renderDemande)
              : <Vide icone={vides.icone} styles={styles} texte={vides.texte} sous={vides.sous} />}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}

      <FeuilleDemandeRH
        visible={!!demandeOuverte}
        demande={demandeOuverte}
        restaurantNom={demandeOuverte ? restoNom(demandeOuverte.restaurant_id) : ''}
        travailleursConnus={connus}
        ctx={ctx}
        onFermer={() => setDemandeOuverte(null)}
        onTraitee={async ({ travailleur, generer }) => {
          const demandeId = demandeOuverte?.id
          setDemandeOuverte(null)
          await charger()
          if (generer && travailleur?.id) {
            router.push({ pathname: '/contrats', params: { travailleur_id: travailleur.id, generer: '1', demande_id: demandeId || '' } })
          }
        }}
      />

      <FeuilleMiseAJourRH
        visible={!!majOuverte}
        demande={majOuverte}
        ctx={ctx}
        onFermer={() => setMajOuverte(null)}
        onTraitee={async ({ travailleur, generer }) => {
          setMajOuverte(null)
          await charger()
          if (generer && travailleur?.id) {
            router.push({ pathname: '/contrats', params: { travailleur_id: travailleur.id, generer: '1' } })
          }
        }}
      />
    </SafeAreaView>
  )
}

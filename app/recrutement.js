// ──────────────────────────────────────────────────────────────────────────────
// Nouveau travailleur — écran du gérant.
//
//   Mes demandes            demandes d'embauche envoyées à la RH, avec leur
//                           statut ; une demande refusée se corrige et repart.
//   Contrats à faire signer contrats préparés par la RH pour son restaurant :
//                           le gérant les fait lire et signer au travailleur.
//
// La RH valide les demandes dans « Nouveaux travailleurs » (app/embauches.js)
// et prépare les contrats dans l'écran Contrats (app/contrats.js).
// ──────────────────────────────────────────────────────────────────────────────
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import FeuilleSignature from '../components/contrats/FeuilleSignature'
import FormulaireDemande from '../components/contrats/FormulaireDemande'
import OngletMiseAJour from '../components/contrats/OngletMiseAJour'
import Avatar from '../components/equipe/Avatar'
import { Bouton, EnTete, Pastille, Puces, Vide, teinte, useEcranModerne } from '../components/ui/EcranModerne'
import { useApp } from '../context/AppContext'
import { aujourdhuiISO, formatFR } from '../lib/contrats'
import { chargerDemandes, chargerTousTravailleurs } from '../lib/contratsSignesDb'
import { listeEquipe, nbACompleter } from '../lib/miseAJourFiches'
import { chargerEquipeRestaurant } from '../lib/miseAJourFichesDb'
import { STATUTS_DEMANDE_TRAV, nomComplet } from '../lib/recrutement'
import { supabase } from '../lib/supabase'

const STATUTS_CONTRAT_GERANT = {
  a_signer: { label: 'À faire signer', emoji: '✍️', couleur: '#E07B00' },
  signe_a_verifier: { label: 'Signé — vérification RH', emoji: '🕓', couleur: '#2F6FD8' },
  refuse: { label: 'Refusé — la RH corrige', emoji: '⛔', couleur: '#C2462B' },
}

export default function RecrutementScreen() {
  const { restaurantId, restaurantNom, userId, userNom } = useApp() ?? {}
  const { styles, accent, principale } = useEcranModerne('orange')
  const params = useLocalSearchParams()

  const [onglet, setOnglet] = useState(params.onglet === 'signer' ? 'signer' : params.onglet === 'equipe' ? 'equipe' : 'demandes')
  const [demandes, setDemandes] = useState([])
  const [contrats, setContrats] = useState([])
  const [connus, setConnus] = useState([])
  const [loading, setLoading] = useState(true)
  const [formVisible, setFormVisible] = useState(false)
  const [demandeEditee, setDemandeEditee] = useState(null)
  const [contratOuvert, setContratOuvert] = useState(null)
  const [equipe, setEquipe] = useState([])
  const [majOuverte, setMajOuverte] = useState(null) // { trav, demande }

  const ctx = { userId: userId || null, userNom: userNom || null }
  const restaurant = { id: restaurantId || null, nom: restaurantNom || '' }

  useEffect(() => { charger() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function charger() {
    setLoading(true)
    try {
      let q = supabase.from('contrats_travailleurs')
        .select('*, travailleurs(nom, photo_url, poste)')
        .in('statut', ['a_signer', 'signe_a_verifier', 'refuse'])
        .order('envoye_le', { ascending: false })
        .range(0, 999)
      if (restaurantId) q = q.eq('restaurant_id', restaurantId)
      const [d, c, t, e] = await Promise.all([
        chargerDemandes({ restaurantId }), q, chargerTousTravailleurs(),
        restaurantId ? chargerEquipeRestaurant(restaurantId).catch(() => []) : [],
      ])
      setDemandes(d)
      setEquipe(e)
      setContrats(c.data || [])
      setConnus(t)
    } catch (_) {
      setDemandes([])
    } finally {
      setLoading(false)
    }
  }

  const aSigner = useMemo(() => contrats.filter(c => c.statut === 'a_signer'), [contrats])
  const embauches = demandes.filter(d => (d.type || 'embauche') === 'embauche')
  const demandesOuvertes = embauches.filter(d => d.statut !== 'acceptee').length
  const lignesEquipe = useMemo(() => listeEquipe(equipe, demandes), [equipe, demandes])
  const nbEquipe = nbACompleter(equipe, demandes)

  function renderDemande(d) {
    const cfg = STATUTS_DEMANDE_TRAV[d.statut] || STATUTS_DEMANDE_TRAV.envoyee
    return (
      <View key={d.id} style={styles.carte}>
        <View style={styles.carteTop}>
          <Avatar nom={nomComplet(d)} photo={d.photo_url} taille={44} />
          <View style={{ flex: 1 }}>
            <Text style={styles.carteTitre}>{nomComplet(d)}</Text>
            <Text style={styles.carteSous}>{d.poste}{d.date_embauche ? ` · dès le ${formatFR(d.date_embauche)}` : ''}</Text>
          </View>
        </View>
        <Pastille cfg={cfg} styles={styles} />
        {d.statut === 'refusee' && d.motif_refus
          ? <Text style={[styles.infoTxt, { color: cfg.couleur, marginTop: 8, flex: 0 }]}>Raison : {d.motif_refus}</Text>
          : null}
        <Text style={[styles.infoTxt, { marginTop: 6, flex: 0 }]}>Envoyée le {formatFR(String(d.created_at).slice(0, 10))}</Text>
        {d.statut === 'refusee' && (
          <View style={{ marginTop: 10 }}>
            <Bouton styles={styles} couleur={principale} variante="plein" label="✏️ Corriger et renvoyer"
              onPress={() => { setDemandeEditee(d); setFormVisible(true) }} />
          </View>
        )}
      </View>
    )
  }

  function renderContrat(c) {
    const cfg = STATUTS_CONTRAT_GERANT[c.statut]
    const nom = c.travailleurs?.nom || ''
    const actif = c.statut === 'a_signer'
    return (
      <TouchableOpacity key={c.id} style={[styles.carte, actif && { borderColor: teinte(principale, '88'), borderWidth: 1.5 }]}
        activeOpacity={actif ? 0.8 : 1} onPress={actif ? () => setContratOuvert(c) : undefined}>
        <View style={styles.carteTop}>
          <Avatar nom={nom} photo={c.travailleurs?.photo_url} taille={44} />
          <View style={{ flex: 1 }}>
            <Text style={styles.carteTitre}>{nom}</Text>
            <Text style={styles.carteSous}>
              {c.type}{c.date_debut ? ` · ${formatFR(c.date_debut)}` : ''}{c.date_fin ? ` → ${formatFR(c.date_fin)}` : ''}
            </Text>
          </View>
          {actif ? <Text style={{ color: accent, fontWeight: '800' }}>Signer ›</Text> : null}
        </View>
        <Pastille cfg={cfg} styles={styles} />
        {c.statut === 'refuse' && c.motif_refus
          ? <Text style={[styles.infoTxt, { marginTop: 6, flex: 0 }]}>Raison du refus : {c.motif_refus}</Text>
          : null}
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <EnTete titre="Nouveau travailleur" sous={restaurantNom || 'Demandes & contrats'} styles={styles}
        onRetour={() => (router.canGoBack() ? router.back() : router.replace('/accueil'))} />

      <Puces ligne styles={styles} actif={onglet} onChoisir={setOnglet} elements={[
        { cle: 'demandes', label: `🧑‍🍳 Mes demandes${demandesOuvertes ? ` (${demandesOuvertes})` : ''}` },
        { cle: 'signer', label: `✍️ Contrats à faire signer${aSigner.length ? ` (${aSigner.length})` : ''}` },
        { cle: 'equipe', label: `📋 Mettre à jour mon équipe${nbEquipe ? ` (${nbEquipe})` : ''}` },
      ]} />

      {loading ? (
        <View style={styles.loadingBox}><ActivityIndicator size="large" color={accent} /></View>
      ) : (
        <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
          {onglet === 'demandes' && (embauches.length
            ? embauches.map(renderDemande)
            : <Vide icone="🧑‍🍳" styles={styles} texte="Aucune demande pour l'instant."
              sous="Un nouveau travailleur ? Appuie sur « + Nouveau travailleur » : la RH valide, puis prépare son contrat." />)}
          {onglet === 'signer' && (contrats.length
            ? contrats.map(renderContrat)
            : <Vide icone="✍️" styles={styles} texte="Aucun contrat à faire signer."
              sous="Quand la RH prépare un contrat pour ton restaurant, il apparaît ici." />)}
          {onglet === 'equipe' && (
            <OngletMiseAJour styles={styles} principale={principale} lignes={lignesEquipe}
              aujourdhui={aujourdhuiISO()} onOuvrir={x => setMajOuverte(x)} />
          )}
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {onglet === 'demandes' && (
        <TouchableOpacity style={{
          position: 'absolute', bottom: 24, alignSelf: 'center', backgroundColor: principale, borderRadius: 26,
          paddingHorizontal: 24, paddingVertical: 15, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 }, elevation: 4,
        }} onPress={() => { setDemandeEditee(null); setFormVisible(true) }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>+ Nouveau travailleur</Text>
        </TouchableOpacity>
      )}

      <FormulaireDemande
        visible={formVisible}
        demande={demandeEditee}
        restaurant={restaurant}
        travailleursConnus={connus}
        ctx={ctx}
        onFermer={() => setFormVisible(false)}
        onEnvoye={() => { setFormVisible(false); charger() }}
      />

      <FormulaireDemande
        visible={!!majOuverte}
        travailleur={majOuverte?.trav || null}
        demande={majOuverte?.demande || null}
        restaurant={restaurant}
        travailleursConnus={connus}
        ctx={ctx}
        onFermer={() => setMajOuverte(null)}
        onEnvoye={() => { setMajOuverte(null); charger() }}
      />

      <FeuilleSignature
        visible={!!contratOuvert}
        contrat={contratOuvert}
        travailleurNom={contratOuvert?.travailleurs?.nom}
        ctx={ctx}
        onFermer={() => setContratOuvert(null)}
        onTermine={charger}
      />
    </SafeAreaView>
  )
}

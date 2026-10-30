// ──────────────────────────────────────────────────────────────────────────────
// Demande de nouveau travailleur, côté RH : vérifier, accepter ou refuser.
//
// Accepter crée la fiche (actif tout de suite : équipe, pointage, POS) — ou
// réactive l'ancienne fiche si la personne a déjà travaillé chez nous, pour ne
// pas couper son historique en deux. Refuser exige une raison : le gérant
// corrige et renvoie la même demande.
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Linking, Text, TouchableOpacity, View } from 'react-native'

import { Bouton, Champ, Feuille, Info, Libelle, Puces, teinte, useEcranModerne } from '../ui/EcranModerne'
import { formatFR } from '../../lib/contrats'
import { accepterDemande, refuserDemande } from '../../lib/contratsSignesDb'
import { estPdf, manquantsDemande, nomComplet, trouverDoublon } from '../../lib/recrutement'

export default function FeuilleDemandeRH({ visible, demande, restaurantNom, travailleursConnus, ctx, onFermer, onTraitee }) {
  const { styles, colors, accent } = useEcranModerne('orange')
  const [salaire, setSalaire] = useState('')
  const [reutiliser, setReutiliser] = useState(true)
  const [refus, setRefus] = useState(false)
  const [motif, setMotif] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (!visible || !demande) return
    setSalaire(demande.salaire_journalier ? String(demande.salaire_journalier) : '')
    setReutiliser(true)
    setRefus(false)
    setMotif('')
  }, [visible, demande])

  if (!demande) return null

  const doublon = (demande.doublon_travailleur_id && (travailleursConnus || []).find(t => t.id === demande.doublon_travailleur_id))
    || trouverDoublon(demande, travailleursConnus)
  const { incomplets } = manquantsDemande(demande)
  const nom = nomComplet(demande)

  async function accepter() {
    setOccupe(true)
    try {
      const trav = await accepterDemande(demande, { salaire_journalier: salaire, reutiliserId: doublon && reutiliser ? doublon.id : null }, ctx)
      const generer = await new Promise(resolve => Alert.alert(
        'Travailleur ajouté',
        `${nom} fait maintenant partie de l'équipe de ${restaurantNom || 'son restaurant'}.\n\nGénérer son contrat maintenant ?`,
        [
          { text: 'Plus tard', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Générer le contrat', onPress: () => resolve(true) },
        ],
        { cancelable: false },
      ))
      onTraitee?.({ travailleur: trav, generer })
    } catch (e) {
      Alert.alert('Acceptation impossible', e.message)
    } finally {
      setOccupe(false)
    }
  }

  async function refuser() {
    setOccupe(true)
    try {
      await refuserDemande(demande, motif, ctx)
      onTraitee?.({ travailleur: null, generer: false })
    } catch (e) {
      Alert.alert('Refus impossible', e.message)
    } finally {
      setOccupe(false)
    }
  }

  const ligne = (libelle, valeur) => (
    <Text key={libelle} style={[styles.infoTxt, { flex: 0, marginBottom: 3 }]}>
      {libelle} : {valeur
        ? <Text style={{ color: colors.text, fontWeight: '700' }}>{valeur}</Text>
        : <Text style={{ color: '#C2462B' }}>non renseigné</Text>}
    </Text>
  )

  const photos = [
    ...(demande.piece_identite_urls || []).map(u => ({ u, l: 'CNI' })),
    ...(demande.papiers_urls || []).map(u => ({ u, l: 'Papier' })),
  ]

  return (
    <Feuille visible={visible} styles={styles} onFermer={onFermer} titre={nom}
      sous={`${demande.poste} · demandé par ${demande.cree_par_nom || 'le gérant'} le ${formatFR(String(demande.created_at).slice(0, 10))}`}>

      <View style={{ flexDirection: 'row', gap: 14, marginBottom: 12 }}>
        <TouchableOpacity onPress={() => Linking.openURL(demande.photo_url)}>
          <Image source={{ uri: demande.photo_url }} style={{ width: 110, height: 110, borderRadius: 14, backgroundColor: colors.surfaceAlt }} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          {ligne('Civilité', demande.civilite)}
          {ligne('Naissance', [demande.date_naissance ? formatFR(demande.date_naissance) : null, demande.lieu_naissance].filter(Boolean).join(' à '))}
          {ligne('Nationalité', demande.nationalite)}
          {ligne('Téléphone', demande.contact)}
        </View>
      </View>
      {ligne('Situation de famille', demande.situation_famille)}
      {ligne('CNI', demande.cni_numero)}
      {ligne('NNI', demande.nni_numero)}
      {ligne('Lieu de résidence', demande.lieu_residence)}
      {ligne("Date d'embauche", demande.date_embauche ? formatFR(demande.date_embauche) : null)}

      {photos.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {photos.map(p => (
            <TouchableOpacity key={p.u} onPress={() => Linking.openURL(p.u)}>
              {estPdf(p.u)
                ? (
                  <View style={{ width: 84, height: 84, borderRadius: 10, backgroundColor: teinte(accent, '1A'), alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 30 }}>📄</Text>
                    <Text style={{ color: accent, fontWeight: '800', fontSize: 12 }}>PDF</Text>
                  </View>
                )
                : <Image source={{ uri: p.u }} style={{ width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surfaceAlt }} />}
              <Text style={[styles.infoTxt, { flex: 0, fontSize: 11, textAlign: 'center' }]}>{p.l}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {incomplets.length > 0 && (
        <Info icone="⚠️" styles={styles} couleur="#C27C1A">
          Incomplet : {incomplets.join(', ')}. Tu peux accepter ; il faudra compléter avant de générer le contrat.
        </Info>
      )}

      {doublon && (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: teinte('#C27C1A', '14'), marginTop: 10 }}>
          <Text style={{ color: '#C27C1A', fontWeight: '700', marginBottom: 6 }}>
            Ce travailleur existe peut-être déjà : {doublon.nom}{doublon.restaurants?.nom ? ` (${doublon.restaurants.nom})` : ''}{doublon.statut === 'archive' ? ' — ancien employé' : ''}
          </Text>
          <Puces petit styles={styles} actif={reutiliser} onChoisir={setReutiliser} elements={[
            { cle: true, label: "Réactiver l'ancienne fiche" },
            { cle: false, label: 'Créer une nouvelle fiche' },
          ]} />
        </View>
      )}

      <Libelle styles={styles}>Salaire journalier (paie)</Libelle>
      <Champ styles={styles} colors={colors} keyboardType="number-pad" value={salaire}
        onChangeText={v => setSalaire(v.replace(/\D/g, ''))} placeholder="Ex. 3000" />

      {demande.historique_refus?.length > 0 && (
        <Info icone="🔁" styles={styles}>Déjà refusée {demande.historique_refus.length} fois — dernier motif : {demande.historique_refus.at(-1).motif}</Info>
      )}

      {occupe ? <ActivityIndicator size="large" color={accent} style={{ marginTop: 14 }} /> : refus ? (
        <View style={{ marginTop: 12 }}>
          <Libelle styles={styles}>Raison du refus (le gérant la verra)</Libelle>
          <Champ styles={styles} colors={colors} multiline value={motif} onChangeText={setMotif}
            placeholder="Ex. photo de la CNI illisible, reprends-la" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Bouton flex styles={styles} couleur={colors.textSecondary} variante="contour" label="Retour" onPress={() => setRefus(false)} />
            <Bouton flex styles={styles} couleur="#C2462B" variante="plein" label="Refuser" disabled={!motif.trim()} onPress={refuser} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <Bouton flex styles={styles} couleur="#C2462B" label="❌ Refuser" onPress={() => setRefus(true)} />
          <Bouton flex grand styles={styles} couleur="#3B8D2F" variante="plein" label="✅ Accepter" onPress={accepter} />
        </View>
      )}
    </Feuille>
  )
}

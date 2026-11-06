// Mise à jour de fiche envoyée par un gérant, côté RH : seulement ce qui
// change (avant → après), les nouvelles pièces, ce qui manquera encore.
// Accepter fusionne sans rien effacer (lib/miseAJourFiches.js → fusionFiche).
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Linking, Text, TouchableOpacity, View } from 'react-native'

import ChampsCorrectionFiche from './ChampsCorrectionFiche'
import { Bouton, Champ, Feuille, Info, Libelle, useEcranModerne } from '../ui/EcranModerne'
import { formatFR } from '../../lib/contrats'
import { refuserDemande } from '../../lib/contratsSignesDb'
import {
  correctionComplete, correctionsRH, demandeCorrigee, diffFiche, formulaireCorrection, fusionFiche, manquantsFiche, typeContratPropose,
} from '../../lib/miseAJourFiches'
import { accepterMiseAJour, chargerTravailleur } from '../../lib/miseAJourFichesDb'
import { estPdf } from '../../lib/recrutement'

const lisible = (cle, v) => (v === null || v === undefined || v === '' ? 'vide'
  : /date_/.test(cle) ? formatFR(v) : cle === 'photo_url' ? 'nouvelle photo' : String(v))

export default function FeuilleMiseAJourRH({ visible, demande, ctx, onFermer, onTraitee }) {
  const { styles, colors, accent } = useEcranModerne('orange')
  const [trav, setTrav] = useState(null)
  const [refus, setRefus] = useState(false)
  const [motif, setMotif] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [depart, setDepart] = useState(null)
  const [form, setForm] = useState(null)

  useEffect(() => {
    if (!visible || !demande) return
    setTrav(null); setRefus(false); setMotif(''); setDepart(null); setForm(null)
    chargerTravailleur(demande.travailleur_id).then(setTrav).catch(e => Alert.alert('Fiche', e.message))
  }, [visible, demande])

  if (!demande) return null
  const effective = form ? demandeCorrigee(demande, form) : demande
  const diff = trav ? diffFiche(trav, effective) : []
  const { maj, nouvellesPieces, nouveauxPapiers } = trav ? fusionFiche(trav, effective) : { maj: {}, nouvellesPieces: [], nouveauxPapiers: [] }
  const encore = trav ? manquantsFiche({ ...trav, ...maj }) : []
  const peutAccepter = !form || correctionComplete(form)

  function ouvrirCorrection() {
    const f = formulaireCorrection(trav, demande)
    setDepart(f)
    setForm(f)
  }

  async function accepter() {
    setOccupe(true)
    try {
      const t = await accepterMiseAJour(effective, ctx, form ? correctionsRH(depart, form) : [])
      const generer = await new Promise(resolve => Alert.alert('Fiche mise à jour',
        `${t.nom} : fiche à jour.\n\nGénérer son contrat maintenant (${typeContratPropose(t)} proposé) ?`,
        [{ text: 'Plus tard', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Générer le contrat', onPress: () => resolve(true) }],
        { cancelable: false }))
      onTraitee?.({ travailleur: t, generer })
    } catch (e) {
      Alert.alert('Validation impossible', e.message)
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

  const vignette = u => (
    <TouchableOpacity key={u} onPress={() => Linking.openURL(u)}>
      {estPdf(u)
        ? <View style={{ width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 30 }}>📄</Text></View>
        : <Image source={{ uri: u }} style={{ width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surfaceAlt }} />}
    </TouchableOpacity>
  )

  return (
    <Feuille visible={visible} styles={styles} onFermer={onFermer} titre={trav?.nom || 'Mise à jour de fiche'}
      sous={`Mise à jour envoyée par ${demande.cree_par_nom || 'le gérant'} le ${formatFR(String(demande.updated_at || demande.created_at).slice(0, 10))}`}>
      {!trav ? <ActivityIndicator size="large" color={accent} /> : (
        <>
          {demande.statut === 'refusee' && demande.motif_refus
            ? <Info icone="❌" styles={styles} couleur="#C2462B">Refusée : {demande.motif_refus}</Info>
            : null}
          <Libelle styles={styles}>Ce qui change</Libelle>
          {diff.length === 0
            ? <Text style={[styles.infoTxt, { flex: 0 }]}>Aucun changement sur la fiche.</Text>
            : diff.map(d => (
              <Text key={d.cle} style={[styles.infoTxt, { flex: 0, marginBottom: 4 }]}>
                {d.libelle} : <Text style={{ color: '#C2462B' }}>{lisible(d.cle, d.avant)}</Text> → <Text style={{ color: colors.text, fontWeight: '700' }}>{lisible(d.cle, d.apres)}</Text>
              </Text>
            ))}
          {diff.some(d => d.cle === 'photo_url') && (
            <View style={{ flexDirection: 'row', gap: 10, marginVertical: 8 }}>
              {trav.photo_url ? <Image source={{ uri: trav.photo_url }} style={{ width: 84, height: 84, borderRadius: 42 }} /> : null}
              <Image source={{ uri: demande.photo_url }} style={{ width: 84, height: 84, borderRadius: 42 }} />
            </View>
          )}
          {(nouvellesPieces.length + nouveauxPapiers.length) > 0 && (
            <>
              <Libelle styles={styles}>Nouvelles pièces</Libelle>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[...nouvellesPieces, ...nouveauxPapiers].map(vignette)}</View>
            </>
          )}
          {encore.length > 0 && (
            <Info icone="⚠️" styles={styles} couleur="#C27C1A">
              Encore manquant après validation : {encore.join(', ')}. Le contrat demandera de compléter.
            </Info>
          )}
          {form
            ? <ChampsCorrectionFiche form={form} setForm={setForm} styles={styles} colors={colors} />
            : (
              <View style={{ marginTop: 10 }}>
                <Bouton styles={styles} couleur={accent} label="✏️ Corriger / compléter" onPress={ouvrirCorrection} />
              </View>
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
              {demande.statut === 'envoyee' && <Bouton flex styles={styles} couleur="#C2462B" label="❌ Refuser" onPress={() => setRefus(true)} />}
              <Bouton flex grand styles={styles} couleur="#3B8D2F" variante="plein" label="✅ Accepter" disabled={!peutAccepter} onPress={accepter} />
            </View>
          )}
        </>
      )}
    </Feuille>
  )
}

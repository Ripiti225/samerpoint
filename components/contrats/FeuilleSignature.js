// ──────────────────────────────────────────────────────────────────────────────
// Faire signer un contrat — chez le gérant, sur son appareil.
//
//   lire     le travailleur lit tout le contrat ; le bouton « signer » est en
//            bas du texte, il faut donc l'avoir fait défiler jusqu'au bout ;
//   signer   cadre de signature hors de tout défilement (le geste serait volé) ;
//   fin      PDF signé à télécharger (WhatsApp, impression) ;
//   refus    le travailleur refuse : raison obligatoire, la RH est prévenue ;
//   papier   plan B : PDF à imprimer, signature à la main, photo du papier.
//
// Le gérant ne modifie jamais le contenu du contrat.
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Modal, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import ApercuContrat from './ApercuContrat'
import PadSignature from './PadSignature'
import { Bouton, Champ, Info, Libelle, useEcranModerne } from '../ui/EcranModerne'
import {
  deposerPapierSigne, refuserSignature, signerContrat, telechargerPdf, telechargerPdfNonSigne,
} from '../../lib/contratsSignesDb'
import { formatFR } from '../../lib/contrats'
import { estPhotoEnAttente } from '../../lib/photoQueue'
import { usePhoto } from '../../lib/usePhoto'

export default function FeuilleSignature({ visible, contrat, travailleurNom, ctx, onFermer, onTermine }) {
  const { styles, colors, accent, principale } = useEcranModerne('orange')
  const { prendrePhoto } = usePhoto()
  const pad = useRef(null)
  const [etape, setEtape] = useState('lire')
  const [signature, setSignature] = useState(null)
  const [pdf, setPdf] = useState(null)
  const [motif, setMotif] = useState('')
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    if (visible) { setEtape('lire'); setSignature(null); setPdf(null); setMotif(''); setOccupe(false) }
  }, [visible, contrat?.id])

  if (!contrat) return null
  const d = contrat.donnees || {}
  const sous = `${contrat.type} · ${travailleurNom || ''}${d.date_debut ? ` · dès le ${formatFR(d.date_debut)}` : ''}`

  async function action(fn) {
    setOccupe(true)
    try { await fn() } catch (e) { Alert.alert('Impossible', e.message) } finally { setOccupe(false) }
  }

  const signer = () => action(async () => {
    const r = await signerContrat(contrat, signature, ctx, travailleurNom)
    setPdf(r)
    setEtape('fin')
    onTermine?.()
  })

  const refuser = () => action(async () => {
    await refuserSignature(contrat, motif, ctx, travailleurNom)
    onTermine?.()
    Alert.alert('Refus enregistré', 'La RH est prévenue. Elle corrigera le contrat et te le renverra.')
    onFermer()
  })

  const photoPapier = () => action(async () => {
    const url = await prendrePhoto('contrats/papiers-signes')
    if (!url) return
    if (estPhotoEnAttente(url)) throw new Error("Pas de connexion : la photo n'est pas partie. Reprends-la quand le réseau revient.")
    await deposerPapierSigne(contrat, url, ctx, travailleurNom)
    onTermine?.()
    Alert.alert('Contrat envoyé', 'La photo du contrat signé est partie à la RH pour vérification.')
    onFermer()
  })

  const entete = (
    <View style={styles.header}>
      <TouchableOpacity onPress={etape === 'lire' || etape === 'fin' ? onFermer : () => setEtape('lire')} hitSlop={10}>
        <Text style={styles.back}>{etape === 'lire' || etape === 'fin' ? '✕ Fermer' : '‹ Retour'}</Text>
      </TouchableOpacity>
      <View style={{ flex: 1, paddingHorizontal: 8 }}>
        <Text style={styles.headerTitre}>Signature du contrat</Text>
        <Text style={styles.headerSub} numberOfLines={1}>{sous}</Text>
      </View>
      <View style={{ width: 60 }} />
    </View>
  )

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onFermer}>
      <SafeAreaView style={styles.container}>
        {entete}

        {etape === 'lire' && (
          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }}>
            <Info icone="📖" styles={styles}>Donne l&apos;appareil au travailleur : il lit tout le contrat, puis signe en bas.</Info>
            <View style={{ height: 10 }} />
            <ApercuContrat donnees={d} />
            <View style={{ height: 16 }} />
            <Bouton grand styles={styles} couleur={principale} variante="plein" label="✍️ J'ai lu le contrat — signer" onPress={() => setEtape('signer')} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Bouton flex styles={styles} couleur="#C2462B" label="Le travailleur refuse" onPress={() => setEtape('refus')} />
              <Bouton flex styles={styles} couleur={accent} variante="contour" label="Signer sur papier" onPress={() => setEtape('papier')} />
            </View>
          </ScrollView>
        )}

        {etape === 'signer' && (
          <View style={[styles.body, { paddingTop: 16 }]}>
            <Text style={[styles.carteTitre, { marginBottom: 4 }]}>Signature de {travailleurNom}</Text>
            <Text style={[styles.infoTxt, { flex: 0, marginBottom: 12 }]}>
              Signe avec le doigt dans le cadre. En signant, tu déclares avoir lu et approuvé le contrat.
            </Text>
            <PadSignature ref={pad} onChange={setSignature} hauteur={240} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Bouton flex styles={styles} couleur={accent} variante="contour" label="Effacer" onPress={() => pad.current?.effacer()} />
              {occupe
                ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={accent} /></View>
                : <Bouton flex grand styles={styles} couleur="#3B8D2F" variante="plein" label="✅ Signer et valider" disabled={!signature} onPress={signer} />}
            </View>
          </View>
        )}

        {etape === 'fin' && (
          <ScrollView style={styles.body} contentContainerStyle={{ paddingVertical: 24, alignItems: 'stretch' }}>
            <Text style={{ fontSize: 52, textAlign: 'center' }}>✅</Text>
            <Text style={[styles.carteTitre, { textAlign: 'center', fontSize: 19, marginTop: 8 }]}>Contrat signé</Text>
            <Text style={[styles.infoTxt, { flex: 0, textAlign: 'center', marginVertical: 12 }]}>
              La RH va le vérifier. Télécharge le PDF pour l&apos;envoyer au travailleur (WhatsApp) ou l&apos;imprimer.
            </Text>
            <Bouton grand styles={styles} couleur={principale} variante="plein" label="📄 Télécharger le PDF"
              onPress={() => action(() => telechargerPdf(pdf))} />
            <View style={{ height: 10 }} />
            <Bouton styles={styles} couleur={accent} variante="contour" label="Fermer" onPress={onFermer} />
          </ScrollView>
        )}

        {etape === 'refus' && (
          <ScrollView style={styles.body} contentContainerStyle={{ paddingTop: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={[styles.carteTitre, { marginBottom: 8 }]}>Le travailleur refuse de signer</Text>
            <Libelle styles={styles}>Pourquoi ? (obligatoire)</Libelle>
            <Champ styles={styles} colors={colors} multiline value={motif} onChangeText={setMotif}
              placeholder="Ex. le salaire ne correspond pas à ce qui était convenu" />
            <View style={{ height: 12 }} />
            {occupe
              ? <ActivityIndicator color={accent} />
              : <Bouton grand styles={styles} couleur="#C2462B" variante="plein" label="Enregistrer le refus" disabled={!motif.trim()} onPress={refuser} />}
          </ScrollView>
        )}

        {etape === 'papier' && (
          <ScrollView style={styles.body} contentContainerStyle={{ paddingTop: 16 }}>
            <Text style={[styles.carteTitre, { marginBottom: 8 }]}>Signer sur papier</Text>
            <Info icone="1️⃣" styles={styles}>Télécharge le contrat et imprime-le.</Info>
            <Bouton styles={styles} couleur={principale} label="📄 Télécharger le contrat à imprimer"
              onPress={() => action(() => telechargerPdfNonSigne(contrat))} />
            <View style={{ height: 12 }} />
            <Info icone="2️⃣" styles={styles}>Le travailleur écrit « Lu et approuvé » et signe à la main.</Info>
            <Info icone="3️⃣" styles={styles}>Prends en photo la page signée : elle part à la RH.</Info>
            <View style={{ height: 8 }} />
            {occupe
              ? <ActivityIndicator color={accent} />
              : <Bouton grand styles={styles} couleur="#3B8D2F" variante="plein" label="📷 Photo du contrat signé" onPress={photoPapier} />}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

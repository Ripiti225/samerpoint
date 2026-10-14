// ──────────────────────────────────────────────────────────────────────────────
// Demande de nouveau travailleur — saisie du gérant (création ou correction
// après refus de la RH).
//
// Seuls la photo, le nom, les prénoms et le poste sont exigés. Tout le reste
// est signalé (« Informations incomplètes ») mais n'empêche pas l'envoi : la
// RH complétera avant de générer le contrat.
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Text, TouchableOpacity, View } from 'react-native'

import ChampDate from '../ChampDate'
import { Bouton, Champ, Feuille, Info, Libelle, Puces, teinte, useEcranModerne } from '../ui/EcranModerne'
import { corrigerEtRenvoyer, envoyerDemande } from '../../lib/contratsSignesDb'
import { estPhotoEnAttente } from '../../lib/photoQueue'
import { CIVILITES, SITUATIONS_FAMILLE, manquantsDemande, trouverDoublon } from '../../lib/recrutement'
import { usePhoto } from '../../lib/usePhoto'

export const POSTES_COURANTS = [
  'Caissier', 'Serveur', 'Comptoiriste', 'Cuisinier', 'Aide cuisinier', 'Pizzaïolo', 'Plongeur', 'Technicien de surface',
]

const VIDE = {
  civilite: '', nom_famille: '', prenoms: '', date_naissance: '', lieu_naissance: '', nationalite: '',
  situation_famille: '', cni_numero: '', nni_numero: '', lieu_residence: '', contact: '', poste: '',
  salaire_journalier: '', date_embauche: '', photo_url: null, piece_identite_urls: [], papiers_urls: [],
}

function depuisDemande(d) {
  if (!d) return { ...VIDE }
  const f = { ...VIDE }
  for (const k of Object.keys(VIDE)) if (d[k] !== null && d[k] !== undefined) f[k] = d[k]
  f.salaire_journalier = d.salaire_journalier ? String(d.salaire_journalier) : ''
  return f
}

export default function FormulaireDemande({ visible, demande, restaurant, travailleursConnus, ctx, onFermer, onEnvoye }) {
  const { styles, colors, accent, principale } = useEcranModerne('orange')
  const { prendrePhoto } = usePhoto()
  const [form, setForm] = useState(depuisDemande(demande))
  const [envoi, setEnvoi] = useState(false)
  const [photoEnCours, setPhotoEnCours] = useState(null)

  useEffect(() => { if (visible) setForm(depuisDemande(demande)) }, [visible, demande])

  const maj = (cle, val) => setForm(f => ({ ...f, [cle]: val }))

  // Une photo prise hors connexion revient sous forme de jeton « en attente » :
  // ici rien ne le remplacerait plus tard par la vraie adresse. On la refuse.
  async function photo(dossier) {
    setPhotoEnCours(dossier)
    try {
      const url = await prendrePhoto(`recrutement/${dossier}`)
      if (!url) return null
      if (estPhotoEnAttente(url)) {
        Alert.alert('Pas de connexion', "La photo n'a pas pu être envoyée. Reprends-la quand le réseau revient.")
        return null
      }
      return url
    } finally {
      setPhotoEnCours(null)
    }
  }

  async function envoyer(doublon) {
    setEnvoi(true)
    try {
      const contenu = { ...form, doublon_travailleur_id: doublon?.id || null }
      if (demande) await corrigerEtRenvoyer(demande, contenu, ctx)
      else await envoyerDemande(contenu, ctx, restaurant)
      onEnvoye?.()
    } catch (e) {
      Alert.alert('Envoi impossible', e.message)
    } finally {
      setEnvoi(false)
    }
  }

  function valider() {
    const { bloquants, incomplets } = manquantsDemande(form)
    if (bloquants.length) {
      Alert.alert('Il manque des informations', `Obligatoire : ${bloquants.join(', ')}.`)
      return
    }
    const autres = (travailleursConnus || []).filter(t => t.id !== demande?.travailleur_id)
    const doublon = trouverDoublon(form, autres)
    const lignes = []
    if (doublon) {
      lignes.push(`⚠ Ce travailleur existe peut-être déjà : ${doublon.nom}${doublon.restaurants?.nom ? ` (${doublon.restaurants.nom})` : ''}${doublon.statut === 'archive' ? ', ancien employé' : ''}. La RH vérifiera.`)
    }
    if (incomplets.length) lignes.push(`Informations incomplètes : ${incomplets.join(', ')}.`)
    if (lignes.length === 0) { envoyer(null); return }
    Alert.alert(
      incomplets.length ? 'Informations incomplètes' : 'Travailleur déjà connu ?',
      `${lignes.join('\n\n')}\n\nTu peux envoyer quand même : la RH complétera.`,
      [
        { text: 'Compléter', style: 'cancel' },
        { text: 'Envoyer quand même', onPress: () => envoyer(doublon) },
      ],
    )
  }

  const champTexte = (cle, libelle, props = {}) => (
    <>
      <Libelle styles={styles}>{libelle}</Libelle>
      <Champ styles={styles} colors={colors} value={form[cle]} onChangeText={v => maj(cle, v)} {...props} />
    </>
  )

  const vignette = (url, onRetirer) => (
    <View key={url} style={{ marginRight: 8, marginBottom: 8 }}>
      <Image source={{ uri: url }} style={{ width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surfaceAlt }} />
      <TouchableOpacity onPress={onRetirer} hitSlop={8} style={{
        position: 'absolute', top: -6, right: -6, backgroundColor: '#C2462B', borderRadius: 11, width: 22, height: 22,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✕</Text>
      </TouchableOpacity>
    </View>
  )

  return (
    <Feuille visible={visible} styles={styles} onFermer={onFermer}
      titre={demande ? 'Corriger la demande' : 'Nouveau travailleur'}
      sous={demande?.motif_refus ? `Refus de la RH : ${demande.motif_refus}` : restaurant?.nom}>

      <Libelle styles={styles}>Photo du travailleur *</Libelle>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        {form.photo_url
          ? <Image source={{ uri: form.photo_url }} style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceAlt }} />
          : (
            <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: teinte(principale, '1A'), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 34 }}>👤</Text>
            </View>
          )}
        <View style={{ flex: 1 }}>
          {photoEnCours === 'photos'
            ? <ActivityIndicator color={accent} />
            : <Bouton styles={styles} couleur={principale} variante="plein" label={form.photo_url ? '📷 Reprendre la photo' : '📷 Prendre la photo'}
              onPress={async () => { const u = await photo('photos'); if (u) maj('photo_url', u) }} />}
          <Text style={[styles.infoTxt, { marginTop: 6, flex: 0 }]}>Obligatoire : la RH doit pouvoir reconnaître la personne.</Text>
        </View>
      </View>

      <Libelle styles={styles}>Civilité</Libelle>
      <Puces styles={styles} actif={form.civilite} onChoisir={v => maj('civilite', v)} elements={CIVILITES.map(c => ({ cle: c, label: c === 'M.' ? 'Monsieur' : 'Madame' }))} />

      {champTexte('nom_famille', 'Nom *', { placeholder: 'Ex. GBADIE', autoCapitalize: 'characters' })}
      {champTexte('prenoms', 'Prénoms *', { placeholder: 'Ex. Gogre Tanguy' })}

      <ChampDate label="Date de naissance" valeur={form.date_naissance} onChange={v => maj('date_naissance', v)}
        maxDate={new Date().toISOString().slice(0, 10)} couleur={principale} />
      {champTexte('lieu_naissance', 'Lieu de naissance', { placeholder: 'Ex. Yopougon' })}
      {champTexte('nationalite', 'Nationalité', { placeholder: 'Ex. Ivoirienne' })}

      <Libelle styles={styles}>Situation de famille</Libelle>
      <Puces styles={styles} actif={form.situation_famille} onChoisir={v => maj('situation_famille', v)} elements={SITUATIONS_FAMILLE.map(s => ({ cle: s, label: s }))} />

      {champTexte('cni_numero', "N° de carte d'identité (CNI)", { placeholder: 'Ex. CI007879705', autoCapitalize: 'characters' })}
      {champTexte('nni_numero', 'NNI (si connu)', { placeholder: 'Ex. 11919240401', keyboardType: 'number-pad' })}
      {champTexte('lieu_residence', 'Lieu de résidence', { placeholder: 'Ex. Yopougon' })}
      {champTexte('contact', 'Téléphone', { placeholder: 'Ex. 01 01 35 48 69', keyboardType: 'phone-pad' })}

      <Libelle styles={styles}>Poste *</Libelle>
      <Puces petit styles={styles} actif={form.poste} onChoisir={v => maj('poste', v)} elements={POSTES_COURANTS.map(p => ({ cle: p, label: p }))} />
      <Champ styles={styles} colors={colors} value={form.poste} onChangeText={v => maj('poste', v)} placeholder="Ou écris le poste" />

      {champTexte('salaire_journalier', 'Salaire journalier proposé (F)', { placeholder: 'Ex. 3000', keyboardType: 'number-pad' })}
      <ChampDate label="Date d'embauche (premier jour de travail)" valeur={form.date_embauche} onChange={v => maj('date_embauche', v)} couleur={principale} />

      <Libelle styles={styles}>Carte d&apos;identité (recto, verso) — facultatif</Libelle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        {form.piece_identite_urls.map(u => vignette(u, () => maj('piece_identite_urls', form.piece_identite_urls.filter(x => x !== u))))}
        {photoEnCours === 'cni'
          ? <ActivityIndicator color={accent} />
          : <Bouton styles={styles} couleur={principale} label="+ Photo de la CNI"
            onPress={async () => { const u = await photo('cni'); if (u) maj('piece_identite_urls', [...form.piece_identite_urls, u]) }} />}
      </View>

      <Libelle styles={styles}>Autres papiers — facultatif</Libelle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {form.papiers_urls.map(u => vignette(u, () => maj('papiers_urls', form.papiers_urls.filter(x => x !== u))))}
        {photoEnCours === 'papiers'
          ? <ActivityIndicator color={accent} />
          : <Bouton styles={styles} couleur={principale} label="+ Photo d'un papier"
            onPress={async () => { const u = await photo('papiers'); if (u) maj('papiers_urls', [...form.papiers_urls, u]) }} />}
      </View>

      <Info icone="ℹ️" styles={styles}>Le salaire du contrat et le type de contrat seront fixés par la RH.</Info>
      <View style={{ height: 12 }} />
      {envoi
        ? <ActivityIndicator size="large" color={accent} />
        : <Bouton grand styles={styles} couleur={principale} variante="plein" label={demande ? 'Renvoyer à la RH' : 'Envoyer à la RH'} onPress={valider} />}
    </Feuille>
  )
}

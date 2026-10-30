// ──────────────────────────────────────────────────────────────────────────────
// Demande de nouveau travailleur — saisie du gérant (création ou correction
// après refus de la RH).
//
// `direct` : le même formulaire pour la RH / le manager (Équipe globale,
// Paramètres), qui ajoutent eux-mêmes un travailleur. Pas de demande : la
// fiche est créée tout de suite (lib/contratsSignesDb.js →
// ajouterTravailleurDirect). En plus : le choix du restaurant, et la décision
// sur un éventuel ancien employé (réactiver sa fiche ou en créer une).
//
// Seuls la photo, le nom, les prénoms et le poste sont exigés. Tout le reste
// est signalé (« Informations incomplètes ») mais n'empêche pas l'envoi : la
// RH complétera avant de générer le contrat.
//
// Photo du travailleur : appareil photo ou galerie. CNI et autres papiers :
// appareil photo, galerie ou PDF (une carte scannée arrive souvent en PDF).
// Trois vrais boutons, pas un menu Alert : sur le web, un Alert à plusieurs
// choix perd des options.
// ──────────────────────────────────────────────────────────────────────────────
import * as DocumentPicker from 'expo-document-picker'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Linking, Text, TouchableOpacity, View } from 'react-native'

import ChampDate from '../ChampDate'
import { Bouton, Champ, Feuille, Info, Libelle, Puces, teinte, useEcranModerne } from '../ui/EcranModerne'
import { uploadFichier } from '../../lib/api'
import { ajouterTravailleurDirect, corrigerEtRenvoyer, envoyerDemande } from '../../lib/contratsSignesDb'
import { ficheVersFormulaire, formulaireCorrection } from '../../lib/miseAJourFiches'
import { envoyerMiseAJour } from '../../lib/miseAJourFichesDb'
import { isOnlineNow } from '../../lib/networkStatus'
import { estPhotoEnAttente } from '../../lib/photoQueue'
import { CIVILITES, SITUATIONS_FAMILLE, estPdf, manquantsDemande, trouverDoublon } from '../../lib/recrutement'
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

export default function FormulaireDemande({
  visible, demande, restaurant, travailleursConnus, ctx, onFermer, onEnvoye,
  direct = false, restaurants = [], restoParDefaut = null, travailleur = null,
}) {
  const maj = !!travailleur
  // Mise à jour : la demande refusée (si elle existe) a priorité, sinon la fiche.
  const initial = () => (maj ? (demande ? formulaireCorrection(travailleur, demande) : ficheVersFormulaire(travailleur)) : depuisDemande(demande))
  const { styles, colors, accent, principale } = useEcranModerne('orange')
  const { prendrePhoto, choisirPhoto } = usePhoto()
  const [form, setForm] = useState(initial)
  const [envoi, setEnvoi] = useState(false)
  const [photoEnCours, setPhotoEnCours] = useState(null)
  const [restoId, setRestoId] = useState(restoParDefaut)
  const [reutiliser, setReutiliser] = useState(true)

  useEffect(() => {
    if (!visible) return
    setForm(initial())
    setRestoId(restoParDefaut)
    setReutiliser(true)
  }, [visible, demande, restoParDefaut, travailleur?.id])

  const restoChoisi = direct ? restaurants.find(r => r.id === restoId) || null : restaurant
  // Ajout direct : l'ancien employé se repère pendant la saisie, et c'est la
  // personne qui ajoute qui décide (pas de RH derrière pour vérifier).
  const doublonDirect = direct ? trouverDoublon(form, travailleursConnus || []) : null

  const majChamp = (cle, val) => setForm(f => ({ ...f, [cle]: val }))

  // mode : 'camera' | 'galerie' | 'pdf'.
  // Une photo prise hors connexion revient sous forme de jeton « en attente » :
  // ici rien ne le remplacerait plus tard par la vraie adresse. On la refuse.
  async function joindre(dossier, mode) {
    if (mode === 'pdf') return joindrePdf(dossier)
    setPhotoEnCours(dossier)
    try {
      const url = mode === 'galerie'
        ? await choisirPhoto(`recrutement/${dossier}`)
        : await prendrePhoto(`recrutement/${dossier}`, { cameraWeb: true })
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

  async function joindrePdf(dossier) {
    let uri = null
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
      if (res.canceled) return null
      uri = res.assets?.[0]?.uri
    } catch (_e) {
      Alert.alert('PDF', "Impossible d'ouvrir le choix du fichier.")
      return null
    }
    if (!uri) return null
    if (!isOnlineNow()) {
      Alert.alert('Pas de connexion', "Le PDF n'a pas pu être envoyé. Réessaie quand le réseau revient.")
      return null
    }
    setPhotoEnCours(dossier)
    try {
      const url = await uploadFichier(uri, `recrutement/${dossier}`)
      if (!url) Alert.alert('Envoi impossible', "Le PDF n'a pas pu être envoyé. Réessaie.")
      return url || null
    } finally {
      setPhotoEnCours(null)
    }
  }

  async function enregistrerDirect() {
    setEnvoi(true)
    try {
      const trav = await ajouterTravailleurDirect(form, ctx, restoChoisi, {
        reutiliserId: doublonDirect && reutiliser ? doublonDirect.id : null,
      })
      onEnvoye?.(trav)
      if (!trav?.id) return
      Alert.alert(
        'Travailleur ajouté',
        `${trav.nom} fait maintenant partie de l'équipe de ${restoChoisi?.nom || 'son restaurant'}.\n\nGénérer son contrat maintenant ?`,
        [
          { text: 'Plus tard', style: 'cancel' },
          { text: 'Générer le contrat', onPress: () => router.push({ pathname: '/contrats', params: { travailleur_id: trav.id, generer: '1' } }) },
        ],
      )
    } catch (e) {
      Alert.alert('Enregistrement impossible', e.message)
    } finally {
      setEnvoi(false)
    }
  }

  async function envoyer(doublon) {
    setEnvoi(true)
    try {
      if (maj) await envoyerMiseAJour(travailleur, form, ctx, demande)
      else {
        const contenu = { ...form, doublon_travailleur_id: doublon?.id || null }
        if (demande) await corrigerEtRenvoyer(demande, contenu, ctx)
        else await envoyerDemande(contenu, ctx, restaurant)
      }
      onEnvoye?.()
    } catch (e) {
      Alert.alert('Envoi impossible', e.message)
    } finally {
      setEnvoi(false)
    }
  }

  function valider() {
    const { bloquants, incomplets } = manquantsDemande(form)
    // Mise à jour : le poste et le salaire restent ceux de la fiche.
    if (maj) {
      const b = bloquants.filter(x => x !== 'Poste')
      const inc = incomplets.filter(x => x !== 'Salaire journalier')
      if (b.length) { Alert.alert('Il manque des informations', `Obligatoire : ${b.join(', ')}.`); return }
      if (!inc.length) { envoyer(null); return }
      Alert.alert('Informations incomplètes',
        `Encore à compléter : ${inc.join(', ')}.\n\nTu peux envoyer quand même : la RH valide ce qui est rempli.`,
        [{ text: 'Compléter', style: 'cancel' }, { text: 'Envoyer quand même', onPress: () => envoyer(null) }])
      return
    }
    if (direct && !restoChoisi) bloquants.unshift('Restaurant')
    if (bloquants.length) {
      Alert.alert('Il manque des informations', `Obligatoire : ${bloquants.join(', ')}.`)
      return
    }
    if (direct) {
      if (!incomplets.length) { enregistrerDirect(); return }
      Alert.alert(
        'Informations incomplètes',
        `Informations incomplètes : ${incomplets.join(', ')}.\n\nTu peux enregistrer quand même et compléter avant de générer le contrat.`,
        [
          { text: 'Compléter', style: 'cancel' },
          { text: 'Enregistrer quand même', onPress: enregistrerDirect },
        ],
      )
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
      <Champ styles={styles} colors={colors} value={form[cle]} onChangeText={v => majChamp(cle, v)} {...props} />
    </>
  )

  const vignette = (url, onRetirer) => (
    <View key={url} style={{ marginRight: 8, marginBottom: 8 }}>
      {estPdf(url)
        ? (
          <TouchableOpacity onPress={() => Linking.openURL(url)} style={{
            width: 84, height: 84, borderRadius: 10, backgroundColor: teinte(principale, '1A'), alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 30 }}>📄</Text>
            <Text style={{ color: principale, fontWeight: '800', fontSize: 12 }}>PDF</Text>
          </TouchableOpacity>
        )
        : <Image source={{ uri: url }} style={{ width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surfaceAlt }} />}
      <TouchableOpacity onPress={onRetirer} hitSlop={8} style={{
        position: 'absolute', top: -6, right: -6, backgroundColor: '#C2462B', borderRadius: 11, width: 22, height: 22,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✕</Text>
      </TouchableOpacity>
    </View>
  )

  // Rangée de boutons d'ajout : appareil photo, galerie et, pour les papiers, PDF.
  const boutonsAjout = (dossier, onAjoute, { pdf = true } = {}) => (photoEnCours === dossier
    ? <ActivityIndicator color={accent} style={{ marginVertical: 10 }} />
    : (
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
        <Bouton flex styles={styles} couleur={principale} label="📷 Appareil"
          onPress={async () => { const u = await joindre(dossier, 'camera'); if (u) onAjoute(u) }} />
        <Bouton flex styles={styles} couleur={principale} label="🖼️ Galerie"
          onPress={async () => { const u = await joindre(dossier, 'galerie'); if (u) onAjoute(u) }} />
        {pdf && (
          <Bouton flex styles={styles} couleur={principale} label="📄 PDF"
            onPress={async () => { const u = await joindre(dossier, 'pdf'); if (u) onAjoute(u) }} />
        )}
      </View>
    ))

  return (
    <Feuille visible={visible} styles={styles} onFermer={onFermer}
      titre={maj ? 'Mettre à jour la fiche' : demande ? 'Corriger la demande' : 'Nouveau travailleur'}
      sous={demande?.motif_refus ? `Refus de la RH : ${demande.motif_refus}` : maj ? travailleur.nom : direct ? 'Ajout direct — actif tout de suite' : restaurant?.nom}>

      {direct && (
        <>
          <Libelle styles={styles}>Restaurant *</Libelle>
          <Puces styles={styles} actif={restoId} onChoisir={setRestoId} elements={restaurants.map(r => ({ cle: r.id, label: r.nom }))} />
        </>
      )}

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
          {boutonsAjout('photos', u => majChamp('photo_url', u), { pdf: false })}
          <Text style={[styles.infoTxt, { marginTop: 6, flex: 0 }]}>
            {form.photo_url ? 'Touche un bouton pour la remplacer. ' : ''}Obligatoire : la RH doit pouvoir reconnaître la personne.
          </Text>
        </View>
      </View>

      {maj && (
        <>
          <ChampDate label="Date d'embauche (premier jour de travail)" valeur={form.date_embauche}
            onChange={v => majChamp('date_embauche', v)} couleur={principale} />
          <Info icone="📅" styles={styles}>C'est la date de début de son contrat.</Info>
        </>
      )}

      <Libelle styles={styles}>Civilité</Libelle>
      <Puces styles={styles} actif={form.civilite} onChoisir={v => majChamp('civilite', v)} elements={CIVILITES.map(c => ({ cle: c, label: c === 'M.' ? 'Monsieur' : 'Madame' }))} />

      {champTexte('nom_famille', 'Nom *', { placeholder: 'Ex. GBADIE', autoCapitalize: 'characters' })}
      {champTexte('prenoms', 'Prénoms *', { placeholder: 'Ex. Gogre Tanguy' })}

      <ChampDate label="Date de naissance" valeur={form.date_naissance} onChange={v => majChamp('date_naissance', v)}
        maxDate={new Date().toISOString().slice(0, 10)} couleur={principale} naissance />
      {champTexte('lieu_naissance', 'Lieu de naissance', { placeholder: 'Ex. Yopougon' })}
      {champTexte('nationalite', 'Nationalité', { placeholder: 'Ex. Ivoirienne' })}

      <Libelle styles={styles}>Situation de famille</Libelle>
      <Puces styles={styles} actif={form.situation_famille} onChoisir={v => majChamp('situation_famille', v)} elements={SITUATIONS_FAMILLE.map(s => ({ cle: s, label: s }))} />

      {champTexte('cni_numero', "N° de carte d'identité (CNI)", { placeholder: 'Ex. CI007879705', autoCapitalize: 'characters' })}
      {champTexte('nni_numero', 'NNI (si connu)', { placeholder: 'Ex. 11919240401', keyboardType: 'number-pad' })}
      {champTexte('lieu_residence', 'Lieu de résidence', { placeholder: 'Ex. Yopougon' })}
      {champTexte('contact', 'Téléphone', { placeholder: 'Ex. 01 01 35 48 69', keyboardType: 'phone-pad' })}

      {!maj && (
        <>
      <Libelle styles={styles}>Poste *</Libelle>
      <Puces petit styles={styles} actif={form.poste} onChoisir={v => majChamp('poste', v)} elements={POSTES_COURANTS.map(p => ({ cle: p, label: p }))} />
      <Champ styles={styles} colors={colors} value={form.poste} onChangeText={v => majChamp('poste', v)} placeholder="Ou écris le poste" />

      {champTexte('salaire_journalier', direct ? 'Salaire journalier (paie, F)' : 'Salaire journalier proposé (F)', { placeholder: 'Ex. 3000', keyboardType: 'number-pad' })}
      <ChampDate label="Date d'embauche (premier jour de travail)" valeur={form.date_embauche} onChange={v => majChamp('date_embauche', v)} couleur={principale} />
        </>
      )}

      <Libelle styles={styles}>Carte d&apos;identité (recto, verso) — facultatif</Libelle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 2 }}>
        {form.piece_identite_urls.map(u => vignette(u, () => majChamp('piece_identite_urls', form.piece_identite_urls.filter(x => x !== u))))}
      </View>
      {boutonsAjout('cni', u => setForm(f => ({ ...f, piece_identite_urls: [...f.piece_identite_urls, u] })))}

      <Libelle styles={styles}>Autres papiers — facultatif</Libelle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 2 }}>
        {form.papiers_urls.map(u => vignette(u, () => majChamp('papiers_urls', form.papiers_urls.filter(x => x !== u))))}
      </View>
      {boutonsAjout('papiers', u => setForm(f => ({ ...f, papiers_urls: [...f.papiers_urls, u] })))}
      <View style={{ height: 8 }} />

      {doublonDirect && (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: teinte('#C27C1A', '14'), marginBottom: 10 }}>
          <Text style={{ color: '#C27C1A', fontWeight: '700', marginBottom: 6 }}>
            Ce travailleur existe peut-être déjà : {doublonDirect.nom}{doublonDirect.restaurants?.nom ? ` (${doublonDirect.restaurants.nom})` : ''}{doublonDirect.statut === 'archive' ? ' — ancien employé' : ''}
          </Text>
          <Puces petit styles={styles} actif={reutiliser} onChoisir={setReutiliser} elements={[
            { cle: true, label: "Réactiver l'ancienne fiche" },
            { cle: false, label: 'Créer une nouvelle fiche' },
          ]} />
        </View>
      )}

      <Info icone="ℹ️" styles={styles}>
        {maj
          ? 'La RH vérifie puis met la fiche à jour ; rien ne change avant sa validation.'
          : direct
          ? 'Le travailleur est actif tout de suite (équipe, pointage, POS). Son contrat se génère ensuite dans Contrats.'
          : 'Le salaire du contrat et le type de contrat seront fixés par la RH.'}
      </Info>
      <View style={{ height: 12 }} />
      {envoi
        ? <ActivityIndicator size="large" color={accent} />
        : <Bouton grand styles={styles} couleur={principale} variante="plein"
          label={direct ? 'Enregistrer le travailleur' : maj ? 'Envoyer à la RH' : demande ? 'Renvoyer à la RH' : 'Envoyer à la RH'} onPress={valider} />}
    </Feuille>
  )
}

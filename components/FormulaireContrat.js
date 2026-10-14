// ──────────────────────────────────────────────────────────────────────────────
// Saisie d'un contrat de travail — création ou correction.
//
// L'ordre des champs suit le raisonnement du RH : quel type, à partir de quand,
// pour combien de temps, et la preuve. La date de fin est un résultat calculé,
// mais elle reste modifiable pour le contrat qui ne tombe pas sur un nombre
// entier de mois (« jusqu'au 30 juin »). La corriger à la main met duree_mois à
// null : on n'enregistre pas une durée qui ne correspond plus aux dates.
// Les dates se choisissent au calendrier (ChampDate), jamais au clavier.
// ──────────────────────────────────────────────────────────────────────────────
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Text, View } from 'react-native'

import ChampDate from './ChampDate'
import { Bouton, Champ, Feuille, Libelle, Puces, teinte, useEcranModerne } from './ui/EcranModerne'

import {
  TYPES_CONTRAT, DUREES_MOIS, calculerDateFin, validerFormulaireContrat,
  validerDureeLibre, aujourdhuiISO, ajouterJours, finEffective, formatFR,
} from '../lib/contrats'
import { uploaderFichier } from '../lib/uploadFichier'

const LIBELLE_DUREE = { 1: '1 mois', 2: '2 mois', 3: '3 mois', 6: '6 mois', 12: '1 an' }

// Premier contrat : la date d'embauche. Renouvellement : le lendemain de la fin
// du dernier contrat, pour ne pas laisser de trou par inadvertance.
export function debutParDefaut(travailleur, contratsExistants) {
  const finsConnues = (contratsExistants || [])
    .map(finEffective)
    .filter(Boolean)
    .sort()
  if (finsConnues.length > 0) return ajouterJours(finsConnues[finsConnues.length - 1], 1)
  return travailleur?.date_embauche || aujourdhuiISO()
}

export default function FormulaireContrat({
  visible, travailleur, contratsExistants, contratEdite, onFermer, onEnregistrer,
}) {
  const { styles, colors, accent, principale } = useEcranModerne('orange')
  const enCorrection = !!contratEdite

  const [type, setType] = useState('CDD')
  const [dateDebut, setDateDebut] = useState('')
  const [duree, setDuree] = useState(3)
  const [dureeLibre, setDureeLibre] = useState('')
  const [dateFin, setDateFin] = useState('')
  const [finManuelle, setFinManuelle] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [upload, setUpload] = useState(false)
  const [enreg, setEnreg] = useState(false)

  useEffect(() => {
    if (!visible) return
    if (contratEdite) {
      setType(contratEdite.type)
      setDateDebut(contratEdite.date_debut)
      setDateFin(contratEdite.date_fin || '')
      // Un contrat sans duree_mois a eu sa date de fin saisie à la main.
      const connue = DUREES_MOIS.includes(contratEdite.duree_mois)
      setDuree(connue ? contratEdite.duree_mois : (contratEdite.duree_mois ? 'autre' : 3))
      setDureeLibre(connue || !contratEdite.duree_mois ? '' : String(contratEdite.duree_mois))
      setFinManuelle(!contratEdite.duree_mois && !!contratEdite.date_fin)
    } else {
      setType('CDD')
      setDateDebut(debutParDefaut(travailleur, contratsExistants))
      setDuree(3)
      setDureeLibre('')
      setDateFin('')
      setFinManuelle(false)
    }
    setPhoto(null)
    // Volontairement limité : recharger la liste des contrats pendant la saisie
    // ne doit pas remettre le formulaire à zéro sous les doigts du RH.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, travailleur?.id, contratEdite?.id])

  const estCDI = type === 'CDI'
  const dureeLibreChoisie = duree === 'autre'

  // Recalcule la date de fin tant que l'utilisateur ne l'a pas reprise à la main.
  useEffect(() => {
    if (estCDI) { setDateFin(''); return }
    if (finManuelle) return
    const mois = dureeLibreChoisie ? validerDureeLibre(dureeLibre).mois : duree
    setDateFin(mois && dateDebut ? calculerDateFin(dateDebut, mois) : '')
  }, [estCDI, finManuelle, dureeLibreChoisie, dureeLibre, duree, dateDebut])

  const dureeMois = estCDI || finManuelle
    ? null
    : (dureeLibreChoisie ? validerDureeLibre(dureeLibre).mois : duree)

  const photoUrl = photo?.url || contratEdite?.photo_url || null
  const photoType = photo?.type || contratEdite?.photo_type || 'photo'

  const erreurDuree = (!estCDI && dureeLibreChoisie && !finManuelle)
    ? validerDureeLibre(dureeLibre).erreur
    : null
  const validation = erreurDuree
    ? { ok: false, erreur: erreurDuree }
    : validerFormulaireContrat({
        type,
        date_debut: dateDebut,
        date_fin: estCDI ? '' : dateFin,
        duree_mois: dureeMois,
        photo_url: photoUrl,
      })

  function choisirDuree(d) {
    setDuree(d)
    setFinManuelle(false)   // reprendre un bouton reprend la main sur la date
  }

  async function prendrePhoto() {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85,
    })
    if (r.canceled) return
    await televerser(r.assets[0].uri, false)
  }

  async function prendrePDF() {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' })
    if (r.canceled) return
    await televerser(r.assets[0].uri, true)
  }

  async function televerser(uri, estPDF) {
    setUpload(true)
    try {
      const res = await uploaderFichier({
        uri, dossier: 'documents-travailleurs', prefixe: 'contrat', estPDF,
      })
      setPhoto(res)
    } catch {
      Alert.alert('Erreur', "Impossible d'envoyer le fichier. Vérifie ta connexion.")
    }
    setUpload(false)
  }

  async function enregistrer() {
    if (!validation.ok) {
      Alert.alert('Contrat incomplet', validation.erreur)
      return
    }
    setEnreg(true)
    await onEnregistrer({
      type,
      date_debut: dateDebut,
      date_fin: estCDI ? null : dateFin,
      duree_mois: dureeMois,
      photo_url: photoUrl,
      photo_type: photoType,
    })
    setEnreg(false)
  }

  const vert = '#3B8D2F'

  return (
    <Feuille visible={visible} titre={enCorrection ? 'Corriger le contrat' : 'Nouveau contrat'} sous={travailleur?.nom}
      onFermer={onFermer} styles={styles}>
      <Libelle styles={styles}>Type de contrat *</Libelle>
      <Puces styles={styles} actif={type} onChoisir={setType} elements={TYPES_CONTRAT.map(t => ({ cle: t, label: t }))} />

      <ChampDate label="Date de début *" valeur={dateDebut} onChange={setDateDebut} couleur={principale} />

      {!estCDI && (
        <>
          <Libelle styles={styles}>Durée *</Libelle>
          <Puces styles={styles} actif={finManuelle ? null : duree} onChoisir={choisirDuree}
            elements={[...DUREES_MOIS.map(d => ({ cle: d, label: LIBELLE_DUREE[d] })), { cle: 'autre', label: 'Autre' }]} />

          {dureeLibreChoisie && (
            <Champ styles={styles} colors={colors} placeholder="Nombre de mois (ex : 4)" keyboardType="number-pad"
              value={dureeLibre} onChangeText={t => { setDureeLibre(t); setFinManuelle(false) }} />
          )}

          <ChampDate label="Date de fin *" valeur={dateFin} couleur={principale} minDate={dateDebut || undefined}
            onChange={d => { setDateFin(d); setFinManuelle(true) }} />
          <Text style={[styles.infoTxt, { fontSize: 12, marginTop: -4, marginBottom: 16 }]}>
            {finManuelle
              ? 'Date choisie à la main — la durée ne sera pas enregistrée.'
              : dateFin
                ? `Calculée : se termine le ${formatFR(dateFin)}.`
                : 'Choisis la date de début et la durée.'}
          </Text>
        </>
      )}

      {estCDI && (
        <View style={{ backgroundColor: teinte(principale, '14'), borderRadius: 14, padding: 14, marginBottom: 16 }}>
          <Text style={[styles.infoTxt, { color: colors.text }]}>
            Un CDI n'a pas de date de fin : aucune alerte, aucune désactivation automatique.
          </Text>
        </View>
      )}

      <Libelle styles={styles}>Contrat signé * (photo ou PDF)</Libelle>
      {/* Deux boutons distincts, jamais un menu : sur le web, Alert.alert
          passe par window.confirm, qui ne peut offrir que deux issues —
          le troisième choix serait inatteignable. */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        <Bouton label="📷 Photo" couleur={accent} flex grand styles={styles} onPress={prendrePhoto} disabled={upload} />
        <Bouton label="📄 PDF" couleur={accent} flex grand styles={styles} onPress={prendrePDF} disabled={upload} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        {upload && <ActivityIndicator size="small" color={accent} />}
        <Text style={[styles.infoTxt, photoUrl && !upload && { color: vert, fontWeight: '700' }]}>
          {upload
            ? 'Envoi en cours…'
            : photo
              ? `✓ ${photo.type === 'pdf' ? 'PDF' : 'Photo'} ajouté`
              : contratEdite?.photo_url
                ? `✓ ${contratEdite.photo_type === 'pdf' ? 'PDF' : 'Photo'} déjà enregistré — choisis un fichier pour le remplacer`
                : 'Aucun fichier choisi'}
        </Text>
      </View>

      {!validation.ok && (
        <View style={[styles.refus, { marginBottom: 14, marginTop: 0 }]}>
          <Text style={styles.refusTxt}>{validation.erreur}</Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Bouton label="Annuler" variante="contour" couleur={colors.textSecondary} flex grand styles={styles} onPress={onFermer} />
        <Bouton label={enreg ? 'Enregistrement…' : 'Enregistrer'} variante="plein" couleur={principale} flex grand styles={styles}
          onPress={enregistrer} disabled={!validation.ok || enreg} />
      </View>
    </Feuille>
  )
}

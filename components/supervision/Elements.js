// ──────────────────────────────────────────────────────────────────────────────
// Petits éléments partagés des écrans de supervision : étoiles, photo
// (appareil ou galerie), grosse note /20.
// ──────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { ActivityIndicator, Alert, Image, Linking, Text, TouchableOpacity, View } from 'react-native'
import { appreciation } from '../../lib/noteCaissier'
import { estPhotoEnAttente } from '../../lib/photoQueue'
import { LIBELLES_ETOILES, fmtNote } from '../../lib/supervision'
import { usePhoto } from '../../lib/usePhoto'
import PhotoJustificatif, { photoConsultable } from '../PhotoJustificatif'

export const SARCELLE = '#0F766E'
export const TONS = { vert: '#0E8A6B', bleu: '#2F7FD8', orange: '#C27C1A', rouge: '#C2462B', gris: '#64748B' }

/** 5 étoiles touchables ; `petit` pour les lignes de travailleurs. */
export function Etoiles({ valeur, onChange, petit = false, lectureSeule = false, colors }) {
  const taille = petit ? 22 : 30
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: petit ? 2 : 6 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <TouchableOpacity key={i} disabled={lectureSeule} onPress={() => onChange?.(i === valeur ? null : i)}
          hitSlop={4} accessibilityRole="button" accessibilityLabel={`${i} étoile${i > 1 ? 's' : ''}, ${LIBELLES_ETOILES[i]}`}
          style={{ minWidth: petit ? 26 : 40, minHeight: petit ? 26 : 40, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: taille, color: i <= (valeur || 0) ? '#F5A524' : colors.border }}>★</Text>
        </TouchableOpacity>
      ))}
      {!petit && valeur ? <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginLeft: 4 }}>{LIBELLES_ETOILES[valeur]}</Text> : null}
    </View>
  )
}

/**
 * Photo : vignette + boutons « Appareil » / « Galerie ». Une photo restée en
 * attente (pas de réseau) est refusée : la supervision écrit directement en
 * base, le jeton ne serait jamais remplacé par la vraie photo.
 */
export function ChampPhoto({ uri, onChange, dossier = 'supervision', requis = false, libelle = 'Photo', colors }) {
  const { prendrePhoto, choisirPhoto } = usePhoto()
  const [envoi, setEnvoi] = useState(false)
  async function prendre(source) {
    setEnvoi(true)
    try {
      const url = source === 'galerie' ? await choisirPhoto(dossier) : await prendrePhoto(dossier, { cameraWeb: true })
      if (!url) return
      if (estPhotoEnAttente(url)) {
        Alert.alert('Pas de réseau', "La photo n'a pas pu partir. Reprenez-la quand le réseau revient.")
        return
      }
      onChange(url)
    } finally { setEnvoi(false) }
  }
  const bouton = (label, source) => (
    <TouchableOpacity onPress={() => prendre(source)} disabled={envoi}
      style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: (requis && !uri ? TONS.rouge : SARCELLE) + '66',
        backgroundColor: SARCELLE + '12', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 13.5, fontWeight: '800', color: SARCELLE }}>{label}</Text>
    </TouchableOpacity>
  )
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: requis && !uri ? TONS.rouge : colors.textMuted, marginBottom: 6 }}>
        {libelle}{requis ? ' (obligatoire)' : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        {uri ? (
          <TouchableOpacity onPress={() => photoConsultable(uri) && Linking.openURL(uri)}>
            <PhotoJustificatif uri={uri} style={{ width: 54, height: 54, borderRadius: 10 }} compact />
          </TouchableOpacity>
        ) : null}
        {envoi ? <ActivityIndicator color={SARCELLE} style={{ flex: 1 }} /> : (
          <>
            {bouton(uri ? '📷 Reprendre' : '📷 Appareil', 'camera')}
            {bouton('🖼️ Galerie', 'galerie')}
          </>
        )}
        {uri && !envoi ? (
          <TouchableOpacity onPress={() => onChange(null)} hitSlop={8} style={{ padding: 6 }}>
            <Text style={{ fontSize: 16, color: colors.textMuted }}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  )
}

/** Vignette d'une photo enregistrée, qui s'ouvre en grand. */
export function Vignette({ uri, taille = 64, libelle }) {
  if (!uri) return null
  return (
    <TouchableOpacity onPress={() => photoConsultable(uri) && Linking.openURL(uri)} style={{ alignItems: 'center' }}>
      {photoConsultable(uri)
        ? <Image source={{ uri }} style={{ width: taille, height: taille, borderRadius: 10 }} />
        : <PhotoJustificatif uri={uri} style={{ width: taille, height: taille, borderRadius: 10 }} compact />}
      {libelle ? <Text style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>{libelle}</Text> : null}
    </TouchableOpacity>
  )
}

/** Couleur d'une note /20 (mêmes seuils que la note des caissiers). */
export function couleurNote(note) {
  return TONS[appreciation(note).ton] || TONS.gris
}

/** Grosse pastille « 15,5 /20 · Très bien ». */
export function PastilleNote({ note, petite = false }) {
  const c = couleurNote(note)
  const { mot } = appreciation(note)
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', minWidth: petite ? 58 : 92, paddingVertical: petite ? 6 : 10, paddingHorizontal: 8,
      borderRadius: petite ? 12 : 18, backgroundColor: c + '1C', borderWidth: 1.5, borderColor: c + '55' }}>
      <Text style={{ fontSize: petite ? 18 : 30, fontWeight: '900', color: c, letterSpacing: -0.5 }}>
        {fmtNote(note)}<Text style={{ fontSize: petite ? 11 : 14, fontWeight: '700' }}>/20</Text>
      </Text>
      {!petite ? <Text style={{ fontSize: 11.5, fontWeight: '800', color: c, marginTop: 1 }}>{mot}</Text> : null}
    </View>
  )
}

/** « 15/10 à 09:40 » (heure d'Abidjan = UTC). */
export function dateHeure(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} à ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export const dateCourte = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '—')

export function texteJoursSansVisite(r) {
  if (r.joursSansVisite === null) return 'Jamais visité'
  if (r.joursSansVisite === 0) return "Visité aujourd'hui"
  if (r.joursSansVisite === 1) return 'Visité hier'
  return `Visité il y a ${r.joursSansVisite} jours`
}

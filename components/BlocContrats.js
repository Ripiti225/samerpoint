// ──────────────────────────────────────────────────────────────────────────────
// Le contrat en cours d'un travailleur, et son historique replié en dessous.
//
// Le badge d'échéance s'allume à 30 jours : plus tôt il n'apprend rien, plus
// tard il prévient trop tard pour préparer un renouvellement.
// ──────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

import { contratEnCours, statutContrat, joursRestants, aujourdhuiISO } from '../lib/contrats'

const SEUIL_BADGE_JOURS = 30

function formatFR(iso) {
  if (!iso) return ''
  const [a, m, j] = iso.split('-')
  return `${j}/${m}/${a}`
}

function libelleStatut(contrat, jour) {
  const s = statutContrat(contrat, jour)
  if (s === 'rompu') return `rompu le ${formatFR(contrat.cloture_le)}${contrat.cloture_motif ? ` · ${contrat.cloture_motif}` : ''}`
  if (s === 'expire') return 'terminé'
  if (s === 'a_venir') return 'à venir'
  return 'en cours'
}

export function badgeEcheance(contrat, jour) {
  if (!contrat || contrat.cloture_le || !contrat.date_fin) return null
  const restants = joursRestants(contrat, jour)
  if (restants === null || restants < 0 || restants > SEUIL_BADGE_JOURS) return null
  if (restants === 0) return { texte: "Dernier jour", couleur: '#993C1D' }
  return {
    texte: `Expire dans ${restants} j`,
    couleur: restants <= 7 ? '#993C1D' : '#854F0B',
  }
}

export default function BlocContrats({ travailleur, contrats, colors, onAjouter }) {
  const [ouvert, setOuvert] = useState(false)
  const jour = aujourdhuiISO()
  const liste = contrats || []
  const courant = contratEnCours(liste, jour)
  const historique = liste.filter(c => c.id !== courant?.id)
  const badge = badgeEcheance(courant, jour)

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 14 }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 12 }}>
        Contrat
      </Text>

      {courant ? (
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
              {courant.type}
              {courant.date_fin
                ? ` · ${formatFR(courant.date_debut)} → ${formatFR(courant.date_fin)}`
                : ` · depuis le ${formatFR(courant.date_debut)}`}
            </Text>
            {badge && (
              <View style={{ backgroundColor: badge.couleur, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 11, color: '#fff', fontWeight: '600' }}>{badge.texte}</Text>
              </View>
            )}
          </View>
          {courant.photo_url && (
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
              📄 contrat signé{courant.photo_type === 'pdf' ? ' (PDF)' : ''}
            </Text>
          )}
        </View>
      ) : (
        <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: 12 }}>
          Aucun contrat enregistré
        </Text>
      )}

      {historique.length > 0 && (
        <>
          <TouchableOpacity onPress={() => setOuvert(o => !o)} style={{ paddingVertical: 6 }}>
            <Text style={{ fontSize: 13, color: '#185FA5', fontWeight: '500' }}>
              Historique ({historique.length}) {ouvert ? '▴' : '▾'}
            </Text>
          </TouchableOpacity>
          {ouvert && historique.map(c => (
            <View key={c.id} style={{ paddingVertical: 6, paddingLeft: 10 }}>
              <Text style={{ fontSize: 13, color: colors.text }}>
                {c.type} · {formatFR(c.date_debut)}
                {c.date_fin ? ` → ${formatFR(c.date_fin)}` : ''}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{libelleStatut(c, jour)}</Text>
            </View>
          ))}
        </>
      )}

      <TouchableOpacity
        style={{ marginTop: 10, alignSelf: 'flex-start', backgroundColor: colors.bg, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 0.5, borderColor: colors.border }}
        onPress={onAjouter}
      >
        <Text style={{ fontSize: 13, color: '#185FA5', fontWeight: '500' }}>+ Nouveau contrat</Text>
      </TouchableOpacity>
    </View>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Tous les contrats d'un travailleur, du plus récent au plus ancien.
//
// Le contrat qui fait foi est mis en avant ; les précédents restent listés en
// dessous — ce sont eux la trace, et c'est souvent l'un d'eux qu'il faut
// corriger quand une date a été mal saisie.
//
// Rompre se fait ici, dans un panneau replié : c'est une action rare et lourde,
// elle ne mérite pas un bouton permanent au milieu des autres.
// ──────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Alert, Linking, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

import {
  contratAffiche, statutContrat, rangParType, ordinalFR, formatFR,
  joursRestants, aujourdhuiISO, MOTIFS_RUPTURE, validerCloture,
} from '../lib/contrats'

const COULEUR_STATUT = {
  en_cours: { bg: '#EAF3DE', txt: '#3B6D11', libelle: 'en cours' },
  a_venir:  { bg: '#E6F1FB', txt: '#185FA5', libelle: 'à venir' },
  expire:   { bg: '#F1EFE8', txt: '#444441', libelle: 'terminé' },
  rompu:    { bg: '#FAECE7', txt: '#993C1D', libelle: 'rompu' },
}

export default function FicheContrat({
  visible, travailleur, contrats, colors, onFermer, onRenouveler, onCorriger, onSupprimer, onRompre,
}) {
  const [rupturePour, setRupturePour] = useState(null)   // id du contrat en cours de rupture
  const [dateRupture, setDateRupture] = useState('')
  const [motifRupture, setMotifRupture] = useState('Démission')
  const [motifAutre, setMotifAutre] = useState('')

  const jour = aujourdhuiISO()
  const liste = contrats || []
  const courant = contratAffiche(liste, jour)
  // Du plus récent au plus ancien : on lit un dossier en commençant par la fin.
  const ordonnes = [...liste].sort((a, b) => (a.date_debut < b.date_debut ? 1 : -1))

  function ouvrirRupture(c) {
    setRupturePour(c.id)
    setDateRupture(jour)
    setMotifRupture('Démission')
    setMotifAutre('')
  }

  function confirmerRupture(c) {
    const motif = motifRupture === 'Autre' ? motifAutre.trim() : motifRupture
    const v = validerCloture(c, dateRupture, motif)
    if (!v.ok) {
      Alert.alert('Rupture impossible', v.erreur)
      return
    }
    Alert.alert(
      'Rompre ce contrat',
      `Le ${c.type} de ${travailleur?.nom} sera marqué rompu au ${formatFR(dateRupture)}, motif « ${motif} ». Les alertes d'échéance s'arrêtent.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Rompre',
          style: 'destructive',
          onPress: () => { setRupturePour(null); onRompre(c, dateRupture, motif) },
        },
      ]
    )
  }

  function confirmerSuppression(c) {
    Alert.alert(
      '⚠️ Supprimer ce contrat',
      `Le ${c.type} du ${formatFR(c.date_debut)} sera effacé définitivement. À n'utiliser que pour une saisie erronée — pour un contrat qui s'arrête, choisis « Rompre ».`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => onSupprimer(c) },
      ]
    )
  }

  function renderContrat(c, estCourant) {
    const statut = statutContrat(c, jour)
    const st = COULEUR_STATUT[statut] || COULEUR_STATUT.expire
    const rang = rangParType(liste, c)
    const restants = joursRestants(c, jour)
    const peutRompre = statut === 'en_cours' || statut === 'a_venir'

    return (
      <View
        key={c.id}
        style={{
          backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
          borderWidth: estCourant ? 1.5 : 0.5, borderColor: estCourant ? '#185FA5' : colors.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>
            {c.type}{rang > 0 ? ` · ${ordinalFR(rang)} contrat` : ''}
          </Text>
          <View style={{ backgroundColor: st.bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 11, color: st.txt, fontWeight: '600' }}>{st.libelle}</Text>
          </View>
        </View>

        <Text style={{ fontSize: 13, color: colors.textMuted }}>
          {c.date_fin
            ? `${formatFR(c.date_debut)} → ${formatFR(c.date_fin)}`
            : `depuis le ${formatFR(c.date_debut)}`}
          {c.duree_mois ? ` · ${c.duree_mois} mois` : ''}
        </Text>

        {statut === 'en_cours' && restants !== null && restants >= 0 && restants <= 30 && (
          <Text style={{ fontSize: 13, color: restants <= 7 ? '#993C1D' : '#854F0B', marginTop: 4, fontWeight: '600' }}>
            {restants === 0 ? 'Dernier jour' : `Expire dans ${restants} jours`}
          </Text>
        )}
        {statut === 'rompu' && (
          <Text style={{ fontSize: 13, color: '#993C1D', marginTop: 4 }}>
            Rompu le {formatFR(c.cloture_le)}{c.cloture_motif ? ` · ${c.cloture_motif}` : ''}
          </Text>
        )}

        {c.photo_url && (
          <TouchableOpacity onPress={() => Linking.openURL(c.photo_url)} style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 13, color: '#185FA5' }}>
              📄 Voir le contrat signé{c.photo_type === 'pdf' ? ' (PDF)' : ''}
            </Text>
          </TouchableOpacity>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {peutRompre && (
            <TouchableOpacity
              style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.bg }}
              onPress={() => ouvrirRupture(c)}
            >
              <Text style={{ fontSize: 12, color: '#993C1D', fontWeight: '600' }}>Rompre</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.bg }}
            onPress={() => onCorriger(c)}
          >
            <Text style={{ fontSize: 12, color: '#185FA5', fontWeight: '600' }}>Corriger</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.bg }}
            onPress={() => confirmerSuppression(c)}
          >
            <Text style={{ fontSize: 12, color: colors.textMuted, fontWeight: '600' }}>Supprimer</Text>
          </TouchableOpacity>
        </View>

        {rupturePour === c.id && (
          <View style={{ marginTop: 14, padding: 14, borderRadius: 12, backgroundColor: colors.bg }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>
              Date de rupture
            </Text>
            <TextInput
              style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, fontSize: 14, color: colors.text, marginBottom: 12 }}
              placeholder="AAAA-MM-JJ"
              value={dateRupture}
              onChangeText={setDateRupture}
              placeholderTextColor="#bbb"
            />
            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>
              Motif
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {MOTIFS_RUPTURE.map(m => (
                <TouchableOpacity
                  key={m}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
                    backgroundColor: motifRupture === m ? '#185FA5' : colors.surface,
                  }}
                  onPress={() => setMotifRupture(m)}
                >
                  <Text style={{ fontSize: 12, color: motifRupture === m ? '#fff' : colors.textMuted }}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {motifRupture === 'Autre' && (
              <TextInput
                style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, fontSize: 14, color: colors.text, marginBottom: 12 }}
                placeholder="Préciser le motif"
                value={motifAutre}
                onChangeText={setMotifAutre}
                placeholderTextColor="#bbb"
              />
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center' }}
                onPress={() => setRupturePour(null)}
              >
                <Text style={{ fontSize: 13, color: colors.textMuted, fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#993C1D', alignItems: 'center' }}
                onPress={() => confirmerRupture(c)}
              >
                <Text style={{ fontSize: 13, color: '#fff', fontWeight: '700' }}>Confirmer</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    )
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ backgroundColor: colors.headerBg, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={onFermer}>
            <Text style={{ fontSize: 16, color: colors.primaryText, fontWeight: '500' }}>✕ Fermer</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.surface }}>Contrats</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={{ padding: 16 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{travailleur?.nom}</Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: 18 }}>
            {travailleur?.restaurants?.nom || 'Sans restaurant'} · {travailleur?.poste || 'Sans poste'}
          </Text>

          <TouchableOpacity
            style={{ backgroundColor: '#185FA5', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 18 }}
            onPress={onRenouveler}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
              {liste.length === 0 ? '+ Enregistrer un contrat' : '+ Renouveler le contrat'}
            </Text>
          </TouchableOpacity>

          {liste.length === 0 && (
            <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingVertical: 20 }}>
              Aucun contrat enregistré pour ce travailleur.
            </Text>
          )}

          {ordonnes.map(c => renderContrat(c, c.id === courant?.id))}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  )
}

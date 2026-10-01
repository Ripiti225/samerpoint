// ──────────────────────────────────────────────────────────────────────────────
// Choix du travailleur à qui attribuer un contrat.
//
// Recherche par nom et filtre par restaurant : avec sept points de vente et une
// centaine de fiches, une simple liste déroulante ne suffit pas.
// ──────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

export default function SelecteurTravailleur({
  visible, travailleurs, restaurants, colors, onFermer, onChoisir,
}) {
  const [recherche, setRecherche] = useState('')
  const [filtreResto, setFiltreResto] = useState('tous')

  const liste = (travailleurs || []).filter(t => {
    const matchNom = t.nom?.toLowerCase().includes(recherche.trim().toLowerCase())
    const matchResto = filtreResto === 'tous' || t.restaurant_id === filtreResto
    return matchNom && matchResto
  })

  const puce = { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.bg, borderWidth: 0.5, borderColor: colors.border }
  const puceActive = { backgroundColor: '#185FA5', borderColor: '#185FA5' }
  const txtPuce = actif => ({ fontSize: 12, color: actif ? '#fff' : colors.textMuted, fontWeight: actif ? '600' : '400' })

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Quel travailleur ?</Text>
            <TouchableOpacity onPress={onFermer} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ fontSize: 22, color: colors.textMuted }}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={{ padding: 16, paddingBottom: 8 }}>
            <TextInput
              style={{ backgroundColor: colors.bg, borderRadius: 10, padding: 12, fontSize: 14, color: colors.text }}
              placeholder="🔍 Rechercher un nom…"
              value={recherche}
              onChangeText={setRecherche}
              placeholderTextColor="#bbb"
            />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxHeight: 46, paddingHorizontal: 16 }}>
            <TouchableOpacity style={[puce, { marginRight: 8 }, filtreResto === 'tous' && puceActive]} onPress={() => setFiltreResto('tous')}>
              <Text style={txtPuce(filtreResto === 'tous')}>Tous</Text>
            </TouchableOpacity>
            {(restaurants || []).map(r => (
              <TouchableOpacity
                key={r.id}
                style={[puce, { marginRight: 8 }, filtreResto === r.id && puceActive]}
                onPress={() => setFiltreResto(r.id)}
              >
                <Text style={txtPuce(filtreResto === r.id)}>{r.nom}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView style={{ padding: 16 }}>
            {liste.length === 0 && (
              <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingVertical: 30 }}>
                Aucun travailleur ne correspond.
              </Text>
            )}
            {liste.map(t => (
              <TouchableOpacity
                key={t.id}
                style={{ backgroundColor: colors.bg, borderRadius: 12, padding: 14, marginBottom: 8 }}
                onPress={() => onChoisir(t)}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{t.nom}</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  {t.restaurants?.nom || 'Sans restaurant'} · {t.poste || 'Sans poste'}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={{ height: 30 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

import { useState } from 'react'
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

const POSTES = ['Gérant', 'Sous-gérant', 'Caissier/re', 'Serveur/se', 'Comptoiriste', 'Cuisinier', 'Chef cuisinier', 'Pizzaïo', 'Barman']

function normaliserPoste(poste) {
  if (!poste) return ''
  const p = poste.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (p.includes('sous') && p.includes('gerant')) return 'Sous-gérant'
  if (p.includes('gerant')) return 'Gérant'
  if (p.includes('caissier') || p.includes('caissiere')) return 'Caissier/re'
  if (p.includes('serveur') || p.includes('serveuse')) return 'Serveur/se'
  if (p.includes('comptoir')) return 'Comptoiriste'
  if (p.includes('chef') && p.includes('cuisinier')) return 'Chef cuisinier'
  if (p.includes('cuisinier')) return 'Cuisinier'
  if (p.includes('pizza')) return 'Pizzaïo'
  if (p.includes('bar')) return 'Barman'
  return poste
}

export default function FormulaireTravailleur({ form, setForm, colors, nomEditable = true }) {
  const [showPostes, setShowPostes] = useState(false)
  const label = {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase',
  }
  const input = {
    backgroundColor: colors.bg, borderRadius: 12, padding: 14,
    fontSize: 15, color: colors.text, marginBottom: 14,
  }
  const choix = {
    flex: 1, padding: 10, borderRadius: 10,
    backgroundColor: colors.bg, alignItems: 'center',
    borderWidth: 0.5, borderColor: colors.border,
  }
  const choixActive = { backgroundColor: '#185FA5', borderColor: '#185FA5' }

  return (
    <>
      <Text style={label}>Nom complet *</Text>
      <TextInput
        style={[input, !nomEditable && { opacity: 0.6 }]}
        placeholder="Ex: Kouamé Assi"
        value={form.nom || ''}
        onChangeText={v => setForm(p => ({ ...p, nom: v }))}
        placeholderTextColor="#bbb"
        editable={nomEditable}
      />

      <Text style={label}>Téléphone</Text>
      <TextInput
        style={input}
        placeholder="Ex: +225 07 00 00 00 00"
        value={form.contact || ''}
        onChangeText={v => setForm(p => ({ ...p, contact: v }))}
        placeholderTextColor="#bbb"
        keyboardType="phone-pad"
      />

      <Text style={label}>Poste *</Text>
      <TouchableOpacity
        style={[input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
        onPress={() => setShowPostes(true)}
      >
        <Text style={{ fontSize: 15, color: form.poste ? colors.text : '#bbb' }}>
          {normaliserPoste(form.poste) || 'Sélectionner un poste...'}
        </Text>
        <Text style={{ color: colors.textMuted }}>▾</Text>
      </TouchableOpacity>

      <Modal visible={showPostes} transparent animationType="fade">
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 }} activeOpacity={1} onPress={() => setShowPostes(false)}>
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden' }}>
            <Text style={{ padding: 16, fontSize: 14, fontWeight: '700', color: colors.textMuted, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
              Sélectionner un poste
            </Text>
            <ScrollView>
              {POSTES.map((p, i) => (
                <TouchableOpacity
                  key={p}
                  style={{ padding: 16, borderBottomWidth: i < POSTES.length - 1 ? 0.5 : 0, borderBottomColor: colors.border, backgroundColor: normaliserPoste(form.poste) === p ? '#EBF3FF' : 'transparent' }}
                  onPress={() => { setForm(prev => ({ ...prev, poste: p })); setShowPostes(false) }}
                >
                  <Text style={{ fontSize: 15, color: normaliserPoste(form.poste) === p ? '#185FA5' : colors.text, fontWeight: normaliserPoste(form.poste) === p ? '600' : '400' }}>
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Text style={label}>Type de contrat</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {['CDI', 'CDD', 'Journalier'].map(c => (
          <TouchableOpacity
            key={c}
            style={[choix, form.type_contrat === c && choixActive]}
            onPress={() => setForm(p => ({ ...p, type_contrat: c }))}
          >
            <Text style={{
              fontSize: 13,
              color: form.type_contrat === c ? '#fff' : colors.textMuted,
              fontWeight: form.type_contrat === c ? '600' : '400',
            }}>
              {c}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={label}>Salaire journalier (FCFA)</Text>
      <TextInput
        style={input}
        placeholder="Ex: 5000"
        value={form.salaire_journalier?.toString() || ''}
        onChangeText={v => setForm(p => ({ ...p, salaire_journalier: v }))}
        placeholderTextColor="#bbb"
        keyboardType="numeric"
      />

      <Text style={label}>Date d'embauche</Text>
      <TextInput
        style={input}
        placeholder="AAAA-MM-JJ (ex: 2024-01-15)"
        value={form.date_embauche || ''}
        onChangeText={v => setForm(p => ({ ...p, date_embauche: v }))}
        placeholderTextColor="#bbb"
      />
    </>
  )
}

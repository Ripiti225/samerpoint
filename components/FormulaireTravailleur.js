import { Text, TextInput, TouchableOpacity, View } from 'react-native'

export default function FormulaireTravailleur({ form, setForm, colors, nomEditable = true }) {
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {['Gérant', 'Sous-gérant', 'Caissier/re', 'Serveur/se', 'Comptoiriste', 'Cuisinier', 'Chef cuisinier', 'Pizzaïo', 'Barman'].map(p => (
          <TouchableOpacity
            key={p}
            style={[choix, { flex: 0, paddingHorizontal: 14 }, form.poste === p && choixActive]}
            onPress={() => setForm(prev => ({ ...prev, poste: p }))}
          >
            <Text style={{ fontSize: 13, color: form.poste === p ? '#fff' : colors.textMuted, fontWeight: form.poste === p ? '600' : '400' }}>
              {p}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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

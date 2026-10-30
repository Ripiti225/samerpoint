// Section « Paie » de la fiche d'un CDD/CDI (RH et manager) : les champs du
// bulletin, pré-remplis depuis le contrat signé en cours, et les bulletins
// validés (PDF régénéré depuis le calcul figé).
// Conception : docs/superpowers/specs/2026-10-30-etats-salaire-bulletins-design.md § 4.2
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Text, TextInput, TouchableOpacity, View } from 'react-native'

import { aujourdhuiISO } from '../../lib/contrats'
import { manquesFichePaie } from '../../lib/etatSalaire'
import { chargerBulletinsTravailleur, chargerFichesPaie, enregistrerFichePaie, libelleMois, montantsDuContrat } from '../../lib/paieDb'
import { telechargerBulletins } from '../../lib/pdfBulletin'

const CHAMPS = [
  ['matricule', 'Matricule', 'default'],
  ['coefficient', 'Coefficient', 'decimal-pad'],
  ['categorie', 'Catégorie', 'default'],
  ['salaire_categoriel', 'Salaire catégoriel (F)', 'number-pad'],
  ['sursalaire', 'Sursalaire (F)', 'number-pad'],
  ['prime_transport', 'Prime de transport (F)', 'number-pad'],
  ['prime_tenue', 'Prime de tenue (F)', 'number-pad'],
  ['numero_cnps', 'N° CNPS', 'number-pad'],
  ['parts_fiscales', 'Parts fiscales (1 à 5, par demi-part)', 'decimal-pad'],
  ['personnes_cmu', 'Personnes couvertes CMU', 'number-pad'],
]
const NUMERIQUES = ['coefficient', 'salaire_categoriel', 'sursalaire', 'prime_transport', 'prime_tenue', 'parts_fiscales', 'personnes_cmu']

const versTexte = v => (v === null || v === undefined ? '' : String(v))
const versValeur = (cle, v) => {
  const t = String(v ?? '').trim().replace(',', '.')
  if (!NUMERIQUES.includes(cle)) return t || null
  return t === '' ? null : Number(t)
}

export default function SectionPaie({ trav, contrats, ctx, colors, accent }) {
  const [form, setForm] = useState(null)
  const [bulletins, setBulletins] = useState([])
  const [occupe, setOccupe] = useState(false)

  useEffect(() => {
    let vivant = true
    setForm(null)
    Promise.all([chargerFichesPaie([trav.id]), chargerBulletinsTravailleur(trav.id)])
      .then(([fiches, b]) => {
        if (!vivant) return
        const fiche = fiches[trav.id] || {}
        const contrat = montantsDuContrat(contrats || [], aujourdhuiISO())
        const f = {}
        for (const [cle] of CHAMPS) f[cle] = versTexte(fiche[cle] ?? contrat[cle] ?? null)
        f.mode_paiement = fiche.mode_paiement || ''
        setForm(f)
        setBulletins(b)
      })
      .catch(e => vivant && Alert.alert('Paie', e.message))
    return () => { vivant = false }
  }, [trav.id, contrats])

  if (!form) return <ActivityIndicator color={accent} style={{ marginVertical: 16 }} />

  const valeurs = Object.fromEntries([...CHAMPS.map(([c]) => [c, versValeur(c, form[c])]), ['mode_paiement', form.mode_paiement || null]])
  const manques = manquesFichePaie(valeurs)

  async function enregistrer() {
    setOccupe(true)
    try {
      await enregistrerFichePaie(trav.id, valeurs, ctx)
      Alert.alert('Fiche paie', manques.length ? `Enregistrée. Il manque encore ${manques.join(', ')}.` : 'Fiche paie complète.')
    } catch (e) {
      Alert.alert('Fiche paie', e.message)
    } finally {
      setOccupe(false)
    }
  }

  const input = { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, color: colors.text, backgroundColor: colors.surface, minHeight: 48 }
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 4 }}>💼 Paie</Text>
      <Text style={{ color: manques.length ? '#C2410C' : '#047857', marginBottom: 10 }}>
        {manques.length ? `À compléter : ${manques.join(', ')}` : 'Fiche paie complète'}
      </Text>
      {CHAMPS.map(([cle, label, clavier]) => (
        <View key={cle} style={{ marginBottom: 8 }}>
          <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 3 }}>{label}</Text>
          <TextInput value={form[cle]} keyboardType={clavier} style={input}
            onChangeText={v => setForm(f => ({ ...f, [cle]: v }))} />
        </View>
      ))}
      <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 3 }}>Mode de paiement</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {[['especes', 'Espèces'], ['virement', 'Virement']].map(([cle, label]) => (
          <TouchableOpacity key={cle} onPress={() => setForm(f => ({ ...f, mode_paiement: cle }))}
            style={{ flex: 1, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: accent, backgroundColor: form.mode_paiement === cle ? accent : 'transparent' }}>
            <Text style={{ color: form.mode_paiement === cle ? '#fff' : accent, fontWeight: '700' }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity onPress={enregistrer} disabled={occupe}
        style={{ minHeight: 48, borderRadius: 12, backgroundColor: accent, alignItems: 'center', justifyContent: 'center', opacity: occupe ? 0.5 : 1 }}>
        <Text style={{ color: '#fff', fontWeight: '800' }}>{occupe ? 'Enregistrement…' : 'Enregistrer la fiche paie'}</Text>
      </TouchableOpacity>

      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginTop: 18, marginBottom: 6 }}>🧾 Bulletins</Text>
      {bulletins.length === 0
        ? <Text style={{ color: colors.textMuted }}>Aucun bulletin validé pour l'instant.</Text>
        : bulletins.map(l => (
          <TouchableOpacity key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}
            onPress={() => telechargerBulletins([l.bulletin], `Bulletin-${trav.nom}-${l.etats_salaire.mois.slice(0, 7)}.pdf`.replace(/\s+/g, '-')).catch(e => Alert.alert('PDF', e.message))}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{libelleMois(l.etats_salaire.mois)}</Text>
            <Text style={{ color: accent, fontWeight: '800' }}>Net {Number(l.bulletin.calcul.net).toLocaleString('fr-FR')} F · PDF ›</Text>
          </TouchableOpacity>
        ))}
    </View>
  )
}

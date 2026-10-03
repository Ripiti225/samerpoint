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
import { Alert, Linking, Modal, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'

import ChampDate from './ChampDate'
import Avatar from './equipe/Avatar'
import { Bouton, Info, Libelle, Puces, teinte, useEcranModerne } from './ui/EcranModerne'
import {
  contratAffiche, statutContrat, rangParType, ordinalFR, formatFR, progressionContrat,
  joursRestants, aujourdhuiISO, MOTIFS_RUPTURE, validerCloture,
} from '../lib/contrats'

export const STATUTS_CONTRAT = {
  en_cours: { emoji: '🟢', label: 'En cours', couleur: '#3B8D2F' },
  a_venir: { emoji: '🔵', label: 'À venir', couleur: '#2F6FD8' },
  expire: { emoji: '⚪', label: 'Terminé', couleur: '#7A7A86' },
  rompu: { emoji: '⛔', label: 'Rompu', couleur: '#C2462B' },
}

export default function FicheContrat({
  visible, travailleur, contrats, onFermer, onRenouveler, onCorriger, onSupprimer, onRompre,
}) {
  const { styles, colors, accent, principale } = useEcranModerne('orange')
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
    const st = STATUTS_CONTRAT[statut] || STATUTS_CONTRAT.expire
    const rang = rangParType(liste, c)
    const restants = joursRestants(c, jour)
    const bientot = statut === 'en_cours' && restants !== null && restants >= 0 && restants <= 30
    const peutRompre = statut === 'en_cours' || statut === 'a_venir'
    const pct = progressionContrat(c, jour)
    const couleurBarre = bientot ? (restants <= 7 ? '#C2462B' : '#C27C1A') : principale

    return (
      <View key={c.id} style={[styles.carte, estCourant && { borderColor: principale, borderWidth: 1.5 }]}>
        <View style={styles.carteTop}>
          <View style={[styles.bulle, { backgroundColor: teinte(st.couleur, '1C') }]}><Text style={styles.bulleTxt}>📝</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.carteTitre}>{c.type}{rang > 0 ? ` · ${ordinalFR(rang)} contrat` : ''}</Text>
            <Text style={styles.carteSous}>
              {c.date_fin ? `${formatFR(c.date_debut)} → ${formatFR(c.date_fin)}` : `Depuis le ${formatFR(c.date_debut)}`}
              {c.duree_mois ? ` · ${c.duree_mois} mois` : ''}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <View style={[styles.pastille, { backgroundColor: teinte(st.couleur, '22') }]}>
            <Text style={[styles.pastilleTxt, { color: st.couleur }]}>{st.emoji} {st.label}{estCourant ? ' · fait foi' : ''}</Text>
          </View>
          {bientot && (
            <View style={[styles.pastille, { backgroundColor: restants <= 7 ? '#C2462B' : '#C27C1A' }]}>
              <Text style={[styles.pastilleTxt, { color: '#fff' }]}>{restants === 0 ? 'Dernier jour' : `Expire dans ${restants} jours`}</Text>
            </View>
          )}
        </View>

        <View style={styles.carteCorps}>
          {pct !== null && (statut === 'en_cours' || statut === 'a_venir') && (
            <View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${Math.max(2, pct)}%`, borderRadius: 4, backgroundColor: couleurBarre }} />
              </View>
              <Text style={[styles.infoTxt, { fontSize: 11.5, marginTop: 4 }]}>
                {statut === 'a_venir' ? `Débute le ${formatFR(c.date_debut)}` : `${pct} % du contrat écoulé`}
              </Text>
            </View>
          )}
          {statut === 'rompu' && (
            <Info icone="⛔" styles={styles} couleur="#C2462B">
              Rompu le {formatFR(c.cloture_le)}{c.cloture_motif ? ` · ${c.cloture_motif}` : ''}
            </Info>
          )}
          {c.photo_url && (
            <TouchableOpacity onPress={() => Linking.openURL(c.photo_url)}>
              <Info icone="📄" styles={styles} couleur={accent} gras>
                Voir le contrat signé{c.photo_type === 'pdf' ? ' (PDF)' : ''}
              </Info>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.actions}>
          <Bouton label="✏️ Corriger" couleur={accent} flex styles={styles} onPress={() => onCorriger(c)} />
          {peutRompre && <Bouton label="⛔ Rompre" couleur="#C2462B" flex styles={styles} onPress={() => ouvrirRupture(c)} />}
          <Bouton label="🗑 Supprimer" variante="contour" couleur={colors.textMuted} styles={styles} onPress={() => confirmerSuppression(c)} />
        </View>

        {rupturePour === c.id && (
          <View style={{ marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: teinte('#C2462B', '0F'), borderWidth: 1, borderColor: teinte('#C2462B', '40') }}>
            <Text style={[styles.carteTitre, { fontSize: 14, color: '#C2462B', marginBottom: 12 }]}>Rompre ce contrat</Text>
            <ChampDate label="Date de rupture" valeur={dateRupture} onChange={setDateRupture} couleur="#C2462B"
              minDate={c.date_debut} maxDate={c.date_fin || undefined} />
            <Libelle styles={styles}>Motif</Libelle>
            <Puces styles={styles} petit actif={motifRupture} onChoisir={setMotifRupture}
              elements={MOTIFS_RUPTURE.map(m => ({ cle: m, label: m }))} />
            {motifRupture === 'Autre' && (
              <TextInput style={styles.input} placeholder="Préciser le motif" value={motifAutre} onChangeText={setMotifAutre}
                placeholderTextColor={colors.textPlaceholder} />
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Bouton label="Annuler" variante="contour" couleur={colors.textSecondary} flex styles={styles} onPress={() => setRupturePour(null)} />
              <Bouton label="Confirmer la rupture" variante="plein" couleur="#C2462B" flex styles={styles} onPress={() => confirmerRupture(c)} />
            </View>
          </View>
        )}
      </View>
    )
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onFermer}>
      <SafeAreaView style={styles.container}>
        <View style={[styles.header, { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 24 }]}>
          <TouchableOpacity onPress={onFermer} hitSlop={10}><Text style={styles.back}>✕ Fermer</Text></TouchableOpacity>
          <View style={{ flex: 1, paddingHorizontal: 8 }}>
            <Text style={styles.headerTitre}>Contrats</Text>
          </View>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          {/* Carte d'identité du travailleur, posée à cheval sur l'en-tête */}
          <View style={[styles.carte, { marginTop: -28, flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
            <Avatar nom={travailleur?.nom} photo={travailleur?.photo_url} resto={travailleur?.restaurants} taille={58} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.carteTitre, { fontSize: 18 }]}>{travailleur?.nom}</Text>
              <Text style={styles.carteSous}>{travailleur?.restaurants?.nom || 'Sans restaurant'} · {travailleur?.poste || 'Sans poste'}</Text>
              <Text style={[styles.carteSous, { color: accent, fontWeight: '700' }]}>
                {liste.length === 0 ? 'Aucun contrat' : `${liste.length} contrat${liste.length > 1 ? 's' : ''}`}
              </Text>
            </View>
          </View>

          <View style={{ marginBottom: 16 }}>
            <Bouton label={liste.length === 0 ? '+ Enregistrer un contrat' : '+ Renouveler le contrat'}
              variante="plein" couleur={principale} grand styles={styles} onPress={onRenouveler} />
          </View>

          {liste.length === 0 && (
            <Text style={[styles.infoTxt, { textAlign: 'center', paddingVertical: 20 }]}>Aucun contrat enregistré pour ce travailleur.</Text>
          )}

          {ordonnes.length > 0 && <Text style={styles.resultat}>Historique, du plus récent au plus ancien</Text>}
          {ordonnes.map(c => renderContrat(c, c.id === courant?.id))}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

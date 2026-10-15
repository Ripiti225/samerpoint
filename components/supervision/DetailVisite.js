// ──────────────────────────────────────────────────────────────────────────────
// Détail d'une visite du superviseur : note, points notés (étoiles, photo,
// point grave), tâches laissées, travailleurs vus, remarques, preuve de la
// visite (heures, position), réponse du gérant et décision du manager.
//
// Le gérant qui l'ouvre la marque « lue » ; il peut répondre ou contester.
// Le manager / directeur tranche une contestation (note maintenue ou corrigée).
// Les notes des travailleurs ne sont pas montrées au gérant.
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Text, TouchableOpacity, View } from 'react-native'
import { dureeVisite, ETATS_TACHE, etatTache, fmtNote, noteRetenueVisite } from '../../lib/supervision'
import {
  chargerDetailVisite, deciderContestation, lienCarte, marquerVisiteLue, repondreVisite, textePosition,
} from '../../lib/supervisionDb'
import { Bouton, Champ, Info, Libelle, Pastille } from '../ui/EcranModerne'
import { Etoiles, PastilleNote, SARCELLE, TONS, Vignette, dateCourte, dateHeure } from './Elements'

const ADMIN = ['manager', 'directeur']

export default function DetailVisite({ visiteId, role, userId, userNom, restaurantNom, aujourdhui, onChange, styles, colors }) {
  const [d, setD] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [reponse, setReponse] = useState('')
  const [motif, setMotif] = useState('')
  const [noteCorrigee, setNoteCorrigee] = useState('')
  const [envoi, setEnvoi] = useState(false)

  async function charger() {
    try {
      const res = await chargerDetailVisite(visiteId)
      setD(res)
      if (role === 'gerant' && res.visite && !res.visite.lu_gerant_at) marquerVisiteLue(res.visite, userNom)
    } catch (e) { setErreur(e?.message || 'Lecture impossible') }
  }
  useEffect(() => { charger() }, [visiteId])

  if (erreur) return <Text style={{ color: TONS.rouge, padding: 12 }}>La visite n'a pas pu être chargée. Vérifiez le réseau.</Text>
  if (!d) return <ActivityIndicator color={SARCELLE} style={{ marginVertical: 30 }} />
  const v = d.visite
  if (!v) return <Text style={{ color: colors.textMuted, padding: 12 }}>Visite introuvable.</Text>
  const retenue = noteRetenueVisite(v)
  const tachesCreees = d.taches.filter(t => t.visite_id === v.id)
  const tachesFaites = d.taches.filter(t => t.faite_visite_id === v.id)

  async function envoyerReponse(conteste) {
    if (!reponse.trim()) { Alert.alert('Réponse vide', conteste ? 'Expliquez pourquoi vous contestez la note.' : 'Écrivez votre réponse.'); return }
    setEnvoi(true)
    try {
      await repondreVisite({ visite: v, texte: reponse, conteste, nom: userNom, restaurantNom, userId })
      setReponse('')
      await charger(); onChange?.()
    } catch { Alert.alert('Erreur', "La réponse n'a pas pu être envoyée. Réessayez.") } finally { setEnvoi(false) }
  }

  async function decider(decision) {
    const nc = Number(String(noteCorrigee).replace(',', '.'))
    if (decision === 'corrigee' && (!noteCorrigee || Number.isNaN(nc) || nc < 0 || nc > 20)) {
      Alert.alert('Note corrigée', 'Indiquez la nouvelle note, entre 0 et 20.'); return
    }
    setEnvoi(true)
    try {
      await deciderContestation({ visite: v, decision, noteCorrigee: nc, motif, nom: userNom, userId })
      await charger(); onChange?.()
    } catch { Alert.alert('Erreur', "La décision n'a pas pu être enregistrée. Réessayez.") } finally { setEnvoi(false) }
  }

  const carte = lienCarte(v.position_debut)
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <PastilleNote note={retenue} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.carteTitre}>{restaurantNom || 'Visite'} · {dateCourte(v.debut_at)}</Text>
          <Text style={styles.carteSous}>Par {v.superviseur_nom || 'le superviseur'}</Text>
          {v.decision === 'corrigee'
            ? <Text style={[styles.carteSous, { color: TONS.bleu, fontWeight: '700' }]}>Note corrigée par le manager (au lieu de {fmtNote(v.note)})</Text>
            : null}
          {v.points_graves ? <Text style={{ color: TONS.rouge, fontWeight: '800', fontSize: 12.5 }}>⚠️ {v.points_graves} point{v.points_graves > 1 ? 's' : ''} grave{v.points_graves > 1 ? 's' : ''}</Text> : null}
        </View>
      </View>

      <View style={[styles.carte, { gap: 5 }]}>
        <Info icone="🕘" styles={styles}>Arrivée {dateHeure(v.debut_at)}{v.fin_at ? ` · départ ${dateHeure(v.fin_at).split(' à ')[1]} (${dureeVisite(v.debut_at, v.fin_at)})` : ''}</Info>
        {role !== 'gerant' ? (
          <TouchableOpacity disabled={!carte} onPress={() => carte && Linking.openURL(carte)}>
            <Info icone="📍" styles={styles} couleur={carte ? TONS.bleu : undefined}>{textePosition(v.position_debut)}{carte ? ' · voir sur la carte' : ''}</Info>
          </TouchableOpacity>
        ) : null}
        {role !== 'gerant' && v.lu_gerant_at ? <Info icone="👁️" styles={styles}>Lue par {v.lu_gerant_nom || 'le gérant'} le {dateHeure(v.lu_gerant_at)}</Info> : null}
        {role !== 'gerant' && !v.lu_gerant_at ? <Info icone="👁️" styles={styles} couleur={TONS.orange}>Pas encore lue par le gérant</Info> : null}
      </View>

      <Libelle styles={styles}>Points notés</Libelle>
      {d.notes.map(n => (
        <View key={n.id} style={[styles.carte, n.grave && { borderColor: TONS.rouge, borderWidth: 1.5 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={[styles.carteTitre, { flex: 1 }]}>{n.critere_libelle}</Text>
            {n.grave ? <Text style={{ color: TONS.rouge, fontWeight: '800', fontSize: 12 }}>⚠️ Grave</Text> : null}
          </View>
          <Etoiles valeur={n.note} lectureSeule colors={colors} />
          {n.commentaire || n.photo_url ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6, alignItems: 'flex-start' }}>
              {n.photo_url ? <Vignette uri={n.photo_url} /> : null}
              {n.commentaire ? <Text style={[styles.citation, { flex: 1, marginTop: 0 }]}>{n.commentaire}</Text> : null}
            </View>
          ) : null}
        </View>
      ))}

      {v.remarques ? (
        <>
          <Libelle styles={styles}>Remarques et suggestions</Libelle>
          <View style={styles.carte}><Text style={{ fontSize: 14, color: colors.text, lineHeight: 20 }}>💬 {v.remarques}</Text></View>
        </>
      ) : null}

      {tachesCreees.length ? (
        <>
          <Libelle styles={styles}>Tâches laissées ({tachesCreees.length})</Libelle>
          {tachesCreees.map(t => {
            const e = ETATS_TACHE[etatTache(t, aujourdhui)]
            return (
              <View key={t.id} style={styles.carte}>
                <Text style={styles.carteTitre}>{t.importante ? '❗ ' : ''}{t.titre}</Text>
                {t.details ? <Text style={styles.carteSous}>{t.details}</Text> : null}
                <Text style={styles.carteSous}>{t.echeance ? `Pour le ${dateCourte(t.echeance)}` : 'Sans date limite'}{t.responsable_nom ? ` · ${t.responsable_nom}` : ''}</Text>
                <Pastille cfg={e} styles={styles} />
              </View>
            )
          })}
        </>
      ) : null}

      {tachesFaites.length ? (
        <>
          <Libelle styles={styles}>Tâches confirmées faites ({tachesFaites.length})</Libelle>
          {tachesFaites.map(t => (
            <View key={t.id} style={styles.carte}><Text style={styles.carteTitre}>✅ {t.titre}</Text></View>
          ))}
        </>
      ) : null}

      {role !== 'gerant' && d.travailleurs.length ? (
        <>
          <Libelle styles={styles}>Travailleurs vus ({d.travailleurs.length})</Libelle>
          <View style={styles.carte}>
            {d.travailleurs.map((t, i) => (
              <View key={t.id} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.borderLight }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 }}>{t.travailleur_nom}{t.poste ? <Text style={{ color: colors.textMuted, fontWeight: '500' }}> · {t.poste}</Text> : null}</Text>
                  {t.absent
                    ? <Text style={{ color: TONS.rouge, fontWeight: '800', fontSize: 12.5 }}>Absent</Text>
                    : <Etoiles valeur={t.note} lectureSeule petit colors={colors} />}
                </View>
                {t.en_retard ? <Text style={{ color: TONS.orange, fontWeight: '700', fontSize: 12.5 }}>⏰ En retard</Text> : null}
                {t.commentaire ? <Text style={styles.carteSous}>{t.commentaire}</Text> : null}
              </View>
            ))}
          </View>
        </>
      ) : null}

      <Libelle styles={styles}>Réponse du gérant</Libelle>
      {v.reponse_gerant ? (
        <View style={[styles.carte, v.conteste && { borderColor: TONS.orange, borderWidth: 1.5 }]}>
          <Text style={{ fontSize: 12.5, fontWeight: '800', color: v.conteste ? TONS.orange : colors.textMuted }}>
            {v.conteste ? '✋ Contestation' : '💬 Réponse'} de {v.reponse_gerant_nom || 'le gérant'} · {dateHeure(v.reponse_gerant_at)}
          </Text>
          <Text style={[styles.citation]}>{v.reponse_gerant}</Text>
          {v.decision ? (
            <View style={{ marginTop: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: v.decision === 'corrigee' ? TONS.bleu : colors.text }}>
                {v.decision === 'corrigee' ? `✅ Note corrigée à ${fmtNote(v.note_corrigee)}/20` : '⚖️ Note maintenue'} par {v.decision_par_nom || 'le manager'}
              </Text>
              {v.decision_motif ? <Text style={styles.carteSous}>{v.decision_motif}</Text> : null}
            </View>
          ) : v.conteste ? <Text style={[styles.carteSous, { color: TONS.orange }]}>En attente de la décision du manager</Text> : null}
        </View>
      ) : role === 'gerant' ? (
        <View style={styles.carte}>
          <Champ styles={styles} colors={colors} multiline value={reponse} onChangeText={setReponse}
            placeholder="Votre réponse au superviseur (ce qui a été fait, ce que vous allez faire…)" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Bouton label="💬 Répondre" onPress={() => envoyerReponse(false)} couleur={SARCELLE} variante="plein" flex disabled={envoi} styles={styles} />
            <Bouton label="✋ Contester la note" onPress={() => envoyerReponse(true)} couleur={TONS.orange} flex disabled={envoi} styles={styles} />
          </View>
          <Text style={styles.hint}>Contester envoie la visite au manager, qui maintient ou corrige la note.</Text>
        </View>
      ) : <Text style={[styles.carteSous, { marginBottom: 12 }]}>Le gérant n'a pas encore répondu.</Text>}

      {ADMIN.includes(role) && v.conteste && !v.decision ? (
        <View style={[styles.carte, { borderColor: TONS.orange, borderWidth: 1.5 }]}>
          <Text style={[styles.carteTitre, { marginBottom: 10 }]}>Trancher la contestation</Text>
          <Champ styles={styles} colors={colors} value={motif} onChangeText={setMotif} placeholder="Motif de la décision (facultatif)" />
          <Champ styles={styles} colors={colors} value={noteCorrigee} onChangeText={setNoteCorrigee} keyboardType="decimal-pad"
            placeholder={`Nouvelle note si vous corrigez (actuelle : ${fmtNote(v.note)})`} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Bouton label="⚖️ Maintenir" onPress={() => decider('maintenue')} couleur={colors.textSecondary} flex disabled={envoi} styles={styles} />
            <Bouton label="✅ Corriger la note" onPress={() => decider('corrigee')} couleur={TONS.bleu} variante="plein" flex disabled={envoi} styles={styles} />
          </View>
        </View>
      ) : null}
    </View>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
//  Onglet « À répondre » (écran Avis, manager) — réponses aux avis Glovo écrits.
//  Valider : la réponse part au prochain clic sur le bouton favori (portail Glovo).
//  Spec : docs/superpowers/specs/2026-10-21-reponses-avis-glovo-design.md
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { LIBELLES_MOTIF, MAX_REPONSE, avisARepondre, proposerReponse, verifierReponse } from '../../lib/reponsesAvis'
import { chargerAvisGlovoEcrits, chargerReponses, enregistrerReponse } from '../../lib/reponsesAvisDb'

const JOURS = 60

export default function ReponsesAvis({ restaurants, colors, userNom, restoFilter }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [avis, setAvis] = useState([])
  const [reponses, setReponses] = useState(new Map())
  const [textes, setTextes] = useState({})          // id avis → texte en cours
  const [enEdition, setEnEdition] = useState(null)
  const [enCours, setEnCours] = useState(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState(null)

  async function charger() {
    setChargement(true); setErreur(null)
    try {
      const depuis = new Date(Date.now() - JOURS * 86400000).toISOString().slice(0, 10)
      const lignes = await chargerAvisGlovoEcrits({ depuis })
      setAvis(lignes)
      setReponses(await chargerReponses(lignes.map(a => a.id)))
    } catch (_e) {
      setErreur('Les avis n’ont pas pu être chargés. Tirez vers le bas pour réessayer.')
    } finally { setChargement(false) }
  }
  useEffect(() => { charger() }, [])

  const nomResto = id => restaurants.find(r => r.id === id)?.nom || 'Boutique non rattachée'
  const liste = avisARepondre(avis, reponses).filter(a => !restoFilter || a.restaurant_id === restoFilter)
  const enAttente = [...reponses.values()].filter(r => r.statut === 'validee').length

  function texteDe(a) {
    if (textes[a.id] != null) return textes[a.id]
    const r = reponses.get(a.id)
    return r?.statut === 'refusee' ? r.texte : proposerReponse(a).texte
  }

  async function decider(a, statut) {
    const texte = texteDe(a)
    if (statut === 'validee' && verifierReponse(texte).length) return
    setEnCours(a.id)
    try {
      await enregistrerReponse({ reviewId: a.id, texte, modele: proposerReponse(a).motif, statut, par: userNom })
      setReponses(prev => new Map(prev).set(a.id, { review_id: a.id, texte, statut }))
      setEnEdition(null)
    } catch (_e) {
      setErreur('L’enregistrement a échoué. Réessayez.')
    } finally { setEnCours(null) }
  }

  if (chargement) return <View style={styles.centre}><ActivityIndicator color={colors.primary} /></View>

  return (
    <ScrollView style={styles.body}>
      <Text style={styles.entete}>
        {liste.length} à répondre · {enAttente} en attente d’envoi
      </Text>
      {enAttente ? (
        <Text style={styles.rappel}>📤 Cliquez sur le bouton favori dans le portail Glovo pour envoyer les réponses validées.</Text>
      ) : null}
      {erreur ? <Text style={styles.erreur}>{erreur}</Text> : null}
      {liste.length === 0 ? <Text style={styles.vide}>✅ Aucun avis en attente de réponse</Text> : null}
      {liste.map(a => {
        const texte = texteDe(a)
        const problemes = verifierReponse(texte)
        const refusee = reponses.get(a.id)?.statut === 'refusee' ? reponses.get(a.id) : null
        const plat = a.raw?.raw?.dish
        return (
          <View key={a.id} style={styles.carte}>
            <Text style={styles.meta}>
              {a.classification === 'negatif' ? '👎' : '👍'} {a.review_date?.split('-').reverse().join('/')} · {nomResto(a.restaurant_id)}
            </Text>
            {plat ? <Text style={styles.plat}>🍽 {Array.isArray(plat) ? plat.join(', ') : plat}</Text> : null}
            <Text style={styles.client}>« {a.comment} »</Text>
            <Text style={styles.motif}>{LIBELLES_MOTIF[proposerReponse(a).motif]}</Text>
            {refusee ? <Text style={styles.erreur}>Refusée par Glovo : {refusee.erreur || 'sans raison donnée'}</Text> : null}
            {enEdition === a.id ? (
              <TextInput style={styles.champ} value={texte} multiline
                onChangeText={v => setTextes(p => ({ ...p, [a.id]: v }))} />
            ) : (
              <Text style={styles.reponse}>{texte}</Text>
            )}
            <Text style={[styles.compteur, texte.length > MAX_REPONSE && styles.rouge]}>{texte.length} / {MAX_REPONSE}</Text>
            {problemes.map(p => <Text key={p} style={styles.erreur}>⚠️ {p}</Text>)}
            <View style={styles.boutons}>
              <TouchableOpacity style={[styles.btn, styles.btnIgnorer]} disabled={enCours === a.id} onPress={() => decider(a, 'ignoree')}>
                <Text style={styles.btnTxtSombre}>Ignorer</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnModifier]} onPress={() => setEnEdition(enEdition === a.id ? null : a.id)}>
                <Text style={styles.btnTxtSombre}>{enEdition === a.id ? 'Fermer' : 'Modifier'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnValider, (problemes.length || enCours === a.id) && { opacity: 0.4 }]}
                disabled={!!problemes.length || enCours === a.id} onPress={() => decider(a, 'validee')}>
                <Text style={styles.btnTxt}>Valider</Text>
              </TouchableOpacity>
            </View>
          </View>
        )
      })}
      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

function makeStyles(colors) {
  return StyleSheet.create({
    body: { flex: 1, padding: 16 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    entete: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 6 },
    rappel: { fontSize: 13, color: colors.textSecondary, marginBottom: 12 },
    vide: { fontSize: 15, color: colors.textMuted, textAlign: 'center', marginTop: 40 },
    carte: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
    meta: { fontSize: 13, color: colors.textMuted, marginBottom: 4 },
    plat: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
    client: { fontSize: 15, color: colors.text, fontStyle: 'italic', marginBottom: 8 },
    motif: { fontSize: 12, fontWeight: '700', color: colors.primary, marginBottom: 6 },
    reponse: { fontSize: 14, color: colors.text, lineHeight: 20, backgroundColor: colors.bg, borderRadius: 10, padding: 10 },
    champ: { fontSize: 14, color: colors.text, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10, padding: 10, minHeight: 100, textAlignVertical: 'top' },
    compteur: { fontSize: 12, color: colors.textMuted, textAlign: 'right', marginTop: 4 },
    rouge: { color: '#C62828', fontWeight: '700' },
    erreur: { fontSize: 13, color: '#C62828', marginTop: 4 },
    boutons: { flexDirection: 'row', gap: 8, marginTop: 10 },
    btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    btnIgnorer: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
    btnModifier: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.primary },
    btnValider: { backgroundColor: '#2E7D32' },
    btnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
    btnTxtSombre: { color: colors.text, fontWeight: '700', fontSize: 15 },
  })
}

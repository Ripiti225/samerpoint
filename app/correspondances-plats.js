// ──────────────────────────────────────────────────────────────────────────────
//  CORRESPONDANCES DE PLATS — Glovo / Yango → POS (manager uniquement)
//
//  Les litiges automatiques comparent les plats vendus sur les portails à ceux
//  tapés dans le POS. Chaque nom de plat d'un portail doit être relié une fois
//  à un plat du POS (ou ignoré : sauce, couverts…). Tant qu'un nom n'est pas
//  relié, la journée reste « à relier » et aucun tapé ± n'est créé.
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { normaliserNom, proposerCorrespondance } from '../lib/litigesPlateformes'
import { retour } from '../lib/navigation'
import { supabase } from '../lib/supabase'

const URL_RECALCUL = 'https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/ingest-commandes-plateformes'
const NOMS = { glovo: 'Glovo', yango: 'Yango' }

export default function CorrespondancesPlats() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { roleActif } = useApp()
  const [chargement, setChargement] = useState(true)
  const [inconnus, setInconnus] = useState([])      // [{ plateforme, nom, jours }]
  const [platsPos, setPlatsPos] = useState([])      // [{ nom_norm, nom, ignorer }]
  const [choix, setChoix] = useState({})            // `${plateforme}|${nom}` → nom POS | '__ignorer'
  const [ouvert, setOuvert] = useState(null)
  const [message, setMessage] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  const charger = useCallback(async () => {
    setChargement(true)
    const [{ data: journees }, { data: pos }] = await Promise.all([
      supabase.from('journees_litiges_plateformes').select('plateforme, jour, noms_inconnus').eq('statut', 'a_relier'),
      supabase.from('plats_pos_vus').select('nom_norm, nom, ignorer').order('nom'),
    ])
    const parNom = new Map()
    for (const j of journees || []) {
      for (const nom of j.noms_inconnus || []) {
        const cle = `${j.plateforme}|${nom}`
        if (!parNom.has(cle)) parNom.set(cle, { plateforme: j.plateforme, nom, jours: 0 })
        parNom.get(cle).jours++
      }
    }
    const liste = [...parNom.values()].sort((a, b) => b.jours - a.jours || a.nom.localeCompare(b.nom))
    const nomsPos = (pos || []).filter(p => !p.ignorer).map(p => p.nom)
    const propositions = {}
    for (const i of liste) {
      const p = proposerCorrespondance(i.nom, nomsPos)
      if (p) propositions[`${i.plateforme}|${i.nom}`] = p
    }
    setInconnus(liste)
    setPlatsPos(pos || [])
    setChoix(propositions)
    setChargement(false)
  }, [])

  useEffect(() => { charger() }, [charger])

  async function enregistrer() {
    const lignes = inconnus
      .filter(i => choix[`${i.plateforme}|${i.nom}`])
      .map(i => {
        const c = choix[`${i.plateforme}|${i.nom}`]
        return {
          plateforme: i.plateforme, nom_norm: normaliserNom(i.nom), nom_plateforme: i.nom,
          nom_pos: c === '__ignorer' ? null : c, ignorer: c === '__ignorer',
        }
      })
    if (!lignes.length) { setMessage('Choisissez au moins un plat.'); return }
    setEnvoi(true)
    const { error } = await supabase.from('correspondances_plats').upsert(lignes, { onConflict: 'plateforme,nom_norm' })
    if (error) { setEnvoi(false); setMessage("L'enregistrement n'a pas abouti. Réessayez."); return }
    try {
      const r = await fetch(URL_RECALCUL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recalculer: true }) })
      const j = await r.json()
      setMessage(`${lignes.length} plat${lignes.length > 1 ? 's' : ''} relié${lignes.length > 1 ? 's' : ''} · ${j.litiges || 0} litige${(j.litiges || 0) > 1 ? 's' : ''} recalculé${(j.litiges || 0) > 1 ? 's' : ''}`)
    } catch (_e) {
      setMessage('Plats reliés. Le recalcul se fera au prochain clic du bouton avis.')
    }
    setEnvoi(false)
    charger()
  }

  async function basculerIgnorePos(p) {
    await supabase.from('plats_pos_vus').update({ ignorer: !p.ignorer }).eq('nom_norm', p.nom_norm)
    charger()
  }

  const entete = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => retour()} style={styles.backBtn}>
        <Text style={styles.backTxt}>← Retour</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitre}>Correspondances</Text>
      <Text style={styles.headerSub}>Relier les plats Glovo & Yango à ceux du POS</Text>
    </View>
  )

  if (roleActif !== 'manager') {
    return (
      <SafeAreaView style={styles.page}>{entete}
        <Text style={styles.vide}>Cet écran est réservé au manager.</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.page}>
      {entete}
      {chargement ? <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} /> : (
        <ScrollView contentContainerStyle={styles.contenu}>
          {inconnus.length === 0 ? (
            <Text style={styles.vide}>Tous les plats sont reliés. Rien à faire.</Text>
          ) : inconnus.map(i => {
            const cle = `${i.plateforme}|${i.nom}`
            const c = choix[cle]
            return (
              <View key={cle} style={styles.carte}>
                <Text style={styles.nomPf}>{NOMS[i.plateforme]} · {i.nom}</Text>
                <Text style={styles.sous}>{i.jours} journée{i.jours > 1 ? 's' : ''} en attente</Text>
                <TouchableOpacity style={styles.selecteur} onPress={() => setOuvert(ouvert === cle ? null : cle)}>
                  <Text style={styles.selecteurTxt}>
                    {c === '__ignorer' ? 'Ignorer (pas un plat)' : c ? `→ ${c}` : 'Choisir le plat du POS'}
                  </Text>
                </TouchableOpacity>
                {ouvert === cle && (
                  <ScrollView style={styles.liste} nestedScrollEnabled>
                    <TouchableOpacity style={styles.option} onPress={() => { setChoix({ ...choix, [cle]: '__ignorer' }); setOuvert(null) }}>
                      <Text style={styles.optionTxt}>Ignorer (sauce, couverts…)</Text>
                    </TouchableOpacity>
                    {platsPos.filter(p => !p.ignorer).map(p => (
                      <TouchableOpacity key={p.nom_norm} style={styles.option} onPress={() => { setChoix({ ...choix, [cle]: p.nom }); setOuvert(null) }}>
                        <Text style={styles.optionTxt}>{p.nom}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            )
          })}
          {inconnus.length > 0 && (
            <TouchableOpacity style={[styles.bouton, envoi && { opacity: 0.6 }]} disabled={envoi} onPress={enregistrer}>
              <Text style={styles.boutonTxt}>{envoi ? 'Enregistrement…' : 'Enregistrer et recalculer'}</Text>
            </TouchableOpacity>
          )}
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <Text style={styles.titreSection}>Plats du POS à ne pas comparer</Text>
          <Text style={styles.sous}>Ex. un supplément tapé comme un article. Touchez pour basculer.</Text>
          {platsPos.map(p => (
            <TouchableOpacity key={p.nom_norm} style={styles.ligneIgnore} onPress={() => basculerIgnorePos(p)}>
              <Text style={styles.optionTxt}>{p.nom}</Text>
              <Text style={[styles.etat, { color: p.ignorer ? colors.error : colors.successDark }]}>{p.ignorer ? 'Ignoré' : 'Comparé'}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const makeStyles = c => StyleSheet.create({
  page: { flex: 1, backgroundColor: c.bg },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: c.border },
  backBtn: { minHeight: 44, justifyContent: 'center' },
  backTxt: { color: c.primary, fontSize: 16, fontWeight: '600' },
  headerTitre: { color: c.text, fontSize: 22, fontWeight: '700' },
  headerSub: { color: c.textSecondary, fontSize: 14, marginTop: 2 },
  contenu: { padding: 16, gap: 12, paddingBottom: 48 },
  vide: { color: c.textSecondary, fontSize: 15, textAlign: 'center', marginTop: 32 },
  carte: { backgroundColor: c.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border },
  nomPf: { color: c.text, fontSize: 16, fontWeight: '700' },
  sous: { color: c.textSecondary, fontSize: 13, marginTop: 2 },
  selecteur: { marginTop: 10, minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: c.primary, justifyContent: 'center', paddingHorizontal: 12 },
  selecteurTxt: { color: c.primary, fontSize: 15, fontWeight: '600' },
  liste: { marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: c.border, maxHeight: 280 },
  option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  optionTxt: { color: c.text, fontSize: 15 },
  bouton: { minHeight: 52, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  boutonTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  message: { color: c.text, fontSize: 14, textAlign: 'center' },
  titreSection: { color: c.text, fontSize: 17, fontWeight: '700', marginTop: 24 },
  ligneIgnore: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  etat: { fontSize: 14, fontWeight: '600' },
})

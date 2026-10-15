// ──────────────────────────────────────────────────────────────────────────────
// Visite en cours du superviseur, en 4 étapes :
//   1. Grille   chaque point noté de 1 à 5 étoiles ; photo obligatoire si
//               ≤ 2 étoiles ; « point grave » prévient le manager tout de suite
//   2. Tâches   celles laissées avant : faite / pas faite (+ demande
//               d'explication) ; nouvelles tâches (photo si importante)
//   3. Équipe   les travailleurs vus : étoiles, retard, absence (RH et manager
//               seulement, pas le gérant)
//   4. Fin      remarques et suggestions, note calculée, « Terminer »
//
// Tout est gardé en brouillon sur le téléphone à chaque changement (réseau
// faible sur place) et recopié dans la base quelques secondes après : « Se
// déconnecter » laisse la visite ouverte, on la retrouve à la reconnexion,
// même sur un autre téléphone. Notes, tâches, etc. ne sont enregistrées
// qu'en terminant.
// ──────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import ChampDate from '../ChampDate'
import { ETATS_TACHE, etatTache, manquesVisite, NOTE_BASSE, noteVisite } from '../../lib/supervision'
import {
  annulerVisite, chargerCriteres, chargerTaches, chargerTravailleursResto, demanderExplicationTache, ecrireBrouillon,
  envoyerBrouillon, lireBrouillon, terminerVisite, textePosition,
} from '../../lib/supervisionDb'
import { Bouton, Champ, Feuille, Info, Libelle, Pastille, Puces, Vide } from '../ui/EcranModerne'
import { ChampPhoto, Etoiles, PastilleNote, SARCELLE, TONS, Vignette, dateCourte, dateHeure } from './Elements'

const ETAPES = [
  { cle: 'grille', label: '1 · Grille' },
  { cle: 'taches', label: '2 · Tâches' },
  { cle: 'equipe', label: '3 · Équipe' },
  { cle: 'fin', label: '4 · Fin' },
]
const VIDE = { notes: {}, travailleurs: {}, verifs: {}, nouvelles: [], remarques: '' }
const TACHE_VIDE = { titre: '', details: '', importante: false, echeance: '', responsable_nom: '', responsable_travailleur_id: null, photo_constat_url: null }
const isoJour = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

function Bascule({ actif, label, couleur, onPress, colors }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 20, justifyContent: 'center',
      borderWidth: 1.5, borderColor: actif ? couleur : colors.borderLight, backgroundColor: actif ? couleur + '1C' : colors.surface }}>
      <Text style={{ fontSize: 13, fontWeight: '800', color: actif ? couleur : colors.textMuted }}>{label}</Text>
    </TouchableOpacity>
  )
}

export default function VisiteEnCours({ visite, restaurant, userId, userNom, onFinie, onDeconnecter, styles, colors }) {
  const [charge, setCharge] = useState(false)
  const [erreur, setErreur] = useState(false)
  const [criteres, setCriteres] = useState([])
  const [equipe, setEquipe] = useState([])
  const [ouvertes, setOuvertes] = useState([])
  const [b, setB] = useState(VIDE)                 // brouillon
  const [etape, setEtape] = useState('grille')
  const [form, setForm] = useState(null)           // nouvelle tâche en saisie
  const [envoi, setEnvoi] = useState(false)
  const [confirmerAbandon, setConfirmerAbandon] = useState(false)
  const scrollRef = useRef(null)
  const aujourdhui = isoJour()

  useEffect(() => {
    (async () => {
      try {
        const [c, e, t, brouillon] = await Promise.all([
          chargerCriteres(), chargerTravailleursResto(restaurant.id),
          chargerTaches({ restaurantId: restaurant.id, ouvertesSeulement: true }), lireBrouillon(visite),
        ])
        setCriteres(c); setEquipe(e)
        // Les tâches de cette visite (nouvel essai après coupure) ne sont pas « à vérifier ».
        setOuvertes(t.filter(x => x.visite_id !== visite.id))
        if (brouillon) setB({ ...VIDE, ...brouillon })
        setCharge(true)
      } catch { setErreur(true) }
    })()
  }, [visite.id, restaurant.id])

  // Brouillon à chaque changement : tout de suite sur le téléphone, 3 s plus tard dans la base.
  const dejaEnvoye = useRef(true)
  useEffect(() => {
    if (!charge) return undefined
    const copie = { ...b, saved_at: Date.now() }
    ecrireBrouillon(visite.id, copie)
    dejaEnvoye.current = false
    const t = setTimeout(() => { envoyerBrouillon(visite.id, copie).then(ok => { if (ok) dejaEnvoye.current = true }) }, 3000)
    return () => clearTimeout(t)
  }, [b, charge, visite.id])

  async function seDeconnecter() {
    setEnvoi(true)
    const ok = dejaEnvoye.current || await envoyerBrouillon(visite.id, { ...b, saved_at: Date.now() })
    setEnvoi(false)
    if (!ok) {
      Alert.alert('Pas de réseau', 'La saisie reste sur ce téléphone : reconnectez-vous sur celui-ci pour reprendre la visite.')
    }
    onDeconnecter?.()
  }

  const maj = (champ, cle, valeur) => setB(p => ({ ...p, [champ]: { ...p[champ], [cle]: { ...(p[champ][cle] || {}), ...valeur } } }))

  const confirmees = ouvertes.filter(t => b.verifs[t.id]?.resultat === 'faite')
    .map(t => ({ ...t, photo: b.verifs[t.id]?.photo }))
  const manques = useMemo(() => manquesVisite({ criteres, notes: b.notes, nouvelles: b.nouvelles, confirmees }),
    [criteres, b.notes, b.nouvelles, confirmees])
  const noteDirecte = noteVisite(criteres.map(c => ({ poids: c.poids, note: b.notes[c.id]?.note })))
  const nbGraves = criteres.filter(c => b.notes[c.id]?.grave).length
  const nbNotes = criteres.filter(c => b.notes[c.id]?.note).length

  function allerA(cle) { setEtape(cle); scrollRef.current?.scrollTo?.({ y: 0, animated: false }) }

  function ajouterTache() {
    if (!form.titre.trim()) { Alert.alert('Titre manquant', 'Écrivez ce qu\'il faut faire.'); return }
    if (form.importante && !form.photo_constat_url) { Alert.alert('Photo obligatoire', 'Une tâche importante demande une photo de ce que vous avez vu.'); return }
    setB(p => ({ ...p, nouvelles: [...p.nouvelles, { ...form, cle: String(Date.now()) }] }))
    setForm(null)
  }

  async function terminer() {
    if (manques.length) return
    setEnvoi(true)
    try {
      const note = await terminerVisite({
        visite, restaurant, criteres, notes: b.notes, travailleursResto: equipe, travailleurs: b.travailleurs,
        tachesOuvertes: ouvertes, verifs: b.verifs, nouvelles: b.nouvelles, remarques: b.remarques, userId, userNom,
      })
      // Demandes d'explication cochées (après l'enregistrement, avec le constat à jour).
      const aExpliquer = ouvertes.filter(t => b.verifs[t.id]?.resultat === 'pas_faite' && b.verifs[t.id]?.explication && !t.demande_explication_id)
      let echecs = 0
      for (const t of aExpliquer) {
        try {
          await demanderExplicationTache({
            tache: { ...t, nb_non_faite: (t.nb_non_faite || 0) + 1, derniere_verif_refus: b.verifs[t.id]?.motif || t.derniere_verif_refus },
            restaurant, userId, userNom,
          })
        } catch { echecs += 1 }
      }
      Alert.alert('Visite enregistrée',
        `Note : ${String(note ?? '—').replace('.', ',')}/20. Le gérant est prévenu.`
        + (nbGraves ? ' Le manager est alerté du point grave.' : '')
        + (echecs ? `\n${echecs} demande(s) d'explication n'ont pas pu partir : refaites-les depuis la fiche du restaurant.` : ''))
      onFinie?.()
    } catch {
      Alert.alert('Pas enregistrée', 'La visite n\'a pas pu être enregistrée (réseau ?). Rien n\'est perdu : réessayez dans un instant.')
    } finally { setEnvoi(false) }
  }

  async function abandonner() {
    setEnvoi(true)
    try { await annulerVisite(visite); onFinie?.() }
    catch { Alert.alert('Erreur', "La visite n'a pas pu être abandonnée. Réessayez.") }
    finally { setEnvoi(false); setConfirmerAbandon(false) }
  }

  if (erreur) {
    return <View style={styles.body}><Vide icone="📡" texte="Chargement impossible" sous="Vérifiez le réseau puis rouvrez la visite." styles={styles} /></View>
  }
  if (!charge) return <ActivityIndicator color={SARCELLE} style={{ marginTop: 40 }} />

  const indexEtape = ETAPES.findIndex(e => e.cle === etape)
  const suivante = ETAPES[indexEtape + 1]

  return (
    <View style={{ flex: 1 }}>
      <Puces elements={ETAPES} actif={etape} onChoisir={allerA} styles={styles} ligne />
      <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Info icone="🕘" styles={styles}>Arrivée {dateHeure(visite.debut_at)} · {textePosition(visite.position_debut)}</Info>
        {onDeconnecter ? (
          <View style={{ marginTop: 10 }}>
            <Bouton label="⏸ Se déconnecter (la visite reste ouverte)" onPress={seDeconnecter} couleur={colors.textSecondary}
              variante="contour" disabled={envoi} styles={styles} />
            <Text style={styles.hint}>À terminer aujourd'hui : une visite pas terminée est abandonnée le lendemain.</Text>
          </View>
        ) : null}
        <View style={{ height: 10 }} />

        {etape === 'grille' && (
          <>
            {!criteres.length ? <Vide icone="📋" texte="Grille vide" sous="Le manager doit d'abord créer les points à noter (Supervision → Grille)." styles={styles} /> : null}
            {criteres.map(c => {
              const x = b.notes[c.id] || {}
              const basse = x.note && x.note <= NOTE_BASSE
              return (
                <View key={c.id} style={[styles.carte, x.grave && { borderColor: TONS.rouge, borderWidth: 1.5 }]}>
                  <Text style={styles.carteTitre}>{c.libelle}</Text>
                  {c.aide ? <Text style={[styles.carteSous, { marginBottom: 6 }]}>{c.aide}</Text> : null}
                  <Etoiles valeur={x.note} onChange={v => maj('notes', c.id, { note: v })} colors={colors} />
                  <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
                    <Bascule actif={!!x.grave} label="⚠️ Point grave" couleur={TONS.rouge} colors={colors}
                      onPress={() => maj('notes', c.id, { grave: !x.grave })} />
                  </View>
                  <Champ styles={styles} colors={colors} multiline={!!x.grave} value={x.commentaire || ''}
                    onChangeText={v => maj('notes', c.id, { commentaire: v })}
                    placeholder={x.grave ? 'Expliquez le point grave (obligatoire)' : 'Commentaire (facultatif)'} />
                  <ChampPhoto uri={x.photo_url} onChange={u => maj('notes', c.id, { photo_url: u })} requis={!!basse}
                    libelle={basse ? 'Photo (note basse)' : 'Photo'} dossier="supervision/visites" colors={colors} />
                </View>
              )
            })}
          </>
        )}

        {etape === 'taches' && (
          <>
            <Libelle styles={styles}>À vérifier ({ouvertes.length})</Libelle>
            {!ouvertes.length ? <Text style={[styles.carteSous, { marginBottom: 14 }]}>Aucune tâche en cours dans ce restaurant.</Text> : null}
            {ouvertes.map(t => {
              const v = b.verifs[t.id] || {}
              return (
                <View key={t.id} style={styles.carte}>
                  <Text style={styles.carteTitre}>{t.importante ? '❗ ' : ''}{t.titre}</Text>
                  {t.details ? <Text style={styles.carteSous}>{t.details}</Text> : null}
                  <View style={styles.carteCorps}>
                    <Info icone="📅" styles={styles}>{t.echeance ? `Pour le ${dateCourte(t.echeance)}` : 'Sans date limite'}{t.responsable_nom ? ` · ${t.responsable_nom}` : ''}</Info>
                    {t.signalee_at ? <Info icone="📸" styles={styles} couleur={TONS.bleu}>Le gérant dit qu'elle est faite ({dateCourte(t.signalee_at)}){t.signalee_commentaire ? ` : ${t.signalee_commentaire}` : ''}</Info> : null}
                    {t.nb_non_faite ? <Info icone="❌" styles={styles} couleur={TONS.rouge}>Déjà constatée non faite {t.nb_non_faite} fois</Info> : null}
                  </View>
                  {(t.photo_constat_url || t.signalee_photo_url) ? (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                      <Vignette uri={t.photo_constat_url} libelle="Constat" />
                      <Vignette uri={t.signalee_photo_url} libelle="Gérant" />
                    </View>
                  ) : null}
                  <Pastille cfg={ETATS_TACHE[etatTache(t, aujourdhui)]} styles={styles} />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    <Bascule actif={v.resultat === 'faite'} label="✅ Faite" couleur={TONS.vert} colors={colors}
                      onPress={() => maj('verifs', t.id, { resultat: v.resultat === 'faite' ? null : 'faite' })} />
                    <Bascule actif={v.resultat === 'pas_faite'} label="❌ Pas faite" couleur={TONS.rouge} colors={colors}
                      onPress={() => maj('verifs', t.id, { resultat: v.resultat === 'pas_faite' ? null : 'pas_faite' })} />
                  </View>
                  {v.resultat === 'faite' && t.importante ? (
                    <View style={{ marginTop: 10 }}>
                      <ChampPhoto uri={v.photo} onChange={u => maj('verifs', t.id, { photo: u })} requis={!t.signalee_photo_url}
                        libelle="Photo de la tâche faite" dossier="supervision/taches" colors={colors} />
                    </View>
                  ) : null}
                  {v.resultat === 'pas_faite' ? (
                    <View style={{ marginTop: 10 }}>
                      <Champ styles={styles} colors={colors} value={v.motif || ''} onChangeText={x => maj('verifs', t.id, { motif: x })}
                        placeholder="Ce que vous avez constaté (facultatif)" />
                      {t.demande_explication_id
                        ? <Text style={styles.carteSous}>📨 Une demande d'explication est déjà partie.</Text>
                        : <Bascule actif={!!v.explication} label="📨 Demander une explication" couleur={TONS.orange} colors={colors}
                          onPress={() => maj('verifs', t.id, { explication: !v.explication })} />}
                    </View>
                  ) : null}
                </View>
              )
            })}

            <Libelle styles={styles}>Nouvelles tâches ({b.nouvelles.length})</Libelle>
            {b.nouvelles.map(t => (
              <View key={t.cle} style={styles.carte}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <Vignette uri={t.photo_constat_url} taille={48} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.carteTitre}>{t.importante ? '❗ ' : ''}{t.titre}</Text>
                    <Text style={styles.carteSous}>{t.echeance ? `Pour le ${dateCourte(t.echeance)}` : 'Sans date limite'}{t.responsable_nom ? ` · ${t.responsable_nom}` : ''}</Text>
                    {t.details ? <Text style={styles.carteSous}>{t.details}</Text> : null}
                  </View>
                  <TouchableOpacity hitSlop={10} onPress={() => setB(p => ({ ...p, nouvelles: p.nouvelles.filter(x => x.cle !== t.cle) }))}>
                    <Text style={{ fontSize: 16, color: colors.textMuted }}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            <Bouton label="＋ Ajouter une tâche" onPress={() => setForm({ ...TACHE_VIDE })} couleur={SARCELLE} grand styles={styles} />
          </>
        )}

        {etape === 'equipe' && (
          <>
            <Text style={[styles.carteSous, { marginBottom: 12 }]}>Notez seulement les travailleurs que vous avez vus. Ces notes vont au RH et au manager, pas au gérant.</Text>
            {!equipe.length ? <Vide icone="👥" texte="Aucun travailleur enregistré" styles={styles} /> : null}
            {equipe.map(t => {
              const x = b.travailleurs[t.id] || {}
              return (
                <View key={t.id} style={[styles.carte, { paddingVertical: 10 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <View style={{ flex: 1, minWidth: 130 }}>
                      <Text style={{ fontSize: 14.5, fontWeight: '800', color: colors.text }}>{t.nom}</Text>
                      {t.poste ? <Text style={styles.carteSous}>{t.poste}</Text> : null}
                    </View>
                    {!x.absent ? <Etoiles valeur={x.note} onChange={v => maj('travailleurs', t.id, { note: v })} petit colors={colors} /> : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <Bascule actif={!!x.en_retard && !x.absent} label="⏰ En retard" couleur={TONS.orange} colors={colors}
                      onPress={() => maj('travailleurs', t.id, { en_retard: !x.en_retard, absent: false })} />
                    <Bascule actif={!!x.absent} label="🚫 Absent" couleur={TONS.rouge} colors={colors}
                      onPress={() => maj('travailleurs', t.id, { absent: !x.absent, en_retard: false })} />
                  </View>
                  {(x.note || x.absent || x.en_retard) ? (
                    <View style={{ marginTop: 8 }}>
                      <Champ styles={styles} colors={colors} value={x.commentaire || ''} onChangeText={v => maj('travailleurs', t.id, { commentaire: v })}
                        placeholder="Commentaire (facultatif)" />
                    </View>
                  ) : null}
                </View>
              )
            })}
          </>
        )}

        {etape === 'fin' && (
          <>
            <View style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
              <PastilleNote note={noteDirecte} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.carteTitre}>Note de la visite</Text>
                <Text style={styles.carteSous}>{nbNotes}/{criteres.length} points notés</Text>
                {nbGraves ? <Text style={{ color: TONS.rouge, fontWeight: '800', fontSize: 12.5 }}>⚠️ {nbGraves} point{nbGraves > 1 ? 's' : ''} grave{nbGraves > 1 ? 's' : ''} : le manager sera alerté</Text> : null}
                <Text style={styles.carteSous}>
                  {b.nouvelles.length} nouvelle{b.nouvelles.length > 1 ? 's' : ''} tâche{b.nouvelles.length > 1 ? 's' : ''} · {Object.values(b.verifs).filter(v => v?.resultat).length}/{ouvertes.length} vérifiée{ouvertes.length > 1 ? 's' : ''}
                </Text>
              </View>
            </View>

            <Libelle styles={styles}>Remarques et suggestions</Libelle>
            <Champ styles={styles} colors={colors} multiline value={b.remarques} onChangeText={v => setB(p => ({ ...p, remarques: v }))}
              placeholder="Ex. : restaurant très propre, les travailleurs viennent à l'heure." />

            {manques.length ? (
              <View style={styles.refus}>
                <Text style={styles.refusTitre}>Avant de terminer :</Text>
                {manques.map(m => <Text key={m} style={styles.refusTxt}>• {m}</Text>)}
              </View>
            ) : null}
            <View style={{ height: 12 }} />
            <Bouton label={envoi ? 'Enregistrement…' : '✅ Terminer la visite'} onPress={terminer} couleur={SARCELLE} variante="plein" grand
              disabled={envoi || manques.length > 0} styles={styles} />
            <Text style={styles.hint}>L'heure et la position de départ sont relevées en terminant.</Text>
            <View style={{ height: 24 }} />
            {confirmerAbandon ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Bouton label="Garder la visite" onPress={() => setConfirmerAbandon(false)} couleur={colors.textSecondary} flex styles={styles} />
                <Bouton label="Abandonner" onPress={abandonner} couleur={TONS.rouge} variante="plein" flex disabled={envoi} styles={styles} />
              </View>
            ) : (
              <Bouton label="Abandonner cette visite" onPress={() => setConfirmerAbandon(true)} couleur={TONS.rouge} variante="contour" styles={styles} />
            )}
          </>
        )}

        {suivante ? (
          <>
            <View style={{ height: 16 }} />
            <Bouton label={`Suivant : ${suivante.label.split(' · ')[1]} ›`} onPress={() => allerA(suivante.cle)} couleur={SARCELLE} variante="plein" grand styles={styles} />
          </>
        ) : null}
      </ScrollView>

      <Feuille visible={!!form} titre="Nouvelle tâche" sous={restaurant.nom} onFermer={() => setForm(null)} styles={styles}>
        {form ? (
          <>
            <Libelle styles={styles}>Ce qu'il faut faire</Libelle>
            <Champ styles={styles} colors={colors} value={form.titre} onChangeText={v => setForm(p => ({ ...p, titre: v }))} placeholder="Ex. : nettoyer la hotte" />
            <Champ styles={styles} colors={colors} multiline value={form.details} onChangeText={v => setForm(p => ({ ...p, details: v }))} placeholder="Détails (facultatif)" />
            <View style={{ flexDirection: 'row', marginBottom: 14 }}>
              <Bascule actif={form.importante} label="❗ Tâche importante" couleur={TONS.rouge} colors={colors}
                onPress={() => setForm(p => ({ ...p, importante: !p.importante }))} />
            </View>
            <ChampDate label="Date limite" valeur={form.echeance} onChange={v => setForm(p => ({ ...p, echeance: v }))} effacable minDate={aujourdhui}
              couleur={SARCELLE} styleLabel={styles.label} placeholder="Sans date limite" />
            <Libelle styles={styles}>Responsable</Libelle>
            <Puces petit styles={styles} actif={form.responsable_travailleur_id || (form.responsable_nom ? 'gerant' : null)}
              onChoisir={cle => setForm(p => {
                if (cle === 'gerant') return { ...p, responsable_nom: p.responsable_nom === 'Gérant' ? '' : 'Gérant', responsable_travailleur_id: null }
                const t = equipe.find(x => x.id === cle)
                return p.responsable_travailleur_id === cle
                  ? { ...p, responsable_nom: '', responsable_travailleur_id: null }
                  : { ...p, responsable_nom: t?.nom || '', responsable_travailleur_id: cle }
              })}
              elements={[{ cle: 'gerant', label: 'Gérant' }, ...equipe.map(t => ({ cle: t.id, label: t.nom }))]} />
            <ChampPhoto uri={form.photo_constat_url} onChange={u => setForm(p => ({ ...p, photo_constat_url: u }))} requis={form.importante}
              libelle="Photo de ce que vous avez vu" dossier="supervision/taches" colors={colors} />
            <Bouton label="Ajouter la tâche" onPress={ajouterTache} couleur={SARCELLE} variante="plein" grand styles={styles} />
          </>
        ) : null}
      </Feuille>
    </View>
  )
}

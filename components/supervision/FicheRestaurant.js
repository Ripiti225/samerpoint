// ──────────────────────────────────────────────────────────────────────────────
// Fiche supervision d'un restaurant : sa note (60 % visites + 40 % données),
// ses tâches et ses visites. Vue du gérant (son restaurant), du manager / RH
// (depuis le classement) et du superviseur (avant de commencer une visite).
//
//   Gérant      : « C'est fait » sur une tâche (photo obligatoire), lit les
//                 visites, répond ou conteste (DetailVisite).
//   Superviseur, manager, directeur : demande d'explication sur une tâche en
//                 retard ou constatée non faite.
//   Manager, directeur : annuler une tâche, trancher une contestation.
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { ETATS_TACHE, etatTache, explicationNote, fmtNote, noteRetenueVisite, tacheOuverte } from '../../lib/supervision'
import {
  annulerTache, chargerSynthese, demanderExplicationTache, signalerTacheFaite,
} from '../../lib/supervisionDb'
import { Bouton, Champ, Compteurs, Feuille, Info, Pastille, Vide } from '../ui/EcranModerne'
import DetailVisite from './DetailVisite'
import { ChampPhoto, PastilleNote, SARCELLE, TONS, Vignette, couleurNote, dateCourte, texteJoursSansVisite } from './Elements'

const ADMIN = ['manager', 'directeur']
const PEUT_EXPLIQUER = ['manager', 'directeur', 'superviseur']

export default function FicheRestaurant({ restaurant, role, userId, userNom, onCommencer, enTete, styles, colors }) {
  const [synthese, setSynthese] = useState(null)
  const [erreur, setErreur] = useState(false)
  const [rafraichir, setRafraichir] = useState(false)
  const [onglet, setOnglet] = useState('taches')
  const [filtre, setFiltre] = useState('ouvertes')
  const [visiteOuverte, setVisiteOuverte] = useState(null)
  const [tacheFaite, setTacheFaite] = useState(null)        // tâche que le gérant signale faite
  const [photo, setPhoto] = useState(null)
  const [commentaire, setCommentaire] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const charger = useCallback(async () => {
    try {
      setErreur(false)
      setSynthese(await chargerSynthese({ restaurantId: restaurant.id }))
    } catch { setErreur(true) }
  }, [restaurant.id])
  useEffect(() => { charger() }, [charger])

  const r = synthese?.liste?.[0]
  const aujourdhui = synthese?.aujourdhui
  const taches = useMemo(() => (synthese?.taches || []).filter(t => t.restaurant_id === restaurant.id), [synthese, restaurant.id])
  const visites = useMemo(() => (synthese?.visites || []).filter(v => v.restaurant_id === restaurant.id), [synthese, restaurant.id])
  const tachesAffichees = useMemo(() => {
    const ordre = { en_retard: 0, a_confirmer: 1, a_faire: 2, faite: 3, annulee: 4 }
    return taches
      .filter(t => (filtre === 'ouvertes' ? tacheOuverte(t) : filtre === 'faites' ? t.statut === 'faite' : true))
      .sort((a, b) => ordre[etatTache(a, aujourdhui)] - ordre[etatTache(b, aujourdhui)] || String(a.echeance || '9').localeCompare(String(b.echeance || '9')))
  }, [taches, filtre, aujourdhui])

  async function onRafraichir() { setRafraichir(true); await charger(); setRafraichir(false) }

  async function envoyerFaite() {
    if (!photo) { Alert.alert('Photo obligatoire', 'Prenez une photo qui montre que la tâche est faite.'); return }
    setEnvoi(true)
    try {
      await signalerTacheFaite({ tache: tacheFaite, photoUrl: photo, commentaire, nom: userNom, userId })
      setTacheFaite(null); setPhoto(null); setCommentaire('')
      await charger()
    } catch { Alert.alert('Erreur', "La tâche n'a pas pu être signalée. Réessayez.") } finally { setEnvoi(false) }
  }

  async function demanderExplication(t) {
    setEnvoi(true)
    try {
      await demanderExplicationTache({ tache: t, restaurant, userId, userNom })
      Alert.alert('Demande envoyée', "La demande d'explication part en validation chez le RH / manager.")
      await charger()
    } catch { Alert.alert('Erreur', "La demande n'a pas pu être créée. Réessayez.") } finally { setEnvoi(false) }
  }

  async function annuler(t) {
    setEnvoi(true)
    try { await annulerTache({ tache: t, nom: userNom, userId }); await charger() }
    catch { Alert.alert('Erreur', "La tâche n'a pas pu être annulée.") } finally { setEnvoi(false) }
  }

  if (erreur && !synthese) {
    return (
      <View style={styles.body}>
        {enTete}
        <Vide icone="📡" texte="Lecture impossible" sous="Vérifiez le réseau, puis tirez vers le bas pour réessayer." styles={styles} />
        <Bouton label="Réessayer" onPress={charger} couleur={SARCELLE} styles={styles} />
      </View>
    )
  }

  const nbOuvertes = taches.filter(tacheOuverte).length
  return (
    <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={rafraichir} onRefresh={onRafraichir} />}>
      {enTete}
      {!r ? <ActivityIndicator color={SARCELLE} style={{ marginVertical: 30 }} /> : (
        <>
          <View style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
            <PastilleNote note={r.note} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.carteTitre}>Note du restaurant</Text>
              <Text style={styles.carteSous}>{explicationNote(r)}</Text>
              <Text style={[styles.carteSous, r.sansVisite && { color: TONS.orange, fontWeight: '700' }]}>
                {texteJoursSansVisite(r)}{r.sansVisite && r.joursSansVisite !== null ? ' · à visiter' : ''}
              </Text>
            </View>
          </View>
          {synthese.donneesErreur ? (
            <Info icone="ℹ️" styles={styles} couleur={TONS.orange}>Notes des caissiers indisponibles pour l'instant : la note est calculée sans elles.</Info>
          ) : null}
          <View style={[styles.carte, { gap: 4 }]}>
            <Info icone="🧭" styles={styles}>Visites (60 %) : {fmtNote(r.visites.note)}{r.visites.nb ? ` · ${r.visites.nb} visite${r.visites.nb > 1 ? 's' : ''} sur 30 jours` : ' · aucune sur 30 jours'}</Info>
            <Info icone="📊" styles={styles}>Données (40 %) : {fmtNote(r.donnees.note)}</Info>
            <Info icone="💼" styles={styles}>· Caissiers : {fmtNote(r.donnees.caissiers.note)}{r.donnees.caissiers.nb ? ` (moyenne de ${r.donnees.caissiers.nb})` : ''}</Info>
            <Info icone="✅" styles={styles}>· Tâches faites à temps : {r.donnees.taches.applicable ? `${r.donnees.taches.nbATemps}/${r.donnees.taches.nbEchues}` : 'aucune échue'}</Info>
          </View>

          {onCommencer ? (
            <Bouton label="🧭 Commencer la visite" onPress={onCommencer} couleur={SARCELLE} variante="plein" grand styles={styles} />
          ) : null}

          <View style={styles.ongletsWrap}>
            {[['taches', `Tâches${nbOuvertes ? ` (${nbOuvertes})` : ''}`], ['visites', `Visites (${visites.length})`]].map(([cle, label]) => (
              <TouchableOpacity key={cle} onPress={() => setOnglet(cle)} style={[styles.onglet, onglet === cle && styles.ongletActive]}>
                <Text style={[styles.ongletTxt, onglet === cle && styles.ongletTxtActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ height: 12 }} />

          {onglet === 'taches' ? (
            <>
              <Compteurs styles={styles} actif={filtre} onChoisir={c => setFiltre(c || 'ouvertes')} elements={[
                { cle: 'ouvertes', label: 'Ouvertes', valeur: nbOuvertes, couleur: TONS.orange },
                { cle: 'faites', label: 'Faites', valeur: taches.filter(t => t.statut === 'faite').length, couleur: TONS.vert },
                { cle: 'toutes', label: 'Toutes', valeur: taches.length, couleur: TONS.gris },
              ]} />
              <View style={{ height: 12 }} />
              {!tachesAffichees.length ? <Vide icone="🗒️" texte={filtre === 'ouvertes' ? 'Aucune tâche en cours' : 'Aucune tâche'} styles={styles} /> : null}
              {tachesAffichees.map(t => {
                const etat = etatTache(t, aujourdhui)
                const peutExpliquer = PEUT_EXPLIQUER.includes(role) && !t.demande_explication_id
                  && (etat === 'en_retard' || (t.nb_non_faite > 0 && tacheOuverte(t)))
                return (
                  <View key={t.id} style={[styles.carte, etat === 'en_retard' && styles.carteAlerte]}>
                    <Text style={styles.carteTitre}>{t.importante ? '❗ ' : ''}{t.titre}</Text>
                    {t.details ? <Text style={styles.carteSous}>{t.details}</Text> : null}
                    <View style={styles.carteCorps}>
                      <Info icone="📅" styles={styles}>{t.echeance ? `Pour le ${dateCourte(t.echeance)}` : 'Sans date limite'} · laissée le {dateCourte(t.created_at)}</Info>
                      {t.responsable_nom ? <Info icone="👤" styles={styles}>{t.responsable_nom}</Info> : null}
                      {t.nb_non_faite ? <Info icone="❌" styles={styles} couleur={TONS.rouge}>Constatée non faite {t.nb_non_faite} fois{t.derniere_verif_refus ? ` : ${t.derniere_verif_refus}` : ''}</Info> : null}
                      {t.signalee_at ? <Info icone="📸" styles={styles}>Signalée faite par {t.signalee_par_nom || 'le gérant'} le {dateCourte(t.signalee_at)}{t.signalee_commentaire ? ` : ${t.signalee_commentaire}` : ''}</Info> : null}
                      {t.faite_at ? <Info icone="✅" styles={styles} couleur={TONS.vert}>Confirmée par {t.faite_par_nom || 'le superviseur'} le {dateCourte(t.faite_at)}</Info> : null}
                      {t.demande_explication_id ? <Info icone="📨" styles={styles}>Demande d'explication envoyée</Info> : null}
                    </View>
                    {(t.photo_constat_url || t.signalee_photo_url || t.faite_photo_url) ? (
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                        <Vignette uri={t.photo_constat_url} libelle="Constat" />
                        <Vignette uri={t.signalee_photo_url} libelle="Gérant" />
                        <Vignette uri={t.faite_photo_url} libelle="Superviseur" />
                      </View>
                    ) : null}
                    <Pastille cfg={ETATS_TACHE[etat]} styles={styles} />
                    {(role === 'gerant' && t.statut === 'a_faire') || peutExpliquer || (ADMIN.includes(role) && tacheOuverte(t)) ? (
                      <View style={styles.actions}>
                        {role === 'gerant' && t.statut === 'a_faire'
                          ? <Bouton label="📸 C'est fait" onPress={() => { setTacheFaite(t); setPhoto(null); setCommentaire('') }} couleur={SARCELLE} variante="plein" flex styles={styles} />
                          : null}
                        {peutExpliquer
                          ? <Bouton label="📨 Demander une explication" onPress={() => demanderExplication(t)} couleur={TONS.orange} flex disabled={envoi} styles={styles} />
                          : null}
                        {ADMIN.includes(role) && tacheOuverte(t)
                          ? <Bouton label="Annuler" onPress={() => annuler(t)} couleur={TONS.gris} variante="contour" disabled={envoi} styles={styles} />
                          : null}
                      </View>
                    ) : null}
                  </View>
                )
              })}
            </>
          ) : (
            <>
              {!visites.length ? <Vide icone="🧭" texte="Pas encore de visite" sous="Les visites des 90 derniers jours s'affichent ici." styles={styles} /> : null}
              {visites.map(v => {
                const note = noteRetenueVisite(v)
                return (
                  <TouchableOpacity key={v.id} onPress={() => setVisiteOuverte(v)} activeOpacity={0.8}
                    style={[styles.carte, v.conteste && !v.decision && styles.carteAlerte]}>
                    <View style={styles.carteTop}>
                      <View style={[styles.bulle, { backgroundColor: couleurNote(note) + '1C' }]}>
                        <Text style={{ fontSize: 15, fontWeight: '900', color: couleurNote(note) }}>{fmtNote(note)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.carteTitre}>Visite du {dateCourte(v.debut_at)}</Text>
                        <Text style={styles.carteSous} numberOfLines={2}>
                          {v.superviseur_nom || 'Superviseur'}
                          {v.points_graves ? ` · ⚠️ ${v.points_graves} grave${v.points_graves > 1 ? 's' : ''}` : ''}
                          {v.conteste && !v.decision ? ' · contestée' : ''}
                          {role === 'gerant' && !v.lu_gerant_at ? ' · nouvelle' : ''}
                        </Text>
                        {v.remarques ? <Text style={styles.carteSous} numberOfLines={1}>💬 {v.remarques}</Text> : null}
                      </View>
                      <Text style={{ fontSize: 20, color: colors.textMuted }}>›</Text>
                    </View>
                  </TouchableOpacity>
                )
              })}
            </>
          )}
        </>
      )}

      <Feuille visible={!!visiteOuverte} titre="Visite du superviseur" sous={restaurant.nom} onFermer={() => setVisiteOuverte(null)} styles={styles}>
        {visiteOuverte ? (
          <DetailVisite visiteId={visiteOuverte.id} role={role} userId={userId} userNom={userNom} restaurantNom={restaurant.nom}
            aujourdhui={aujourdhui} onChange={charger} styles={styles} colors={colors} />
        ) : null}
      </Feuille>

      <Feuille visible={!!tacheFaite} titre="Tâche faite" sous={tacheFaite?.titre} onFermer={() => setTacheFaite(null)} styles={styles}>
        <ChampPhoto uri={photo} onChange={setPhoto} requis libelle="Photo de la tâche faite" dossier="supervision/taches" colors={colors} />
        <Champ styles={styles} colors={colors} multiline value={commentaire} onChangeText={setCommentaire} placeholder="Commentaire (facultatif)" />
        <Bouton label={envoi ? 'Envoi…' : 'Signaler comme faite'} onPress={envoyerFaite} couleur={SARCELLE} variante="plein" grand disabled={envoi || !photo} styles={styles} />
        <Text style={styles.hint}>Le superviseur confirmera à sa prochaine visite.</Text>
      </Feuille>
    </ScrollView>
  )
}

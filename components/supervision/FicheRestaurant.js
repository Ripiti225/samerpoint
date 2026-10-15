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
//
// Onglet Matériel : pannes (le gérant dit « réparé » ou « remplacé » avec une
// photo ; superviseur et manager aussi) et suggestions d'achats du superviseur
// (le manager accepte ou refuse, puis l'achat est marqué fait).
// ──────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import {
  achatOuvert, ETATS_ACHAT, ETATS_PANNE, ETATS_TACHE, etatTache, explicationNote, fmtNote, joursEnPanne, noteRetenueVisite, panneOuverte,
  tacheOuverte, totalAchatsAcceptes,
} from '../../lib/supervision'
import {
  annulerTache, chargerSynthese, deciderAchat, demanderExplicationTache, marquerAchatAchete, reglerPanne, signalerTacheFaite,
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
  const [panneReglee, setPanneReglee] = useState(null)      // { panne, statut, photo, commentaire }
  const [refusAchat, setRefusAchat] = useState(null)        // { achat, motif }
  const [voirTout, setVoirTout] = useState(false)

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
  const pannes = useMemo(() => (synthese?.pannes || []).filter(p => p.restaurant_id === restaurant.id), [synthese, restaurant.id])
  const achats = useMemo(() => (synthese?.achats || []).filter(a => a.restaurant_id === restaurant.id), [synthese, restaurant.id])
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

  async function envoyerPanne() {
    const { panne, statut, photo, commentaire: com } = panneReglee
    if (role === 'gerant' && statut !== 'annulee' && !photo) { Alert.alert('Photo obligatoire', 'Prenez une photo du matériel réparé ou remplacé.'); return }
    setEnvoi(true)
    try { await reglerPanne({ panne, statut, commentaire: com, photoUrl: photo, nom: userNom, userId }); setPanneReglee(null); await charger() }
    catch { Alert.alert('Erreur', "Le matériel n'a pas pu être mis à jour. Réessayez.") } finally { setEnvoi(false) }
  }

  async function decider(achat, decision, motif) {
    setEnvoi(true)
    try { await deciderAchat({ achat, decision, motif, nom: userNom, userId }); setRefusAchat(null); await charger() }
    catch { Alert.alert('Erreur', "La décision n'a pas pu être enregistrée. Réessayez.") } finally { setEnvoi(false) }
  }

  async function achete(achat) {
    setEnvoi(true)
    try { await marquerAchatAchete({ achat, nom: userNom, userId }); await charger() }
    catch { Alert.alert('Erreur', "L'achat n'a pas pu être marqué. Réessayez.") } finally { setEnvoi(false) }
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
  const nbMateriel = pannes.filter(panneOuverte).length + achats.filter(achatOuvert).length
  const pannesAffichees = voirTout ? pannes : pannes.filter(panneOuverte)
  const achatsAffiches = voirTout ? achats : achats.filter(achatOuvert)
  const totalAccepte = totalAchatsAcceptes(achats)
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
            {[['taches', `Tâches${nbOuvertes ? ` (${nbOuvertes})` : ''}`],
              ['materiel', `Matériel${nbMateriel ? ` (${nbMateriel})` : ''}`],
              ['visites', `Visites (${visites.length})`]].map(([cle, label]) => (
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
          ) : onglet === 'materiel' ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 6 }}>
                <TouchableOpacity onPress={() => setVoirTout(v => !v)} hitSlop={8}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: SARCELLE }}>{voirTout ? 'En cours seulement' : 'Voir aussi l\'historique'}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.resultat}>🔧 Matériel en panne ({pannes.filter(panneOuverte).length})</Text>
              {!pannesAffichees.length ? <Text style={[styles.carteSous, { marginBottom: 14 }]}>Aucun matériel en panne.</Text> : null}
              {pannesAffichees.map(p => {
                const jours = joursEnPanne(p, aujourdhui)
                return (
                  <View key={p.id} style={[styles.carte, p.urgente && panneOuverte(p) && styles.carteAlerte]}>
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                      <Vignette uri={p.photo_url} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.carteTitre}>{p.urgente ? '🚨 ' : ''}{p.objet}</Text>
                        {p.description ? <Text style={styles.carteSous}>{p.description}</Text> : null}
                        <Text style={[styles.carteSous, jours > 7 && { color: TONS.rouge, fontWeight: '700' }]}>
                          Signalé le {dateCourte(p.created_at)}{p.signale_par_nom ? ` par ${p.signale_par_nom}` : ''}{jours ? ` · ${jours} j en panne` : ''}
                        </Text>
                        {p.repare_at ? (
                          <Text style={[styles.carteSous, { color: TONS.vert }]}>
                            {ETATS_PANNE[p.statut]?.label} le {dateCourte(p.repare_at)}{p.repare_par_nom ? ` par ${p.repare_par_nom}` : ''}{p.repare_commentaire ? ` : ${p.repare_commentaire}` : ''}
                          </Text>
                        ) : null}
                      </View>
                      <Vignette uri={p.repare_photo_url} libelle="Après" />
                    </View>
                    <Pastille cfg={ETATS_PANNE[p.statut]} styles={styles} />
                    {panneOuverte(p) && role !== 'rh' ? (
                      <View style={styles.actions}>
                        <Bouton label="✅ Réparé" onPress={() => setPanneReglee({ panne: p, statut: 'reparee', photo: null, commentaire: '' })} couleur={TONS.vert} variante="plein" flex styles={styles} />
                        <Bouton label="🔁 Remplacé" onPress={() => setPanneReglee({ panne: p, statut: 'remplacee', photo: null, commentaire: '' })} couleur={TONS.vert} flex styles={styles} />
                        {ADMIN.includes(role)
                          ? <Bouton label="Retirer" onPress={() => setPanneReglee({ panne: p, statut: 'annulee', photo: null, commentaire: '' })} couleur={TONS.gris} variante="contour" styles={styles} />
                          : null}
                      </View>
                    ) : null}
                  </View>
                )
              })}

              <View style={{ height: 10 }} />
              <Text style={styles.resultat}>💡 Suggestions d'achats ({achats.filter(achatOuvert).length})</Text>
              {totalAccepte ? <Info icone="🧾" styles={styles}>Acceptés, à acheter : ≈ {totalAccepte.toLocaleString('fr-FR')} F (prix connus)</Info> : null}
              {!achatsAffiches.length ? <Text style={[styles.carteSous, { marginBottom: 14 }]}>Aucune suggestion en cours.</Text> : null}
              {achatsAffiches.map(a => (
                <View key={a.id} style={[styles.carte, a.statut === 'proposee' && a.urgente && styles.carteAlerte]}>
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <Vignette uri={a.photo_url} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.carteTitre}>{a.urgente ? '🚨 ' : ''}{a.quantite} × {a.objet}</Text>
                      {a.raison ? <Text style={styles.carteSous}>{a.raison}</Text> : null}
                      {a.prix_estime ? <Text style={styles.carteSous}>≈ {Number(a.prix_estime).toLocaleString('fr-FR')} F l'unité · {(Number(a.prix_estime) * a.quantite).toLocaleString('fr-FR')} F au total</Text> : null}
                      <Text style={styles.carteSous}>Proposé le {dateCourte(a.created_at)}{a.propose_par_nom ? ` par ${a.propose_par_nom}` : ''}</Text>
                      {a.decision_at ? (
                        <Text style={[styles.carteSous, { color: a.statut === 'refusee' ? TONS.gris : TONS.bleu }]}>
                          {a.statut === 'refusee' ? 'Refusé' : 'Accepté'} par {a.decision_par_nom || 'le manager'} le {dateCourte(a.decision_at)}{a.decision_motif ? ` : ${a.decision_motif}` : ''}
                        </Text>
                      ) : null}
                      {a.achete_at ? <Text style={[styles.carteSous, { color: TONS.vert }]}>Acheté le {dateCourte(a.achete_at)}{a.achete_par_nom ? ` (${a.achete_par_nom})` : ''}</Text> : null}
                    </View>
                  </View>
                  <Pastille cfg={ETATS_ACHAT[a.statut]} styles={styles} />
                  {ADMIN.includes(role) && a.statut === 'proposee' ? (
                    <View style={styles.actions}>
                      <Bouton label="👍 Accepter" onPress={() => decider(a, 'acceptee')} couleur={TONS.bleu} variante="plein" flex disabled={envoi} styles={styles} />
                      <Bouton label="Refuser" onPress={() => setRefusAchat({ achat: a, motif: '' })} couleur={TONS.gris} flex disabled={envoi} styles={styles} />
                    </View>
                  ) : null}
                  {(ADMIN.includes(role) || role === 'gerant') && a.statut === 'acceptee' ? (
                    <View style={styles.actions}>
                      <Bouton label="✅ C'est acheté" onPress={() => achete(a)} couleur={TONS.vert} variante="plein" flex disabled={envoi} styles={styles} />
                    </View>
                  ) : null}
                </View>
              ))}
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
      <Feuille visible={!!panneReglee} sous={panneReglee?.panne?.objet} onFermer={() => setPanneReglee(null)} styles={styles}
        titre={panneReglee?.statut === 'annulee' ? 'Retirer de la liste' : panneReglee?.statut === 'remplacee' ? 'Matériel remplacé' : 'Matériel réparé'}>
        {panneReglee ? (
          <>
            {panneReglee.statut !== 'annulee' ? (
              <ChampPhoto uri={panneReglee.photo} onChange={u => setPanneReglee(p => ({ ...p, photo: u }))} requis={role === 'gerant'}
                libelle="Photo du matériel qui marche" dossier="supervision/materiel" colors={colors} />
            ) : null}
            <Champ styles={styles} colors={colors} multiline value={panneReglee.commentaire} onChangeText={v => setPanneReglee(p => ({ ...p, commentaire: v }))}
              placeholder={panneReglee.statut === 'annulee' ? 'Pourquoi le retirer ? (facultatif)' : 'Qui a réparé, combien ça a coûté… (facultatif)'} />
            <Bouton label={envoi ? 'Envoi…' : 'Enregistrer'} onPress={envoyerPanne} couleur={panneReglee.statut === 'annulee' ? TONS.gris : TONS.vert}
              variante="plein" grand disabled={envoi || (role === 'gerant' && panneReglee.statut !== 'annulee' && !panneReglee.photo)} styles={styles} />
          </>
        ) : null}
      </Feuille>

      <Feuille visible={!!refusAchat} titre="Refuser l'achat" sous={refusAchat?.achat?.objet} onFermer={() => setRefusAchat(null)} styles={styles}>
        {refusAchat ? (
          <>
            <Champ styles={styles} colors={colors} multiline value={refusAchat.motif} onChangeText={v => setRefusAchat(p => ({ ...p, motif: v }))}
              placeholder="Pourquoi ? (le gérant verra ce motif)" />
            <Bouton label={envoi ? 'Envoi…' : 'Refuser'} onPress={() => decider(refusAchat.achat, 'refusee', refusAchat.motif)} couleur={TONS.gris}
              variante="plein" grand disabled={envoi} styles={styles} />
          </>
        ) : null}
      </Feuille>
    </ScrollView>
  )
}

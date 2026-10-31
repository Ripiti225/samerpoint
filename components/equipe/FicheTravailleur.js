// Fiche complète d'un travailleur : carte professionnelle (ex-Équipe globale),
// actions, papiers, puis historique de présences (ex-fiche RH).
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Image, Linking, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import {
  BLEU, PERIODES, STATUTS, couleurTaux, fmt, formatDate, friseJours, plageDates, statsTravailleur, titrePeriode,
} from '../../lib/equipe'
import { carteEnCours, htmlCarteTravailleur, libelleValidite, numeroCarte, validiteCarte } from '../../lib/carteTravailleur'
import { chargerContratsTravailleur, derniereCarte, emettreCarte, marquerBadgeRendu, qrSvgCarte } from '../../lib/cartesTravailleursDb'
import { aujourdhuiISO } from '../../lib/contrats'
import { chargerDocuments, chargerHistoriqueTravailleur, chargerPaiesGerantTravailleur, chargerPoints } from '../../lib/equipeDb'
import { completerPresences, nomJour } from '../../lib/joursRepos'
import { restoAvecPaie } from '../../lib/paieDb'
import { exporterPdf } from '../../lib/pdfDocuments'
import Avatar from './Avatar'
import SectionPaie from './SectionPaie'
import { PastilleStatut } from './OngletPresences'
import { teinte } from './styles'
import { useApp } from '../../context/AppContext'

const TYPE_DOC_ICONS = { 'CNI': '🪪', 'Passeport': '📕', 'Permis de conduire': '🚗', 'Contrat': '📄', 'Autre': '📎' }

function libelleStatut(t) {
  return t.statut === 'archive' ? 'Archivé' : t.actif ? 'Actif' : 'Inactif'
}

function nbJoursEntre(debut, fin) {
  return Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86400000) + 1
}

export default function FicheTravailleur({ visible, trav, resto, styles, colors, perso, peutEditer, onFermer, onModifier, onTransferer, onArchiver }) {
  const s2 = useMemo(() => f(colors), [colors])
  const [periode, setPeriode] = useState('month')
  const [presences, setPresences] = useState([])
  const [paiesGerant, setPaiesGerant] = useState([])  // salaires payés via Déductions gérant
  const [docs, setDocs] = useState([])
  const [loadingPres, setLoadingPres] = useState(false)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Carte imprimée : undefined = en chargement, null = aucune,
  // { indisponible } = migration pas passée, sinon { id, valide_jusqua, emise_le }.
  const [carte, setCarte] = useState(undefined)
  const [creation, setCreation] = useState(false)
  const [contrats, setContrats] = useState(null)   // null = pas encore chargés
  const [badgeRendu, setBadgeRendu] = useState(null)
  const { userId, userNom } = useApp()

  const plage = useMemo(() => plageDates(periode, perso), [periode, perso])
  const periodes = PERIODES.filter(p => p.key !== 'custom' || (perso.debut && perso.fin))

  useEffect(() => { setPeriode('month'); setZoom(false) }, [trav?.id])

  useEffect(() => {
    if (!visible || !trav?.id) return
    setCarte(undefined)
    setContrats(null)
    setBadgeRendu(trav.badge_rendu ?? null)
    derniereCarte(trav.id).then(setCarte).catch(() => setCarte(null))
    chargerContratsTravailleur(trav.id).then(setContrats).catch(() => setContrats([]))
  }, [visible, trav?.id, trav?.badge_rendu])

  // Calculé à l'avance : l'impression doit partir sans attente (Safari iPhone).
  const qrSvg = useMemo(() => (carte?.id ? qrSvgCarte(carte.id) : null), [carte?.id])

  useEffect(() => {
    if (!visible || !trav?.id) return
    setLoadingDocs(true)
    chargerDocuments(trav.id).then(setDocs).catch(() => setDocs([])).finally(() => setLoadingDocs(false))
  }, [visible, trav?.id])

  useEffect(() => {
    if (!visible || !trav?.id || !plage) return
    let actif = true
    setLoadingPres(true)
    Promise.all([
      chargerHistoriqueTravailleur(trav.id, plage),
      trav.restaurant_id ? chargerPoints(plage, trav.restaurant_id) : [],
      chargerPaiesGerantTravailleur(trav, plage).catch(() => []),
    ])
      .then(([hist, points, paiesG]) => {
        if (!actif) return
        setPaiesGerant(paiesG)
        // Jours non pointés : Repos / Absent / Non pointé selon son jour de repos.
        const complet = completerPresences({ presences: hist, travailleurs: [trav], points, aujourdhui: aujourdhuiISO() })
        setPresences(complet.sort((a, b) => b.date.localeCompare(a.date)))
      })
      .catch(() => { if (actif) { setPresences([]); setPaiesGerant([]) } })
      .finally(() => { if (actif) setLoadingPres(false) })
    return () => { actif = false }
  }, [visible, trav?.id, trav?.jour_repos, plage]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!trav) return null
  const archive = trav.statut === 'archive'
  const restoNom = resto?.nom || trav.restaurants?.nom || 'SAMER'
  const s = statsTravailleur(presences)
  const totalGerant = paiesGerant.reduce((sum, d) => sum + (parseFloat(d.montant) || 0), 0)
  const totalPercu = s.totalPaye + totalGerant
  const frise = plage ? friseJours(presences, plage.fin, Math.min(31, nbJoursEntre(plage.debut, plage.fin))) : []

  const enCours = carteEnCours(carte, aujourdhuiISO())
  // Validité d'une NOUVELLE carte : fin du contrat en cours, CDI = jusqu'au départ, sinon 6 mois.
  const validite = contrats ? validiteCarte(trav, contrats, aujourdhuiISO()) : null

  // Aucun `await` avant exporterPdf : la fenêtre d'impression doit s'ouvrir
  // dans le geste du toucher, sinon Safari iPhone la bloque.
  async function exporter() {
    if (exporting || !enCours || !qrSvg) return
    setExporting(true)
    try {
      const html = htmlCarteTravailleur(trav, resto, aujourdhuiISO(), { jeton: carte.id, qrSvg, valideJusqua: carte.valide_jusqua })
      await exporterPdf(html, `Carte_${String(trav.nom).replace(/\s+/g, '_')}.pdf`, `Carte — ${trav.nom}`)
    } finally {
      setExporting(false)
    }
  }

  async function creerCarte() {
    if (creation) return
    setCreation(true)
    try {
      setCarte(await emettreCarte(trav.id, userNom, validite.valideJusqua))
    } catch (e) {
      Alert.alert('Carte', e.message)
    }
    setCreation(false)
  }

  async function badgeRapporte() {
    try {
      await marquerBadgeRendu(trav.id)
      setBadgeRendu(true)
    } catch (e) {
      Alert.alert('Badge', e.message)
    }
  }

  const dateLongue = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  const texteCarte = carte === undefined ? 'Chargement…'
    : carte?.indisponible ? 'Vérification pas encore activée'
    : !carte ? 'Aucune carte imprimée'
    : enCours ? `N° ${numeroCarte(carte.id)} · valable ${carte.valide_jusqua ? `jusqu'au ${dateLongue(carte.valide_jusqua)}` : 'pendant le CDI'}`
    : `N° ${numeroCarte(carte.id)} · expirée le ${dateLongue(carte.valide_jusqua)}`

  const ligneInfo = (icone, label, val, onPress) => {
    const contenu = (
      <>
        <Text style={s2.infoIcon}>{icone}</Text>
        <Text style={s2.infoLabel}>{label}</Text>
        <Text style={[s2.infoVal, onPress && { color: BLEU }]}>{val}</Text>
      </>
    )
    return onPress
      ? <TouchableOpacity style={s2.infoRow} onPress={onPress}>{contenu}</TouchableOpacity>
      : <View style={s2.infoRow}>{contenu}</View>
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onFermer}>
      <SafeAreaView style={styles.container}>
        <View style={s2.top}>
          <TouchableOpacity onPress={onFermer}><Text style={s2.fermer}>✕ Fermer</Text></TouchableOpacity>
          <Text style={s2.topTitre}>Fiche travailleur</Text>
          <View style={{ width: 70 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          {/* ─── Carte professionnelle ─── */}
          <View style={s2.carte}>
            <View style={[s2.carteBandeau, { backgroundColor: archive ? '#7A7A86' : BLEU }]}>
              <Text style={s2.carteResto}>{restoNom.toUpperCase()}</Text>
            </View>
            <View style={{ alignItems: 'center', paddingTop: 20 }}>
              <TouchableOpacity onPress={() => trav.photo_url && setZoom(true)} activeOpacity={trav.photo_url ? 0.8 : 1}>
                <Avatar nom={trav.nom} photo={trav.photo_url} resto={resto || trav.restaurants} taille={100}
                  style={{ borderWidth: 4, borderColor: colors.surface }} />
              </TouchableOpacity>
              <Text style={s2.carteNom}>{trav.nom}</Text>
              <Text style={s2.cartePoste}>{trav.poste || 'Sans poste'}</Text>
            </View>
            <View style={s2.carteInfos}>
              {ligneInfo('📍', 'Restaurant', restoNom)}
              {trav.contact ? ligneInfo('📞', 'Téléphone', trav.contact, () => Linking.openURL(`tel:${trav.contact}`)) : null}
              {trav.salaire_journalier ? ligneInfo('💰', 'Salaire', `${Number(trav.salaire_journalier).toLocaleString('fr-FR')} F / jour`) : null}
              {trav.type_contrat ? ligneInfo('📋', 'Contrat', trav.type_contrat) : null}
              {ligneInfo(archive ? '⚫' : trav.actif ? '🟢' : '🔴', 'Statut', libelleStatut(trav))}
              {!archive ? ligneInfo('😴', 'Jour de repos', trav.jour_repos
                ? `${nomJour(trav.jour_repos)} · ${trav.jour_repos_source === 'manuel' ? 'fixé à la main' : 'déduit'}`
                : trav.jour_repos_source === 'manuel' ? 'Pas de jour fixe' : 'Pas encore connu') : null}
              {trav.date_embauche ? ligneInfo('📅', "Date d'embauche",
                new Date(trav.date_embauche).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })) : null}
              {archive && trav.archive_motif ? ligneInfo('📦', 'Motif', trav.archive_motif) : null}
              {archive ? ligneInfo('🪪', 'Badge', badgeRendu === true
                ? `Rendu${trav.badge_rendu_le ? ` le ${dateLongue(trav.badge_rendu_le)}` : ''}`
                : badgeRendu === false ? '⚠️ Non rendu' : 'Non renseigné') : ligneInfo('🪪', 'Carte', texteCarte)}
            </View>
          </View>

          {/* ─── Actions ─── */}
          <View style={s2.actions}>
            {peutEditer && !archive && (
              <>
                <TouchableOpacity style={[s2.action, { backgroundColor: teinte(BLEU) }]} onPress={() => onModifier(trav)}>
                  <Text style={[s2.actionTxt, { color: BLEU }]}>✏️ Modifier</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s2.action, { backgroundColor: teinte('#6C63E0') }]} onPress={() => onTransferer(trav)}>
                  <Text style={[s2.actionTxt, { color: '#6C63E0' }]}>🔄 Transférer</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s2.action, { backgroundColor: teinte('#C27C1A') }]} onPress={() => onArchiver(trav)}>
                  <Text style={[s2.actionTxt, { color: '#C27C1A' }]}>📦 Archiver</Text>
                </TouchableOpacity>
              </>
            )}
            {/* Carte : créer (base) puis imprimer ; une nouvelle carte rend l'ancienne invalide au scan. */}
            {!archive && enCours && (
              <TouchableOpacity style={[s2.action, { backgroundColor: BLEU }, exporting && { opacity: 0.6 }]} onPress={exporter} disabled={exporting}>
                <Text style={[s2.actionTxt, { color: '#fff' }]}>{exporting ? 'Génération…' : '📄 Imprimer la carte'}</Text>
              </TouchableOpacity>
            )}
            {!archive && peutEditer && carte !== undefined && !carte?.indisponible && validite && (
              <TouchableOpacity style={[s2.action, { backgroundColor: enCours ? teinte(BLEU) : BLEU }, creation && { opacity: 0.6 }]}
                onPress={creerCarte} disabled={creation}>
                <Text style={[s2.actionTxt, { color: enCours ? BLEU : '#fff' }]}>
                  {creation ? 'Création…' : enCours ? '🆕 Remplacer la carte' : `🆕 Créer la carte (${libelleValidite(validite.valideJusqua)})`}
                </Text>
              </TouchableOpacity>
            )}
            {archive && badgeRendu === false && peutEditer && (
              <TouchableOpacity style={[s2.action, { backgroundColor: teinte('#1E9E5A') }]} onPress={badgeRapporte}>
                <Text style={[s2.actionTxt, { color: '#1E9E5A' }]}>✅ Badge rendu</Text>
              </TouchableOpacity>
            )}
          </View>
          {!archive && enCours && peutEditer && (
            <Text style={[s2.vide, { marginTop: -10, marginBottom: 16 }]}>
              « Remplacer la carte » rend l'ancienne invalide au scan (carte perdue, photo changée, contrat renouvelé…).
              {validite ? ` Nouvelle carte : ${libelleValidite(validite.valideJusqua)}${validite.source === 'defaut' ? ' (aucun contrat saisi : 6 mois)' : validite.source === 'contrat' ? ' (fin du contrat)' : ''}.` : ''}
            </Text>
          )}

          {peutEditer && !archive && ['CDD', 'CDI'].includes(trav.type_contrat) && restoAvecPaie(resto || trav.restaurants) && contrats !== null && (
            <SectionPaie trav={trav} contrats={contrats} ctx={{ userId: userId || null, userNom: userNom || null }} colors={colors} accent={BLEU} />
          )}

          {/* ─── Papiers ─── */}
          <Text style={styles.sectionTitre}>Papiers</Text>
          {loadingDocs ? (
            <ActivityIndicator size="small" color={BLEU} style={{ marginVertical: 12 }} />
          ) : docs.length === 0 ? (
            <Text style={s2.vide}>Aucun document enregistré</Text>
          ) : docs.map(doc => (
            <TouchableOpacity key={doc.id} style={s2.doc} onPress={() => doc.fichier_url && Linking.openURL(doc.fichier_url)}>
              <Text style={{ fontSize: 24 }}>{TYPE_DOC_ICONS[doc.type_document] || '📎'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.nom}>{doc.type_document}</Text>
                <Text style={styles.sousNom}>{doc.description === 'pdf' ? 'PDF' : 'Photo'} · {new Date(doc.created_at).toLocaleDateString('fr-FR')}</Text>
              </View>
              <Text style={styles.lien}>Ouvrir →</Text>
            </TouchableOpacity>
          ))}

          {/* ─── Présences ─── */}
          <Text style={[styles.sectionTitre, { marginTop: 18 }]}>Présences</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
            {periodes.map(p => (
              <TouchableOpacity key={p.key} style={[styles.chipPetit, periode === p.key && styles.chipPetitActive]} onPress={() => setPeriode(p.key)}>
                <Text style={[styles.chipPetitTxt, periode === p.key && styles.chipPetitTxtActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loadingPres ? (
            <View style={styles.loadingBox}><ActivityIndicator size="large" color={BLEU} /></View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {[
                  { v: s.present, l: 'Présences', c: STATUTS['Présent'] },
                  { v: s.absent, l: 'Absences', c: STATUTS['Absent'] },
                  { v: s.repos + s.conge + s.malade + s.permission, l: 'Autres', c: STATUTS['Repos'] },
                  { v: `${s.taux.toFixed(0)}%`, l: 'Taux', c: couleurTaux(s.taux) },
                ].map(k => (
                  <View key={k.l} style={[s2.stat, { backgroundColor: teinte(k.c) }]}>
                    <Text style={[s2.statVal, { color: k.c }]}>{k.v}</Text>
                    <Text style={[s2.statLabel, { color: k.c }]}>{k.l}</Text>
                  </View>
                ))}
              </View>

              <View style={[styles.heroCard, { paddingVertical: 14 }]}>
                <Text style={styles.heroTitre}>💰 Total perçu — {titrePeriode(periode, perso)}</Text>
                <Text style={[styles.heroValeur, { fontSize: 24 }]}>{fmt(totalPercu)}</Text>
                {totalGerant > 0 && (
                  <Text style={styles.heroSub}>{`Présences ${fmt(s.totalPaye)} · payé par le gérant ${fmt(totalGerant)}`}</Text>
                )}
                <Text style={styles.heroSub}>Moyenne : {s.present > 0 ? fmt(totalPercu / s.present) : '0 FCFA'} / jour</Text>
              </View>

              {frise.length > 0 && (s.total > 0 || s.nonPointe > 0) && (
                <View style={styles.carte}>
                  <Text style={[styles.sousNom, { marginTop: 0, marginBottom: 8, fontWeight: '600' }]}>
                    {s.taux.toFixed(0)}% de présence sur {s.total} jour(s){s.nonPointe ? ` · ${s.nonPointe} non pointé(s)` : ''}
                  </Text>
                  <View style={s2.frise}>
                    {frise.map(j => (
                      <View key={j.date} style={[s2.case, { backgroundColor: j.statut ? (STATUTS[j.statut] || '#888') : colors.surfaceAlt }]} />
                    ))}
                  </View>
                  <View style={[styles.miniStats, { marginTop: 8 }]}>
                    {['Présent', 'Absent', 'Repos', 'Congé', 'Malade', 'Non pointé'].map(st => (
                      <View key={st} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={[s2.case, { width: 9, height: 9, backgroundColor: STATUTS[st] }]} />
                        <Text style={[styles.sousNom, { marginTop: 0, fontSize: 11 }]}>{st}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {paiesGerant.length > 0 && (
                <>
                  <Text style={[styles.sectionTitre, { marginTop: 6 }]}>Payé par le gérant ({paiesGerant.length})</Text>
                  <View style={styles.carteListe}>
                    {paiesGerant.map((d, i) => (
                      <View key={d.id} style={[styles.ligne, i === paiesGerant.length - 1 && { borderBottomWidth: 0 }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.nom, { fontSize: 13, fontWeight: '600' }]}>{formatDate(d.date)}</Text>
                          <Text style={styles.shift}>💼 Déductions gérant</Text>
                        </View>
                        <Text style={styles.paie}>{fmt(d.montant)}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              <Text style={[styles.sectionTitre, { marginTop: 6 }]}>Historique jour par jour</Text>
              {presences.length === 0 ? (
                <View style={styles.emptyBox}><Text style={styles.emptyTxt}>Aucune présence sur cette période</Text></View>
              ) : (
                <View style={styles.carteListe}>
                  {presences.map((p, i) => (
                    <View key={p.id || `${p.date}|${i}`} style={[styles.ligne, i === presences.length - 1 && { borderBottomWidth: 0 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.nom, { fontSize: 13, fontWeight: '600' }]}>{formatDate(p.date)}</Text>
                        {p.shift_nom ? <Text style={styles.shift}>⏰ {p.shift_nom} {p.heure_debut ? `(${p.heure_debut} → ${p.heure_fin})` : ''}</Text> : null}
                      </View>
                      <PastilleStatut styles={styles} statut={p.statut} deduit={p.deduit} />
                      {p.statut === 'Présent' && parseFloat(p.paye) > 0 ? <Text style={[styles.paie, { marginLeft: 8 }]}>{fmt(p.paye)}</Text> : null}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Zoom photo plein écran (superposé, pas de modale imbriquée) */}
        {zoom && trav.photo_url ? (
          <View style={s2.zoom}>
            <TouchableOpacity style={s2.zoomClose} onPress={() => setZoom(false)}>
              <Text style={{ color: '#fff', fontSize: 28, fontWeight: '300' }}>✕</Text>
            </TouchableOpacity>
            <Image source={{ uri: trav.photo_url }} style={{ width: '90%', height: '70%' }} resizeMode="contain" />
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  )
}

const f = colors => StyleSheet.create({
  top: { backgroundColor: BLEU, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fermer: { fontSize: 14, color: '#D6E6F8', fontWeight: '600', width: 70 },
  topTitre: { fontSize: 16, fontWeight: '800', color: '#fff' },
  carte: {
    backgroundColor: colors.surface, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderLight, marginBottom: 14,
    shadowColor: colors.cardShadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 14, elevation: 2,
  },
  carteBandeau: { paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' },
  carteResto: { fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 1.5, textAlign: 'center' },
  carteNom: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center', marginTop: 12, paddingHorizontal: 16 },
  cartePoste: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 4, marginBottom: 6 },
  carteInfos: { padding: 16, gap: 14, borderTopWidth: 1, borderTopColor: colors.borderLight, marginTop: 10 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoIcon: { fontSize: 16, width: 26, textAlign: 'center' },
  infoLabel: { flex: 1, fontSize: 13, color: colors.textMuted },
  infoVal: { fontSize: 13, fontWeight: '700', color: colors.text, maxWidth: '58%', textAlign: 'right' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  action: { flexGrow: 1, flexBasis: '45%', minWidth: 130, paddingVertical: 13, borderRadius: 14, alignItems: 'center' },
  actionTxt: { fontSize: 14, fontWeight: '700' },
  vide: { fontSize: 13, color: colors.textPlaceholder, textAlign: 'center', paddingVertical: 12 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.borderLight },
  stat: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  statVal: { fontSize: 19, fontWeight: '800' },
  statLabel: { fontSize: 10.5, marginTop: 3, fontWeight: '700' },
  frise: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  case: { width: 14, height: 14, borderRadius: 4 },
  zoom: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  zoomClose: { position: 'absolute', top: 50, right: 20, zIndex: 2, padding: 10 },
})

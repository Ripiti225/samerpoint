// ──────────────────────────────────────────────────────────────────────────────
// Rapports → Analyse : un mois passé au crible, avec toutes les sources réunies
// (points, résultat net de la Trésorerie, objectifs, POS, litiges, note des
// caissiers). Faits marquants écrits en clair, puis le détail.
// Calculs : lib/analyseMois.js · chargement : lib/analyseMoisDb.js
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { useTheme } from '../../context/ThemeContext'
import { couleurResto } from '../../lib/dashboardGlobal'
import { fmtCourt, melangerCouleurs } from '../../lib/graphiques'
import { chargerAnalyse, moisProposes } from '../../lib/analyseMoisDb'
import { heuresDuService, mixCanaux } from '../../lib/statsPOS'
import { Anneau, Barres, BarresHorizontales, CarteGraphique, CourbeAire } from '../graphiques'
import VenteDouble from '../ui/VenteDouble'

const fmt = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} F`
const pct = v => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v} %`)
const note = v => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')}/20`)

export default function OngletAnalyse({ onExporter }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const mois = useMemo(() => moisProposes(6), [])
  const [choisi, setChoisi] = useState(mois[1]?.mois || mois[0].mois)   // dernier mois clos par défaut
  const [analyse, setAnalyse] = useState(null)
  const [etape, setEtape] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [ouvert, setOuvert] = useState(null)

  useEffect(() => {
    let vivant = true
    setErreur(null); setEtape('Préparation…')
    chargerAnalyse(choisi, e => vivant && setEtape(e))
      .then(a => { if (vivant) { setAnalyse(a); setEtape(null) } })
      .catch(e => { if (vivant) { setErreur(e?.message || 'Analyse impossible.'); setEtape(null) } })
    return () => { vivant = false }
  }, [choisi])

  const infoMois = mois.find(m => m.mois === choisi)
  const a = analyse?.mois === choisi ? analyse : null
  const tons = { bon: colors.successDark, alerte: colors.error, info: colors.primary }
  const fonds = { bon: colors.successLight, alerte: colors.errorLight, info: colors.primaryLight }

  return (
    <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
        {mois.map(m => {
          const actif = m.mois === choisi
          return (
            <TouchableOpacity key={m.mois} style={[styles.puce, actif && styles.puceActive]} onPress={() => setChoisi(m.mois)}>
              <Text style={[styles.puceTxt, actif && styles.puceTxtActive]}>
                {m.label.charAt(0).toUpperCase() + m.label.slice(1)}{m.enCours ? ' · en cours' : ''}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {etape && (
        <View style={styles.chargement}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.chargementTxt}>{etape}</Text>
          <Text style={styles.chargementSous}>Ventes, résultat net, POS, litiges et équipe : quelques secondes.</Text>
        </View>
      )}
      {erreur && !etape && (
        <View style={styles.erreur}>
          <MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.errorDark} />
          <Text style={styles.erreurTxt}>{erreur}</Text>
        </View>
      )}

      {a && !etape && (<>
        {/* Carte principale */}
        <View style={styles.hero}>
          <View style={[styles.heroRond, { top: -70, right: -50, width: 190, height: 190 }]} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={styles.heroIcone}><MaterialCommunityIcons name="file-chart-outline" size={18} color="#FFFFFF" /></View>
            <Text style={styles.heroLbl} numberOfLines={1}>
              {infoMois?.label}{a.enCours ? ` · au ${a.jourCourant}` : ''}
            </Text>
          </View>
          <VenteDouble machine={a.totaux.ca} theorique={a.totaux.caTheo} colors={colors} taille={13}
            couleur="rgba(255,255,255,0.8)" couleurValeur="#FFFFFF">
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <Text style={styles.heroValeur} numberOfLines={1} adjustsFontSizeToFit>{fmt(a.totaux.ca)}</Text>
              {a.totaux.varCa !== null && (
                <View style={styles.heroVar}>
                  <MaterialCommunityIcons name={a.totaux.varCa >= 0 ? 'arrow-up' : 'arrow-down'} size={13} color="#FFFFFF" />
                  <Text style={styles.heroVarTxt}>{Math.abs(a.totaux.varCa)} %</Text>
                </View>
              )}
            </View>
          </VenteDouble>
          <Text style={styles.heroSous}>
            Vente machine du mois{a.totaux.varCa !== null ? ` · ${a.enCours ? 'comparé au mois précédent à date égale' : 'comparé au mois précédent'}` : ''}
          </Text>
          <View style={styles.heroCases}>
            {[
              { label: 'Bénéfice SC', valeur: fmtCourt(a.totaux.benefice), point: '#A7F3D0' },
              { label: 'Résultat net', valeur: a.totaux.net === null ? '—' : fmtCourt(a.totaux.net), point: '#FDE68A' },
              { label: a.enCours ? 'Objectif (rythme)' : 'Objectif', valeur: a.totaux.pctObjectif === null ? '—' : `${a.totaux.pctObjectif} %`, point: '#BAE6FD' },
            ].map(c => (
              <View key={c.label} style={styles.heroCase}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.point }} />
                  <Text style={styles.heroCaseLbl} numberOfLines={1}>{c.label}</Text>
                </View>
                <Text style={styles.heroCaseVal} numberOfLines={1} adjustsFontSizeToFit>{c.valeur}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Ce qu'il faut retenir */}
        {a.faits.length > 0 && (
          <View style={styles.carte}>
            <View style={styles.titreCarte}>
              <MaterialCommunityIcons name="lightbulb-on-outline" size={20} color={colors.primary} />
              <Text style={styles.titreCarteTxt}>Ce qu’il faut retenir</Text>
            </View>
            {a.faits.map(f => (
              <View key={f.texte} style={styles.fait}>
                <View style={[styles.faitIcone, { backgroundColor: fonds[f.ton] }]}>
                  <MaterialCommunityIcons name={f.icone} size={16} color={tons[f.ton]} />
                </View>
                <Text style={styles.faitTxt}>{f.texte}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Ventes jour par jour, ce mois contre le précédent */}
        <CarteGraphique icone="chart-areaspline" couleur="#EF9F27" titre="Ventes jour par jour"
          sous="Ce mois (plein) contre le mois précédent (pointillé)"
          legende={[{ nom: 'Ce mois', couleur: '#EF9F27' }, { nom: 'Mois précédent', couleur: '#94A3B8', pointille: true }]}>
          {l => {
            const nb = Math.max(a.serie.length, a.seriePrec.length)
            const jusqua = a.enCours ? a.jourCourant : nb
            return (
              <CourbeAire largeur={l} etiquettes={Array.from({ length: nb }, (_, i) => String(i + 1))} formatDetail={fmt}
                series={[
                  { nom: 'Ce mois', valeurs: a.serie.slice(0, jusqua), couleur: '#EF9F27', aire: true },
                  { nom: 'Mois précédent', valeurs: a.seriePrec, couleur: '#94A3B8', pointille: true },
                ]} />
            )
          }}
        </CarteGraphique>

        {/* Restaurants : tout réuni */}
        <View style={styles.titreSection}>
          <MaterialCommunityIcons name="storefront-outline" size={18} color={colors.primary} />
          <Text style={styles.titreSectionTxt}>Restaurant par restaurant</Text>
        </View>
        {a.lignes.map((r, i) => {
          const c = couleurResto(r.couleur)
          const estOuvert = ouvert === r.id
          return (
            <TouchableOpacity key={r.id} activeOpacity={0.8} onPress={() => setOuvert(estOuvert ? null : r.id)}
              style={[styles.resto, { borderLeftColor: c }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.rang, i < 3 && { backgroundColor: ['#F59E0B', '#94A3B8', '#B45309'][i] }]}>
                  <Text style={[styles.rangTxt, i < 3 && { color: '#FFFFFF' }]}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.restoNom} numberOfLines={1}>{r.nom}</Text>
                  <Text style={styles.restoSous}>{r.nbJours} jour{r.nbJours > 1 ? 's' : ''} · marge {r.marge === null ? '—' : `${String(r.marge).replace('.', ',')} %`}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.restoCa}>{fmtCourt(r.ca)}</Text>
                  {r.varCa !== null && (
                    <Text style={[styles.restoVar, { color: r.varCa >= 0 ? colors.successDark : colors.error }]}>{pct(r.varCa)}</Text>
                  )}
                </View>
                <MaterialCommunityIcons name={estOuvert ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              </View>
              <View style={styles.restoGrille}>
                {[
                  { lbl: 'Résultat net', val: r.net === null ? '—' : fmtCourt(r.net), coul: r.net === null ? colors.text : r.net >= 0 ? colors.successDark : colors.error },
                  { lbl: 'Objectif', val: r.pctObjectif === null ? '—' : `${r.pctObjectif} %`, coul: r.pctObjectif === null ? colors.text : r.pctObjectif >= 100 ? colors.successDark : colors.warningDark },
                  { lbl: 'Litiges', val: r.litiges === null ? '—' : fmtCourt(r.litiges), coul: r.litiges ? colors.error : colors.text },
                  { lbl: 'Caissiers', val: note(r.noteCaissiers), coul: r.noteCaissiers === null ? colors.text : r.noteCaissiers >= 14 ? colors.successDark : r.noteCaissiers >= 10 ? colors.warningDark : colors.error },
                ].map(x => (
                  <View key={x.lbl} style={styles.restoCase}>
                    <Text style={styles.restoCaseLbl}>{x.lbl}</Text>
                    <Text style={[styles.restoCaseVal, { color: x.coul }]} numberOfLines={1}>{x.val}</Text>
                  </View>
                ))}
              </View>
              {estOuvert && (
                <View style={styles.restoDetail}>
                  {[
                    ['Vente machine', fmt(r.ca)],
                    ['Vente théorique (comparatif)', `${fmt(r.caTheo)} · écart ${r.caTheo - r.ca > 0 ? '+' : ''}${fmt(r.caTheo - r.ca)}`],
                    ['Mois précédent', r.caPrec ? fmt(r.caPrec) : '—'],
                    ['Dépenses (points)', fmt(r.depenses)],
                    ['Bénéfice SC', fmt(r.benefice)],
                    ['Résultat net (après charges)', r.net === null ? '—' : fmt(r.net)],
                    ['Résultat net du mois précédent', r.netPrec === null ? '—' : fmt(r.netPrec)],
                    ['Objectif mensuel', r.objectif ? `${fmt(r.objectif)}${a.enCours ? ` · au rythme actuel ${fmt(r.projection)}` : ''}` : 'non fixé'],
                    ['Commandes au POS', r.commandes === null ? '—' : r.commandes.toLocaleString('fr-FR')],
                    ['Ticket moyen', r.ticket === null ? '—' : fmt(r.ticket)],
                    ['Heure de pointe', r.pic === null ? '—' : `${r.pic} h – ${(r.pic + 1) % 24} h`],
                    ['Litiges', r.litiges === null ? '—' : fmt(r.litiges)],
                    ['Note moyenne des caissiers', r.noteCaissiers === null ? '—' : `${note(r.noteCaissiers)} (${r.nbCaissiers} noté${r.nbCaissiers > 1 ? 's' : ''})`],
                  ].map(([k, v]) => (
                    <View key={k} style={styles.ligne}>
                      <Text style={styles.ligneLbl}>{k}</Text>
                      <Text style={styles.ligneVal}>{v}</Text>
                    </View>
                  ))}
                </View>
              )}
            </TouchableOpacity>
          )
        })}

        {a.lignes.some(r => r.net !== null) && (
          <CarteGraphique icone="cash-plus" couleur="#10B981" titre="Résultat net par restaurant" sous="Après loyer, salaires, charges et dépenses direction">
            {() => (
              <BarresHorizontales rangs format={fmtCourt} donnees={[...a.lignes].filter(r => r.net !== null).sort((x, y) => y.net - x.net).map(r => ({
                cle: r.id, nom: r.nom, valeur: r.net, couleur: r.net >= 0 ? '#10B981' : '#EF4444', droite: fmt(r.net),
                couleurValeur: r.net >= 0 ? colors.successDark : colors.error,
                sous: r.netPrec !== null ? `mois précédent : ${fmt(r.netPrec)}` : null,
              }))} />
            )}
          </CarteGraphique>
        )}

        {/* Activité POS du mois */}
        {a.pos && Number(a.pos.totaux?.nb) > 0 && (<>
          <CarteGraphique icone="fire" couleur="#E11D48" titre="Heures de pointe du mois" sous={`${Number(a.pos.totaux.nb).toLocaleString('fr-FR')} commandes au POS`}>
            {l => {
              const h = heuresDuService(a.pos.par_heure)
              const max = Math.max(1, ...h.map(x => x.nb))
              return (
                <Barres largeur={l} hauteur={180} format={v => `${Math.round(v)}`} attenuer={false}
                  etiquettes={h.map(x => `${x.h}h`)}
                  detail={i => ({ titre: `${h[i].h} h – ${(h[i].h + 1) % 24} h`, lignes: [
                    { label: 'Commandes', valeur: h[i].nb.toLocaleString('fr-FR') }, { label: 'Encaissé', valeur: fmt(h[i].ca) },
                  ] })}
                  series={[{ nom: 'Commandes', valeurs: h.map(x => x.nb), couleur: '#E11D48', couleurs: h.map(x => melangerCouleurs('#FDE68A', '#DC2626', x.nb / max)) }]} />
              )
            }}
          </CarteGraphique>
          <CarteGraphique icone="moped" couleur="#F59E0B" titre="Canaux de vente" sous="Part de l’encaissé du mois">
            {() => {
              const canaux = mixCanaux(a.pos.par_type)
              const avant = a.posPrec ? mixCanaux(a.posPrec.par_type) : []
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Anneau taille={124} epaisseur={17} centreValeur={fmtCourt(a.pos.totaux.ca)} centreLibelle="encaissé"
                    segments={canaux.map(c => ({ nom: c.nom, valeur: c.ca, couleur: c.couleur }))} />
                  <View style={{ flex: 1, gap: 7 }}>
                    {canaux.map(c => {
                      const p = avant.find(x => x.cle === c.cle)
                      const ecart = p ? c.part - p.part : null
                      return (
                        <View key={c.cle} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.couleur }} />
                          <Text style={styles.legNom} numberOfLines={1}>{c.nom}</Text>
                          <Text style={styles.legVal}>{c.part} %</Text>
                          {ecart ? <Text style={[styles.legVar, { color: ecart > 0 ? colors.successDark : colors.error }]}>{ecart > 0 ? '+' : ''}{ecart} pt</Text> : null}
                        </View>
                      )
                    })}
                  </View>
                </View>
              )
            }}
          </CarteGraphique>
          {(a.pos.top || []).length > 0 && (
            <CarteGraphique icone="silverware-fork-knife" couleur="#EF9F27" titre="Plats les plus vendus" sous="Évolution par rapport au mois précédent">
              {() => (
                <BarresHorizontales rangs donnees={a.pos.top.slice(0, 8).map((p, i, arr) => {
                  const avant = (a.posPrec?.top || []).find(x => x.nom === p.nom)
                  const v = avant && Number(avant.qte) ? Math.round(((Number(p.qte) - Number(avant.qte)) / Number(avant.qte)) * 100) : null
                  return {
                    cle: p.nom, nom: p.nom, valeur: Number(p.qte) || 0,
                    couleur: melangerCouleurs('#FCD34D', '#EA580C', arr.length > 1 ? 1 - i / (arr.length - 1) : 1),
                    droite: `${Number(p.qte).toLocaleString('fr-FR')}`,
                    sous: `${fmt(p.ca)}${v !== null ? ` · ${pct(v)}` : ''}`,
                  }
                })} />
              )}
            </CarteGraphique>
          )}
        </>)}

        {/* Litiges et équipe */}
        {a.litiges.total > 0 && (
          <CarteGraphique icone="scale-balance" couleur="#DC2626" titre="Litiges du mois" sous={`${fmt(a.litiges.total)} · ${a.litiges.nbConcernes} restaurant${a.litiges.nbConcernes > 1 ? 's' : ''}`}>
            {() => {
              const pos = a.litiges.categories.filter(c => c.montant > 0)
              const total = pos.reduce((s, c) => s + c.montant, 0) || 1
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Anneau taille={124} epaisseur={17} centreValeur={fmtCourt(a.litiges.total)} centreLibelle="litiges"
                    segments={pos.map(c => ({ nom: c.nom, valeur: c.montant, couleur: c.couleur }))} />
                  <View style={{ flex: 1, gap: 7 }}>
                    {pos.map(c => (
                      <View key={c.cle} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.couleur }} />
                        <Text style={styles.legNom} numberOfLines={1}>{c.nom}</Text>
                        <Text style={styles.legVal}>{Math.round((c.montant / total) * 100)} %</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )
            }}
          </CarteGraphique>
        )}

        {a.notes.some(x => x.note !== null) && (
          <CarteGraphique icone="account-star" couleur="#6C63E0" titre="Équipe de caisse du mois" sous="Note sur 20 de chaque caissier noté">
            {() => (
              <BarresHorizontales rangs format={v => `${String(v).replace('.', ',')}`} donnees={a.notes.filter(x => x.note !== null).map(x => ({
                cle: x.cle, nom: x.nom, valeur: x.note,
                couleur: x.note >= 14 ? '#10B981' : x.note >= 10 ? '#F59E0B' : '#EF4444',
                droite: note(x.note), sous: `${x.nbShifts} shifts`,
              }))} />
            )}
          </CarteGraphique>
        )}

        {!a.enCours && onExporter && (
          <TouchableOpacity style={styles.boutonExport} onPress={onExporter}>
            <MaterialCommunityIcons name="file-export-outline" size={18} color="#FFFFFF" />
            <Text style={styles.boutonExportTxt}>Exporter ce mois (PowerPoint, Excel, PDF)</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.note}>
          Résultat net : Trésorerie (charges au mois de leur date limite). Ticket, heures, canaux et plats : caisse POS.
          Litiges et notes : mêmes calculs que leurs écrans.{a.enCours ? ' Mois en cours : chiffres provisoires.' : ''}
        </Text>
      </>)}
    </ScrollView>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
  puce: { paddingHorizontal: 14, paddingVertical: 8, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight },
  puceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  puceTxt: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  puceTxtActive: { color: '#FFFFFF', fontWeight: '800' },
  chargement: { alignItems: 'center', paddingVertical: 50, gap: 10 },
  chargementTxt: { fontSize: 14, fontWeight: '800', color: colors.text },
  chargementSous: { fontSize: 12.5, color: colors.textMuted, textAlign: 'center' },
  erreur: { flexDirection: 'row', gap: 8, backgroundColor: colors.errorLight, borderRadius: 14, padding: 12, marginBottom: 12 },
  erreurTxt: { flex: 1, fontSize: 13, color: colors.errorDark },

  hero: {
    backgroundColor: colors.headerBg, borderRadius: 24, padding: 18, marginBottom: 14, overflow: 'hidden',
    shadowColor: colors.headerBg, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 18, elevation: 6,
  },
  heroRond: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  heroIcone: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  heroLbl: { flex: 1, fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 1 },
  heroValeur: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1 },
  heroVar: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 7 },
  heroVarTxt: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  heroSous: { fontSize: 12.5, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  heroCases: { flexDirection: 'row', gap: 8, marginTop: 14 },
  heroCase: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 9 },
  heroCaseLbl: { flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: '700' },
  heroCaseVal: { fontSize: 15, color: '#FFFFFF', fontWeight: '800', marginTop: 3 },

  carte: { backgroundColor: colors.surface, borderRadius: 20, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: colors.borderLight, gap: 10 },
  titreCarte: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titreCarteTxt: { fontSize: 16, fontWeight: '800', color: colors.text },
  fait: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  faitIcone: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  faitTxt: { flex: 1, fontSize: 13.5, color: colors.text, fontWeight: '600', lineHeight: 19 },

  titreSection: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 10 },
  titreSectionTxt: { fontSize: 16, fontWeight: '800', color: colors.text },
  resto: { backgroundColor: colors.surface, borderRadius: 18, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.borderLight, borderLeftWidth: 5 },
  rang: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  rangTxt: { fontSize: 12, fontWeight: '800', color: colors.textSecondary },
  restoNom: { fontSize: 15.5, fontWeight: '800', color: colors.text },
  restoSous: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  restoCa: { fontSize: 16, fontWeight: '800', color: colors.text },
  restoVar: { fontSize: 12, fontWeight: '800' },
  restoGrille: { flexDirection: 'row', marginTop: 12, backgroundColor: colors.surfaceAlt, borderRadius: 12, paddingVertical: 9 },
  restoCase: { flex: 1, alignItems: 'center' },
  restoCaseLbl: { fontSize: 10.5, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  restoCaseVal: { fontSize: 13.5, fontWeight: '800', marginTop: 2 },
  restoDetail: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: 6 },
  ligne: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 5 },
  ligneLbl: { flex: 1, fontSize: 13, color: colors.textSecondary },
  ligneVal: { fontSize: 13, fontWeight: '800', color: colors.text, textAlign: 'right' },

  legNom: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.text },
  legVal: { fontSize: 12.5, fontWeight: '800', color: colors.text },
  legVar: { fontSize: 11, fontWeight: '800', width: 44, textAlign: 'right' },

  boutonExport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 15, marginBottom: 12, minHeight: 52 },
  boutonExportTxt: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  note: { fontSize: 11.5, color: colors.textMuted, textAlign: 'center', lineHeight: 17, marginBottom: 8 },
}) }

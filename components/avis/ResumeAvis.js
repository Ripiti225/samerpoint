// ──────────────────────────────────────────────────────────────────────────────
//  Onglet Résumé de l'écran Avis clients : 4 chiffres clés avec leur évolution
//  par rapport à la période précédente, puis restaurants, caissiers et motifs.
//  Les calculs viennent de lib/avisResume.js ; ce composant ne fait qu'afficher.
// ──────────────────────────────────────────────────────────────────────────────
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { evolution } from '../../lib/avisResume'
import { PLATEFORMES } from '../../lib/avisPlateformes'

const VERT = '#2E7D32'
const ROUGE = '#C62828'
const fcfa = n => `${Math.round(n || 0).toLocaleString('fr-FR')} F`
const virgule = v => String(v).replace('.', ',')

function Fleche({ evo, unite = '', styles }) {
  if (!evo) return <Text style={styles.evoNeutre}>—</Text>
  if (evo.sens === 'egal') return <Text style={styles.evoNeutre}>= stable</Text>
  const couleur = evo.mieux ? VERT : ROUGE
  const signe = evo.delta > 0 ? '+' : ''
  return (
    <Text style={[styles.evo, { color: couleur }]}>
      {evo.sens === 'hausse' ? '↑' : '↓'} {signe}{virgule(evo.delta)}{unite}
    </Text>
  )
}

function Tuile({ libelle, valeur, sous, evo, unite, styles }) {
  return (
    <View style={styles.tuile}>
      <Text style={styles.tuileLibelle}>{libelle}</Text>
      <Text style={styles.tuileValeur}>{valeur}</Text>
      {sous ? <Text style={styles.tuileSous}>{sous}</Text> : null}
      <Fleche evo={evo} unite={unite} styles={styles} />
    </View>
  )
}

function Barre({ pct, styles }) {
  return (
    <View style={styles.barreFond}>
      <View style={[styles.barre, { width: `${Math.min(100, pct)}%`, backgroundColor: pct > 20 ? ROUGE : VERT }]} />
    </View>
  )
}

export default function ResumeAvis({ chiffres, chiffresPrec, parPlateforme, parResto, caissiers, motifs, colors }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  const p = chiffresPrec?.nb ? chiffresPrec : null
  const noteFmt = chiffres.noteMoyenne != null ? virgule(chiffres.noteMoyenne) : '—'

  return (
    <View>
      <View style={styles.grille}>
        <Tuile styles={styles} libelle="Note moyenne" valeur={`${noteFmt} / 5`} sous={`${chiffres.nbNotes} avis notés`}
          evo={p ? evolution(chiffres.noteMoyenne, p.noteMoyenne, true) : null} />
        <Tuile styles={styles} libelle="Avis reçus" valeur={String(chiffres.nb)} sous={`${chiffres.nbBons} bons`}
          evo={p ? evolution(chiffres.nb, p.nb, true) : null} />
        <Tuile styles={styles} libelle="Négatifs" valeur={`${virgule(chiffres.pctNegatifs)} %`} sous={`${chiffres.nbNegatifs} avis`}
          evo={p ? evolution(chiffres.pctNegatifs, p.pctNegatifs, false) : null} unite=" pt" />
        <Tuile styles={styles} libelle="Litiges" valeur={String(chiffres.nbLitiges)} sous={fcfa(chiffres.montantLitiges)}
          evo={p ? evolution(chiffres.nbLitiges, p.nbLitiges, false) : null} />
      </View>
      {!p ? <Text style={styles.aide}>Pas d'avis sur la période précédente : pas de comparaison.</Text> : null}

      <View style={styles.bloc}>
        <Text style={styles.blocTitre}>Par plateforme</Text>
        {PLATEFORMES.map(pl => {
          const k = parPlateforme[pl.key]
          return (
            <View key={pl.key} style={styles.ligne}>
              <Text style={[styles.ligneNom, { color: pl.couleur }]}>{pl.label}</Text>
              <Text style={styles.ligneVal}>
                {k.nb} avis{k.noteMoyenne != null ? ` · ${virgule(k.noteMoyenne)}/5` : ''}{k.nb ? ` · ${virgule(k.pctNegatifs)} % nég.` : ''}
              </Text>
            </View>
          )
        })}
      </View>

      {parResto.length > 1 ? (
        <View style={styles.bloc}>
          <Text style={styles.blocTitre}>Restaurants · du pire au meilleur</Text>
          {parResto.map(r => (
            <View key={r.restaurant_id || 'orphelins'} style={styles.ligneBarre}>
              <View style={styles.ligne}>
                <Text style={styles.ligneNom} numberOfLines={1}>{r.nom}</Text>
                <Text style={styles.ligneVal}>{r.nb} avis · {virgule(r.pctNegatifs)} % nég.</Text>
              </View>
              <Barre pct={r.pctNegatifs} styles={styles} />
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.bloc}>
        <Text style={styles.blocTitre}>Caissiers</Text>
        {caissiers.length === 0 ? <Text style={styles.aide}>Aucun avis sur la période.</Text> : caissiers.map(c => (
          <View key={c.cle} style={styles.ligne}>
            <Text style={[styles.ligneNom, c.cle === 'aucun' && { color: colors.textMuted }]} numberOfLines={1}>{c.nom}</Text>
            <Text style={styles.ligneVal}>
              👍 {c.bons}  👎 {c.mauvais}  ·  <Text style={{ color: c.pctNegatifs > 20 ? ROUGE : colors.textSecondary, fontWeight: '700' }}>{virgule(c.pctNegatifs)} %</Text>
            </Text>
          </View>
        ))}
        <Text style={styles.aide}>Caissier présent à l'heure de la commande, ou responsable du litige.</Text>
      </View>

      <View style={styles.bloc}>
        <Text style={styles.blocTitre}>Motifs les plus fréquents</Text>
        {motifs.length === 0 ? <Text style={styles.aide}>Aucune plainte sur la période. 🎉</Text> : motifs.map(m => (
          <View key={m.motif} style={styles.ligne}>
            <Text style={styles.ligneNom} numberOfLines={1}>{m.motif}</Text>
            <Text style={styles.ligneVal}>{m.nb}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  tuile: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.borderLight, padding: 14 },
  tuileLibelle: { fontSize: 12, color: colors.textMuted, fontWeight: '700' },
  tuileValeur: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 4, letterSpacing: -0.4 },
  tuileSous: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  evo: { fontSize: 13, fontWeight: '800', marginTop: 6 },
  evoNeutre: { fontSize: 13, color: colors.textMuted, marginTop: 6 },
  aide: { fontSize: 12, color: colors.textMuted, marginTop: 6, marginBottom: 6, lineHeight: 17 },
  bloc: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.borderLight, padding: 14, marginTop: 12 },
  blocTitre: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 8 },
  ligne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 6 },
  ligneBarre: { paddingBottom: 6 },
  ligneNom: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
  ligneVal: { fontSize: 13, color: colors.textSecondary },
  barreFond: { height: 6, borderRadius: 3, backgroundColor: colors.borderLight, overflow: 'hidden' },
  barre: { height: 6, borderRadius: 3 },
}) }

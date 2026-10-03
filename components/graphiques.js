// ──────────────────────────────────────────────────────────────────────────────
// Graphiques du Dashboard : courbes lisses avec dégradé, barres arrondies,
// barres horizontales, anneau et carte de chaleur (jours × heures).
// Dessinés en SVG (react-native-svg) : mêmes rendus sur iPhone, Android et web.
// Géométrie : lib/graphiques.js
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { useState } from 'react'
import { Text, View } from 'react-native'
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg'

import { useTheme } from '../context/ThemeContext'
import {
  arcsAnneau, bornesJolies, cheminAire, cheminLisse, etiquettesEspacees, fmtCourt, melangerCouleurs,
} from '../lib/graphiques'

let idUnique = 0
const nouvelId = prefixe => `${prefixe}${++idUnique}`

// Carte qui accueille un graphique et lui donne sa largeur réelle.
// children : (largeur) => graphique
export function CarteGraphique({ icone, couleur, titre, sous, droite, legende, children, style }) {
  const { colors } = useTheme()
  const [largeur, setLargeur] = useState(0)
  const c = couleur || colors.primary
  return (
    <View style={[{
      backgroundColor: colors.surface, borderRadius: 20, padding: 16, marginBottom: 14,
      borderWidth: 1, borderColor: colors.borderLight,
      shadowColor: colors.cardShadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2,
    }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {icone ? (
          <View style={{ width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: `${c}1F` }}>
            <MaterialCommunityIcons name={icone} size={18} color={c} />
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text, letterSpacing: -0.2 }} numberOfLines={2}>{titre}</Text>
          {sous ? <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{sous}</Text> : null}
        </View>
        {droite || null}
      </View>
      <View onLayout={e => setLargeur(Math.floor(e.nativeEvent.layout.width))}>
        {largeur > 0 ? children(largeur) : <View style={{ height: 120 }} />}
      </View>
      {legende ? <Legende elements={legende} /> : null}
    </View>
  )
}

export function Legende({ elements }) {
  const { colors } = useTheme()
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
      {elements.map(e => (
        <View key={e.nom} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{
            width: e.pointille ? 14 : 10, height: e.pointille ? 3 : 10, borderRadius: 5,
            backgroundColor: e.couleur, opacity: e.opacite ?? 1,
          }} />
          <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}>{e.nom}</Text>
          {e.valeur != null ? <Text style={{ fontSize: 12, color: colors.text, fontWeight: '800' }}>{e.valeur}</Text> : null}
        </View>
      ))}
    </View>
  )
}

const MARGES = { haut: 22, bas: 24, gauche: 44, droite: 10 }

// Grille horizontale + valeurs de l'axe vertical.
function Grille({ largeur, hauteur, b, y, format, colors }) {
  return b.ticks.map(t => (
    <G key={t}>
      <Line x1={MARGES.gauche} x2={largeur - MARGES.droite} y1={y(t)} y2={y(t)}
        stroke={t === 0 ? colors.border : colors.borderLight} strokeWidth={1} strokeDasharray={t === 0 ? undefined : '3,5'} />
      <SvgText x={MARGES.gauche - 6} y={y(t) + 3.5} fontSize={10} fill={colors.textMuted} textAnchor="end">{format(t)}</SvgText>
    </G>
  ))
}

function EtiquettesX({ etiquettes, x, hauteur, largeur, colors }) {
  const garder = etiquettesEspacees(etiquettes.length, Math.max(3, Math.floor((largeur - MARGES.gauche) / 52)))
  return garder.map(i => (
    <SvgText key={i} x={x(i)} y={hauteur - 6} fontSize={10} fill={colors.textMuted} textAnchor="middle">{etiquettes[i]}</SvgText>
  ))
}

// Bulle au-dessus d'un point (« 3,4 M »).
function Bulle({ cx, cy, texte, couleur, largeurMax }) {
  const l = Math.max(34, texte.length * 6.4 + 12)
  const x = Math.min(Math.max(cx - l / 2, 2), largeurMax - l - 2)
  return (
    <G>
      <Rect x={x} y={cy - 26} width={l} height={18} rx={9} fill={couleur} />
      <SvgText x={x + l / 2} y={cy - 13.5} fontSize={10.5} fontWeight="bold" fill="#FFFFFF" textAnchor="middle">{texte}</SvgText>
    </G>
  )
}

/**
 * Courbes lisses. series = [{ nom, valeurs, couleur, aire?, pointille?, opacite? }].
 * La première série avec `aire` reçoit un dégradé dessous. seuil = { valeur, libelle }.
 */
export function CourbeAire({ largeur, hauteur = 200, series, etiquettes, format = fmtCourt, seuil, marquerMax = true }) {
  const { colors } = useTheme()
  const [id] = useState(() => nouvelId('aire'))
  const n = Math.max(...series.map(s => s.valeurs.length), 0)
  if (!n) return null
  const toutes = series.flatMap(s => s.valeurs).concat(seuil ? [seuil.valeur] : [])
  const b = bornesJolies(Math.min(...toutes), Math.max(...toutes))
  const larg = largeur - MARGES.gauche - MARGES.droite
  const x = i => MARGES.gauche + (n === 1 ? larg / 2 : (i / (n - 1)) * larg)
  const y = v => MARGES.haut + (1 - (v - b.min) / (b.max - b.min)) * (hauteur - MARGES.haut - MARGES.bas)
  const yBase = y(Math.max(b.min, 0))

  return (
    <Svg width={largeur} height={hauteur}>
      <Defs>
        {series.map((s, k) => (
          <LinearGradient key={k} id={`${id}-${k}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={s.couleur} stopOpacity={0.35} />
            <Stop offset="1" stopColor={s.couleur} stopOpacity={0.02} />
          </LinearGradient>
        ))}
      </Defs>
      <Grille largeur={largeur} hauteur={hauteur} b={b} y={y} format={format} colors={colors} />
      {seuil ? (
        <G>
          <Line x1={MARGES.gauche} x2={largeur - MARGES.droite} y1={y(seuil.valeur)} y2={y(seuil.valeur)}
            stroke={seuil.couleur || colors.warning} strokeWidth={1.5} strokeDasharray="6,4" />
          <SvgText x={largeur - MARGES.droite} y={y(seuil.valeur) - 5} fontSize={10} fontWeight="bold"
            fill={seuil.couleur || colors.warning} textAnchor="end">{seuil.libelle}</SvgText>
        </G>
      ) : null}
      {series.map((s, k) => {
        const pts = s.valeurs.map((v, i) => ({ x: x(i), y: y(v) }))
        return (
          <G key={k} opacity={s.opacite ?? 1}>
            {s.aire && pts.length > 1 ? <Path d={cheminAire(pts, yBase)} fill={`url(#${id}-${k})`} /> : null}
            <Path d={cheminLisse(pts)} stroke={s.couleur} strokeWidth={s.pointille ? 2 : 2.8} fill="none"
              strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.pointille ? '5,5' : undefined} />
            {pts.length <= 14 && !s.pointille ? pts.map((p, i) => (
              <Circle key={i} cx={p.x} cy={p.y} r={3} fill={colors.surface} stroke={s.couleur} strokeWidth={2} />
            )) : null}
          </G>
        )
      })}
      {marquerMax && series[0] ? (() => {
        const v = series[0].valeurs
        const iMax = v.indexOf(Math.max(...v))
        if (iMax < 0) return null
        return (
          <G>
            <Circle cx={x(iMax)} cy={y(v[iMax])} r={7} fill={series[0].couleur} opacity={0.25} />
            <Circle cx={x(iMax)} cy={y(v[iMax])} r={4} fill={series[0].couleur} />
            <Bulle cx={x(iMax)} cy={y(v[iMax])} texte={format(v[iMax])} couleur={series[0].couleur} largeurMax={largeur} />
          </G>
        )
      })() : null}
      <EtiquettesX etiquettes={etiquettes} x={x} hauteur={hauteur} largeur={largeur} colors={colors} />
    </Svg>
  )
}

/**
 * Barres verticales arrondies, une ou plusieurs séries côte à côte.
 * series = [{ nom, valeurs, couleur, couleurs? (une par barre) }] ; surligne = index mis en avant.
 */
export function Barres({ largeur, hauteur = 190, series, etiquettes, format = fmtCourt, surligne = null, valeurSurligne, attenuer = true }) {
  const { colors } = useTheme()
  const n = Math.max(...series.map(s => s.valeurs.length), 0)
  if (!n) return null
  const b = bornesJolies(Math.min(...series.flatMap(s => s.valeurs)), Math.max(...series.flatMap(s => s.valeurs)))
  const larg = largeur - MARGES.gauche - MARGES.droite
  const pas = larg / n
  const groupe = Math.min(pas * 0.72, 34 * series.length)
  const lb = Math.max(2, groupe / series.length - (series.length > 1 ? 2 : 0))
  const x = i => MARGES.gauche + pas * i + pas / 2
  const y = v => MARGES.haut + (1 - (v - b.min) / (b.max - b.min)) * (hauteur - MARGES.haut - MARGES.bas)
  const y0 = y(0)
  return (
    <Svg width={largeur} height={hauteur}>
      <Grille largeur={largeur} hauteur={hauteur} b={b} y={y} format={format} colors={colors} />
      {series.map((s, k) => s.valeurs.map((v, i) => {
        const haut = Math.abs(y(v) - y0)
        const bx = x(i) - groupe / 2 + k * (groupe / series.length) + (groupe / series.length - lb) / 2
        const couleur = s.couleurs?.[i] || s.couleur
        const attenue = attenuer && surligne !== null && surligne !== i
        return (
          <Rect key={`${k}-${i}`} x={bx} y={v >= 0 ? y0 - haut : y0} width={lb} height={Math.max(haut, v ? 2 : 0)}
            rx={Math.min(6, lb / 2)} fill={couleur} opacity={attenue ? 0.55 : 1} />
        )
      }))}
      {surligne !== null && series[0]?.valeurs[surligne] != null ? (
        <Bulle cx={x(surligne)} cy={y(Math.max(0, series[0].valeurs[surligne]))}
          texte={valeurSurligne || format(series[0].valeurs[surligne])}
          couleur={series[0].couleurs?.[surligne] || series[0].couleur} largeurMax={largeur} />
      ) : null}
      <EtiquettesX etiquettes={etiquettes} x={x} hauteur={hauteur} largeur={largeur} colors={colors} />
    </Svg>
  )
}

/** Barres horizontales classées. donnees = [{ cle, nom, valeur, couleur, sous?, droite? }] */
export function BarresHorizontales({ donnees, format = fmtCourt, rangs = false }) {
  const { colors } = useTheme()
  const max = Math.max(1, ...donnees.map(d => Math.abs(d.valeur)))
  return (
    <View style={{ gap: 12 }}>
      {donnees.map((d, i) => (
        <View key={d.cle || d.nom}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            {rangs ? (
              <View style={{
                width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center',
                backgroundColor: i === 0 ? '#F59E0B' : i === 1 ? '#94A3B8' : i === 2 ? '#B45309' : colors.surfaceAlt,
              }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: i < 3 ? '#FFFFFF' : colors.textSecondary }}>{i + 1}</Text>
              </View>
            ) : null}
            <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={1}>{d.nom}</Text>
            <Text style={{ fontSize: 13, fontWeight: '800', color: d.couleurValeur || colors.text, fontVariant: ['tabular-nums'] }}>
              {d.droite ?? format(d.valeur)}
            </Text>
          </View>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${Math.max(2, (Math.abs(d.valeur) / max) * 100)}%`, borderRadius: 5, backgroundColor: d.couleur }} />
          </View>
          {d.sous ? <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 3 }}>{d.sous}</Text> : null}
        </View>
      ))}
    </View>
  )
}

/** Anneau avec un chiffre au centre. segments = [{ nom, valeur, couleur }] */
export function Anneau({ segments, taille = 150, epaisseur = 20, centreValeur, centreLibelle }) {
  const { colors } = useTheme()
  const r = (taille - epaisseur) / 2
  const tour = 2 * Math.PI * r
  const arcs = arcsAnneau(segments.map(s => s.valeur))
  const ecart = segments.filter(s => s.valeur > 0).length > 1 ? 2 : 0
  return (
    <View style={{ width: taille, height: taille, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={taille} height={taille} style={{ position: 'absolute' }}>
        <Circle cx={taille / 2} cy={taille / 2} r={r} stroke={colors.surfaceAlt} strokeWidth={epaisseur} fill="none" />
        {segments.map((s, i) => {
          const longueur = Math.max(0, arcs[i].part * tour - ecart)
          if (!longueur) return null
          // Un cercle SVG commence à 3 h et tourne dans le sens des aiguilles :
          // midi est aux trois quarts du tour. Pas de rotation (mal rendue sur le web).
          const depart = ((0.75 + arcs[i].debut) % 1) * tour
          return (
            <Circle key={s.nom} cx={taille / 2} cy={taille / 2} r={r} stroke={s.couleur} strokeWidth={epaisseur} fill="none"
              strokeDasharray={`${longueur} ${tour - longueur}`} strokeDashoffset={-depart}
              strokeLinecap="butt" />
          )
        })}
      </Svg>
      {centreValeur ? <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{centreValeur}</Text> : null}
      {centreLibelle ? <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '600' }}>{centreLibelle}</Text> : null}
    </View>
  )
}

/** Carte de chaleur jours × heures. grille[ligne][colonne] ; colonnes = libellés des heures. */
export function CarteChaleur({ largeur, grille, max, lignes, colonnes, couleur }) {
  const { colors } = useTheme()
  const marge = 34
  const nbCol = colonnes.length
  const cote = Math.max(6, Math.floor((largeur - marge) / nbCol) - 2)
  const fond = colors.surfaceAlt.length === 7 ? colors.surfaceAlt : '#F1F5F9'
  return (
    <View>
      {grille.map((ligne, j) => (
        <View key={j} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
          <Text style={{ width: marge, fontSize: 10.5, fontWeight: '700', color: colors.textSecondary }}>{lignes[j]}</Text>
          {ligne.map((v, i) => (
            <View key={i} style={{
              width: cote, height: cote, borderRadius: 3, marginRight: 2,
              backgroundColor: v ? melangerCouleurs(fond, couleur, 0.15 + 0.85 * (v / (max || 1))) : fond,
            }} />
          ))}
        </View>
      ))}
      <View style={{ flexDirection: 'row', marginLeft: marge, marginTop: 4 }}>
        {colonnes.map((c, i) => (
          <Text key={i} style={{ width: cote + 2, fontSize: 9, color: colors.textMuted, textAlign: 'left' }}>
            {i % 3 === 0 ? c : ''}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>Calme</Text>
        {[0.15, 0.4, 0.65, 0.9, 1].map(t => (
          <View key={t} style={{ width: 16, height: 10, borderRadius: 3, backgroundColor: melangerCouleurs(fond, couleur, t) }} />
        ))}
        <Text style={{ fontSize: 11, color: colors.textMuted }}>Très chargé</Text>
      </View>
    </View>
  )
}

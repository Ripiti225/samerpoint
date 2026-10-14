// ──────────────────────────────────────────────────────────────────────────────
// Graphiques du Dashboard : courbes lisses avec dégradé, barres arrondies,
// barres horizontales, anneau et carte de chaleur (jours × heures).
// Dessinés en SVG (react-native-svg) : mêmes rendus sur iPhone, Android et web.
//
// Tous réagissent : au survol de la souris (ordinateur) ou au doigt (téléphone),
// la donnée visée ressort et son montant s'affiche dans une bulle.
// Géométrie et « qu'y a-t-il sous le doigt » : lib/graphiques.js
// ──────────────────────────────────────────────────────────────────────────────
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg'

import { useTheme } from '../context/ThemeContext'
import {
  arcsAnneau, bornesJolies, cheminAire, cheminLisse, etiquettesEspacees, fmtCourt, indexBarre, indexCourbe,
  melangerCouleurs, segmentAnneau,
} from '../lib/graphiques'

let idUnique = 0
const nouvelId = prefixe => `${prefixe}${++idUnique}`

const fmtEntier = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')}`

// ── Zone sensible au survol et au toucher ────────────────────────────────────
// onPosition(x, y) à chaque mouvement ; onQuitter() quand la souris sort.
// Web : événements « pointer » (souris ET doigt sur iPhone). Natif : système
// de répondeur, qui rend la main au défilement vertical de l'écran.
function ZoneSurvol({ onPosition, onQuitter, style, children }) {
  const props = Platform.OS === 'web'
    ? {
      onPointerMove: e => {
        const r = e.currentTarget.getBoundingClientRect()
        onPosition(e.nativeEvent.clientX - r.left, e.nativeEvent.clientY - r.top)
      },
      onPointerDown: e => {
        const r = e.currentTarget.getBoundingClientRect()
        onPosition(e.nativeEvent.clientX - r.left, e.nativeEvent.clientY - r.top)
      },
      // Au doigt, le navigateur envoie « leave » juste après le toucher :
      // on garde alors la bulle affichée jusqu'au toucher suivant.
      onPointerLeave: e => { if (e.nativeEvent.pointerType === 'mouse') onQuitter?.() },
    }
    : {
      onStartShouldSetResponder: () => true,
      onResponderGrant: e => onPosition(e.nativeEvent.locationX, e.nativeEvent.locationY),
      onResponderMove: e => onPosition(e.nativeEvent.locationX, e.nativeEvent.locationY),
      onResponderTerminationRequest: () => true,
    }
  return <View {...props} style={[Platform.OS === 'web' && { cursor: 'crosshair' }, style]}>{children}</View>
}

// Bulle d'information dans le SVG : un titre, puis des lignes (pastille, libellé, valeur).
function Infobulle({ x, y, largeurMax, titre, lignes, colors }) {
  const hLigne = 16
  const largeurTexte = Math.max(
    titre.length * 6.6,
    ...lignes.map(l => (l.label ? l.label.length + 2 : 0) * 6 + String(l.valeur).length * 6.8 + (l.couleur ? 14 : 0)),
  )
  const l = Math.min(largeurMax - 4, Math.max(96, largeurTexte + 20))
  const h = 24 + lignes.length * hLigne
  const bx = Math.min(Math.max(x - l / 2, 2), largeurMax - l - 2)
  const by = Math.max(2, y - h - 12)
  return (
    <G>
      <Rect x={bx + 1} y={by + 2} width={l} height={h} rx={10} fill="#000000" opacity={0.12} />
      <Rect x={bx} y={by} width={l} height={h} rx={10} fill={colors.text} />
      <SvgText x={bx + 10} y={by + 16} fontSize={11} fontWeight="bold" fill={colors.surface}>{titre}</SvgText>
      {lignes.map((li, k) => {
        const ly = by + 16 + (k + 1) * hLigne
        return (
          <G key={k}>
            {li.couleur ? <Circle cx={bx + 14} cy={ly - 4} r={4} fill={li.couleur} /> : null}
            <SvgText x={bx + (li.couleur ? 23 : 10)} y={ly} fontSize={11} fill={colors.surface} opacity={0.8}>{li.label || ''}</SvgText>
            <SvgText x={bx + l - 10} y={ly} fontSize={11.5} fontWeight="bold" fill={colors.surface} textAnchor="end">{String(li.valeur)}</SvgText>
          </G>
        )
      })}
    </G>
  )
}

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
function Grille({ largeur, b, y, format, colors }) {
  return b.ticks.map(t => (
    <G key={t}>
      <Line x1={MARGES.gauche} x2={largeur - MARGES.droite} y1={y(t)} y2={y(t)}
        stroke={t === 0 ? colors.border : colors.borderLight} strokeWidth={1} strokeDasharray={t === 0 ? undefined : '3,5'} />
      <SvgText x={MARGES.gauche - 6} y={y(t) + 3.5} fontSize={10} fill={colors.textMuted} textAnchor="end">{format(t)}</SvgText>
    </G>
  ))
}

function EtiquettesX({ etiquettes, x, hauteur, largeur, colors, actif }) {
  const garder = etiquettesEspacees(etiquettes.length, Math.max(3, Math.floor((largeur - MARGES.gauche) / 52)))
  return garder.filter(i => i !== actif).map(i => (
    <SvgText key={i} x={x(i)} y={hauteur - 6} fontSize={10} fill={colors.textMuted} textAnchor="middle">{etiquettes[i]}</SvgText>
  )).concat(actif != null && etiquettes[actif] != null ? [
    <SvgText key="actif" x={x(actif)} y={hauteur - 6} fontSize={10.5} fontWeight="bold" fill={colors.text} textAnchor="middle">{etiquettes[actif]}</SvgText>,
  ] : [])
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
 * formatDetail : montant affiché dans la bulle au survol (par défaut le nombre entier).
 */
export function CourbeAire({ largeur, hauteur = 200, series, etiquettes, format = fmtCourt, formatDetail = fmtEntier, seuil, marquerMax = true }) {
  const { colors } = useTheme()
  const [id] = useState(() => nouvelId('aire'))
  const [actif, setActif] = useState(null)
  const n = Math.max(...series.map(s => s.valeurs.length), 0)
  if (!n) return null
  const toutes = series.flatMap(s => s.valeurs).concat(seuil ? [seuil.valeur] : [])
  const b = bornesJolies(Math.min(...toutes), Math.max(...toutes))
  const larg = largeur - MARGES.gauche - MARGES.droite
  const x = i => MARGES.gauche + (n === 1 ? larg / 2 : (i / (n - 1)) * larg)
  const y = v => MARGES.haut + (1 - (v - b.min) / (b.max - b.min)) * (hauteur - MARGES.haut - MARGES.bas)
  const yBase = y(Math.max(b.min, 0))
  const yHaut = actif !== null ? Math.min(...series.map(s => (s.valeurs[actif] != null ? y(s.valeurs[actif]) : hauteur))) : 0

  return (
    <ZoneSurvol onPosition={px => setActif(indexCourbe(px, n, MARGES.gauche, larg))} onQuitter={() => setActif(null)}>
      <Svg width={largeur} height={hauteur} pointerEvents="none">
        <Defs>
          {series.map((s, k) => (
            <LinearGradient key={k} id={`${id}-${k}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={s.couleur} stopOpacity={0.35} />
              <Stop offset="1" stopColor={s.couleur} stopOpacity={0.02} />
            </LinearGradient>
          ))}
        </Defs>
        <Grille largeur={largeur} b={b} y={y} format={format} colors={colors} />
        {seuil ? (
          <G>
            <Line x1={MARGES.gauche} x2={largeur - MARGES.droite} y1={y(seuil.valeur)} y2={y(seuil.valeur)}
              stroke={seuil.couleur || colors.warning} strokeWidth={1.5} strokeDasharray="6,4" />
            <SvgText x={largeur - MARGES.droite} y={y(seuil.valeur) - 5} fontSize={10} fontWeight="bold"
              fill={seuil.couleur || colors.warning} textAnchor="end">{seuil.libelle}</SvgText>
          </G>
        ) : null}
        {actif !== null ? (
          <Line x1={x(actif)} x2={x(actif)} y1={MARGES.haut - 6} y2={hauteur - MARGES.bas}
            stroke={colors.textMuted} strokeWidth={1} strokeDasharray="3,3" />
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
              {actif !== null && pts[actif] ? (
                <G>
                  <Circle cx={pts[actif].x} cy={pts[actif].y} r={9} fill={s.couleur} opacity={0.2} />
                  <Circle cx={pts[actif].x} cy={pts[actif].y} r={5} fill={s.couleur} stroke={colors.surface} strokeWidth={2} />
                </G>
              ) : null}
            </G>
          )
        })}
        {marquerMax && actif === null && series[0] ? (() => {
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
        <EtiquettesX etiquettes={etiquettes} x={x} hauteur={hauteur} largeur={largeur} colors={colors} actif={actif} />
        {actif !== null ? (
          <Infobulle x={x(actif)} y={Math.max(yHaut, 70)} largeurMax={largeur} colors={colors}
            titre={String(etiquettes[actif] ?? '')}
            lignes={series.filter(s => s.valeurs[actif] != null).map(s => ({
              couleur: s.couleur, label: series.length > 1 ? s.nom : '', valeur: formatDetail(s.valeurs[actif]),
            }))} />
        ) : null}
      </Svg>
    </ZoneSurvol>
  )
}

/**
 * Barres verticales arrondies, une ou plusieurs séries côte à côte.
 * series = [{ nom, valeurs, couleur, couleurs? (une par barre) }] ; surligne = index mis en avant.
 * detail(i) → { titre, lignes: [{ couleur?, label, valeur }] } : contenu de la bulle au survol
 * (par défaut : l'étiquette et la valeur de chaque série).
 */
export function Barres({
  largeur, hauteur = 190, series, etiquettes, format = fmtCourt, formatDetail = fmtEntier,
  surligne = null, valeurSurligne, attenuer = true, detail,
}) {
  const { colors } = useTheme()
  const [actif, setActif] = useState(null)
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
  const enAvant = actif ?? surligne
  const contenu = actif !== null ? (detail ? detail(actif) : {
    titre: String(etiquettes[actif] ?? ''),
    lignes: series.map(s => ({ couleur: s.couleurs?.[actif] || s.couleur, label: series.length > 1 ? s.nom : '', valeur: formatDetail(s.valeurs[actif]) })),
  }) : null
  const yHautActif = actif !== null ? Math.min(...series.map(s => y(Math.max(0, s.valeurs[actif] || 0)))) : 0

  return (
    <ZoneSurvol onPosition={px => setActif(indexBarre(px, n, MARGES.gauche, larg))} onQuitter={() => setActif(null)}>
      <Svg width={largeur} height={hauteur} pointerEvents="none">
        <Grille largeur={largeur} b={b} y={y} format={format} colors={colors} />
        {actif !== null ? (
          <Rect x={x(actif) - pas / 2 + 1} y={MARGES.haut - 6} width={pas - 2} height={hauteur - MARGES.haut - MARGES.bas + 6}
            rx={6} fill={colors.text} opacity={0.06} />
        ) : null}
        {series.map((s, k) => s.valeurs.map((v, i) => {
          const haut = Math.abs(y(v) - y0)
          const bx = x(i) - groupe / 2 + k * (groupe / series.length) + (groupe / series.length - lb) / 2
          const couleur = s.couleurs?.[i] || s.couleur
          const attenue = enAvant !== null && enAvant !== i && (attenuer || actif !== null)
          const vise = actif === i
          return (
            <Rect key={`${k}-${i}`} x={vise ? bx - 1 : bx} y={v >= 0 ? y0 - haut : y0} width={vise ? lb + 2 : lb}
              height={Math.max(haut, v ? 2 : 0)} rx={Math.min(6, lb / 2)} fill={couleur} opacity={attenue ? 0.45 : 1} />
          )
        }))}
        {actif === null && surligne !== null && series[0]?.valeurs[surligne] != null ? (
          <Bulle cx={x(surligne)} cy={y(Math.max(0, series[0].valeurs[surligne]))}
            texte={valeurSurligne || format(series[0].valeurs[surligne])}
            couleur={series[0].couleurs?.[surligne] || series[0].couleur} largeurMax={largeur} />
        ) : null}
        <EtiquettesX etiquettes={etiquettes} x={x} hauteur={hauteur} largeur={largeur} colors={colors} actif={actif} />
        {contenu ? (
          <Infobulle x={x(actif)} y={Math.max(yHautActif, 30 + contenu.lignes.length * 16)} largeurMax={largeur} colors={colors}
            titre={contenu.titre} lignes={contenu.lignes} />
        ) : null}
      </Svg>
    </ZoneSurvol>
  )
}

/**
 * Barres horizontales classées. donnees = [{ cle, nom, valeur, couleur, sous?, droite?, segments? }]
 * segments = [{ nom, valeur, couleur, texte }] : la barre est découpée en morceaux de couleur,
 * avec une légende « nom texte » en dessous.
 * echelle : valeur d'une barre pleine (ex. 100 pour des pourcentages) ; par défaut la plus grande valeur.
 */
export function BarresHorizontales({ donnees, format = fmtCourt, rangs = false, echelle }) {
  const { colors } = useTheme()
  const [actif, setActif] = useState(null)
  const max = echelle || Math.max(1, ...donnees.map(d => Math.abs(d.valeur)))
  return (
    <View style={{ gap: 6 }}>
      {donnees.map((d, i) => {
        const cle = d.cle || d.nom
        const vise = actif === cle
        const estompe = actif !== null && !vise
        return (
          <Pressable key={cle}
            onHoverIn={() => setActif(cle)} onHoverOut={() => setActif(a => (a === cle ? null : a))}
            onPressIn={() => setActif(cle)}
            style={{
              paddingVertical: 6, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 12,
              backgroundColor: vise ? colors.surfaceAlt : 'transparent', opacity: estompe ? 0.55 : 1,
            }}>
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
              <Text style={{ fontSize: vise ? 14 : 13, fontWeight: '800', color: d.couleurValeur || colors.text, fontVariant: ['tabular-nums'] }}>
                {d.droite ?? format(d.valeur)}
              </Text>
            </View>
            <View style={{ height: vise ? 12 : 10, borderRadius: 6, backgroundColor: vise ? colors.border : colors.surfaceAlt, overflow: 'hidden' }}>
              {d.segments?.length ? (
                // Barre découpée (ex. un plat par canal) : chaque morceau garde sa couleur.
                <View style={{ height: '100%', width: `${Math.max(2, (Math.abs(d.valeur) / max) * 100)}%`, borderRadius: 6, overflow: 'hidden', flexDirection: 'row', gap: 1 }}>
                  {d.segments.map(s => <View key={s.nom} style={{ flex: s.valeur, backgroundColor: s.couleur }} />)}
                </View>
              ) : (
                <View style={{ height: '100%', width: `${Math.max(2, (Math.abs(d.valeur) / max) * 100)}%`, borderRadius: 6, backgroundColor: d.couleur }} />
              )}
            </View>
            {d.sous ? <Text style={{ fontSize: 11.5, color: vise ? colors.textSecondary : colors.textMuted, marginTop: 3, fontWeight: vise ? '700' : '400' }}>{d.sous}</Text> : null}
            {d.segments?.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 2, marginTop: 3 }}>
                {d.segments.map(s => (
                  <View key={s.nom} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.couleur }} />
                    <Text style={{ fontSize: 11, color: vise ? colors.textSecondary : colors.textMuted, fontWeight: vise ? '700' : '400' }}>{s.nom} {s.texte}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * Anneau avec un chiffre au centre. segments = [{ nom, valeur, couleur, detail? }].
 * Au survol, le segment visé grossit et le centre affiche son nom et son montant.
 */
export function Anneau({ segments, taille = 150, epaisseur = 20, centreValeur, centreLibelle, formatDetail = fmtCourt }) {
  const { colors } = useTheme()
  const [actif, setActif] = useState(null)
  const r = (taille - epaisseur) / 2 - 3
  const tour = 2 * Math.PI * r
  const arcs = arcsAnneau(segments.map(s => s.valeur))
  const ecart = segments.filter(s => s.valeur > 0).length > 1 ? 2 : 0
  const vise = actif !== null ? segments[actif] : null
  return (
    <ZoneSurvol
      onPosition={(px, py) => setActif(segmentAnneau(px, py, taille / 2, r - epaisseur / 2 - 4, r + epaisseur / 2 + 4, arcs))}
      onQuitter={() => setActif(null)}
      style={{ width: taille, height: taille, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={taille} height={taille} style={{ position: 'absolute' }} pointerEvents="none">
        <Circle cx={taille / 2} cy={taille / 2} r={r} stroke={colors.surfaceAlt} strokeWidth={epaisseur} fill="none" />
        {segments.map((s, i) => {
          const longueur = Math.max(0, arcs[i].part * tour - ecart)
          if (!longueur) return null
          // Un cercle SVG commence à 3 h et tourne dans le sens des aiguilles :
          // midi est aux trois quarts du tour. Pas de rotation (mal rendue sur le web).
          const depart = ((0.75 + arcs[i].debut) % 1) * tour
          const estVise = actif === i
          return (
            <Circle key={s.nom} cx={taille / 2} cy={taille / 2} r={r} stroke={s.couleur}
              strokeWidth={estVise ? epaisseur + 6 : epaisseur} fill="none"
              opacity={actif !== null && !estVise ? 0.35 : 1}
              strokeDasharray={`${longueur} ${tour - longueur}`} strokeDashoffset={-depart}
              strokeLinecap="butt" />
          )
        })}
      </Svg>
      <View pointerEvents="none" style={{ alignItems: 'center', maxWidth: taille - epaisseur * 2 - 8 }}>
        {vise ? (
          <>
            <Text style={{ fontSize: 15, fontWeight: '800', color: vise.couleur }} numberOfLines={1} adjustsFontSizeToFit>
              {vise.detail ?? formatDetail(vise.valeur)}
            </Text>
            <Text style={{ fontSize: 10.5, color: colors.textSecondary, fontWeight: '700', textAlign: 'center' }} numberOfLines={2}>
              {vise.nom} · {Math.round(arcs[actif].part * 100)} %
            </Text>
          </>
        ) : (
          <>
            {centreValeur ? <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{centreValeur}</Text> : null}
            {centreLibelle ? <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '600' }}>{centreLibelle}</Text> : null}
          </>
        )}
      </View>
    </ZoneSurvol>
  )
}

/**
 * Carte de chaleur jours × heures. grille[ligne][colonne] ; colonnes = libellés des heures.
 * Au survol, la case visée est entourée et sa valeur s'affiche au-dessus.
 */
export function CarteChaleur({ largeur, grille, max, lignes, colonnes, couleur, unite = 'commandes' }) {
  const { colors } = useTheme()
  const [actif, setActif] = useState(null)   // { j, i }
  const marge = 34
  const nbCol = colonnes.length
  const cote = Math.max(6, Math.floor((largeur - marge) / nbCol) - 2)
  const pasX = cote + 2, pasY = cote + 2
  const fond = colors.surfaceAlt.length === 7 ? colors.surfaceAlt : '#F1F5F9'
  const valeur = actif ? grille[actif.j]?.[actif.i] || 0 : null
  return (
    <View>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30, marginBottom: 8,
        paddingHorizontal: 10, borderRadius: 10, backgroundColor: actif ? colors.surfaceAlt : 'transparent',
      }}>
        {actif ? (
          <>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: valeur ? melangerCouleurs(fond, couleur, 0.15 + 0.85 * (valeur / (max || 1))) : fond }} />
            <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>
              {lignes[actif.j]} · {colonnes[actif.i]} – {colonnes[(actif.i + 1) % nbCol]}
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '800', color: couleur, marginLeft: 'auto' }}>{fmtEntier(valeur)} {unite}</Text>
          </>
        ) : (
          <Text style={{ fontSize: 12, color: colors.textMuted }}>Passez sur une case pour voir le détail</Text>
        )}
      </View>
      <ZoneSurvol
        onPosition={(px, py) => {
          const i = Math.floor((px - marge) / pasX)
          const j = Math.floor(py / pasY)
          setActif(i >= 0 && i < nbCol && j >= 0 && j < grille.length ? { i, j } : null)
        }}
        onQuitter={() => setActif(null)}>
        {grille.map((ligne, j) => (
          <View key={j} pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', height: pasY }}>
            <Text style={{ width: marge, fontSize: 10.5, fontWeight: actif?.j === j ? '800' : '700', color: actif?.j === j ? colors.text : colors.textSecondary }}>
              {lignes[j]}
            </Text>
            {ligne.map((v, i) => {
              const vise = actif && actif.i === i && actif.j === j
              return (
                <View key={i} style={{
                  width: cote, height: cote, borderRadius: 3, marginRight: 2,
                  backgroundColor: v ? melangerCouleurs(fond, couleur, 0.15 + 0.85 * (v / (max || 1))) : fond,
                  borderWidth: vise ? 2 : 0, borderColor: colors.text,
                  opacity: actif && !vise && actif.j !== j && actif.i !== i ? 0.5 : 1,
                }} />
              )
            })}
          </View>
        ))}
      </ZoneSurvol>
      <View style={{ flexDirection: 'row', marginLeft: marge, marginTop: 4 }}>
        {colonnes.map((c, i) => (
          <Text key={i} style={{ width: pasX, fontSize: 9, color: actif?.i === i ? colors.text : colors.textMuted, fontWeight: actif?.i === i ? '800' : '400' }}>
            {i % 3 === 0 || actif?.i === i ? c : ''}
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

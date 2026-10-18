// ──────────────────────────────────────────────────────────────────────────────
// Champ date avec calendrier : on voit la date choisie en clair, on appuie pour
// ouvrir un calendrier, on touche un jour, il se referme. Remplace la saisie
// « AAAA-MM-JJ » à la main, source d'erreurs.
// Valeur au format ISO (AAAA-MM-JJ), comme en base.
// ──────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { Calendar, LocaleConfig } from 'react-native-calendars'

import { useTheme } from '../context/ThemeContext'
import { joursEntre, moisDeLaPeriode, periodeMois, toucherJour } from '../lib/calendrierPeriode'

LocaleConfig.locales.fr = {
  monthNames: ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'],
  monthNamesShort: ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'],
  dayNames: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
  dayNamesShort: ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'],
  today: "Aujourd'hui",
}
LocaleConfig.defaultLocale = 'fr'

export function dateEnClair(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const [a, m, j] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, j)).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

// Le calendrier seul (sans bouton), aux couleurs du thème. onChoisir(iso).
// initial : mois affiché quand aucune date n'est choisie (ISO).
// Titre en deux morceaux (18/10/2026) : toucher « Octobre » ouvre les 12 mois,
// toucher « 2026 » ouvre les années ; plus besoin de reculer mois par mois.
// naissance : date de naissance → s'ouvre directement sur le choix de l'année.
const ANNEES_PAR_PAGE = 20
const deux = n => String(n).padStart(2, '0')
const aujourdhui = () => new Date().toISOString().slice(0, 10)

// Une case des grilles mois / années.
function Case({ texte, actif, desactive, onPress, c, colors }) {
  return (
    <TouchableOpacity disabled={desactive} onPress={onPress}
      style={{
        width: '25%', paddingVertical: 12, alignItems: 'center', borderRadius: 10,
        backgroundColor: actif ? c : 'transparent', opacity: desactive ? 0.3 : 1,
      }}>
      <Text style={{ fontSize: 15, fontWeight: actif ? '700' : '500', color: actif ? '#fff' : colors.text }}>{texte}</Text>
    </TouchableOpacity>
  )
}

function Fleche({ sens, onPress, desactive, c }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={desactive} hitSlop={12}
      style={{ paddingHorizontal: 14, paddingVertical: 6, opacity: desactive ? 0.3 : 1 }}>
      <Text style={{ fontSize: 20, color: c, fontWeight: '700' }}>{sens < 0 ? '‹' : '›'}</Text>
    </TouchableOpacity>
  )
}

// Titre des jours : « Octobre ▾ » et « 2026 ▾ », deux boutons distincts.
function TitreMoisAnnee({ date, c, onMois, onAnnee }) {
  const style = { fontSize: 16, fontWeight: '700', color: c, paddingVertical: 4, paddingHorizontal: 4 }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <TouchableOpacity onPress={onMois} hitSlop={8}>
        <Text style={style}>{LocaleConfig.locales.fr.monthNames[date.getMonth()]} ▾</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onAnnee} hitSlop={8}>
        <Text style={style}>{date.getFullYear()} ▾</Text>
      </TouchableOpacity>
    </View>
  )
}

// Grille des années (20 par page). onChoisir(annee).
function GrilleAnnees({ annee, onChoisir, minDate, maxDate, c, colors }) {
  const [debutPage, setDebutPage] = useState(annee - (ANNEES_PAR_PAGE - 1) + 5)
  const anMin = minDate ? Number(minDate.slice(0, 4)) : null
  const anMax = maxDate ? Number(maxDate.slice(0, 4)) : null
  const finPage = debutPage + ANNEES_PAR_PAGE - 1
  return (
    <View style={{ backgroundColor: colors.surface, padding: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Fleche sens={-1} c={c} onPress={() => setDebutPage(d => d - ANNEES_PAR_PAGE)} desactive={anMin != null && debutPage <= anMin} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Année · {debutPage} – {finPage}</Text>
        <Fleche sens={1} c={c} onPress={() => setDebutPage(d => d + ANNEES_PAR_PAGE)} desactive={anMax != null && finPage >= anMax} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: ANNEES_PAR_PAGE }, (_, i) => debutPage + i).map(a => (
          <Case key={a} texte={String(a)} actif={a === annee} c={c} colors={colors}
            desactive={(anMin != null && a < anMin) || (anMax != null && a > anMax)}
            onPress={() => onChoisir(a)} />
        ))}
      </View>
    </View>
  )
}

// Grille des 12 mois d'une année. onChoisir('AAAA-MM'). moisActif : 'AAAA-MM' surligné.
function GrilleMois({ annee, moisActif, onChoisir, onAnnees, setAnnee, minDate, maxDate, aide, c, colors }) {
  const moisMin = minDate ? minDate.slice(0, 7) : null
  const moisMax = maxDate ? maxDate.slice(0, 7) : null
  return (
    <View style={{ backgroundColor: colors.surface, padding: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Fleche sens={-1} c={c} onPress={() => setAnnee(annee - 1)} desactive={moisMin != null && `${annee - 1}-12` < moisMin} />
        <TouchableOpacity onPress={onAnnees} hitSlop={8}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: c }}>{annee} ▾</Text>
        </TouchableOpacity>
        <Fleche sens={1} c={c} onPress={() => setAnnee(annee + 1)} desactive={moisMax != null && `${annee + 1}-01` > moisMax} />
      </View>
      {aide ? <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 6 }}>{aide}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {LocaleConfig.locales.fr.monthNamesShort.map((nom, i) => {
          const cle = `${annee}-${deux(i + 1)}`
          return (
            <Case key={cle} texte={nom} actif={cle === moisActif} c={c} colors={colors}
              desactive={(moisMin && cle < moisMin) || (moisMax && cle > moisMax)}
              onPress={() => onChoisir(cle)} />
          )
        })}
      </View>
    </View>
  )
}

// marques : dates à signaler en plus (ex. points des jours qui ont des données).
export function CalendrierFr({ valeur, onChoisir, minDate, maxDate, couleur, initial, naissance = false, marques }) {
  const { colors } = useTheme()
  const c = couleur || colors.primary
  const depart = valeur || initial
    || (naissance ? `${new Date().getFullYear() - 25}-01-01` : aujourdhui())
  const [affiche, setAffiche] = useState(depart.slice(0, 7) + '-01')
  const [etape, setEtape] = useState(naissance && !valeur ? 'annees' : 'jours')
  const anAffiche = Number(affiche.slice(0, 4))
  const fixerAnnee = a => setAffiche(`${a}${affiche.slice(4)}`)

  if (etape === 'annees') {
    return <GrilleAnnees annee={anAffiche} minDate={minDate} maxDate={maxDate} c={c} colors={colors}
      onChoisir={a => { fixerAnnee(a); setEtape('mois') }} />
  }
  if (etape === 'mois') {
    return <GrilleMois annee={anAffiche} moisActif={affiche.slice(0, 7)} minDate={minDate} maxDate={maxDate} c={c} colors={colors}
      setAnnee={fixerAnnee} onAnnees={() => setEtape('annees')}
      onChoisir={cle => { setAffiche(`${cle}-01`); setEtape('jours') }} />
  }

  return (
    <Calendar
      key={colors.bg + affiche}
      current={affiche}
      minDate={minDate}
      maxDate={maxDate}
      firstDay={1}
      onDayPress={d => onChoisir(d.dateString)}
      onMonthChange={d => setAffiche(d.dateString.slice(0, 7) + '-01')}
      markedDates={{ ...(marques || {}), ...(valeur ? { [valeur]: { ...(marques?.[valeur] || {}), selected: true } } : {}) }}
      renderHeader={mois => (
        <TitreMoisAnnee date={mois} c={c} onMois={() => setEtape('mois')} onAnnee={() => setEtape('annees')} />
      )}
      theme={{
        calendarBackground: colors.surface,
        selectedDayBackgroundColor: c,
        selectedDayTextColor: '#fff',
        todayTextColor: c,
        dayTextColor: colors.text,
        textDisabledColor: colors.textPlaceholder,
        arrowColor: c,
        monthTextColor: colors.text,
        textSectionTitleColor: colors.textMuted,
      }}
    />
  )
}

// ── Période (début → fin) ────────────────────────────────────────────────────
// debut / fin : 'AAAA-MM-JJ' ou '' · onChange({ debut, fin }) à chaque toucher.
// Toucher « Octobre » ouvre les 12 mois : toucher un mois choisit le mois
// ENTIER et appelle onMoisEntier({ debut, fin }) (par défaut onChange) — l'écran
// peut alors valider tout de suite. Toucher « 2026 » ouvre les années.
// maxDate vaut aujourd'hui par défaut : on ne filtre pas l'avenir.
export function CalendrierPeriode({ debut = '', fin = '', onChange, onMoisEntier, minDate, maxDate = aujourdhui(), couleur, couleurClaire }) {
  const { colors } = useTheme()
  const c = couleur || colors.primary
  const clair = couleurClaire || `${c}33`
  const bornes = { minDate, maxDate }
  const [affiche, setAffiche] = useState(((debut || maxDate || aujourdhui()).slice(0, 7)) + '-01')
  const [etape, setEtape] = useState('jours')
  const anAffiche = Number(affiche.slice(0, 4))
  const fixerAnnee = a => setAffiche(`${a}${affiche.slice(4)}`)

  if (etape === 'annees') {
    return <GrilleAnnees annee={anAffiche} minDate={minDate} maxDate={maxDate} c={c} colors={colors}
      onChoisir={a => { fixerAnnee(a); setEtape('mois') }} />
  }
  if (etape === 'mois') {
    return <GrilleMois annee={anAffiche} moisActif={moisDeLaPeriode(debut, fin, bornes)} minDate={minDate} maxDate={maxDate}
      c={c} colors={colors} setAnnee={fixerAnnee} onAnnees={() => setEtape('annees')}
      aide="Touchez un mois pour le choisir en entier"
      onChoisir={cle => {
        const p = periodeMois(cle, bornes)
        if (!p) return
        setAffiche(`${cle}-01`)
        setEtape('jours')
        ;(onMoisEntier || onChange)(p)
      }} />
  }

  const jours = joursEntre(debut, fin)
  const marques = {}
  jours.forEach((j, i) => {
    const bout = i === 0 || i === jours.length - 1
    marques[j] = {
      color: bout ? c : clair, textColor: bout ? '#fff' : colors.text,
      startingDay: i === 0, endingDay: i === jours.length - 1,
    }
  })

  return (
    <Calendar
      key={colors.bg + affiche}
      current={affiche}
      minDate={minDate}
      maxDate={maxDate}
      firstDay={1}
      markingType="period"
      markedDates={marques}
      onDayPress={d => onChange(toucherJour({ debut, fin }, d.dateString))}
      onMonthChange={d => setAffiche(d.dateString.slice(0, 7) + '-01')}
      renderHeader={mois => (
        <TitreMoisAnnee date={mois} c={c} onMois={() => setEtape('mois')} onAnnee={() => setEtape('annees')} />
      )}
      theme={{
        calendarBackground: colors.surface,
        todayTextColor: c,
        dayTextColor: colors.text,
        textDisabledColor: colors.textPlaceholder,
        arrowColor: c,
        monthTextColor: colors.text,
        textSectionTitleColor: colors.textMuted,
      }}
    />
  )
}

/**
 * valeur : 'AAAA-MM-JJ' ou vide · onChange(iso | '')
 * effacable : affiche « Effacer » (date facultative)
 * minDate / maxDate : bornes facultatives (ISO)
 * couleur : couleur du calendrier et du bouton (par défaut, celle du thème)
 * styleLabel : style du libellé (pour suivre le kit de l'écran)
 * naissance : date de naissance → le calendrier s'ouvre sur le choix de l'année
 */
export default function ChampDate({ label, valeur, onChange, effacable = false, minDate, maxDate, placeholder = 'Choisir une date', couleur, styleLabel, naissance = false }) {
  const { colors } = useTheme()
  const c = couleur || colors.primary
  const [ouvert, setOuvert] = useState(false)
  const enClair = dateEnClair(valeur)

  return (
    <View style={{ marginBottom: 12 }}>
      {!!label && <Text style={styleLabel || { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 }}>{label}</Text>}
      <TouchableOpacity
        onPress={() => setOuvert(o => !o)}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: colors.inputBg, borderWidth: 1, borderColor: ouvert ? c : colors.inputBorder,
          borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11,
        }}
      >
        <Text style={{ fontSize: 15, color: enClair ? colors.text : colors.textPlaceholder }}>
          📅 {enClair ? enClair.charAt(0).toUpperCase() + enClair.slice(1) : placeholder}
        </Text>
        <Text style={{ fontSize: 13, color: c, fontWeight: '600' }}>{ouvert ? 'Fermer' : 'Changer'}</Text>
      </TouchableOpacity>

      {ouvert && (
        <View style={{ marginTop: 8, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
          <CalendrierFr valeur={valeur} minDate={minDate} maxDate={maxDate} couleur={c} naissance={naissance}
            onChoisir={iso => { onChange(iso); setOuvert(false) }} />
          {effacable && !!valeur && (
            <TouchableOpacity onPress={() => { onChange(''); setOuvert(false) }} style={{ padding: 10, alignItems: 'center', backgroundColor: colors.surface }}>
              <Text style={{ color: colors.error, fontSize: 13, fontWeight: '600' }}>Effacer la date</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  )
}

/**
 * Champ période (début → fin) : on voit la période en clair, on appuie pour
 * ouvrir le calendrier de période. Se referme quand la période est complète.
 * onChange({ debut, fin }) · onMoisEntier : mois touché dans la grille (défaut onChange).
 */
export function ChampPeriode({ label, debut, fin, onChange, onMoisEntier, minDate, maxDate, couleur, styleLabel, placeholder = 'Choisir une période' }) {
  const { colors } = useTheme()
  const c = couleur || colors.primary
  const [ouvert, setOuvert] = useState(false)
  const [brouillon, setBrouillon] = useState({ debut: '', fin: '' })
  const court = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const texte = debut && fin ? `${court(debut)} → ${court(fin)}` : null

  return (
    <View style={{ marginBottom: 12 }}>
      {!!label && <Text style={styleLabel || { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 }}>{label}</Text>}
      <TouchableOpacity
        onPress={() => { setBrouillon({ debut: debut || '', fin: fin || '' }); setOuvert(o => !o) }}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: colors.inputBg, borderWidth: 1, borderColor: ouvert ? c : colors.inputBorder,
          borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11,
        }}
      >
        <Text style={{ fontSize: 15, color: texte ? colors.text : colors.textPlaceholder, flex: 1 }} numberOfLines={1}>📅 {texte || placeholder}</Text>
        <Text style={{ fontSize: 13, color: c, fontWeight: '600' }}>{ouvert ? 'Fermer' : 'Changer'}</Text>
      </TouchableOpacity>

      {ouvert && (
        <View style={{ marginTop: 8, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', paddingTop: 8, backgroundColor: colors.surface }}>
            {brouillon.debut && !brouillon.fin ? 'Touchez le jour de fin' : 'Touchez le jour de début, ou le mois en haut'}
          </Text>
          <CalendrierPeriode debut={brouillon.debut} fin={brouillon.fin} minDate={minDate} maxDate={maxDate} couleur={c}
            onChange={p => {
              setBrouillon(p)
              if (p.debut && p.fin) { onChange(p); setOuvert(false) }
            }}
            onMoisEntier={p => { (onMoisEntier || onChange)(p); setOuvert(false) }} />
        </View>
      )}
    </View>
  )
}

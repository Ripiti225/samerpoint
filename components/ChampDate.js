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
// Toucher le titre « Mois Année » ouvre le choix de l'année, puis du mois,
// puis on retombe sur les jours : plus besoin de reculer mois par mois.
// naissance : date de naissance → s'ouvre directement sur le choix de l'année.
const ANNEES_PAR_PAGE = 20

export function CalendrierFr({ valeur, onChoisir, minDate, maxDate, couleur, initial, naissance = false }) {
  const { colors } = useTheme()
  const c = couleur || colors.primary
  const depart = valeur || initial
    || (naissance ? `${new Date().getFullYear() - 25}-01-01` : new Date().toISOString().slice(0, 10))
  const [affiche, setAffiche] = useState(depart.slice(0, 7) + '-01')
  const [etape, setEtape] = useState(naissance && !valeur ? 'annees' : 'jours')
  const anAffiche = Number(affiche.slice(0, 4))
  const [debutPage, setDebutPage] = useState(anAffiche - (ANNEES_PAR_PAGE - 1) + 5)

  const anMin = minDate ? Number(minDate.slice(0, 4)) : null
  const anMax = maxDate ? Number(maxDate.slice(0, 4)) : null
  const moisMin = minDate ? minDate.slice(0, 7) : null
  const moisMax = maxDate ? maxDate.slice(0, 7) : null
  const deux = n => String(n).padStart(2, '0')

  const case_ = (texte, actif, desactive, onPress) => (
    <TouchableOpacity key={texte} disabled={desactive} onPress={onPress}
      style={{
        width: '25%', paddingVertical: 12, alignItems: 'center', borderRadius: 10,
        backgroundColor: actif ? c : 'transparent', opacity: desactive ? 0.3 : 1,
      }}>
      <Text style={{ fontSize: 15, fontWeight: actif ? '700' : '500', color: actif ? '#fff' : colors.text }}>{texte}</Text>
    </TouchableOpacity>
  )

  const fleche = (sens, onPress, desactive) => (
    <TouchableOpacity onPress={onPress} disabled={desactive} hitSlop={12}
      style={{ paddingHorizontal: 14, paddingVertical: 6, opacity: desactive ? 0.3 : 1 }}>
      <Text style={{ fontSize: 20, color: c, fontWeight: '700' }}>{sens < 0 ? '‹' : '›'}</Text>
    </TouchableOpacity>
  )

  if (etape === 'annees') {
    const annees = Array.from({ length: ANNEES_PAR_PAGE }, (_, i) => debutPage + i)
    const finPage = debutPage + ANNEES_PAR_PAGE - 1
    return (
      <View style={{ backgroundColor: colors.surface, padding: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          {fleche(-1, () => setDebutPage(d => d - ANNEES_PAR_PAGE), anMin != null && debutPage <= anMin)}
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Année · {debutPage} – {finPage}</Text>
          {fleche(1, () => setDebutPage(d => d + ANNEES_PAR_PAGE), anMax != null && finPage >= anMax)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {annees.map(a => case_(String(a), a === anAffiche,
            (anMin != null && a < anMin) || (anMax != null && a > anMax),
            () => { setAffiche(`${a}${affiche.slice(4)}`); setEtape('mois') }))}
        </View>
      </View>
    )
  }

  if (etape === 'mois') {
    const moisAffiche = Number(affiche.slice(5, 7))
    return (
      <View style={{ backgroundColor: colors.surface, padding: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
          <TouchableOpacity onPress={() => { setDebutPage(anAffiche - (ANNEES_PAR_PAGE - 1) + 5); setEtape('annees') }} hitSlop={8}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: c }}>Mois · {anAffiche} ▾</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {LocaleConfig.locales.fr.monthNamesShort.map((nom, i) => {
            const cle = `${anAffiche}-${deux(i + 1)}`
            return case_(nom, i + 1 === moisAffiche,
              (moisMin && cle < moisMin) || (moisMax && cle > moisMax),
              () => { setAffiche(`${cle}-01`); setEtape('jours') })
          })}
        </View>
      </View>
    )
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
      markedDates={valeur ? { [valeur]: { selected: true } } : {}}
      renderHeader={mois => (
        <TouchableOpacity onPress={() => setEtape('annees')} hitSlop={8}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: c, paddingVertical: 4 }}>
            {LocaleConfig.locales.fr.monthNames[mois.getMonth()]} {mois.getFullYear()} ▾
          </Text>
        </TouchableOpacity>
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

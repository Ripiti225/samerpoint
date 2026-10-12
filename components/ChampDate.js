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
export function CalendrierFr({ valeur, onChoisir, minDate, maxDate, couleur, initial }) {
  const { colors } = useTheme()
  const c = couleur || colors.primary
  return (
    <Calendar
      key={colors.bg}
      current={valeur || initial || undefined}
      minDate={minDate}
      maxDate={maxDate}
      firstDay={1}
      onDayPress={d => onChoisir(d.dateString)}
      markedDates={valeur ? { [valeur]: { selected: true } } : {}}
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
 */
export default function ChampDate({ label, valeur, onChange, effacable = false, minDate, maxDate, placeholder = 'Choisir une date', couleur, styleLabel }) {
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
          <CalendrierFr valeur={valeur} minDate={minDate} maxDate={maxDate} couleur={c}
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

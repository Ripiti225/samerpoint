// Résumé de l'écran Contacts : contacts pris sur la période et évolution face
// à la période juste avant (même durée), taux de prise, courbe jour par jour,
// classement par restaurant en vue « Tous ».
import { Text, View } from 'react-native'
import { BarresHorizontales, CarteGraphique, CourbeAire, Legende } from '../graphiques'
import Jauge from '../ui/Jauge'
import { teinte } from '../ui/EcranModerne'
import { evolution } from '../../lib/contactsPeriode'
import { libellePeriode } from '../../lib/periodeComparee'

const nb = n => Math.round(Number(n) || 0).toLocaleString('fr-FR')

function PastilleEvolution({ valeur, styles }) {
  if (valeur === null) return null
  const c = valeur > 0 ? '#3B8D2F' : valeur < 0 ? '#C2462B' : '#7A7A86'
  return (
    <View style={[styles.pastille, { marginTop: 0, backgroundColor: teinte(c, '22') }]}>
      <Text style={[styles.pastilleTxt, { color: c }]}>{valeur > 0 ? '▲ +' : valeur < 0 ? '▼ ' : ''}{valeur} %</Text>
    </View>
  )
}

export default function ResumeContacts({ styles, colors, principale, accent, a, b, plageA, plageB, jourA, jourB, restaurants }) {
  const evo = evolution(a.contacts, b.contacts)
  const evoTaux = a.taux !== null && b.taux !== null ? a.taux - b.taux : null

  return (
    <View>
      {/* Contacts pris + évolution */}
      <View style={[styles.carte, { backgroundColor: principale, borderColor: principale }]}>
        <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '600' }}>📲 Contacts clients pris</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: -0.8 }}>{nb(a.contacts)}</Text>
          {evo !== null && (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: evo > 0 ? '#2F7A25' : evo < 0 ? '#B23A22' : '#5F5F6B' }}>
                {evo > 0 ? '▲ +' : evo < 0 ? '▼ ' : ''}{evo} %
              </Text>
            </View>
          )}
        </View>
        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
          {libellePeriode(plageA.debut, plageA.fin)} · {a.jours} jour{a.jours > 1 ? 's' : ''} avec activité
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 12, padding: 10 }}>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>Période juste avant</Text>
            <Text style={{ fontSize: 15, color: '#fff', fontWeight: '800', marginTop: 2 }}>{nb(b.contacts)}</Text>
            <Text style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.75)', marginTop: 1 }}>{libellePeriode(plageB.debut, plageB.fin)}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 12, padding: 10 }}>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>Écart</Text>
            <Text style={{ fontSize: 15, color: '#fff', fontWeight: '800', marginTop: 2 }}>
              {a.contacts - b.contacts > 0 ? '+' : ''}{nb(a.contacts - b.contacts)}
            </Text>
            <Text style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.75)', marginTop: 1 }}>contacts</Text>
          </View>
        </View>
      </View>

      {/* Taux de prise */}
      <View style={styles.carte}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={[styles.carteTitre, { fontSize: 14.5 }]}>Taux de prise</Text>
          {evoTaux !== null && (
            <PastilleEvolution valeur={evoTaux} styles={styles} />
          )}
        </View>
        {a.taux === null ? (
          <Text style={styles.infoTxt}>Aucune commande Yango / Glovo sur la période.</Text>
        ) : (
          <>
            <Jauge variante="barre" pct={Math.min(100, a.taux)} libelle={`${nb(a.contacts)} contacts ÷ ${nb(a.commandes)} commandes Yango / Glovo`} />
            <Text style={[styles.infoTxt, { fontSize: 12, marginTop: 6 }]}>
              {b.taux !== null ? `Contre ${b.taux} % la période juste avant${evoTaux ? ` (${evoTaux > 0 ? '+' : ''}${evoTaux} points)` : ''}.` : 'Pas de commande partenaire la période juste avant.'}
              {a.taux > 100 ? ' Plus de contacts que de commandes : certains caissiers en saisissent aussi hors livraison.' : ''}
            </Text>
          </>
        )}
      </View>

      {/* Courbe jour par jour */}
      {jourA.length > 1 && (
        <CarteGraphique icone="chart-line" couleur={principale} titre="Jour par jour"
          sous="La période juste avant en pointillés, jour pour jour"
          legende={[{ nom: 'Période choisie', couleur: principale }, { nom: 'Juste avant', couleur: colors.textMuted, pointille: true }]}>
          {largeur => (
            <CourbeAire largeur={largeur} hauteur={190}
              etiquettes={jourA.map(j => `${Number(j.date.slice(8, 10))}/${j.date.slice(5, 7)}`)}
              format={v => nb(v)} formatDetail={v => `${nb(v)} contacts`}
              series={[
                { nom: 'Période', valeurs: jourA.map(j => j.contacts), couleur: principale, aire: true },
                { nom: 'Juste avant', valeurs: jourB.map(j => j.contacts), couleur: colors.textMuted, pointille: true, opacite: 0.8 },
              ]} />
          )}
        </CarteGraphique>
      )}

      {/* Classement par restaurant (vue « Tous ») */}
      {restaurants && restaurants.length > 0 && (
        <CarteGraphique icone="store" couleur={principale} titre="Par restaurant" sous="Contacts pris · taux de prise · évolution">
          {() => (
            <>
              <BarresHorizontales rangs format={v => nb(v)} donnees={restaurants.map(r => ({
                cle: r.id, nom: r.nom, valeur: r.contacts, couleur: principale,
                droite: `${nb(r.contacts)}${r.taux !== null ? ` · ${r.taux} %` : ''}`,
                sous: r.evolution === null
                  ? (r.contactsAvant ? '' : 'Pas de contact la période juste avant')
                  : `${r.evolution > 0 ? '▲ +' : r.evolution < 0 ? '▼ ' : ''}${r.evolution} % (${nb(r.contactsAvant)} avant)`,
              }))} />
              <Legende elements={[{ nom: 'Barre = contacts pris', couleur: principale }]} />
            </>
          )}
        </CarteGraphique>
      )}
      <Text style={[styles.infoTxt, { fontSize: 11, color: accent, marginBottom: 12 }]}>
        Compté par le POS quand il transmet ses compteurs, sinon par les numéros saisis dans Samtrackly (avant le passage au POS).
      </Text>
    </View>
  )
}

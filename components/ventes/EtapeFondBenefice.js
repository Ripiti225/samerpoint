// Étape 2 de la saisie des ventes : fond de caisse et bénéfice SC (calculs de AppContext).
import { Text, View } from 'react-native'
import { COEFFICIENTS } from '../../lib/constants'
import { Carte, Champ, Etiquette, LigneValeur, Rubrique, useStyleChaleureux } from '../ui/StyleChaleureux'

export default function EtapeFondBenefice({ ventesJour, setVente, modifiable, fcRecuAuto, resteEspeces, fc, beneficeSC, fmt }) {
  const { p, styles } = useStyleChaleureux()
  const reste = resteEspeces()
  const detailTreso = (ventesJour.fc_recu_detail || [])
    .map(l => `${l.montant >= 0 ? '+' : '−'} ${fmt(Math.abs(l.montant))} (${l.type === 'fond' ? 'fond donné' : 'repris'} le ${l.date.slice(8, 10)}/${l.date.slice(5, 7)})`)
    .join(' · ')
  const benefices = [
    { label: `Yango TAB ×${COEFFICIENTS.YANGO}`, val: (parseFloat(ventesJour.yangoTab) || 0) * COEFFICIENTS.YANGO },
    { label: `Glovo TAB ×${COEFFICIENTS.GLOVO}`, val: (parseFloat(ventesJour.glovoTab) || 0) * COEFFICIENTS.GLOVO },
    { label: `Wave ×${COEFFICIENTS.WAVE}`, val: (parseFloat(ventesJour.wave) || 0) * COEFFICIENTS.WAVE },
    { label: `Orange Money ×${COEFFICIENTS.OM}`, val: (parseFloat(ventesJour.om) || 0) * COEFFICIENTS.OM },
    { label: `Djamo ×${COEFFICIENTS.DJAMO}`, val: (parseFloat(ventesJour.djamo) || 0) * COEFFICIENTS.DJAMO },
  ].filter(r => r.val > 0)

  return (
    <>
      <Rubrique>Fond de caisse</Rubrique>
      <Carte>
        <LigneValeur libelle="FC de la veille" etiquette="auto" valeur={fmt(parseFloat(ventesJour.fcVeille) || 0)} />
        <View style={{ paddingVertical: 7 }}>
          <View style={styles.ligne}>
            <View style={{ flexShrink: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.texte, { fontWeight: '700' }]}>FC reçu</Text>
                {fcRecuAuto ? <Etiquette ton="ok" texte="Trésorerie" /> : null}
              </View>
              {!fcRecuAuto ? <Text style={styles.petitDoux}>Ajustement admin (+ complément / − déduction)</Text> : null}
            </View>
            <Champ style={{ width: 130 }} keyboardType="numbers-and-punctuation" placeholder="0"
              value={ventesJour.fc_recu || ''} onChangeText={v => setVente('fc_recu', v)} editable={!fcRecuAuto && modifiable} />
          </View>
          {detailTreso ? (
            <Text style={[styles.petitDoux, { color: p.accent, fontWeight: '600', marginTop: 4 }]}>Trésorerie : {detailTreso}</Text>
          ) : null}
        </View>
        <LigneValeur libelle="Espèces en caisse" etiquette="shifts" valeur={fmt(reste)} />
        <LigneValeur fort libelle="FC calculé" valeur={fmt(fc())} couleur={p.accent} />
      </Carte>

      <Rubrique>Bénéfice SC</Rubrique>
      <Carte>
        {benefices.map(r => <LigneValeur key={r.label} libelle={r.label} valeur={fmt(r.val)} />)}
        <LigneValeur libelle="Reste espèces" valeur={reste >= 0 ? fmt(reste) : `− ${fmt(Math.abs(reste))}`}
          couleur={reste < 0 ? p.erreur : undefined} />
        <LigneValeur fort libelle="Bénéfice SC total" valeur={fmt(beneficeSC())} couleur={p.ok} />
      </Carte>
    </>
  )
}

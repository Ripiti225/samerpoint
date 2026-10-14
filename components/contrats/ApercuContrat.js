// ──────────────────────────────────────────────────────────────────────────────
// Le contrat tel que le travailleur le lit avant de signer : les mêmes blocs
// que le PDF (lib/modelesContrat.js), sur fond blanc, en police à empattements.
// Papier blanc même en mode sombre : c'est un document, pas un écran de l'app.
// ──────────────────────────────────────────────────────────────────────────────
import { Image, Platform, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'

import { cachetContrat } from '../../lib/cachetsContrat'
import { LOGO_KAYAN, LOGO_SAMER } from '../../lib/logos'
import { construireContrat, marqueContrat } from '../../lib/modelesContrat'
import { traitsVersPath } from '../../lib/recrutement'

const SERIF = Platform.select({ ios: 'Times New Roman', android: 'serif', default: '"Times New Roman", Times, serif' })
const ENCRE = '#1A1A1A'
const t = (extra = {}) => ({ fontFamily: SERIF, color: ENCRE, fontSize: 15, lineHeight: 22, ...extra })

function Signature({ signature }) {
  if (!signature?.traits?.length) return <View style={{ height: 70 }} />
  const l = 200
  const h = l / (signature.ratio || 2.5)
  return (
    <Svg width={l} height={h}>
      <Path d={traitsVersPath(signature.traits, l, h)} stroke="#1E2878" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export default function ApercuContrat({ donnees, signature = null, avecCachet = true }) {
  const contrat = construireContrat(donnees)
  const marque = marqueContrat(donnees?.marque)
  const logo = donnees?.marque === 'alkayan' ? LOGO_KAYAN : donnees?.marque === 'samer' ? LOGO_SAMER : null
  const cachet = avecCachet ? cachetContrat(donnees?.marque) : null

  return (
    <View style={{ backgroundColor: '#FFFFFF', borderRadius: 12, padding: 18, borderWidth: 1, borderColor: '#E6E1D6' }}>
      {contrat.blocs.map((b, i) => {
        const cle = `${b.t}-${i}`
        if (b.t === 'entete') {
          return (
            <View key={cle} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              {logo ? <Image source={{ uri: logo }} style={{ width: 70, height: 50 }} resizeMode="contain" /> : null}
              <Text style={t({ flex: 1, fontSize: 18, fontWeight: '700', fontStyle: 'italic', textAlign: 'center' })}>
                RESTAURANT {marque?.etablissement || ''}
              </Text>
            </View>
          )
        }
        if (b.t === 'titre') return <Text key={cle} style={t({ fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 14 })}>{b.texte}</Text>
        if (b.t === 'para') return <Text key={cle} style={t({ marginBottom: 8 })}>{b.texte}</Text>
        if (b.t === 'champs') {
          return (
            <View key={cle} style={{ marginBottom: 8 }}>
              {b.items.map(([l, v]) => (
                <Text key={l} style={t()}>{l} : <Text style={{ fontWeight: '700' }}>{v}</Text></Text>
              ))}
            </View>
          )
        }
        if (b.t === 'puces') {
          return (
            <View key={cle} style={{ marginBottom: 8 }}>
              {b.items.map(item => (
                <View key={item} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={t()}>•</Text>
                  <Text style={t({ flex: 1 })}>{item}</Text>
                </View>
              ))}
            </View>
          )
        }
        if (b.t === 'article') {
          return <Text key={cle} style={t({ fontWeight: '700', textDecorationLine: 'underline', marginTop: 8, marginBottom: 4 })}>{b.texte}</Text>
        }
        if (b.t === 'sous') return <Text key={cle} style={t({ fontWeight: '700', marginTop: 2 })}>› {b.texte.toUpperCase()}</Text>
        if (b.t === 'fait') return <Text key={cle} style={t({ fontWeight: '700', textAlign: 'right', marginTop: 12 })}>{b.texte}</Text>
        if (b.t === 'signatures') {
          return (
            <View key={cle} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={t({ fontWeight: '700', textDecorationLine: 'underline' })}>LE TRAVAILLEUR</Text>
                <Text style={t({ fontSize: 13 })}>(Lu et approuvé)</Text>
                <Signature signature={signature} />
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={t({ fontWeight: '700', textDecorationLine: 'underline' })}>L&apos;EMPLOYEUR</Text>
                {cachet ? <Image source={{ uri: cachet }} style={{ width: 150, height: 68, marginTop: 8 }} resizeMode="contain" /> : null}
              </View>
            </View>
          )
        }
        return null
      })}
    </View>
  )
}

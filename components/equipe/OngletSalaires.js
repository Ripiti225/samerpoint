import { ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { fmt } from '../../lib/equipe'
import Avatar from './Avatar'

// stats[].totalPaye = présences + paies du gérant rattachées à la fiche ;
// paiesGerant = seulement les paies du gérant sans fiche retrouvée.
export default function OngletSalaires({ styles, colors, stats, paiesGerant, totalGerant = 0, tous, titre, restoParId, onOuvrir }) {
  const statsTriees = [...stats].sort((a, b) => b.totalPaye - a.totalPaye)
  const totalPresences = statsTriees.reduce((sum, t) => sum + (t.totalPayePresences || 0), 0)
  const totalTravailleurs = statsTriees.reduce((sum, t) => sum + t.totalPaye, 0)
  const totalNonRattache = paiesGerant.reduce((sum, l) => sum + l.montant, 0)
  const totalGlobal = totalPresences + totalGerant
  const pctDe = v => (totalGlobal > 0 ? (v / totalGlobal) * 100 : 0)

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <Text style={styles.heroTitre}>💰 Total masse salariale</Text>
        <Text style={styles.heroValeur}>{fmt(totalGlobal)}</Text>
        <Text style={styles.heroSub}>{titre}</Text>
        {totalGerant > 0 && (
          <View style={styles.heroLignes}>
            <View style={styles.heroLigne}>
              <Text style={styles.heroLigneLabel}>Présences</Text>
              <Text style={styles.heroLigneVal}>{fmt(totalPresences)}</Text>
            </View>
            <View style={styles.heroLigne}>
              <Text style={styles.heroLigneLabel}>Gérant caisse</Text>
              <Text style={styles.heroLigneVal}>{fmt(totalGerant)}</Text>
            </View>
          </View>
        )}
      </View>

      {statsTriees.length === 0 && paiesGerant.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>💰</Text>
          <Text style={styles.emptyTxt}>Aucune donnée sur cette période</Text>
        </View>
      ) : (
        <>
          {statsTriees.length > 0 && (
            <>
              <Text style={styles.sectionTitre}>Salaires par travailleur</Text>
              <View style={styles.carteListe}>
                {statsTriees.map(t => {
                  const pct = pctDe(t.totalPaye)
                  const resto = restoParId[t.restaurant_id]
                  return (
                    <TouchableOpacity key={t.id} style={styles.ligne} onPress={() => onOuvrir(t.id, t)}>
                      <View style={styles.ligneGauche}>
                        <Avatar nom={t.nom} photo={t.photo_url} resto={resto} taille={40} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.nom, { fontSize: 13 }]}>{t.nom}</Text>
                          <Text style={styles.sousNom}>
                            {t.poste || ''}{tous && resto ? ` · ${resto.nom}` : ''} — {t.present}j travaillé(s)
                          </Text>
                          {t.totalPayeGerant > 0 && (
                            <Text style={styles.sousNom}>dont {fmt(t.totalPayeGerant)} payés par le gérant</Text>
                          )}
                          <View style={styles.salaireBarre}>
                            <View style={[styles.salaireBarreFill, { width: `${pct}%` }]} />
                          </View>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.montant}>{fmt(t.totalPaye)}</Text>
                        <Text style={styles.montantPct}>{pct.toFixed(1)}%</Text>
                      </View>
                    </TouchableOpacity>
                  )
                })}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Sous-total</Text>
                  <Text style={styles.totalVal}>{fmt(totalTravailleurs)}</Text>
                </View>
              </View>
            </>
          )}

          {paiesGerant.length > 0 && (
            <>
              <Text style={styles.sectionTitre}>Paies gérant sans fiche retrouvée</Text>
              <View style={styles.carteListe}>
                {paiesGerant.map(l => {
                  const pct = pctDe(l.montant)
                  return (
                    <View key={`${l.nom}|${l.restaurant}`} style={styles.ligne}>
                      <View style={styles.ligneGauche}>
                        <Avatar nom={l.nom} taille={40} resto={{ couleur: 'orange' }} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.nom, { fontSize: 13 }]}>{l.nom}</Text>
                          <Text style={styles.sousNom}>Payé via gérant caisse{tous && l.restaurant ? ` · ${l.restaurant}` : ''}</Text>
                          <View style={styles.salaireBarre}>
                            <View style={[styles.salaireBarreFill, { width: `${pct}%`, backgroundColor: '#EF9F27' }]} />
                          </View>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.montant}>{fmt(l.montant)}</Text>
                        <Text style={styles.montantPct}>{pct.toFixed(1)}%</Text>
                      </View>
                    </View>
                  )
                })}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Sous-total</Text>
                  <Text style={styles.totalVal}>{fmt(totalNonRattache)}</Text>
                </View>
              </View>
            </>
          )}

          <View style={[styles.carte, styles.totalRow, { paddingHorizontal: 16 }]}>
            <Text style={[styles.totalLabel, { fontSize: 15 }]}>Total général</Text>
            <Text style={[styles.totalVal, { fontSize: 18, color: colors.text }]}>{fmt(totalGlobal)}</Text>
          </View>
        </>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  )
}

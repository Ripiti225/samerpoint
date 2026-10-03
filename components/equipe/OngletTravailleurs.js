import { ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { STATUTS, couleurTaux, fmt } from '../../lib/equipe'
import Avatar from './Avatar'

function CarteTravailleur({ styles, t, s, tous, peutEditer, onOuvrir, onModifier, onMenu }) {
  const inactif = !t.actif
  return (
    <View style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 10 }, inactif && { opacity: 0.6 }]}>
      <TouchableOpacity style={styles.ligneGauche} onPress={() => onOuvrir(t)} activeOpacity={0.75}>
        <Avatar nom={t.nom} photo={t.photo_url} resto={t.restaurants} gris={inactif} />
        <View style={{ flex: 1 }}>
          <Text style={styles.nom}>{t.nom}</Text>
          <Text style={styles.sousNom}>{t.poste || 'Sans poste'}{t.type_contrat ? ` — ${t.type_contrat}` : ''}</Text>
          {t.contact ? <Text style={styles.lien}>{t.contact}</Text> : null}
          <View style={styles.badgeRow}>
            {tous && <View style={styles.badge}><Text style={styles.badgeTxt}>{t.restaurants?.nom || 'Sans restaurant'}</Text></View>}
            {t.identifiant ? <View style={styles.badgeBleu}><Text style={styles.badgeBleuTxt}>{t.identifiant}</Text></View> : null}
            {inactif && <View style={styles.badge}><Text style={[styles.badgeTxt, { color: STATUTS['Absent'] }]}>Inactif</Text></View>}
          </View>
          {s && (
            <View style={[styles.miniStats, { marginTop: 6 }]}>
              <Text style={[styles.miniStat, { color: STATUTS['Présent'] }]}>✅ {s.present}j</Text>
              <Text style={[styles.miniStat, { color: STATUTS['Absent'] }]}>❌ {s.absent}j</Text>
              <Text style={[styles.miniStat, { color: STATUTS['Repos'] }]}>💰 {fmt(s.totalPaye)}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        {s && <Text style={[styles.pct, { color: couleurTaux(s.taux) }]}>{s.taux.toFixed(0)}%</Text>}
        {peutEditer && (
          <>
            <TouchableOpacity style={styles.petitBtn} onPress={() => onModifier(t)}>
              <Text style={styles.petitBtnTxt}>✏️ Modifier</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuBtn} onPress={() => onMenu(t)}>
              <Text style={styles.menuBtnTxt}>⋯</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  )
}

export default function OngletTravailleurs({ styles, travailleurs, statsParId, tous, peutEditer, recherche, onAjouter, onOuvrir, onModifier, onMenu }) {
  const actifs = travailleurs.filter(t => t.actif)
  const inactifs = travailleurs.filter(t => !t.actif)
  const carte = t => (
    <CarteTravailleur key={t.id} styles={styles} t={t} s={statsParId[t.id]} tous={tous} peutEditer={peutEditer}
      onOuvrir={onOuvrir} onModifier={onModifier} onMenu={onMenu} />
  )

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {peutEditer && (
        <TouchableOpacity style={styles.btnPointille} onPress={onAjouter}>
          <Text style={styles.btnPointilleTxt}>+ Ajouter un travailleur</Text>
        </TouchableOpacity>
      )}

      {actifs.length > 0 && (
        <>
          <Text style={styles.sectionTitre}>Actifs ({actifs.length})</Text>
          {actifs.map(carte)}
        </>
      )}
      {inactifs.length > 0 && (
        <>
          <Text style={[styles.sectionTitre, { marginTop: 8 }]}>Inactifs ({inactifs.length})</Text>
          {inactifs.map(carte)}
        </>
      )}
      {travailleurs.length === 0 && (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>👥</Text>
          <Text style={styles.emptyTxt}>Aucun travailleur trouvé</Text>
          <Text style={styles.emptySub}>{recherche ? 'Modifiez votre recherche ou le filtre restaurant' : 'Aucun travailleur dans ce restaurant'}</Text>
        </View>
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  )
}

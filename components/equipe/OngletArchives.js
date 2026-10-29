import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { BLEU, formatDate } from '../../lib/equipe'
import Avatar from './Avatar'

export default function OngletArchives({ styles, archives, loading, tous, peutEditer, peutSupprimer, onOuvrir, onReactiver, onSupprimer }) {
  if (loading) return <View style={styles.loadingBox}><ActivityIndicator size="large" color={BLEU} /></View>

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {archives.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTxt}>Aucun travailleur archivé</Text>
        </View>
      ) : archives.map(t => (
        <View key={t.id} style={[styles.carte, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          <TouchableOpacity style={styles.ligneGauche} onPress={() => onOuvrir(t)} activeOpacity={0.75}>
            <Avatar nom={t.nom} photo={t.photo_url} gris />
            <View style={{ flex: 1 }}>
              <Text style={[styles.nom, { opacity: 0.75 }]}>{t.nom}</Text>
              <Text style={styles.sousNom}>{t.poste || 'Sans poste'}{tous && t.restaurants?.nom ? ` · ${t.restaurants.nom}` : ''}</Text>
              {t.archive_motif ? <View style={styles.archiveMotif}><Text style={styles.archiveMotifTxt}>{t.archive_motif}</Text></View> : null}
              {t.badge_rendu === false ? (
                <View style={[styles.archiveMotif, { backgroundColor: '#C0392B1F' }]}><Text style={[styles.archiveMotifTxt, { color: '#C0392B' }]}>⚠️ Badge non rendu</Text></View>
              ) : null}
              {t.archived_at ? <Text style={[styles.sousNom, { fontSize: 11 }]}>Archivé le {formatDate(t.archived_at.split('T')[0])}</Text> : null}
            </View>
          </TouchableOpacity>
          {peutEditer && (
            <View style={{ gap: 6 }}>
              <TouchableOpacity style={styles.btnVert} onPress={() => onReactiver(t)}>
                <Text style={styles.btnVertTxt}>↩ Réactiver</Text>
              </TouchableOpacity>
              {peutSupprimer && (
                <TouchableOpacity style={styles.btnRouge} onPress={() => onSupprimer(t)}>
                  <Text style={styles.btnRougeTxt}>🗑 Supprimer</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      ))}
      <View style={{ height: 30 }} />
    </ScrollView>
  )
}

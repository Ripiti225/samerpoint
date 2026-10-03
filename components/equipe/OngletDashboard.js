import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { Anneau, BarresHorizontales, CarteGraphique, Legende } from '../graphiques'
import { BLEU, STATUTS, couleurTaux, fmt } from '../../lib/equipe'
import Avatar from './Avatar'
import { teinte } from './styles'

function Kpi({ styles, icone, couleur, valeur, label }) {
  return (
    <View style={styles.kpiCard}>
      <View style={[styles.kpiIconBox, { backgroundColor: teinte(couleur) }]}>
        <Text style={styles.kpiIcon}>{icone}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.kpiValue}>{valeur}</Text>
        <Text style={styles.kpiLabel}>{label}</Text>
      </View>
    </View>
  )
}

export default function OngletDashboard({ styles, globales, stats, tauxRestos, tous, titre, sousTitre, restoParId, exporting, onExporter, onOuvrir }) {
  const ps = globales.parStatut
  const segments = [
    { nom: 'Présent', valeur: ps.present, couleur: STATUTS['Présent'] },
    { nom: 'Absent', valeur: ps.absent, couleur: STATUTS['Absent'] },
    { nom: 'Repos', valeur: ps.repos, couleur: STATUTS['Repos'] },
    { nom: 'Congé', valeur: ps.conge, couleur: STATUTS['Congé'] },
    { nom: 'Malade', valeur: ps.malade, couleur: STATUTS['Malade'] },
    { nom: 'Permission', valeur: ps.permission, couleur: STATUTS['Permission'] },
  ].filter(s => s.valeur > 0)

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <TouchableOpacity style={[styles.btnPlein, { marginBottom: 14 }, exporting && { opacity: 0.6 }]} onPress={onExporter} disabled={exporting}>
        {exporting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnPleinTxt}>📊 Exporter en Excel</Text>}
      </TouchableOpacity>

      <View style={styles.kpiGrid}>
        <Kpi styles={styles} icone="👥" couleur={BLEU} valeur={globales.nbTravailleurs} label="Travailleurs" />
        <Kpi styles={styles} icone="📅" couleur="#6C63E0" valeur={globales.nbJours} label="Jours" />
        <Kpi styles={styles} icone="✅" couleur={STATUTS['Présent']} valeur={globales.totalPresences} label="Présences" />
        <Kpi styles={styles} icone="❌" couleur={STATUTS['Absent']} valeur={globales.totalAbsences} label="Absences" />
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroTitre}>💰 Total salaires versés</Text>
        <Text style={styles.heroValeur}>{fmt(globales.totalPaye)}</Text>
        <Text style={styles.heroSub}>{titre} — {sousTitre}</Text>
        {globales.totalPayeGerant > 0 && (
          <View style={styles.heroLignes}>
            <View style={styles.heroLigne}>
              <Text style={styles.heroLigneLabel}>Présences</Text>
              <Text style={styles.heroLigneVal}>{fmt(globales.totalPayePresences)}</Text>
            </View>
            <View style={styles.heroLigne}>
              <Text style={styles.heroLigneLabel}>Gérant caisse</Text>
              <Text style={styles.heroLigneVal}>{fmt(globales.totalPayeGerant)}</Text>
            </View>
          </View>
        )}
      </View>

      {segments.length > 0 && (
        <CarteGraphique icone="chart-donut" couleur={BLEU} titre="Répartition des jours" sous={`${ps.jours} jour(s) pointé(s)`}>
          {() => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <Anneau segments={segments} taille={140} epaisseur={18}
                centreValeur={`${Math.round(globales.taux)} %`} centreLibelle="présence"
                formatDetail={v => `${v} j`} />
              <View style={{ flex: 1, minWidth: 140 }}>
                <Legende elements={segments.map(s => ({ nom: s.nom, couleur: s.couleur, valeur: `${s.valeur} j` }))} />
              </View>
            </View>
          )}
        </CarteGraphique>
      )}

      {tous && tauxRestos.length > 0 && (
        <CarteGraphique icone="store" couleur={BLEU} titre="Taux de présence par restaurant" sous="Où l'équipe manque le plus">
          {() => (
            <BarresHorizontales echelle={100} donnees={tauxRestos.map(r => ({
              cle: r.id, nom: r.nom, valeur: r.taux, couleur: couleurTaux(r.taux), couleurValeur: couleurTaux(r.taux),
              droite: `${Math.round(r.taux)} %`, sous: `${r.present} présence(s) sur ${r.jours} jour(s)`,
            }))} />
          )}
        </CarteGraphique>
      )}

      <Text style={styles.sectionTitre}>Taux de présence par travailleur</Text>
      {stats.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={styles.emptyTxt}>Aucune donnée sur cette période</Text>
        </View>
      ) : (
        [...stats].sort((a, b) => b.taux - a.taux || b.present - a.present).map(t => {
          const resto = restoParId[t.restaurant_id]
          return (
            <TouchableOpacity key={t.id} style={styles.carte} onPress={() => onOuvrir(t.id, t)} activeOpacity={0.8}>
              <View style={styles.ligneGauche}>
                <Avatar nom={t.nom} photo={t.photo_url} resto={resto} taille={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.nom}>{t.nom}</Text>
                  <Text style={styles.sousNom}>{t.poste || 'Sans poste'}{tous && resto ? ` · ${resto.nom}` : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.pct, { color: couleurTaux(t.taux) }]}>{t.taux.toFixed(0)}%</Text>
                  <Text style={styles.voirDetail}>Voir la fiche ›</Text>
                </View>
              </View>
              <View style={styles.barreFond}>
                <View style={[styles.barreFill, { width: `${t.taux}%`, backgroundColor: couleurTaux(t.taux) }]} />
              </View>
              <View style={styles.miniStats}>
                <Text style={[styles.miniStat, { color: STATUTS['Présent'] }]}>✅ {t.present}j</Text>
                <Text style={[styles.miniStat, { color: STATUTS['Absent'] }]}>❌ {t.absent}j</Text>
                {t.repos > 0 && <Text style={[styles.miniStat, { color: STATUTS['Repos'] }]}>😴 {t.repos}j</Text>}
                {t.conge > 0 && <Text style={[styles.miniStat, { color: STATUTS['Congé'] }]}>🏖 {t.conge}j</Text>}
                {t.malade > 0 && <Text style={[styles.miniStat, { color: STATUTS['Malade'] }]}>🤒 {t.malade}j</Text>}
                {t.permission > 0 && <Text style={[styles.miniStat, { color: STATUTS['Permission'] }]}>📋 {t.permission}j</Text>}
              </View>
            </TouchableOpacity>
          )
        })
      )}
      <View style={{ height: 30 }} />
    </ScrollView>
  )
}

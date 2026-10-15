// Détail complet d'un shift caissier, en lecture seule : financier, photos,
// dépenses, fournisseurs, présences & paies, inventaire.
//
// Sorti de app/point-shift.js pour être partagé avec app/point-caissier.js.
// `afficherEcartPOS` ajoute l'écart global du rapport Z et l'explication du
// caissier : c'est la seule différence entre les deux écrans.

import { useMemo, useState } from 'react'
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTheme } from '../context/ThemeContext'
import { depensesSalairesShift } from '../lib/depensesShift'
import PhotoJustificatif from './PhotoJustificatif'

const DETAIL_VIDE = { depenses: [], fournisseurs: [], presences: [], inventaire: null, loading: false }

function fmt(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }

function formatDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc']
  return `${parseInt(d)} ${mois[parseInt(m) - 1]} ${y}`
}

// Rouge = manquant, vert = excédent. Un écart nul ou indisponible reste neutre.
function couleurEcart(ecart) {
  if (typeof ecart !== 'number' || ecart === 0) return null
  return { color: ecart < 0 ? '#A32D2D' : '#3B6D11', fontWeight: '700' }
}

export default function DetailShiftCaissier({ shift, data = DETAIL_VIDE, onClose, afficherEcartPOS = false }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [photoPleinEcranUrl, setPhotoPleinEcranUrl] = useState(null)

  return (
    <>
    {/* Modal détail shift complet — lecture seule */}
    <Modal visible={!!shift} transparent animationType="slide">
      <View style={styles.detailOverlay}>
        <View style={styles.detailModal}>
          {/* En-tête */}
          <View style={styles.detailHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailCaissier}>
                👤 {shift?.caissier_nom || 'Caissier'}
              </Text>
              <Text style={styles.detailHeures}>
                ⏰ {shift?.heure_debut} → {shift?.heure_fin}
                {'  '}
                <Text style={styles.detailDateInline}>{formatDate(shift?.date || '')}</Text>
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <View style={styles.shiftValideBadge}>
                <Text style={styles.shiftValideTxt}>🔒 Validé</Text>
              </View>
              <TouchableOpacity onPress={() => onClose()}>
                <Text style={styles.detailClose}>✕ Fermer</Text>
              </TouchableOpacity>
            </View>
          </View>

          {data.loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#EF9F27" />
              <Text style={{ color: '#888', marginTop: 10 }}>Chargement...</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

              {/* Financier */}
              <Text style={styles.detailSection}>💰 Données financières</Text>
              <View style={styles.detailCard}>
                {[
                  { label: 'Vente shift total', val: shift?.vente_shift, bold: true, color: '#EF9F27' },
                  { label: 'Espèces en caisse', val: shift?.espece },
                  { label: 'Wave', val: shift?.wave },
                  { label: 'Orange Money', val: shift?.om },
                  { label: 'Djamo', val: shift?.djamo },
                  { label: 'Yango CSE', val: shift?.yango_cse },
                  { label: 'Glovo CSE', val: shift?.glovo_cse },
                  { label: 'KDO offerts', val: shift?.kdo },
                  { label: 'Payé en points', val: shift?.points_fidelite },
                  { label: 'Retours', val: shift?.retour },
                  { label: 'Dépenses + Salaires', val: shift ? depensesSalairesShift(shift) : 0 },
                  { label: 'Fournisseurs', val: shift?.fournisseurs },
                ].filter(r => r.val > 0).map((r, i, arr) => (
                  <View key={i} style={[styles.detailRow, i === arr.length - 1 && !afficherEcartPOS && { borderBottomWidth: 0 }]}>
                    <Text style={[styles.detailLabel, r.bold && { fontWeight: '700', color: '#1a1a1a' }]}>{r.label}</Text>
                    <Text style={[styles.detailVal, r.color && { color: r.color, fontWeight: '700' }]}>{fmt(r.val)}</Text>
                  </View>
                ))}
                {afficherEcartPOS && (
                  <>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Écart de caisse (comptage)</Text>
                      <Text style={[styles.detailVal, couleurEcart(shift?.ecartEspeces)]}>
                        {shift?.ecartEspecesTexte}
                      </Text>
                    </View>
                    {typeof shift?.ecartGlobal === 'number' && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Écart du rapport Z</Text>
                        <Text style={[styles.detailVal, couleurEcart(shift.ecartGlobal)]}>
                          {shift.ecartGlobalTexte}
                        </Text>
                      </View>
                    )}
                    <View style={[styles.detailRow, { borderBottomWidth: 0, alignItems: 'flex-start' }]}>
                      <Text style={styles.detailLabel}>Explication du caissier</Text>
                      <Text style={[styles.detailVal, styles.detailExplication]}>
                        {String(shift?.explication_ecart || '').trim() || 'Aucune explication donnée'}
                      </Text>
                    </View>
                  </>
                )}
              </View>

              {/* Photos du shift */}
              {[
                { label: 'KDO', url: shift?.photo_kdo },
                { label: 'Retour', url: shift?.photo_retour },
                { label: 'Yango CSE', url: shift?.photo_yango_cse },
                { label: 'Glovo CSE', url: shift?.photo_glovo_cse },
                { label: 'Wave', url: shift?.photo_wave },
                { label: 'Djamo', url: shift?.photo_djamo },
                { label: 'Orange Money', url: shift?.photo_om },
              ].filter(p => p.url).length > 0 && (
                <>
                  <Text style={styles.detailSection}>📷 Photos justificatives</Text>
                  <View style={styles.detailCard}>
                    <View style={styles.photosGrid}>
                      {[
                        { label: 'KDO', url: shift?.photo_kdo },
                        { label: 'Retour', url: shift?.photo_retour },
                        { label: 'Yango CSE', url: shift?.photo_yango_cse },
                        { label: 'Glovo CSE', url: shift?.photo_glovo_cse },
                        { label: 'Wave', url: shift?.photo_wave },
                        { label: 'Djamo', url: shift?.photo_djamo },
                        { label: 'Orange Money', url: shift?.photo_om },
                      ].filter(p => p.url).map((p, i) => (
                        <TouchableOpacity key={i} style={styles.photoThumb} onPress={() => setPhotoPleinEcranUrl(p.url)}>
                          <PhotoJustificatif uri={p.url} style={styles.photoThumbImg} compact />
                          <Text style={styles.photoThumbLabel}>{p.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </>
              )}

              {/* Dépenses */}
              <Text style={styles.detailSection}>🧾 Dépenses ({data.depenses.length})</Text>
              {data.depenses.length === 0 ? (
                <View style={[styles.detailCard, { alignItems: 'center', paddingVertical: 16 }]}>
                  <Text style={{ color: '#aaa', fontSize: 13 }}>Aucune dépense enregistrée</Text>
                </View>
              ) : (
                <View style={styles.detailCard}>
                  {data.depenses.map((d, i) => (
                    <View key={d.id || i} style={[styles.detailRow, i === data.depenses.length - 1 && { borderBottomWidth: 0 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailLabel}>{d.libelle || d.categorie || 'Dépense'}</Text>
                        {d.categorie && d.libelle && (
                          <Text style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{d.categorie}</Text>
                        )}
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text style={[styles.detailVal, { color: '#A32D2D' }]}>{fmt(d.montant || 0)}</Text>
                        {d.photo_url && (
                          <TouchableOpacity onPress={() => setPhotoPleinEcranUrl(d.photo_url)}>
                            <Text style={{ fontSize: 18 }}>📷</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ))}
                  <View style={[styles.detailRow, { borderBottomWidth: 0, marginTop: 8, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 }]}>
                    <Text style={[styles.detailLabel, { fontWeight: '700', color: '#1a1a1a' }]}>Total dépenses</Text>
                    <Text style={[styles.detailVal, { color: '#A32D2D', fontWeight: '700' }]}>
                      {fmt(data.depenses.reduce((s, d) => s + (d.montant || 0), 0))}
                    </Text>
                  </View>
                </View>
              )}

              {/* Fournisseurs */}
              <Text style={styles.detailSection}>🏭 Fournisseurs ({data.fournisseurs.length})</Text>
              {data.fournisseurs.length === 0 ? (
                <View style={[styles.detailCard, { alignItems: 'center', paddingVertical: 16 }]}>
                  <Text style={{ color: '#aaa', fontSize: 13 }}>Aucun fournisseur enregistré</Text>
                </View>
              ) : (
                <View style={styles.detailCard}>
                  {data.fournisseurs.map((tx, i) => (
                    <View key={tx.id || i} style={[styles.detailRow, { alignItems: 'flex-start', borderBottomWidth: i === data.fournisseurs.length - 1 ? 0 : 0.5 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.detailLabel, { fontWeight: '600' }]}>
                          {tx.fournisseurs?.nom || 'Fournisseur'}
                        </Text>
                        <Text style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
                          Facture : {fmt(tx.facture || 0)} — Payé : {fmt(tx.paye || 0)}
                        </Text>
                        <Text style={{ fontSize: 11, color: tx.reste > 0 ? '#A32D2D' : '#3B6D11', marginTop: 2 }}>
                          Reste dû : {fmt(tx.reste || 0)}
                        </Text>
                      </View>
                      {tx.photo_url && (
                        <TouchableOpacity onPress={() => setPhotoPleinEcranUrl(tx.photo_url)} style={{ marginLeft: 8 }}>
                          <Text style={{ fontSize: 22 }}>📷</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* Présences */}
              <Text style={styles.detailSection}>👥 Présences & Paies ({data.presences.length})</Text>
              {data.presences.length === 0 ? (
                <View style={[styles.detailCard, { alignItems: 'center', paddingVertical: 16 }]}>
                  <Text style={{ color: '#aaa', fontSize: 13 }}>Aucune présence enregistrée</Text>
                </View>
              ) : (
                <View style={styles.detailCard}>
                  {data.presences.map((p, i) => (
                    <View key={p.id || i} style={[styles.detailRow, i === data.presences.length - 1 && { borderBottomWidth: 0 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailLabel}>{p.travailleur_nom || 'Travailleur'}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <View style={[styles.shiftValideBadge, {
                          backgroundColor: ['present', 'Présent', 'présent'].includes(p.statut) ? '#EAF3DE' : '#FAECE7'
                        }]}>
                          <Text style={{
                            fontSize: 11, fontWeight: '500',
                            color: ['present', 'Présent', 'présent'].includes(p.statut) ? '#3B6D11' : '#A32D2D'
                          }}>
                            {['present', 'Présent', 'présent'].includes(p.statut) ? '✅ Présent' : `❌ ${p.statut || 'Absent'}`}
                          </Text>
                        </View>
                        {(p.paye || 0) > 0 && (
                          <Text style={[styles.detailVal, { fontSize: 12 }]}>{fmt(p.paye)}</Text>
                        )}
                      </View>
                    </View>
                  ))}
                  {data.presences.some(p => (p.paye || 0) > 0) && (
                    <View style={[styles.detailRow, { borderBottomWidth: 0, marginTop: 8, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 }]}>
                      <Text style={[styles.detailLabel, { fontWeight: '700', color: '#1a1a1a' }]}>Total paies</Text>
                      <Text style={[styles.detailVal, { fontWeight: '700' }]}>
                        {fmt(data.presences.reduce((s, p) => s + (p.paye || 0), 0))}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Inventaire */}
              <Text style={styles.detailSection}>
                📦 Inventaire {data.inventaire?.valide ? '🔒' : '🔄'}
              </Text>
              {!data.inventaire ? (
                <View style={[styles.detailCard, { alignItems: 'center', paddingVertical: 16 }]}>
                  <Text style={{ color: '#aaa', fontSize: 13 }}>Aucun inventaire enregistré</Text>
                </View>
              ) : (
                <View style={styles.detailCard}>
                  {/* Statut + montant */}
                  <View style={[styles.detailRow, { borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 10, marginBottom: 4 }]}>
                    <View style={[styles.shiftValideBadge, {
                      backgroundColor: data.inventaire.valide ? '#EAF3DE' : '#FAEEDA',
                    }]}>
                      <Text style={{
                        fontSize: 11, fontWeight: '600',
                        color: data.inventaire.valide ? '#3B6D11' : '#854F0B'
                      }}>
                        {data.inventaire.valide ? '🔒 Inventaire verrouillé' : '🔄 En cours'}
                      </Text>
                    </View>
                    {(data.inventaire.montant_a_deduire || 0) > 0 && (
                      <Text style={[styles.detailVal, { color: '#A32D2D', fontWeight: '700' }]}>
                        −{fmt(data.inventaire.montant_a_deduire)}
                      </Text>
                    )}
                  </View>

                  {/* En-tête colonnes */}
                  {(data.inventaire.inventaire_lignes || []).length > 0 && (
                    <View style={styles.invHeaderRow}>
                      <Text style={[styles.invCell, { flex: 2, fontWeight: '700' }]}>Produit</Text>
                      <Text style={[styles.invCellC, { fontWeight: '700' }]}>Init</Text>
                      <Text style={[styles.invCellC, { fontWeight: '700' }]}>Entr.</Text>
                      <Text style={[styles.invCellC, { fontWeight: '700' }]}>Sort.</Text>
                      <Text style={[styles.invCellC, { fontWeight: '700' }]}>Réel</Text>
                      <Text style={[styles.invCellC, { fontWeight: '700' }]}>Écart</Text>
                    </View>
                  )}

                  {(data.inventaire.inventaire_lignes || []).map((l, i, arr) => {
                    const ecart = l.ecart ?? ((l.stock_reel ?? 0) - (l.stock_initial ?? 0))
                    const ecartNeg = ecart < 0
                    const explication = String(l.explication || '').trim()
                    const nombreExplique = Number(l.nombre_explique ?? 0)
                    return (
                      <View key={l.produit_id || i} style={[
                        styles.invLigne,
                        i === arr.length - 1 && { borderBottomWidth: 0 }
                      ]}>
                        <View style={styles.invLigneRow}>
                          <Text style={[styles.invCell, { flex: 2 }]} numberOfLines={1}>
                            {l.produit_nom || l.produit_id}
                          </Text>
                          <Text style={styles.invCellC}>{l.stock_initial ?? '—'}</Text>
                          <Text style={[styles.invCellC, { color: (l.entrees || 0) > 0 ? '#3B6D11' : '#888' }]}>
                            {l.entrees > 0 ? `+${l.entrees}` : (l.entrees ?? '—')}
                          </Text>
                          <Text style={[styles.invCellC, { color: (l.sorties || 0) > 0 ? '#A32D2D' : '#888' }]}>
                            {l.sorties > 0 ? `-${l.sorties}` : (l.sorties ?? '—')}
                          </Text>
                          <Text style={styles.invCellC}>{l.stock_reel ?? '—'}</Text>
                          <Text style={[styles.invCellC, { color: ecartNeg ? '#A32D2D' : ecart > 0 ? '#3B6D11' : '#888', fontWeight: ecart !== 0 ? '600' : '400' }]}>
                            {ecart > 0 ? '+' : ''}{ecart}
                          </Text>
                        </View>

                      {(explication || nombreExplique > 0) && (
                        <Text style={styles.invExplication}>
                          {nombreExplique > 0 ? `Expliqué : ${nombreExplique}` : 'Expliqué'}
                          {explication ? ` — « ${explication} »` : ''}
                          {(l.montant_deduit || 0) > 0 ? ` · déduit ${fmt(l.montant_deduit)}` : ''}
                        </Text>
                      )}
                      </View>
                    )
                  })}

                  {/* Total déduit */}
                  {(data.inventaire.inventaire_lignes || []).some(l => l.montant_deduit > 0) && (
                    <View style={[styles.detailRow, { borderBottomWidth: 0, marginTop: 10, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 }]}>
                      <Text style={[styles.detailLabel, { fontWeight: '700', color: '#1a1a1a' }]}>Total déduit</Text>
                      <Text style={[styles.detailVal, { color: '#A32D2D', fontWeight: '700' }]}>
                        {fmt((data.inventaire.inventaire_lignes || []).reduce((s, l) => s + (l.montant_deduit || 0), 0))}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>

    {/* Modal photo plein écran */}
    <Modal visible={!!photoPleinEcranUrl} transparent animationType="fade">
      <View style={styles.photoPleinEcranOverlay}>
        <TouchableOpacity
          style={styles.photoPleinEcranClose}
          onPress={() => setPhotoPleinEcranUrl(null)}
        >
          <Text style={styles.photoPleinEcranCloseTxt}>✕</Text>
        </TouchableOpacity>
        {photoPleinEcranUrl && (
          <PhotoJustificatif
            uri={photoPleinEcranUrl}
            style={styles.photoPleinEcranImg}
            resizeMode="contain"
          />
        )}
      </View>
    </Modal>
    </>
  )
}

function makeStyles(colors) { return StyleSheet.create({
  loadingBox: { alignItems: 'center', paddingVertical: 40 },
  shiftValideBadge: { backgroundColor: '#EAF3DE', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  shiftValideTxt: { fontSize: 11, color: '#3B6D11', fontWeight: '500' },
  detailOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end',
  },
  detailModal: {
    backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '92%', flex: 0, minHeight: '60%',
  },
  detailHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: 20, paddingBottom: 14,
    backgroundColor: '#EF9F27', borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  detailCaissier: { fontSize: 16, fontWeight: '700', color: '#412402', marginBottom: 4 },
  detailHeures: { fontSize: 13, color: '#854F0B', fontWeight: '500' },
  detailDateInline: { fontSize: 12, color: '#854F0B', fontWeight: '400' },
  detailClose: { fontSize: 12, color: '#412402', fontWeight: '600', paddingTop: 2 },
  detailSection: {
    fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: 16, marginBottom: 6, paddingHorizontal: 16,
  },
  detailCard: {
    backgroundColor: colors.surface, marginHorizontal: 12, borderRadius: 14, padding: 14,
    borderWidth: 0.5, borderColor: colors.border,
  },
  detailRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.bg,
  },
  detailLabel: { fontSize: 13, color: colors.textMuted, flex: 1 },
  detailVal: { fontSize: 13, fontWeight: '500', color: colors.text },
  detailExplication: { flex: 1, textAlign: 'right', fontWeight: '400', fontStyle: 'italic', marginLeft: 12 },
  photosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoThumb: { width: 90, alignItems: 'center' },
  photoThumbImg: { width: 90, height: 70, borderRadius: 8, marginBottom: 4 },
  photoThumbLabel: { fontSize: 10, color: colors.textMuted, textAlign: 'center' },
  photoPleinEcranOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.96)',
    justifyContent: 'center', alignItems: 'center',
  },
  photoPleinEcranClose: {
    position: 'absolute', top: 55, right: 20, zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20,
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  photoPleinEcranCloseTxt: { fontSize: 20, color: '#fff', fontWeight: '700' },
  photoPleinEcranImg: { width: '100%', height: '80%' },
  invHeaderRow: {
    flexDirection: 'row', paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#ddd', marginBottom: 4,
  },
  invLigne: { borderBottomWidth: 0.5, borderBottomColor: colors.bg },
  invLigneRow: { flexDirection: 'row', paddingVertical: 7, alignItems: 'center' },
  invExplication: {
    fontSize: 11, color: colors.textMuted, fontStyle: 'italic',
    paddingBottom: 7, paddingRight: 4,
  },
  invCell: { fontSize: 12, color: colors.text, paddingRight: 4 },
  invCellC: { width: 44, fontSize: 12, color: colors.text, textAlign: 'center' },
}) }

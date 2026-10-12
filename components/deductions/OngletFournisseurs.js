// Onglet Fournisseurs des déductions gérant : une carte par fournisseur
// (dû, payé du jour, barre payé / dû, photo) ; toucher la carte ouvre la saisie.
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import { progressionFournisseur } from '../../lib/manquantsSaisie'
import { estPhotoValide } from '../../lib/photoQueue'
import { BarreProgression, BlocPhoto, Carte, Champ, Etiquette, Vide, useStyleChaleureux } from '../ui/StyleChaleureux'

export default function OngletFournisseurs({
  fournisseursList, fournisseursGerantCaisse, chargement, ouverts, basculer,
  getCreditVeille, majFournisseur, onPhoto, uploading, fmt,
  texteVide = 'Aucun fournisseur enregistré pour ce restaurant',
  sousTitre = null, // four => texte sous le nom (ex. « Ancien travailleur · parti le … »)
}) {
  const { p, styles } = useStyleChaleureux()
  if (chargement) return <ActivityIndicator color={p.accentVif} style={{ paddingVertical: 24 }} />
  if (fournisseursList.length === 0) return <Vide texte={texteVide} />

  return (
    <>
      {fournisseursList.map(four => {
        const data = fournisseursGerantCaisse[four.id] || {}
        const ouvert = ouverts.has(four.id)
        const creditV = getCreditVeille(four)
        const facture = parseFloat(data.montant_facture) || 0
        const prog = progressionFournisseur({ creditVeille: creditV, facture, paye: data.paye })
        const photoOk = estPhotoValide(data.photoUri)
        const saisi = facture > 0 || prog.paye > 0
        const maj = champ => v => majFournisseur(four.id, four.nom, champ, v)
        return (
          <Carte key={four.id} active={ouvert}>
            <TouchableOpacity onPress={() => basculer(four.id)} accessibilityRole="button"
              accessibilityState={{ expanded: ouvert }} accessibilityLabel={`${four.nom}, ${ouvert ? 'fermer' : 'saisir'}`}>
              <View style={styles.ligne}>
                <Text style={styles.carteTitre} numberOfLines={1}>{four.nom}</Text>
                {creditV > 0
                  ? <Etiquette ton="erreur" texte={`dû ${fmt(creditV)}`} />
                  : creditV < 0 ? <Etiquette ton="ok" texte={`avance ${fmt(-creditV)}`} /> : null}
              </View>
              {sousTitre?.(four) ? <Text style={styles.petitDoux}>{sousTitre(four)}</Text> : null}
              {four.caissier_facture > 0
                ? <Text style={styles.petitDoux}>dont facture caissier : {fmt(four.caissier_facture)}</Text>
                : null}
              {saisi ? (
                <>
                  <View style={[styles.ligne, { marginTop: 8 }]}>
                    <Text style={styles.texteDoux}>Payé aujourd'hui</Text>
                    <Text style={styles.montantFort}>{fmt(prog.paye)}</Text>
                  </View>
                  <BarreProgression ratio={prog.ratio} solde={prog.solde} />
                  <View style={[styles.ligne, { marginTop: 6 }]}>
                    <Text style={[styles.petitDoux, prog.solde && { color: p.ok, fontWeight: '700' }]}>
                      {prog.solde ? (prog.reste < 0 ? `Avance payée ${fmt(-prog.reste)}` : 'Soldé') : `Reste dû ${fmt(prog.reste)}`}
                    </Text>
                    {facture > 0
                      ? <Text style={[styles.petitFort, { color: photoOk ? p.ok : p.erreur }]}>{photoOk ? '● Photo OK' : '● Photo requise'}</Text>
                      : null}
                  </View>
                </>
              ) : (
                <Text style={styles.texteVide}>Rien saisi aujourd'hui · toucher pour saisir</Text>
              )}
            </TouchableOpacity>

            {ouvert ? (
              <View style={{ marginTop: 12, gap: 8 }}>
                <Champ value={data.facture_ref || ''} onChangeText={maj('facture_ref')} placeholder="N° facture / référence (optionnel)" />
                <View style={styles.ligneChamps}>
                  <Champ style={{ flex: 1 }} libelle="Facture du jour (FCFA)" keyboardType="numeric" placeholder="0"
                    value={data.montant_facture || ''} onChangeText={maj('montant_facture')} />
                  <Champ style={{ flex: 1 }} libelle="Payé ce jour (FCFA)" accent keyboardType="numeric" placeholder="0"
                    value={data.paye || ''} onChangeText={maj('paye')} />
                </View>
                <BlocPhoto uri={data.photoUri} valide={photoOk} requis={facture > 0} label="Justificatif facture"
                  onPress={() => onPhoto(four)} uploading={uploading} />
              </View>
            ) : null}
          </Carte>
        )
      })}
    </>
  )
}

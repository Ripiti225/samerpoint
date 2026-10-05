// Étape 1 de la saisie des ventes : livraisons TAB (Yango, Glovo) et récap des shifts.
import { Text, View } from 'react-native'
import { COEFFICIENTS } from '../../lib/constants'
import { Bandeau, BlocPhoto, Carte, Champ, Etiquette, LigneValeur, Rubrique, useStyleChaleureux } from '../ui/StyleChaleureux'

const CANAUX = [
  { cle: 'yango', titre: 'Yango TAB', coeff: COEFFICIENTS.YANGO, montant: 'yangoTab', nb: 'yangoNbCommandes', photo: 'photo_yango_tab', dossier: 'yango_tab' },
  { cle: 'glovo', titre: 'Glovo TAB', coeff: COEFFICIENTS.GLOVO, montant: 'glovoTab', nb: 'glovoNbCommandes', photo: 'photo_glovo_tab', dossier: 'glovo_tab' },
]
const virgule = n => String(n).replace('.', ',')

export default function EtapeTab({ ventesJour, setVente, setVentesJour, modifiable, cumulShifts, voitShifts, onPhoto, uploading, fmt }) {
  const { p, styles } = useStyleChaleureux()
  const recap = cumulShifts ? [
    { label: 'Dépenses + Fournisseurs', val: cumulShifts.depenses + cumulShifts.fournisseurs },
    { label: 'Yango CSE', val: cumulShifts.yangoCse },
    { label: 'Glovo CSE', val: cumulShifts.glovoCse },
    { label: 'Wave', val: cumulShifts.wave },
    { label: 'Orange Money', val: cumulShifts.om },
    { label: 'Djamo', val: cumulShifts.djamo },
    { label: 'KDO', val: cumulShifts.kdo },
    { label: 'Retours', val: cumulShifts.retour },
    { label: 'Espèces en caisse', val: cumulShifts.espece },
  ].filter(r => r.val > 0) : []

  return (
    <>
      {voitShifts && cumulShifts ? (
        <Bandeau ton="alerte" style={styles.bandeauDansCorps}
          texte={`${cumulShifts.nbShifts} shift(s) déjà intégrés : Yango/Glovo CSE, Wave, OM, Djamo, KDO, retours et espèces sont pré-chargés. Seuls les canaux TAB restent à saisir.`} />
      ) : null}

      <Rubrique>À saisir</Rubrique>
      {CANAUX.map(c => {
        const montant = parseFloat(ventesJour[c.montant]) || 0
        return (
          <Carte key={c.cle}>
            <View style={styles.ligne}>
              <Text style={styles.carteTitre}>🛵 {c.titre}</Text>
              <Etiquette texte={montant > 0 ? `×${virgule(c.coeff)} → ${fmt(montant * c.coeff)}` : `×${virgule(c.coeff)}`} />
            </View>
            <View style={[styles.ligneChamps, { marginTop: 10 }]}>
              <Champ style={{ flex: 2 }} libelle="Montant (FCFA)" grand keyboardType="numeric" placeholder="0"
                value={ventesJour[c.montant] || ''} onChangeText={v => setVente(c.montant, v)} editable={modifiable} />
              <Champ style={{ flex: 1 }} libelle="Nb commandes" grand keyboardType="numeric" placeholder="0"
                value={ventesJour[c.nb] || ''} onChangeText={v => setVente(c.nb, v)} editable={modifiable} />
            </View>
            <BlocPhoto uri={ventesJour[c.photo]} valide={!!ventesJour[c.photo]} requis={montant > 0}
              label={`Photo ${c.titre}`} modifiable={modifiable} uploading={uploading}
              onPress={() => onPhoto(url => setVentesJour(prev => ({ ...prev, [c.photo]: url })), c.dossier)} />
          </Carte>
        )
      })}

      {voitShifts && cumulShifts ? (
        <>
          <Rubrique>Récap shifts (auto)</Rubrique>
          <Carte>
            {recap.map(r => <LigneValeur key={r.label} libelle={r.label} valeur={fmt(r.val)} />)}
            <LigneValeur fort libelle="Vente shifts total" valeur={fmt(cumulShifts.venteTotal)} couleur={p.accent} />
          </Carte>
        </>
      ) : null}
    </>
  )
}

// Détail de l'état de salaire d'un restaurant pour un mois : lignes, actions
// selon le rôle et le statut, PDF. Les règles (fiches complètes, mois terminé,
// dû Trésorerie, réouverture) sont dans lib/paieDb.js.
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native'

import FeuilleLigne from './FeuilleLigne'
import { Bouton, Champ, Feuille, Info, useEcranModerne } from '../ui/EcranModerne'
import { aujourdhuiISO } from '../../lib/contrats'
import { estContractuel } from '../../lib/etatSalaire'
import { chargerEtatsDuMois, chargerLignes, libelleMois, preparerEtat, renvoyerEtat, rouvrirEtat, soumettreEtat, validerEtat } from '../../lib/paieDb'
import { telechargerBulletins, telechargerEtat } from '../../lib/pdfBulletin'

const F = v => `${Math.round(Number(v) || 0).toLocaleString('fr-FR')} F`

export default function DetailEtat({ visible, resto, mois, ctx, estManager, onFermer }) {
  const { styles, colors, accent } = useEcranModerne('orange')
  const [etat, setEtat] = useState(null)
  const [lignes, setLignes] = useState([])
  const [chargement, setChargement] = useState(true)
  const [occupe, setOccupe] = useState(false)
  const [ligneOuverte, setLigneOuverte] = useState(null)
  const [renvoi, setRenvoi] = useState(false)
  const [motif, setMotif] = useState('')

  useEffect(() => { if (visible && resto) charger() }, [visible, resto?.id, mois])

  async function charger() {
    setChargement(true)
    setRenvoi(false); setMotif('')
    try {
      const e = (await chargerEtatsDuMois(mois))[resto.id] || null
      setEtat(e)
      setLignes(e ? await chargerLignes(e.id) : [])
    } catch (e) {
      Alert.alert('Salaires', e.message)
    } finally {
      setChargement(false)
    }
  }

  async function agir(action, succes) {
    setOccupe(true)
    try {
      const r = await action()
      await charger()
      if (r?.avertissement) Alert.alert('Attention', r.avertissement)
      else if (succes) Alert.alert('Salaires', succes)
    } catch (e) {
      Alert.alert('Salaires', e.message)
    } finally {
      setOccupe(false)
    }
  }

  const preparer = (saisies = {}) => agir(() => preparerEtat({ resto, mois, saisies }, ctx))
  const statut = etat?.statut || null
  const bulletins = lignes.filter(l => l.bulletin).map(l => l.bulletin)

  if (!resto) return null
  return (
    <>
    <Feuille visible={visible} styles={styles} onFermer={onFermer} titre={resto.nom}
      sous={`État de salaire — ${libelleMois(mois)}${etat?.valide_par_nom ? ` · validé par ${etat.valide_par_nom}` : ''}`}>
      {chargement ? <ActivityIndicator size="large" color={accent} /> : (
        <>
          {etat && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {[['Reste à payer', etat.totaux?.reste_a_payer], ['Déjà versé', etat.totaux?.deja_verse], ['Brut bulletins', etat.totaux?.brut], ['Charges patronales', etat.totaux?.charges_patronales]].map(([l, v]) => (
                <View key={l} style={{ minWidth: 140, flex: 1, padding: 10, borderRadius: 12, backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>{l}</Text>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{F(v)}</Text>
                </View>
              ))}
            </View>
          )}
          {etat?.renvoi_motif && statut === 'brouillon'
            ? <Info icone="↩️" styles={styles} couleur="#C2410C">Renvoyé par le manager : {etat.renvoi_motif}</Info>
            : null}

          {lignes.map(l => (
            <TouchableOpacity key={l.id} disabled={statut !== 'brouillon' || estManager} onPress={() => setLigneOuverte(l)}
              style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>
                  {l.nom} <Text style={{ color: colors.textMuted, fontWeight: '400' }}>· {l.type_contrat || 'Stage'}</Text>
                </Text>
                <Text style={{ color: l.reste_a_payer > 0 ? accent : colors.textMuted, fontWeight: '800' }}>{F(l.reste_a_payer)}</Text>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                {l.jours_pointes} j pointés · {l.absences_non_justifiees} absence(s) · dû {F(l.du)} · versé {F(l.deja_verse)}
                {l.bulletin ? ` · net bulletin ${F(l.bulletin.calcul.net)}` : ''}
              </Text>
              {estContractuel(l.type_contrat) && !l.bulletin
                ? <Text style={{ color: '#C2410C', fontSize: 12, marginTop: 2 }}>⚠ Fiche paie incomplète : pas de bulletin</Text>
                : null}
            </TouchableOpacity>
          ))}

          <View style={{ gap: 10, marginTop: 16 }}>
            {!estManager && (statut === null || statut === 'brouillon') && (
              <Bouton styles={styles} grand couleur={accent} variante="teinte" disabled={occupe}
                label={statut ? '🔄 Recalculer' : '🧮 Préparer l\'état'} onPress={() => preparer()} />
            )}
            {!estManager && statut === 'brouillon' && (
              <Bouton styles={styles} grand couleur={accent} variante="plein" disabled={occupe} label="📤 Soumettre au manager"
                onPress={() => agir(() => soumettreEtat({ etat, lignes, resto }, ctx, aujourdhuiISO()), 'État envoyé au manager.')} />
            )}
            {estManager && statut === 'soumis' && !renvoi && (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Bouton styles={styles} flex couleur="#B91C1C" variante="contour" disabled={occupe} label="↩️ Renvoyer" onPress={() => setRenvoi(true)} />
                <Bouton styles={styles} flex couleur="#047857" variante="plein" disabled={occupe} label="✅ Valider"
                  onPress={() => agir(() => validerEtat({ etat, resto }, ctx), 'État validé : le reste à payer est dans Trésorerie.')} />
              </View>
            )}
            {renvoi && (
              <>
                <Champ styles={styles} colors={colors} multiline value={motif} onChangeText={setMotif} placeholder="Ce qu'il faut corriger" />
                <Bouton styles={styles} grand couleur="#B91C1C" variante="plein" disabled={occupe} label="Renvoyer à la RH"
                  onPress={() => agir(() => renvoyerEtat({ etat, resto }, motif, ctx), 'État renvoyé à la RH.')} />
              </>
            )}
            {statut === 'valide' && (
              <>
                <Bouton styles={styles} grand couleur={accent} variante="plein" disabled={occupe || !bulletins.length} label={`🧾 Bulletins PDF (${bulletins.length})`}
                  onPress={() => telechargerBulletins(bulletins, `Bulletins-${resto.nom}-${mois.slice(0, 7)}.pdf`.replace(/\s+/g, '-')).catch(e => Alert.alert('PDF', e.message))} />
                <Bouton styles={styles} grand couleur={accent} variante="teinte" disabled={occupe} label="📄 État PDF"
                  onPress={() => telechargerEtat({ resto, etat, lignes }).catch(e => Alert.alert('PDF', e.message))} />
                {estManager && (
                  <Bouton styles={styles} couleur="#B91C1C" variante="contour" disabled={occupe} label="Rouvrir l'état"
                    onPress={() => agir(() => rouvrirEtat({ etat, resto }, ctx), 'État rouvert : la RH peut le corriger.')} />
                )}
              </>
            )}
            {statut === 'soumis' && !estManager && <Info icone="⏳" styles={styles}>En attente de validation par le manager.</Info>}
          </View>
        </>
      )}

    </Feuille>
    <FeuilleLigne visible={!!ligneOuverte} ligne={ligneOuverte} mois={mois} onFermer={() => setLigneOuverte(null)}
      onEnregistrer={async saisies => {
        const id = ligneOuverte.travailleur_id
        setLigneOuverte(null)
        await preparer({ [id]: saisies })
      }} />
    </>
  )
}

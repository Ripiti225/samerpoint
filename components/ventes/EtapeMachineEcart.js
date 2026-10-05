// Étape 3 de la saisie des ventes : vente machine (saisie ou 🔒 POS), clôtures
// POS (rapport Z), écart historique, explication, responsables et photos.
// Mêmes conditions d'affichage qu'avant la refonte (voir app/ventes.js).
import { Text, TouchableOpacity, View } from 'react-native'
import PhotoJustificatif from '../PhotoJustificatif'
import {
  Bandeau, BarreProgression, BlocPhoto, BoutonSecondaire, Carte, Champ, Etiquette, LigneValeur, Rubrique, Vide,
  useStyleChaleureux,
} from '../ui/StyleChaleureux'

function Justification({
  ventesJour, setVente, ecart, modifiable, responsablesDispo, onChoisirResponsable, onMontantResponsable,
  onRetirerResponsable, onAjouterPhotoEcart, onRetirerPhotoEcart, onPhoto, uploading, fmt,
}) {
  const { p, styles } = useStyleChaleureux()
  const libelle = ecart < 0 ? 'manquant' : 'surplus'
  const montantEcart = Math.abs(ecart)
  const responsables = ventesJour.ecartResponsables || []
  const totalImpute = responsables.reduce((s, r) => s + (parseFloat(r.montant) || 0), 0)
  const reste = montantEcart - totalImpute
  const complet = Math.round(reste) === 0
  const photos = ventesJour.ecartPhotos || []
  const longueur = (ventesJour.explicacionEcartMachine || '').trim().length

  return (
    <Carte style={{ borderWidth: 1, borderColor: p.erreur + '66' }}>
      <Rubrique>📝 Explication obligatoire</Rubrique>
      <Text style={styles.petitDoux}>Justifiez l'écart avant de continuer (min. 10 caractères)</Text>
      <Champ multiline style={{ marginTop: 8 }} value={ventesJour.explicacionEcartMachine || ''}
        onChangeText={v => setVente('explicacionEcartMachine', v)}
        placeholder="Ex : Erreur de saisie caissier, remboursement client..." editable={modifiable} />
      {longueur > 0 ? (
        <Text style={[styles.petitFort, { marginTop: 4, color: longueur >= 10 ? p.ok : p.erreur }]}>
          {longueur}/10 caractères minimum {longueur >= 10 ? '✅' : ''}
        </Text>
      ) : null}

      <Rubrique>👤 Responsables du {libelle}</Rubrique>
      <Text style={styles.petitDoux}>Répartissez le {libelle} de {fmt(montantEcart)} entre les responsables.</Text>
      {responsables.map(r => (
        <View key={r.travailleur_id} style={[styles.ligneChamps, { marginTop: 8, alignItems: 'center' }]}>
          <Text style={[styles.texte, { flex: 1, fontWeight: '600' }]} numberOfLines={1}>{r.nom}</Text>
          <Champ style={{ width: 120 }} keyboardType="numeric" placeholder="Montant" value={String(r.montant ?? '')}
            onChangeText={v => onMontantResponsable(r.travailleur_id, v.replace(/[^0-9]/g, ''))} editable={modifiable} />
          {modifiable ? (
            <TouchableOpacity onPress={() => onRetirerResponsable(r.travailleur_id)} hitSlop={8}
              accessibilityRole="button" accessibilityLabel={`Retirer ${r.nom}`}>
              <Text style={styles.supprimer}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
      <BarreProgression ratio={montantEcart > 0 ? totalImpute / montantEcart : 1} solde={complet} />
      <Text style={[styles.petitFort, { marginTop: 5, color: complet ? p.ok : p.erreur }]}>
        {complet
          ? `✅ Réparti : ${fmt(totalImpute)} / ${fmt(montantEcart)}`
          : `Réparti : ${fmt(totalImpute)} / ${fmt(montantEcart)} — reste ${fmt(reste)}`}
      </Text>
      {modifiable && responsablesDispo.length > 0 ? (
        <BoutonSecondaire label="+ Ajouter un responsable" onPress={onChoisirResponsable} style={{ marginTop: 10 }} />
      ) : null}

      <Rubrique>📷 Photos justificatives</Rubrique>
      <Text style={styles.petitDoux}>Optionnel — ajoutez une ou plusieurs photos.</Text>
      <View style={styles.vignettes}>
        {photos.map((uri, i) => (
          <View key={uri + i} style={styles.vignette}>
            <PhotoJustificatif uri={uri} style={styles.vignetteImage} compact />
            {modifiable ? (
              <TouchableOpacity style={styles.vignetteRetirer} onPress={() => onRetirerPhotoEcart(i)}
                accessibilityRole="button" accessibilityLabel="Retirer la photo">
                <Text style={styles.vignetteRetirerTxt}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {modifiable ? (
          <TouchableOpacity style={styles.vignetteAjout} disabled={uploading} onPress={() => onPhoto(onAjouterPhotoEcart, 'ecart-manquant')}
            accessibilityRole="button" accessibilityLabel="Ajouter une photo justificative">
            <Text style={styles.vignetteAjoutTxt}>{uploading ? '…' : '＋'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Carte>
  )
}

export default function EtapeMachineEcart(props) {
  const {
    ventesJour, setVente, setVentesJour, modifiable, cumulShifts, voitMachine, venteMachineDuPOS, saisieManuelle,
    secoursDisponible, onSecours, venteMachineRecue, venteMachineDuSysteme, onPhoto, uploading, fmt,
  } = props
  const { p, styles } = useStyleChaleureux()
  if (!voitMachine) return <Vide texte="La vente machine est saisie par le gérant." />

  const machine = parseFloat(ventesJour.venteMachine) || 0
  const ecart = cumulShifts ? cumulShifts.venteTotal - machine : 0
  const clotures = cumulShifts?.cloturesPOS || []
  const couleurEcart = v => (v == null ? p.texteDoux : v < 0 ? p.erreur : v > 0 ? p.ok : p.texteDoux)
  const verrouPOS = venteMachineDuPOS && !saisieManuelle
  const ecartHistorique = venteMachineRecue && cumulShifts && clotures.length === 0
  const aJustifier = venteMachineRecue && !venteMachineDuSysteme && cumulShifts && ecart !== 0 && modifiable
  const indispo = cumulShifts?.ecartsGlobaux?.indisponibles || 0

  return (
    <>
      <Carte>
        {cumulShifts ? <LigneValeur libelle="Vente théorique" etiquette="shifts" valeur={fmt(cumulShifts.venteTotal)} /> : null}
        <View style={{ marginTop: 8 }}>
          <Text style={[styles.texte, { fontWeight: '700' }]}>Vente machine</Text>
          <Text style={styles.petitDoux}>{venteMachineDuPOS ? 'Remplie automatiquement par le POS' : 'Montant lu sur la caisse / POS'}</Text>
          {verrouPOS ? (
            <>
              <Text style={[styles.enormeChiffre, !venteMachineRecue && { color: p.texteVide, fontSize: 16 }]}>
                {venteMachineRecue ? fmt(machine) : 'En attente du POS'}
              </Text>
              <Text style={styles.petitDoux}>🔒 Rempli par le POS</Text>
              {secoursDisponible ? (
                <BoutonSecondaire label="Saisir manuellement" onPress={onSecours} style={{ marginTop: 10, marginBottom: 0 }} />
              ) : null}
            </>
          ) : (
            <Champ style={{ marginTop: 8 }} grand accent keyboardType="numeric" placeholder="Saisir…"
              value={ventesJour.venteMachine || ''} onChangeText={v => setVente('venteMachine', v)} editable={modifiable} />
          )}
        </View>
        {!venteMachineDuSysteme && modifiable ? (
          <BlocPhoto uri={ventesJour.photoVenteMachine} valide={!!ventesJour.photoVenteMachine} requis label="Photo vente machine"
            uploading={uploading} onPress={() => onPhoto(url => setVentesJour(prev => ({ ...prev, photoVenteMachine: url })), 'vente-machine')} />
        ) : null}
      </Carte>

      {clotures.length > 0 ? (
        <Carte>
          <View style={styles.ligne}>
            <Rubrique>Clôtures de caisse POS</Rubrique>
            <Etiquette texte="Rapport Z" />
          </View>
          {clotures.map((c, i) => (
            <View key={c.pos_service_id || c.id || i} style={{ paddingVertical: 7 }}>
              <View style={styles.ligne}>
                <Text style={[styles.texte, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>
                  {c.caissier_nom || 'Caissier non identifié'}
                </Text>
                <Text style={[styles.petitFort, { fontSize: 12.5, color: couleurEcart(c.ecartGlobal) }]}>Écart global · {c.ecartGlobalTexte}</Text>
              </View>
              <Text style={styles.petitDoux}>Écart espèces · {c.ecartEspecesTexte}</Text>
              {c.explication_ecart ? <Text style={[styles.petitDoux, { fontStyle: 'italic' }]}>« {c.explication_ecart} »</Text> : null}
            </View>
          ))}
          <LigneValeur fort libelle="Écart global" valeur={cumulShifts.ecartsGlobaux.totalTexte} couleur={couleurEcart(cumulShifts.ecartsGlobaux.total)} />
          {indispo > 0 ? (
            <Text style={styles.petitDoux}>
              {indispo} clôture{indispo > 1 ? 's historiques exclues' : ' historique exclue'} du total : rapport Z non disponible.
            </Text>
          ) : null}
        </Carte>
      ) : null}

      {ecartHistorique ? (
        <Bandeau style={styles.bandeauDansCorps} ton={ecart === 0 ? 'ok' : ecart > 0 ? 'info' : 'erreur'}
          texte={`${ecart === 0 ? '✅ Aucun écart' : ecart > 0 ? '📈 Surplus' : '📉 Manquant'} — Écart : ${ecart >= 0 ? '+' : ''}${fmt(ecart)}`} />
      ) : null}

      {aJustifier ? <Justification {...props} ecart={ecart} /> : null}
    </>
  )
}

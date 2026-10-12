// Cartes d'une demande et d'une demande d'explication, communes aux écrans
// gérant et direction/RH. Les actions propres à chaque écran passent en `children`.
import { Text, TouchableOpacity, View } from 'react-native'
import { TYPES_DEMANDE } from '../../lib/constants'
import { STATUTS_DEMANDE, STATUTS_EXPLICATION, enRetard, fmtDate, fmtMontant } from '../../lib/demandes'
import { Info, Pastille, teinte } from '../ui/EcranModerne'

// `focus` (facultatif) : useFocusRecherche() de l'écran, pour encadrer la carte
// ouverte depuis la recherche globale.
export function CarteDemande({ d, restoNom, styles, children, focus }) {
  const cfg = STATUTS_DEMANDE[d.statut] || STATUTS_DEMANDE.en_attente
  const icone = TYPES_DEMANDE.find(t => t.label === d.type)?.icon || '📋'
  return (
    <View {...focus?.props(d.id)} style={[styles.carte, focus?.style(d.id)]}>
      <View style={styles.carteTop}>
        <View style={[styles.bulle, { backgroundColor: teinte(cfg.couleur, '1C') }]}><Text style={styles.bulleTxt}>{icone}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.carteTitre}>{d.travailleur_nom}</Text>
          <Text style={styles.carteSous}>{d.type}{restoNom ? ` · ${restoNom}` : ''}</Text>
        </View>
      </View>
      <Pastille cfg={cfg} styles={styles} />

      <View style={styles.carteCorps}>
        {d.date_debut ? <Info icone="📅" styles={styles}>{fmtDate(d.date_debut)} → {fmtDate(d.date_fin)}</Info> : null}
        {d.montant > 0 ? <Info icone="💰" styles={styles} couleur="#3B8D2F" gras>Demandé : {fmtMontant(d.montant)}</Info> : null}
        {d.statut === 'validee' && d.montant_alloue > 0
          ? <Info icone="✅" styles={styles} couleur="#3B8D2F" gras>Alloué : {fmtMontant(d.montant_alloue)}</Info> : null}
        {d.description ? <Text style={styles.citation}>« {d.description} »</Text> : null}
        <Info icone="🕒" styles={styles}>Le {fmtDate(d.created_at)}{d.cree_par_nom ? ` · par ${d.cree_par_nom}` : ''}</Info>
        {d.statut === 'validee' && d.traite_par_nom ? <Info icone="👍" styles={styles}>Validée par {d.traite_par_nom}</Info> : null}
        {d.statut === 'annulee' && d.annule_par_nom ? <Info icone="🚫" styles={styles}>Annulée par {d.annule_par_nom}</Info> : null}
        {d.statut === 'declinee' ? (
          <View style={styles.refus}>
            <Text style={styles.refusTitre}>Motif du refus</Text>
            <Text style={styles.refusTxt}>{d.motif_decline}</Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  )
}

export function CarteExplication({ d, restoNom, styles, onVoirReponse, libelleReponse, children, focus }) {
  const cfg = STATUTS_EXPLICATION[d.statut] || STATUTS_EXPLICATION.en_attente_acceptation
  const retard = enRetard(d)
  return (
    <View {...focus?.props(d.id)} style={[styles.carte, retard && styles.carteAlerte, focus?.style(d.id)]}>
      <View style={styles.carteTop}>
        <View style={[styles.bulle, { backgroundColor: teinte(cfg.couleur, '1C') }]}><Text style={styles.bulleTxt}>📨</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.carteTitre}>{d.travailleur_nom}</Text>
          <Text style={styles.carteSous}>
            {[d.travailleur_poste, restoNom, d.numero > 1 ? `relance n° ${d.numero}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Pastille cfg={cfg} styles={styles} />
        {retard ? <Pastille cfg={{ emoji: '⏰', label: 'Plus de 3 jours sans réponse', couleur: '#C27C1A' }} styles={styles} /> : null}
      </View>

      <View style={styles.carteCorps}>
        <Text style={[styles.carteTitre, { fontSize: 14, fontWeight: '700' }]}>{d.motif}</Text>
        {d.description ? <Text style={styles.citation}>« {d.description} »</Text> : null}
        <Info icone="🕒" styles={styles}>Le {fmtDate(d.created_at)}{d.cree_par_nom ? ` · par ${d.cree_par_nom}` : ''}</Info>
        {d.accepte_par_nom && d.statut === 'acceptee' ? <Info icone="👍" styles={styles}>Acceptée par {d.accepte_par_nom}</Info> : null}
        {d.envoyee_at ? <Info icone="📤" styles={styles}>Envoyée le {fmtDate(d.envoyee_at)}</Info> : null}
        {d.statut === 'reponse_recuperee' ? (
          <Info icone="✅" styles={styles} couleur="#3B8D2F">
            Réponse récupérée le {fmtDate(d.reponse_recuperee_at)}{d.reponse_note ? ` — ${d.reponse_note}` : ''}
          </Info>
        ) : null}
        {d.statut === 'refusee' ? (
          <View style={styles.refus}>
            <Text style={styles.refusTitre}>Motif du refus</Text>
            <Text style={styles.refusTxt}>{d.refus_motif}</Text>
          </View>
        ) : null}
        {d.reponse_fichier_url ? (
          <TouchableOpacity onPress={() => onVoirReponse(d.reponse_fichier_url)}
            style={[styles.bouton, { backgroundColor: teinte('#3B8D2F', '1C'), marginTop: 6 }]}>
            <Text style={[styles.boutonTxt, { color: '#3B8D2F' }]}>
              {d.reponse_fichier_type === 'pdf' ? '📄' : '🖼️'} {libelleReponse}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {children}
    </View>
  )
}


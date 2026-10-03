// Styles partagés de l'écran Équipe globale (design de l'ex-écran RH, modernisé).
// Les teintes claires sont obtenues par transparence (`${couleur}1F`) pour rester
// lisibles en mode sombre comme en mode clair.
import { StyleSheet } from 'react-native'
import { BLEU } from '../../lib/equipe'

export const teinte = (couleur, alpha = '1F') => `${couleur}${alpha}`

export function makeStyles(colors) {
  const carte = {
    backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.borderLight,
    shadowColor: colors.cardShadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 1,
  }
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },

    // ── En-tête ──
    header: {
      backgroundColor: BLEU, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderBottomLeftRadius: 22, borderBottomRightRadius: 22,
    },
    back: { fontSize: 16, color: '#D6E6F8', fontWeight: '600' },
    headerTitre: { fontSize: 17, fontWeight: '800', color: '#fff', textAlign: 'center', letterSpacing: -0.2 },
    headerSub: { fontSize: 12, color: '#D6E6F8', marginTop: 2, textAlign: 'center' },
    logoutBtn: { backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
    logoutTxt: { fontSize: 12, color: '#fff', fontWeight: '600' },

    // ── Recherche & filtres ──
    searchWrap: { paddingHorizontal: 14, paddingTop: 12 },
    searchInput: {
      backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
      fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.borderLight,
    },
    chipsBar: { flexGrow: 0, marginTop: 10 },
    chipsContent: { paddingHorizontal: 14, gap: 8 },
    chip: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight,
    },
    chipActive: { backgroundColor: BLEU, borderColor: BLEU },
    chipTxt: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    chipTxtActive: { color: '#fff' },
    chipPetit: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
    chipPetitActive: { backgroundColor: teinte(BLEU), borderColor: BLEU },
    chipPetitTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    chipPetitTxtActive: { color: BLEU },
    periodeInfo: { paddingHorizontal: 16, marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
    periodeInfoTxt: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
    periodeInfoSub: { fontSize: 11, color: colors.textMuted },

    // ── Onglets en pastilles ──
    ongletsWrap: { marginHorizontal: 14, marginTop: 10, backgroundColor: colors.surfaceAlt, borderRadius: 16, padding: 4 },
    ongletsContent: { flexGrow: 1, gap: 4 },
    onglet: { flexGrow: 1, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, alignItems: 'center' },
    ongletActive: { backgroundColor: colors.surface, shadowColor: colors.cardShadow, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
    ongletTxt: { fontSize: 12.5, color: colors.textMuted, fontWeight: '600' },
    ongletTxtActive: { color: BLEU, fontWeight: '800' },

    loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
    loadingTxt: { fontSize: 13, color: colors.textMuted, marginTop: 12 },
    body: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
    sectionTitre: {
      fontSize: 12, fontWeight: '700', color: colors.textMuted,
      marginBottom: 10, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.6,
    },
    emptyBox: { alignItems: 'center', paddingVertical: 40 },
    emptyIcon: { fontSize: 40, marginBottom: 12 },
    emptyTxt: { fontSize: 14, color: colors.textMuted, fontWeight: '600' },
    emptySub: { fontSize: 12, color: colors.textPlaceholder, marginTop: 6, textAlign: 'center' },

    // ── Boutons ──
    btnPlein: { backgroundColor: BLEU, borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
    btnPleinTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
    btnTeinte: { backgroundColor: teinte(BLEU), borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center' },
    btnTeinteTxt: { fontSize: 14, fontWeight: '700', color: BLEU },
    btnPointille: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: BLEU, borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 14 },
    btnPointilleTxt: { fontSize: 14, color: BLEU, fontWeight: '700' },
    petitBtn: { backgroundColor: teinte(BLEU), paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
    petitBtnTxt: { fontSize: 11.5, color: BLEU, fontWeight: '700' },
    menuBtn: { backgroundColor: colors.surfaceAlt, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
    menuBtnTxt: { fontSize: 16, color: colors.textMuted, fontWeight: '700' },

    // ── Dashboard ──
    kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
    kpiCard: { ...carte, flexBasis: '45%', flexGrow: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
    kpiIconBox: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    kpiIcon: { fontSize: 19 },
    kpiValue: { fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
    kpiLabel: { fontSize: 11.5, color: colors.textMuted, marginTop: 1, fontWeight: '600' },
    heroCard: { backgroundColor: BLEU, borderRadius: 20, padding: 18, marginBottom: 14 },
    heroTitre: { fontSize: 13, color: '#D6E6F8', fontWeight: '600' },
    heroValeur: { fontSize: 28, fontWeight: '800', color: '#fff', marginTop: 6, letterSpacing: -0.6 },
    heroSub: { fontSize: 12, color: '#D6E6F8', marginTop: 4 },
    heroLignes: { flexDirection: 'row', gap: 10, marginTop: 14 },
    heroLigne: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 12, padding: 10 },
    heroLigneLabel: { fontSize: 11, color: '#D6E6F8' },
    heroLigneVal: { fontSize: 14, color: '#fff', fontWeight: '800', marginTop: 2 },

    // ── Cartes génériques ──
    carte: { ...carte, padding: 14, marginBottom: 10 },
    carteListe: { ...carte, paddingHorizontal: 14, paddingVertical: 4, marginBottom: 14 },
    ligne: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.borderLight, gap: 10 },
    ligneGauche: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    nom: { fontSize: 14, fontWeight: '700', color: colors.text },
    sousNom: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    lien: { fontSize: 12, color: BLEU, marginTop: 2, fontWeight: '600' },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
    badge: { backgroundColor: colors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
    badgeTxt: { fontSize: 10.5, color: colors.textSecondary, fontWeight: '600' },
    badgeBleu: { backgroundColor: teinte(BLEU), paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
    badgeBleuTxt: { fontSize: 10.5, color: BLEU, fontWeight: '700' },
    pct: { fontSize: 18, fontWeight: '800' },
    voirDetail: { fontSize: 11, color: BLEU, marginTop: 2, fontWeight: '600' },
    barreFond: { height: 8, backgroundColor: colors.surfaceAlt, borderRadius: 4, overflow: 'hidden', marginTop: 10, marginBottom: 8 },
    barreFill: { height: '100%', borderRadius: 4 },
    miniStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    miniStat: { fontSize: 11.5, fontWeight: '600' },
    statutPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    statutPillTxt: { fontSize: 11.5, fontWeight: '700' },

    // ── Présences ──
    dateTitre: { fontSize: 12, fontWeight: '800', color: BLEU, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
    shift: { fontSize: 11, color: '#6C63E0', marginTop: 2 },
    paie: { fontSize: 11.5, color: '#3B8D2F', marginTop: 2, fontWeight: '600' },

    // ── Salaires ──
    salaireBarre: { height: 5, backgroundColor: colors.surfaceAlt, borderRadius: 3, overflow: 'hidden', marginTop: 6 },
    salaireBarreFill: { height: '100%', backgroundColor: BLEU, borderRadius: 3 },
    montant: { fontSize: 14, fontWeight: '800', color: BLEU },
    montantPct: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
    totalLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
    totalVal: { fontSize: 16, fontWeight: '800', color: BLEU },

    // ── Archivés ──
    archiveMotif: { backgroundColor: teinte('#C2462B'), borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 5 },
    archiveMotifTxt: { fontSize: 11, color: '#C2462B', fontWeight: '700' },
    btnVert: { backgroundColor: teinte('#3B8D2F'), borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center' },
    btnVertTxt: { fontSize: 12, color: '#3B8D2F', fontWeight: '700' },
    btnRouge: { backgroundColor: teinte('#C2462B'), borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center' },
    btnRougeTxt: { fontSize: 12, color: '#C2462B', fontWeight: '700' },

    // ── Modales ──
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modal: { backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, paddingBottom: 36, maxHeight: '92%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    modalTitre: { fontSize: 18, fontWeight: '800', color: colors.text, flex: 1 },
    modalClose: { fontSize: 18, color: colors.textMuted, padding: 4 },
    modalLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.6, marginBottom: 6, textTransform: 'uppercase' },
    modalInput: { backgroundColor: colors.bg, borderRadius: 12, padding: 14, fontSize: 15, color: colors.text, marginBottom: 14 },
    modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
    modalCancel: { flex: 1, padding: 14, borderRadius: 14, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
    modalCancelTxt: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
    modalConfirm: { flex: 2, padding: 14, borderRadius: 14, backgroundColor: BLEU, alignItems: 'center' },
    modalConfirmTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
    choix: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.borderLight, marginBottom: 8 },
    choixActive: { backgroundColor: BLEU, borderColor: BLEU },
    choixTxt: { fontSize: 14, color: colors.text, fontWeight: '600' },
    choixTxtActive: { color: '#fff', fontWeight: '700' },
    motifBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.borderLight },
    motifBtnActive: { backgroundColor: BLEU, borderColor: BLEU },
    motifTxt: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    motifTxtActive: { color: '#fff' },
    etapeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    etapeBadge: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, backgroundColor: colors.bg, alignItems: 'center' },
    etapeBadgeActive: { backgroundColor: BLEU },
    etapeTxt: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    etapeTxtActive: { color: '#fff' },
    etapeLine: { width: 20, height: 1, backgroundColor: colors.border, marginHorizontal: 4 },
    datesChoisies: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderRadius: 12, padding: 12, marginBottom: 14 },
    papierRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
    papierType: { fontSize: 13, color: colors.text, flex: 1, fontWeight: '600' },
    papierDone: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: teinte('#3B8D2F'), borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
    papierDoneTxt: { fontSize: 12, color: '#3B8D2F', fontWeight: '700' },
    papierRemove: { fontSize: 14, color: '#C2462B', fontWeight: '800' },
    photoProfilBox: { alignItems: 'center', marginBottom: 16 },
    photoProfil: { width: 76, height: 76, borderRadius: 38, marginBottom: 8 },
    photoProfilVide: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', marginBottom: 8, borderWidth: 1, borderColor: colors.borderLight },
  })
}

import { supabase } from './supabase';

export async function getOrCreatePoint(date, gerantId, restaurantId) {
  const { data: existing } = await supabase
    .from('points')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('date', date)
    .single()

  if (existing) return existing

  const { data: created, error } = await supabase
    .from('points')
    .insert({
      restaurant_id: restaurantId,
      date,
      gerant_id: gerantId,
      valide: false,
    })
    .select()
    .single()

  if (error) { console.error('Erreur création point:', error); return null }
  return created
}

export async function getDepenses(pointId) {
  const { data } = await supabase
    .from('depenses')
    .select('*')
    .eq('point_id', pointId)
    .order('created_at')
  return data || []
}

export async function saveDepenses(pointId, depensesJour, saisiPar = 'caissier', caissierNom = null) {
  // Supprimer uniquement les dépenses du même type
  await supabase
    .from('depenses')
    .delete()
    .eq('point_id', pointId)
    .eq('saisi_par', saisiPar)

  const lignes = []
  Object.entries(depensesJour).forEach(([categorie, items]) => {
    items.forEach(item => {
      if (item.montant && parseFloat(item.montant) > 0) {
        lignes.push({
          point_id: pointId,
          categorie,
          libelle: item.libelle || '',
          montant: parseFloat(item.montant) || 0,
          saisi_par: saisiPar,
          caissier_nom: caissierNom,
        })
      }
    })
  })
  if (lignes.length > 0) {
    await supabase.from('depenses').insert(lignes)
  }
}

export async function getPresences(pointId) {
  const { data } = await supabase
    .from('presences')
    .select('*')
    .eq('point_id', pointId)
  return data || []
}

export async function savePresences(pointId, travailleurs, presencesJour, paiesJour) {
  await supabase.from('presences').delete().eq('point_id', pointId)
  const lignes = travailleurs
    .filter(t => presencesJour[t.id])
    .map(t => ({
      point_id: pointId,
      travailleur_id: t.id,
      travailleur_nom: t.nom,
      statut: presencesJour[t.id] || 'Absent',
      paye: parseFloat(paiesJour[t.id]) || 0,
    }))
  if (lignes.length > 0) {
    await supabase.from('presences').insert(lignes)
  }
}

export async function getCommandes(pointId) {
  const { data } = await supabase
    .from('commandes')
    .select('*')
    .eq('point_id', pointId)
  return data || []
}

export async function saveCommandes(pointId, livraisonsJour) {
  await supabase.from('commandes').delete().eq('point_id', pointId)
  const lignes = []
  Object.entries(livraisonsJour).forEach(([partenaire, items]) => {
    items.forEach(item => {
      lignes.push({
        point_id: pointId,
        partenaire,
        numero_commande: item.numero || '',
        contact_client: item.contact || '',
        plat: item.plat || '',
      })
    })
  })
  if (lignes.length > 0) {
    await supabase.from('commandes').insert(lignes)
  }
}

export async function getTransactionsFournisseurs(pointId) {
  const { data } = await supabase
    .from('transactions_fournisseurs')
    .select('*')
    .eq('point_id', pointId)
  return data || []
}

export async function saveTransactionsFournisseurs(pointId, fournisseursJour, creditsVeille = {}) {
  await supabase.from('transactions_fournisseurs').delete().eq('point_id', pointId)
  const lignes = []
  Object.entries(fournisseursJour).forEach(([fournisseurId, t]) => {
    const credit = creditsVeille[fournisseurId] || 0
    const facture = parseFloat(t.facture) || 0
    const paye = parseFloat(t.paye) || 0
    if (facture || paye) {
      lignes.push({
        point_id: pointId,
        fournisseur_id: fournisseurId,
        facture,
        paye,
        reste: credit + facture - paye,
        photo_url: t.photoUri || null,
      })
    }
  })
  if (lignes.length > 0) {
    await supabase.from('transactions_fournisseurs').insert(lignes)
  }
}

export async function getSequences(pointId) {
  const { data } = await supabase
    .from('sequences')
    .select('*')
    .eq('point_id', pointId)
    .order('numero')
  return data || []
}

export async function saveSequences(pointId, sequences) {
  await supabase.from('sequences').delete().eq('point_id', pointId)
  const lignes = sequences
    .filter(s => s.montant && parseFloat(s.montant) > 0)
    .map((s, i) => ({
      point_id: pointId,
      numero: i + 1,
      montant: parseFloat(s.montant) || 0,
      photo_url: s.photo_url || null,
    }))
  if (lignes.length > 0) {
    await supabase.from('sequences').insert(lignes)
  }
}

export async function getDatesValidees(restaurantId) {
  const { data } = await supabase
    .from('points')
    .select('date')
    .eq('restaurant_id', restaurantId)
    .eq('valide', true)
  return (data || []).map(p => p.date)
}

export async function validerPoint(pointId, totaux) {
  const { error } = await supabase
    .from('points')
    .update({ ...totaux, valide: true })
    .eq('id', pointId)
  return !error
}

export async function updatePoint(pointId, data) {
  const { error } = await supabase
    .from('points')
    .update(data)
    .eq('id', pointId)
  return !error
}

export async function getPointsPeriode(restaurantId, dateDebut, dateFin) {
  const { data } = await supabase
    .from('points')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('valide', true)
    .gte('date', dateDebut)
    .lte('date', dateFin)
    .order('date')
  return data || []
}

export async function getInventaireShifts(pointId) {
  const { data } = await supabase
    .from('inventaires')
    .select('*')
    .eq('point_id', pointId)
    .order('shift_numero')
  return data || []
}

export async function saveInventaireShift(pointId, shift, stocks, categories) {
  await supabase.from('inventaires')
    .delete()
    .eq('point_id', pointId)
    .eq('shift_numero', shift.numero)

  const lignes = []
  categories.forEach(cat => {
    cat.produits.forEach(p => {
      const s = stocks[p.id]
      if (s && (s.initial || s.entrees || s.sorties || s.final)) {
        const initial = parseFloat(s.initial) || 0
        const entrees = parseFloat(s.entrees) || 0
        const sorties = parseFloat(s.sorties) || 0
        const final = parseFloat(s.final) || 0
        lignes.push({
          point_id: pointId,
          produit_id: p.id,
          produit_nom: p.nom,
          stock_initial: initial,
          entrees,
          sorties,
          stock_final: final,
          ecart: final - (initial + entrees - sorties),
          prevision: parseFloat(s.prevision) || 0,
          shift_numero: shift.numero,
          shift_nom: shift.nom,
          heure_debut: shift.heure_debut,
          heure_fin: shift.heure_fin,
        })
      }
    })
  })

  if (lignes.length > 0) {
    const { error } = await supabase.from('inventaires').insert(lignes)
    if (error) { console.error('Erreur save inventaire:', error); return false }
  }
  return true
}
const SUPABASE_URL = 'https://wlwotzxnzowbkbfcpnyi.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indsd290enhuem93YmtiZmNwbnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjQ1OTEsImV4cCI6MjA5MTQ0MDU5MX0.nioXBAKA05_zRIyTpJmV_d4JY5mCYueOt5cKIlL-NNk'

export async function uploadPhoto(uri, dossier = 'general') {
  try {
    console.log('🔄 Upload photo depuis:', uri)

    const ext = uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg'
    const nomFichier = `${dossier}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`

    const formData = new FormData()
    formData.append('file', {
      uri,
      name: nomFichier,
      type: contentType,
    })

    const response = await fetch(
      `${SUPABASE_URL}/storage/v1/object/photos/${nomFichier}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: formData,
      }
    )

    console.log('📤 Response status:', response.status)

    if (!response.ok) {
      const errText = await response.text()
      console.error('❌ Erreur upload:', errText)
      return null
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/photos/${nomFichier}`
    console.log('✅ Upload réussi:', publicUrl)
    return publicUrl

  } catch (err) {
    console.error('❌ Erreur uploadPhoto:', err)
    return null
  }
}
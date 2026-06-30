-- RPC atomique : upsert d'une transaction fournisseur (delete + insert dans une
-- seule transaction SQL). Appelé par saveOneTransactionFournisseur() dans lib/api.js.
-- Sans ce RPC, le code retombe sur un delete + insert en deux requêtes (fallback).
-- Réplique exactement la logique du fallback :
--   - supprime les lignes du point/fournisseur/saisi_par (et caissier_nom si fourni)
--   - n'insère rien si facture ET payé sont à zéro
--   - sinon insère la nouvelle ligne

CREATE OR REPLACE FUNCTION upsert_transaction_fournisseur(
  p_point_id        UUID,
  p_fournisseur_id  UUID,
  p_saisi_par       TEXT,
  p_caissier_nom    TEXT,
  p_facture         NUMERIC,
  p_paye            NUMERIC,
  p_reste           NUMERIC,
  p_fournisseur_nom TEXT,
  p_restaurant_id   UUID,
  p_caissier_id     UUID,
  p_photo_url       TEXT,
  p_source          TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM transactions_fournisseurs
  WHERE point_id = p_point_id
    AND fournisseur_id = p_fournisseur_id
    AND saisi_par = p_saisi_par
    AND (p_caissier_nom IS NULL OR caissier_nom = p_caissier_nom);

  -- Rien à enregistrer si aucune valeur : on s'arrête après la suppression.
  IF COALESCE(p_facture, 0) = 0 AND COALESCE(p_paye, 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO transactions_fournisseurs (
    point_id, fournisseur_id, fournisseur_nom, source, restaurant_id,
    caissier_id, facture, paye, reste, photo_url, saisi_par, caissier_nom
  ) VALUES (
    p_point_id, p_fournisseur_id, p_fournisseur_nom, p_source, p_restaurant_id,
    p_caissier_id, p_facture, p_paye, p_reste, p_photo_url, p_saisi_par, p_caissier_nom
  );
END;
$$;

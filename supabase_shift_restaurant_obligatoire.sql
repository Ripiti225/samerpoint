-- Un inventaire de shift ne doit jamais pouvoir naître sans restaurant.
--
-- Le 08/08/2026 à Al Kayan Yop, le shift 16h-00h a été créé avec restaurant_id
-- NULL : app/inventaire.js recopiait le restaurant depuis le contexte React, et
-- celui-ci était vide. AppContext.deconnecter() sauvegarde les données
-- opérationnelles « sans identité » : il conserve point_id, date et caissier,
-- mais PAS le restaurant. Après une restauration de session (rechargement iOS
-- Safari), l'écran repart donc avec un restaurant vide.
--
-- Conséquence : chargerStockInitial() cherche « le dernier shift validé DE CE
-- RESTAURANT » et n'a pas vu ce shift. La caissière de nuit a démarré sur le
-- stock final du shift 08h-16h — 16 poulets et 5 270 g de fromage de trop.
-- L'écran Vérification, lui, filtre par point_id : le shift y figurait
-- normalement, d'où un diagnostic trompeur.
--
-- Pourquoi le garde-fou est en base et pas seulement dans le code : les gérants
-- ne mettent pas leur application à jour. Un correctif uniquement JavaScript
-- laisserait les anciennes versions continuer à insérer des shifts orphelins.

-- ── 1. Rattrapage des lignes orphelines ─────────────────────────────────────
-- Le point porte toujours le bon restaurant. Ne modifie aucun chiffre
-- d'inventaire : seul le rattachement au restaurant est rétabli.
UPDATE inventaires_shifts s
SET    restaurant_id = p.restaurant_id
FROM   points p
WHERE  s.point_id = p.id
  AND  s.restaurant_id IS NULL;

-- ── 2. Garde-fou : le restaurant est déduit du point s'il arrive vide ───────
CREATE OR REPLACE FUNCTION inventaires_shifts_restaurant_depuis_point()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.restaurant_id IS NULL AND NEW.point_id IS NOT NULL THEN
    SELECT restaurant_id INTO NEW.restaurant_id FROM points WHERE id = NEW.point_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inv_shifts_restaurant ON inventaires_shifts;
CREATE TRIGGER trg_inv_shifts_restaurant
  BEFORE INSERT OR UPDATE ON inventaires_shifts
  FOR EACH ROW EXECUTE FUNCTION inventaires_shifts_restaurant_depuis_point();

-- ── 3. La colonne devient obligatoire ───────────────────────────────────────
-- Sans risque : le trigger ci-dessus la remplit toujours, et aucune des lignes
-- existantes n'a de point_id vide (vérifié sur les 1750 shifts de la base).
ALTER TABLE inventaires_shifts ALTER COLUMN restaurant_id SET NOT NULL;

-- Le stock initial cherche désormais le shift précédent en passant par le point
-- (app/inventaire.js), pour ne plus dépendre de la colonne du shift.
CREATE INDEX IF NOT EXISTS idx_inv_shifts_point_date ON inventaires_shifts (point_id, date);

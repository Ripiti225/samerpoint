-- =====================================================================
--  CONTACTS CLIENTS DU POS
--
--  Depuis la bascule POS, le numéro du client est saisi au POS et vit dans
--  le cloud POS (commandes.contact_client). Cette table en reçoit une copie,
--  pour que l'écran Contacts de Samtrackly puisse écrire aux clients.
--
--  Alimentée par la fonction `import-contacts-pos`, appelée à chaque shift
--  validé arrivant du POS (déclencheur ci-dessous). Une ligne = une commande
--  POS avec numéro ; pos_commande_id unique → aucun doublon, même si la
--  fonction relit plusieurs fois les mêmes jours.
--
--  La clé du déclencheur est la clé PUBLIQUE (anon) déjà présente dans l'app :
--  elle autorise seulement l'appel de la fonction, qui n'écrit que des copies
--  des numéros du POS. RLS ouvert comme le reste de l'app (allow_all).
--  Idempotent — rejouable sans risque.
-- =====================================================================

CREATE TABLE IF NOT EXISTS contacts_clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_commande_id uuid NOT NULL UNIQUE,
  numero          text NOT NULL,
  restaurant_id   uuid REFERENCES restaurants(id),
  date            date NOT NULL,
  commande_at     timestamptz NOT NULL,
  partenaire      text,
  pos_service_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_clients_resto_date ON contacts_clients (restaurant_id, date);
CREATE INDEX IF NOT EXISTS contacts_clients_numero ON contacts_clients (numero);
CREATE INDEX IF NOT EXISTS contacts_clients_commande_at ON contacts_clients (commande_at DESC);

ALTER TABLE contacts_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON contacts_clients;
CREATE POLICY allow_all ON contacts_clients FOR ALL USING (true) WITH CHECK (true);

-- Shift validé arrivé du POS → rapatrier ses numéros.
CREATE OR REPLACE FUNCTION contacts_pos_apres_shift() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://wlwotzxnzowbkbfcpnyi.supabase.co/functions/v1/import-contacts-pos',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indsd290enhuem93YmtiZmNwbnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjQ1OTEsImV4cCI6MjA5MTQ0MDU5MX0.nioXBAKA05_zRIyTpJmV_d4JY5mCYueOt5cKIlL-NNk"}'::jsonb,
    body := '{}'::jsonb
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- L'import ne doit jamais bloquer l'arrivée d'un shift.
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contacts_pos_apres_shift ON points_shifts;
CREATE TRIGGER contacts_pos_apres_shift
  AFTER INSERT ON points_shifts
  FOR EACH ROW
  WHEN (NEW.pos_service_id IS NOT NULL AND NEW.valide IS TRUE)
  EXECUTE FUNCTION contacts_pos_apres_shift();

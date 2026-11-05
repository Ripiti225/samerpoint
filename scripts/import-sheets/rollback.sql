-- Annule l'import historique Sheets (lot import_sheets_2026_10). À lancer dans Supabase > SQL Editor.
begin;
delete from public.inventaire_lignes where inventaire_id in (select id from public.inventaires_shifts where verif_lot_id = 'import_sheets_2026_10');
delete from public.inventaires_shifts where verif_lot_id = 'import_sheets_2026_10';
delete from public.presences where point_id in (select id from public.points where source = 'import_sheets_2026_10');
delete from public.depenses where point_id in (select id from public.points where source = 'import_sheets_2026_10');
delete from public.transactions_fournisseurs where source = 'import_sheets_2026_10';
delete from public.contacts_clients where source = 'import_sheets_2026_10';
delete from public.points where source = 'import_sheets_2026_10';
delete from public.fournisseurs_restaurants where id in ('1ff92890-0224-4108-9da1-5c2b164f8c03','0ffc1a3c-679f-4552-9e48-cafe3418f90d','fd65c439-6f61-4574-9224-f39ab644d748','e77b7f06-93cc-48bb-9275-0e5feb39b4e0','bda12680-4a01-473f-9a9d-2dd9d6f7eb22','5d350997-8c17-40d4-bf16-80ccfdb2bf94','84544c3b-0607-4450-8424-d7370fbb7089');
delete from public.fournisseurs where id in ('b07d115d-974d-414e-841b-cc84b1d437bf','47072a81-3f88-4b4d-9ed6-d05ce946841e','d7dd572b-0374-48bb-8292-3be7823fe32d','2739c1a7-05c2-414f-9b50-005038c3ab1f','c0620439-2f04-43d8-a9dd-d2ad2c0e8f03','cacbce21-f5ed-48b7-b19d-658bababacdc','5c446f51-ed1e-44ea-8ee7-aadda199c85f','d5a10d63-47c2-44ae-9de9-ef53a9c1524b','e6c34e64-86b8-461c-b618-80ba8b207f08','95412e65-31c7-4ec1-8caa-083965662c26');
commit;

# Litige sur un surplus de stock (Vérification) — conception

Date : 06/11/2026.

## Besoin

Des gérants ne rentrent pas les produits reçus : ils apparaissent ensuite en surplus au comptage. La Vérification ne permet ni de changer le montant, ni de mettre en litige un surplus sans explication : la ligne affiche « Sans explication · 0 ✅ », sans aucune action.

Constat du 07/10 au 06/11/2026 : 1 016 surplus, dont 693 sans explication, 10 décidés, 1 retenue. Les données contiennent aussi des erreurs de frappe (331 748 frites comptées pour 33 180), donc un montant calculé d'office serait dangereux.

## Décisions de l'utilisateur

- Le litige est imputé au **caissier du shift**, comme les autres écarts de stock.
- Le gérant est notifié : c'est lui que la notification met sous pression.

## Fonctionnement

**Écran (`app/verification.js`, onglet Stock, manager et directeur) :**
- Surplus sans décision et sans explication : bouton **⚖️ Litige**.
- Surplus en attente : ✅ accepte l'explication comme avant ; ❌ ouvre la fenêtre de litige au lieu de retenir `surplus × prix` d'office.
- Surplus déjà décidé : « Litige » ou « Modifier la décision » ouvre la même fenêtre.
- Déduction annulée : plus aucune action.

**Fenêtre :** produit, théorique, réel, surplus, prix, caissier ; montant vide au départ ; suggestion `surplus × prix` à toucher ; avertissement au-delà de 50 000 F ; commentaire facultatif.

**Montant à 0 :** retire le litige. La ligne reprend `en_attente` si elle porte une explication, sinon aucun statut.

**Effets :** `inventaire_lignes.montant_deduit`, `inventaires_shifts.montant_a_deduire` et `points.montant_inventaire` sont recalculés par différence. Litiges, note du caissier et rapport mensuel lisent déjà ces colonnes. Le pont POS ne réécrit pas une ligne déjà transférée.

**Notification :** au gérant du restaurant (plus manager et directeur s'il y a un commentaire), selon `ciblesVerification`.

**Sécurité des données :** tout passe par la fonction SQL `fixer_litige_surplus`, qui refuse une ligne qui n'est pas un surplus, une déduction annulée, un montant invalide et une ligne changée entre-temps. Chaque changement est journalisé (`litige_surplus_inventaire`).

## Hors périmètre

Les manquants ; la transformation automatique des surplus passés ; l'imputation au gérant.

## Déploiement

1. Passer `supabase_litige_surplus.sql` dans Supabase.
2. Publier le code (Vercel + EAS) sur accord de l'utilisateur.

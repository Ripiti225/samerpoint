# Note des caissiers — sur 20 (Samtrackly + POS)

Validé avec le propriétaire le 2026-10-03. Code Samtrackly : `lib/noteCaissier.js`
(règles, testées), `lib/noteCaissierDb.js` (chargement), `app/stats-caissiers.js`
(écran manager). Fonctions POS : `pos_cloud_stats_dashboard.sql`.

## Principe

On ne note **jamais le volume de ventes** : il dépend du restaurant, pas du caissier.
Chaque critère est un **taux**, jugé avec les mêmes seuils pour tous ; ce qui dépend
du lieu (ticket moyen) est comparé à la moyenne de **son** restaurant.

Période : **30 derniers jours glissants**. Progression : comparée aux 30 jours d'avant.

## Barème (20 points + 1 de bonus)

| Critère | Points | Mesure | Paliers |
|---|---|---|---|
| Justesse de la caisse | 7 | Shifts mesurés sans manquant ni surplus > 500 F, après décisions de Vérification (surplus ajouté le 2026-11-05 ; il reste hors des litiges) | 7 × part des shifts justes, au demi-point |
| Numéros des clients | 4 | Contacts POS ÷ livraisons Yango + Glovo | 4 ≥ 95 % · 3,5 ≥ 90 % · 3 ≥ 80 % · 2 ≥ 70 % · 1 ≥ 50 % · 0 |
| Inventaire et comptage | 4 | (déductions inventaire + vérificateur) ÷ shifts | 4 ≤ 300 F · 3 ≤ 750 · 2 ≤ 1 500 · 1 ≤ 3 000 · 0 |
| Clients et plateformes | 3 | Mauvais avis, erreurs Yango/Glovo, points pas faits à son nom, pour 20 shifts | 3 si aucun · 2 ≤ 1 · 1 ≤ 2 · 0 ; bon avis +0,5 |
| Présence | 2 | Absences « Absent » (malade, congé, permission ne comptent pas) | −0,5 par absence |
| Bonus ventes additionnelles | +1 | Ticket moyen ÷ ticket moyen de son restaurant | +1 ≥ +10 % · +0,5 ≥ +5 % · jamais négatif |

Note = (points des critères applicables ÷ leur maximum) × 20 + bonus, plafonnée à 20,
arrondie au demi-point. Appréciation : 17+ Excellent · 14+ Très bien · 12+ Bien ·
10+ Correct · moins de 10 À accompagner.

## Garde-fous (pour qu'aucun caissier ne se sente lésé)

1. **Minimum 8 shifts** sur 30 jours, sinon « pas encore noté » (le détail reste visible).
2. **Critère neutre** quand il ne s'applique pas : moins de 5 shifts mesurés, moins de
   10 livraisons (À la Braise), fiche employé non reliée, moins de 50 commandes pour le
   ticket. Ses points sont répartis sur les autres critères.
3. **Ce qui est justifié ou annulé dans Vérification ne compte pas** (même règle que
   l'écran Litiges : `decisionEcartShiftPOS`).
4. **Tolérance** : un manquant ou un surplus de 500 F ou moins n'est pas une faute.
5. **Taux, pas totaux** : un caissier qui travaille plus n'est pas plus pénalisé.
6. **30 jours glissants** : les vieilles erreurs s'effacent.
7. **Transparence** : barème affiché dans l'écran, détail et conseil par critère.
8. **Rattachement prudent** des shifts POS sans compte : même nom exact, ou tous les mots
   du compte dans le nom POS, même restaurant, un seul candidat. Le rattachement est
   affiché dans la fiche.

## Constats au 2026-10-03 (30 jours, 551 shifts)

- Les 21 avis clients du mois ne sont attribués à **personne** (`responsable_nom` vide) :
  le critère « Clients et plateformes » donne 3/3 à tous tant que les avis ne sont pas
  attribués au caissier dans l'écran Litiges.
- La colonne `retour_pos` vaut toujours 0 : pas utilisée.
- Le POS ne demande le numéro du client que sur les livraisons (0 sur place).
- 10 noms POS n'ont pas de compte Samtrackly relié (ex. Kazem Ali, Grekou Illa, Zan Lou
  Marlène Flora) : ils sont notés, mais sans critère présence.

## Fiche POS — à réaliser sur le master Windows

Le caissier ne voit plus Samtrackly : il voit sa note **dans le POS, à la connexion**.
Le manager la voit dans Samtrackly (Tableaux de bord → Statistiques caissiers).

### Ce que voit le caissier (après son PIN, avant l'accueil caisse)

Une carte « Ma note » (fermable d'un appui, ne bloque jamais la caisse) :

- la note en grand : « 15,5 / 20 · Très bien », et une flèche ↑/↓ par rapport au mois d'avant ;
- les 5 critères en barres courtes (mêmes couleurs que Samtrackly : caisse vert
  `#10B981`, numéros bleu `#0EA5E9`, inventaire orange `#D97706`, clients rose
  `#DB2777`, présence violet `#6C63E0`, bonus or `#F59E0B`) ;
- **un seul conseil**, celui du critère le plus faible (ex. « Il manque 37 numéros.
  4/4 à partir de 95 % des livraisons. ») ;
- « pas encore noté » s'il a moins de 8 shifts, avec le nombre de shifts manquants.
- Il ne voit **que sa note**, jamais celle des autres ni de classement.

### D'où vient la note (proposition)

1. Samtrackly calcule les notes chaque nuit (Edge Function + pg_cron, même
   `lib/noteCaissier.js` embarqué, comme `rappels-tresorerie`).
2. Il les écrit dans une table du cloud POS, `notes_caissiers` :
   `caissier_id` (id POS — fourni par `stats_services.u`), `restaurant_id`, `note`,
   `appreciation`, `criteres` (jsonb : clé, points, max, résumé, conseil), `conseil`,
   `note_precedente`, `calcule_le`.
3. Cette table **descend** vers les serveurs locaux par la synchro existante
   (lecture seule côté site) ; l'écran de connexion lit la ligne du caissier connecté.
4. Hors ligne : la dernière note descendue reste affichée, avec sa date.

Points à trancher côté POS : l'emplacement exact de la carte (après le PIN ou dans
« Mes ventes »), et si le manager veut aussi la liste dans le POS.

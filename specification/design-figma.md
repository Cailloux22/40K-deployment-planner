# Maquette Figma — 40K Deployment Planner

> Lien : [figma.com/design/lbXUpOjjtr6xUeXIAWMToO/40K-deployment-planner](https://www.figma.com/design/lbXUpOjjtr6xUeXIAWMToO/40K-deployment-planner)
>
> Ce document confronte la maquette Figma à [spec.md](spec.md) et [sitemap.md](sitemap.md) : il inventorie les frames de la maquette (section B), précise ce qu'elle couvre ou non (section C), et consigne les écarts identifiés avec spec.md/sitemap.md ainsi que les arbitrages pris pour les résoudre (section D). `spec.md` et `sitemap.md` renvoient à ce document par `[[design-figma.md]]`.

## A. Lien et accès

- URL : https://www.figma.com/design/lbXUpOjjtr6xUeXIAWMToO/40K-deployment-planner (paramètre `?t=...` d'origine omis, propre à la session de consultation).
- Clé de fichier Figma : `lbXUpOjjtr6xUeXIAWMToO`.
- Fichier à page unique (« Page 1 »), **7 frames** au format mobile (402×874 px, gabarit type iPhone), sans variante desktop/tablette.
- Analyse réalisée le 2026-09-10 via le serveur MCP Figma officiel (lecture de la structure des nœuds + capture d'écran de chacune des 7 frames).

## B. Inventaire des frames

| Frame Figma (node id) | Écran de [sitemap.md](sitemap.md) | Constat |
|---|---|---|
| `accueil listes` (`1:2`) | 1. Accueil — Mes listes (= bibliothèque) | 3 listes affichées comme blocs pleine largeur, menu contextuel « Delete / copy » par liste (⋮), icône réglages en haut à gauche du bandeau. |
| `Import liste` (`1:42`) | 2. Import de liste | Écran unique : zone de récapitulatif (« Visualisation du nombre d'unité et de socle avec les infos de socles »), champ « Name », bloc « disposition : » avec icône. Pas d'écran séparé pour l'assignation de socle. |
| `interface drag&drop unité` (`7:124`) | 6. Écran de placement | Plateau plein cadre, bandeau bas « Nom de l'unité : » avec flèches ◀/▶ et rangée de tokens (socles) du modèle courant, icône burger en haut à droite. |
| `interface drag&drop unité burger open` (`7:166`) | 6. Écran de placement — variante menu ouvert | Panneau latéral « Choisir votre unité » recouvrant ~56 % de la largeur depuis la droite, plateau partiellement visible à gauche ; unités groupées par forme de socle avec compte (`× 10`, `× 9`, `× 1`). |
| `Parametre / signup / Mention` (`11:239`) | 9. Réglages (= À propos / Crédits) | Frame très peu détaillée : titre « Parametre », bloc « Sign in process » (placeholder gris non stylé), mention « Powered by wahapedia » en pied d'écran. |
| `choix force dispo adversaire` (`2:60`) | 3. Choix de la disposition adverse | Diagramme circulaire : 1 icône centrale (disposition du joueur, déjà connue — [[RG_03]]) entourée de **5** icônes sélectionnables (disposition adverse), 3 d'entre elles portant un fond coloré (orange/jaune/vert) cohérent avec [[RG_12]]. |
| `Choix layout` (`5:10`) | 4. Choix du plateau | Bandeau « VS » avec les 2 icônes de disposition en jeu, pager à onglets numérotés (`1 2 3 …`), bloc « Status : » avec pastille à cocher, aperçu plateau (image Battlemaster réelle), et les 3 boutons Nouveau/Éditer/Consulter affichés simultanément. |

**Non couverts par la maquette** (aucune frame correspondante) : écran 5 (Visualiseur plein écran — plateau seul), écran 7 (Visualiseur plein écran — déploiement), écran 8 (Résolution de conflit de synchronisation). Ces trois écrans restent à concevoir visuellement ; leur définition fonctionnelle dans spec.md ([[RG_14]], [[RT_16]], [[RG_11]]) n'est pas remise en cause par cette absence.

## C. Portée de la maquette

Conformément à l'arbitrage du PO, cette maquette Figma décrit la **structure et la navigation cible**, pas un rendu visuel final : plusieurs frames utilisent des rectangles arrondis gris comme placeholders (zone de récapitulatif d'import, bloc « Sign in process »), les couleurs de fond des listes (cyan) ou du header (rouge) ne sont pas nécessairement la charte finale, et aucune frame n'illustre les états intermédiaires (chargement, erreur, écran vide sans liste importée). L'habillage CSS définitif est un sujet distinct traité ultérieurement ; ce document et [sitemap.md](sitemap.md) se concentrent sur ce que chaque écran contient et comment on y navigue.

## D. Écarts identifiés et arbitrages

### D.1 Déjà arbitrés avec le PO (repris dans spec.md/sitemap.md)

- **Fusion accueil + bibliothèque (écran 1)** — la frame `accueil listes` ne montre qu'une liste de listes d'armée (pas de sous-liste de déploiements par liste), mais elle est le seul point d'entrée de la maquette après l'import : le PO a arbitré que la bibliothèque ([[EX_04]]) n'est pas un écran séparé mais intégrée à l'accueil ([[RG_18]]), chaque liste donnant accès à ses propres déploiements. **Non illustré graphiquement dans la maquette actuelle** — voir [D.2](#d2-notes-mineures).
- **Fusion Réglages + À propos (écran 9)** — la frame `Parametre / signup / Mention` regroupe dans un seul écran la gestion de compte (« Sign in process ») et la mention légale (« Powered by wahapedia »), confirmant qu'il n'existe pas d'écran « À propos » séparé ([[RG_18]], [[RG_19]]).
- **Assignation manuelle de socle intégrée à l'import (écran 2)** — la frame `Import liste` ne montre qu'un seul écran (pas de panneau séparé pour les unités non reconnues) ; le PO a arbitré que cette assignation se fait dans le récapitulatif d'import lui-même ([[RG_02]], [[RG_22]]).
- **Pager pour le choix du plateau** — la frame `Choix layout` n'affiche qu'un seul plateau à la fois avec des onglets numérotés (`1 2 3`), confirmant la présentation en pager retenue dans [[RG_14]] plutôt que les 3 plateaux juxtaposés.
- **Panneau latéral pour le menu unités** — la frame `interface drag&drop unité burger open` confirme un panneau coulissant recouvrant une partie de l'écran (le plateau restant visible à gauche), et non un écran séparé ou une feuille modale plein écran ([[RT_24]]).
- **5 dispositions adverses + 1 icône centrale pour la disposition du joueur** — la frame `choix force dispo adversaire` affiche bien 6 icônes au total, mais celle du centre représente la disposition de force de la liste sélectionnée (déjà connue depuis l'import, [[RG_02]]/[[RG_03]]) et n'est pas sélectionnable ; les 5 icônes en orbite autour d'elle sont les 5 dispositions adverses proposées. Confirme le texte actuel de spec.md ([[RG_03]] étape 1, [[RG_12]], [[RT_11]], [[RT_23]]) — aucun changement nécessaire.

### D.2 Notes mineures

- **Mention Battlemaster absente de la maquette** — l'écran `Parametre / signup / Mention` n'affiche que « Powered by wahapedia », alors que [[RT_20]]/[[RT_12]] exigent aussi de créditer Battlemaster pour les plateaux. L'écran étant par ailleurs le moins détaillé de la maquette (placeholder gris pour tout le bloc compte), il s'agit vraisemblablement d'un wireframe incomplet plutôt que d'une décision de ne pas créditer Battlemaster.
- **Boutons Nouveau/Éditer/Consulter tous visibles à la fois** sur la frame `Choix layout`, alors que [[RG_14]] les prévoit conditionnels au statut du plateau (masqués/désactivés selon rouge/orange/vert). Interprété comme un raccourci propre à une maquette statique (montrer toutes les variantes de bouton sur une seule frame) plutôt qu'une contradiction de comportement.
- **Positionnement du menu contextuel « Delete / copy »** sur la frame `accueil listes` : affiché en chevauchement du bandeau du haut plutôt qu'ancré sous le bouton ⋮ de la liste concernée — vraisemblablement un artefact de mise en page Figma (état « menu ouvert » superposé pour la visibilité de la capture), pas une position d'ancrage définitive.
- **Aucune frame n'illustre l'ouverture de la bibliothèque d'une liste** (fusion actée en [D.1](#d1-déjà-arbitrés-avec-le-po-repris-dans-specmdsitemapmd)) : ni l'affichage des déploiements sauvegardés sous une liste, ni un état vide (aucune liste importée, aucun déploiement sauvegardé). À concevoir lors d'une prochaine itération de la maquette.

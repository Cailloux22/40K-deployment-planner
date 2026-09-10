# Spécification — 40K Deployment Planner

> Périmètre de ce document : l'application de planification de déploiement Warhammer 40k décrite dans [CLAUDE.md](../CLAUDE.md) — import de liste d'armée, plan de déploiement sur plateau avec tokens de socles, bibliothèque de déploiements sauvegardés, fonctionnement hors-ligne, compte utilisateur et synchronisation multi-appareils.
>
> Aucune fonctionnalité n'est implémentée à ce jour (dépôt issu du starter Ionic `blank`). Les règles techniques ci-dessous documentent les décisions d'architecture prises pour la suite du projet ; elles remplacent, au fur et à mesure de leur mise en œuvre, les zones marquées « non tranché » dans le CLAUDE.md.

## Convention

Le document s'organise sur **trois niveaux de traçabilité**, du besoin vers le code :

- **`EX_XX`** — **exigence** : un besoin de haut niveau que le projet doit satisfaire (ce que les parties prenantes attendent de l'application), indépendant de la façon dont il est réalisé. Exemple : « le système doit garantir la fiabilité du comptage ».
- **`RG_XX`** — règle de **gestion** : décrit **comment le métier a traduit une exigence** en comportement fonctionnel précis (une décision, une limite, une condition d'accès). Exemple : « un badge ne peut pas être scanné deux fois de suite ».
- **`RT_XX`** — règle **technique** : décrit **comment** une règle de gestion — ou une contrainte non-fonctionnelle — est mise en œuvre techniquement (persistance, synchronisation réseau, cycle de vie de l'application, intégration d'un plugin natif, mécanisme de résilience). Elle ne représente jamais un choix métier : si on changeait de technologie (autre plugin caméra, autre stockage local...), la règle technique changerait sans que l'exigence ou la règle de gestion associée soit affectée.

Chaque exigence renvoie aux règles de gestion et/ou techniques qui la satisfont ; chaque règle de gestion et technique est elle-même reportée dans le code source sous forme de commentaire `// RG_XX: ...` ou `// RT_XX: ...` à l'endroit exact où elle est appliquée. La chaîne complète est donc : **exigence → règle de gestion → règle technique → code**.

---

## EX_01 — Import d'une liste d'armée

Le joueur doit pouvoir importer sa liste d'armée dans l'application pour que celle-ci connaisse les unités à déployer (nombre de modèles, forme et taille de socle par unité).

Satisfait par : [[RG_01]], [[RG_02]], [[RG_13]], [[RT_01]], [[RT_02]], [[RT_13]].

### RG_01 — Formats d'import acceptés

L'import accepte un ou plusieurs formats de liste d'armée standards du jeu (à minima un export texte/JSON d'un list-builder tiers). Un import qui ne peut pas être interprété est rejeté avec un message explicite ; aucune liste partiellement interprétée n'est enregistrée silencieusement.

### RG_02 — Association socle/unité

Chaque unité importée doit être résolue vers une forme et un diamètre de socle (ronde, ovale, etc.) via un référentiel d'unités connu de l'application. Une unité non reconnue par le référentiel est signalée au joueur, qui doit pouvoir lui assigner manuellement un socle avant de pouvoir la déployer.

### RT_01 — Parsing d'import

Le parsing des formats d'import est isolé dans une couche de service dédiée (un parseur par format supporté), indépendante de l'UI, afin de pouvoir ajouter un nouveau format sans toucher aux écrans d'import.

### RT_02 — Référentiel de socles

Le référentiel unité → socle (forme, diamètre) est livré comme donnée statique versionnée avec l'application (voir [src/assets/shapes.svg](../src/assets/shapes.svg) pour les formes disponibles), rechargeable indépendamment du code pour suivre les mises à jour d'errata sans publication complète.

Cette donnée statique est générée hors-ligne, au moment du build/de la mise à jour du référentiel (jamais par appel réseau à l'exécution de l'application, conformément à EX_05), par un script d'ingestion qui consomme l'export CSV public de Wahapedia (`Datasheets_models.csv`, colonnes `base_size` / `base_size_descr`, cf. [wahapedia.ru/wh40k11ed/the-rules/data-export](https://wahapedia.ru/wh40k11ed/the-rules/data-export)) et le transforme vers le format interne du référentiel. Cet export n'est pas une API garantie (pas de SLA, format/URL susceptibles de changer) : le script d'ingestion doit échouer explicitement plutôt que produire un référentiel partiel en cas d'anomalie de format, et toute utilisation publique de la donnée doit mentionner « Powered by Wahapedia » conformément aux conditions d'usage de l'export (voir [CLAUDE.md](../CLAUDE.md)).

### RT_13 — Format d'import « roster JSON » (BattleScribe / NewRecruit)

Un des formats supportés par [[RT_01]] est le roster JSON exporté par les list-builders de la famille BattleScribe/NewRecruit (structure `roster.forces[].selections[]`). [src/assets/list_import.example.json](../src/assets/list_import.example.json) sert de jeu de données de référence (fixture de test) pour ce parseur. Ce format expose, sans ambiguïté et sans appel réseau :

- **Nom de la liste** : `roster.name` (chaîne libre saisie par le joueur dans le list-builder).
- **Disposition de force** : le nœud `force.selections[]` dont `type = "upgrade"` et `name = "Force Disposition"` porte lui-même une sous-sélection (`selections[0]`) avec `from = "group"` et `group = "Force Disposition"` ; le `name` de cette sous-sélection (ex. `"Priority Assets"`) est la disposition choisie par le joueur, à faire correspondre à l'une des 5 dispositions de [[RG_03]].
- **Nom de chaque unité** : chaque entrée de premier niveau de `force.selections[]` dont `type = "unit"` ou `type = "model"` (les catégories de configuration — `"Battle Size"`, `"Detachment"`, `"Force Disposition"` — sont de `type = "upgrade"` et donc explicitement exclues) ; son `name` est le nom d'unité à résoudre par [[RG_02]] contre le référentiel de socles ([[RT_02]]).
- **Nombre de modèles par unité** : pour une entrée de `type = "model"`, son propre champ `number` est le compte de modèles. Pour une entrée de `type = "unit"` (unité composée de plusieurs profils de modèle distincts, ex. meneur + troupe), le compte de modèles est la **somme des `number`** de ses `selections[]` directes de `type = "model"` (chaque profil de modèle différent au sein de l'unité étant une entrée séparée).

Le reste de l'arborescence (`rules`, `profiles`, `categories`, coûts en points, mots-clés d'armes...) est ignoré par ce parseur : seuls `roster.name`, le nœud `"Force Disposition"` et les champs `name`/`number`/`type` des sélections de premier niveau (et de leurs enfants directs de `type = "model"`) sont consommés. Ce format ne fournit pas la forme/taille de socle : celle-ci reste résolue séparément via [[RG_02]]/[[RT_02]] à partir du nom d'unité extrait ci-dessus.

---

## EX_02 — Planification du déploiement sur plateau

Le joueur doit pouvoir positionner ses unités sur une représentation du plateau de jeu, en tenant compte de la disposition de force qu'il a choisie pour la partie.

Satisfait par : [[RG_03]], [[RG_04]], [[RG_05]], [[RG_12]], [[RT_03]], [[RT_04]], [[RT_11]], [[RT_12]].

### RG_03 — Parcours de sélection : liste → disposition adverse → plateau → placement

Une fois qu'il a sélectionné, parmi celles déjà importées, la liste d'armée avec laquelle il joue, le joueur suit un parcours en trois étapes ordonnées avant de pouvoir placer la moindre unité. Sa propre disposition de force est déjà connue à ce stade — elle est fixée dès l'import de la liste ([[RG_02]]) et n'est pas redemandée dans ce parcours :

1. il choisit, parmi les **5 dispositions** proposées par l'application, celle de son **adversaire** ;
2. il choisit un plateau de jeu parmi les **3 plateaux** proposés pour le couple (sa disposition, la disposition adverse retenue à l'étape 1) ;
3. il accède à l'écran de placement des unités sur le plateau ainsi sélectionné.

Chaque étape doit être complétée avant d'accéder à la suivante (pas de placement possible tant que la disposition adverse et le plateau n'ont pas été choisis). Le joueur peut revenir en arrière pour changer un choix précédent ; changer de disposition adverse ou de plateau après coup ne modifie pas les placements déjà enregistrés pour une autre combinaison liste/disposition adverse/plateau (voir [[RG_07]]). Le placement d'un token en dehors de la zone de déploiement autorisée pour son camp est bloqué ou signalé visuellement.

### RG_12 — Indicateurs de déploiement déjà enregistré (disposition adverse et plateau)

Le parcours décrit en [[RG_03]] affiche, à deux étapes, un indicateur de l'avancement des déploiements déjà sauvegardés pour la liste couramment sélectionnée. Ces indicateurs sont purement informatifs : ils n'empêchent jamais de créer un nouveau déploiement sur une combinaison déjà utilisée, et le joueur choisit explicitement s'il reprend un déploiement existant ou en démarre un nouveau.

**Étape 1 — choix de la disposition adverse.** Pour chacune des 5 dispositions adverses proposées, le bouton correspondant affiche un code couleur reflétant l'état des déploiements sauvegardés pour la combinaison (liste couramment sélectionnée, cette disposition adverse), sur l'ensemble des 3 plateaux qui lui seront associés à l'étape 2 :

- **Blanc** : aucun déploiement commencé sur les 3 plateaux (0 déploiement sur 3).
- **Jaune** : 1 ou 2 déploiements terminés sur les 3 plateaux (et aucun déploiement commencé mais non terminé parmi les 3).
- **Orange** : au moins un des 3 plateaux a un déploiement commencé mais non terminé — cet état est prioritaire sur les deux précédents, car il signale un travail interrompu que le joueur voudra probablement reprendre.
- **Vert** : les 3 déploiements sont terminés (3 déploiements sur 3).

Un déploiement sauvegardé est considéré **terminé** lorsque toutes les unités de la liste ont tous leurs modèles placés (aucune unité restant "en attente de déploiement" au sens de [[RG_05]]) ; dans le cas contraire, il est considéré **commencé mais non terminé**. L'ordre de priorité pour déterminer la couleur est : Orange > Vert > Jaune > Blanc.

**Étape 2 — choix du plateau.** Une fois la disposition adverse retenue, l'application indique, pour chacun des 3 plateaux proposés, si le joueur possède déjà au moins un déploiement sauvegardé pour la combinaison liste + disposition adverse + ce plateau (indicateur booléen ou compteur ; pas de code couleur imposé à ce niveau).

### RG_04 — Un token = un modèle

Un token posé sur le plateau représente un seul modèle physique, jamais une unité entière. Une unité de 10 modèles nécessite donc 10 placements distincts ; le joueur peut néanmoins déplacer/dupliquer rapidement les tokens restants d'une même unité pour accélérer la saisie.

### RG_05 — Unité non totalement déployée

Une unité dont tous les modèles n'ont pas encore été placés reste identifiable comme "en attente de déploiement" (par exemple dans une liste latérale), pour que le joueur n'oublie pas de modèles en réserve ou en attente.

### RT_03 — Rendu du plateau et des tokens

Le plateau et les tokens sont rendus via SVG, pour permettre le zoom, le pan et le drag-and-drop tactile sur mobile sans perte de précision de positionnement.

### RT_04 — Modèle de données de placement

Un placement est stocké comme un enregistrement `{ idUnite, idModele, x, y, rotation }` indépendant des autres modèles de la même unité, afin que RG_04 et RG_05 puissent être vérifiées par simple comptage/filtrage sans recalcul géométrique.

### RT_11 — Calcul des indicateurs de déploiement existant

Les indicateurs prévus par [[RG_12]] sont calculés en interrogeant la bibliothèque locale ([[RT_06]]), avant l'affichage de l'écran correspondant, sans appel réseau (conformément à [[EX_05]]), et recalculés à chaque affichage de l'étape pour refléter les sauvegardes les plus récentes :

- **Étape 2 (choix du plateau)** : filtrage sur le triplet (identifiant de liste, identifiant de disposition adverse choisie à l'étape 1, identifiant de plateau) ; le résultat est un simple booléen (ou compteur) par plateau proposé.
- **Étape 1 (choix de la disposition adverse)** : pour chacune des 5 dispositions adverses candidates, filtrage sur le couple (identifiant de liste, identifiant de disposition adverse candidate) sur les 3 plateaux qui lui sont associés. Pour chaque déploiement sauvegardé trouvé, le statut terminé/non terminé est déterminé en comparant, pour chaque unité de la liste, le nombre de placements enregistrés ([[RT_04]]) au nombre de modèles de l'unité (issu de [[RG_02]]). Le code couleur du bouton de disposition en résulte selon l'ordre de priorité défini en [[RG_12]] (Orange > Vert > Jaune > Blanc).

### RT_12 — Référentiel des plateaux (Battlemaster / gdmissions.app)

Le référentiel associant, pour chaque couple (disposition du joueur, disposition adverse), les images des 3 plateaux proposés à l'étape 2 de [[RG_03]] est généré hors-ligne, au moment du build/de la mise à jour du référentiel (jamais par appel réseau à l'exécution de l'application, conformément à [[EX_05]]), par un script d'ingestion qui consomme les images statiques publiées sur [gdmissions.app](https://gdmissions.app/11th/layouts) (`/assets/11th/layouts/{no-measurements|with-measurements}/{disposition}-vs-{adversaire}-{1|2|3}[-portrait].png`, ou `{disposition}-mirror-{1|2|3}.png` lorsque les deux dispositions sont identiques) et les transforme vers le format interne du référentiel. Ces données sont elles-mêmes sourcées par gdmissions.app auprès de Battlemaster (battlemaster.online) et non garanties par une API stable : le script d'ingestion doit échouer explicitement plutôt que produire un référentiel partiel en cas d'anomalie de format ou de changement de structure du site, et toute utilisation publique de ces plateaux doit créditer **Battlemaster** (battlemaster.online).

---

## EX_03 — Représentation fidèle des socles

Les tokens affichés doivent respecter la forme et la taille réelle du socle de chaque unité, et permettre de distinguer visuellement les unités entre elles.

Satisfait par : [[RG_02]], [[RG_06]], [[RT_05]].

### RG_06 — Couleur par unité

Chaque unité importée se voit attribuer une couleur distincte (automatiquement, avec possibilité de réassignation manuelle par le joueur) ; tous les tokens d'une même unité partagent cette couleur pour rester identifiables sur un plateau chargé.

### RT_05 — Échelle des tokens

La taille d'un token à l'écran est calculée au pixel près à partir du diamètre réel du socle (en mm) et de l'échelle courante du plateau affiché, pour que deux socles de tailles différentes restent proportionnellement corrects à tout niveau de zoom.

---

## EX_04 — Bibliothèque de déploiements sauvegardés

Le joueur doit pouvoir sauvegarder un déploiement rempli, le retrouver plus tard, et le relier à la liste d'armée dont il provient.

Satisfait par : [[RG_07]], [[RG_08]], [[RT_06]], [[RT_07]].

### RG_07 — Sauvegarde nommée

Un déploiement sauvegardé conserve un nom (par défaut : liste + plateau + date), la référence à la liste d'armée importée, le plateau et la disposition choisis, et l'ensemble des placements. Toute modification ultérieure du déploiement est enregistrée comme mise à jour de la même entrée, sauf sauvegarde explicite "sous un nouveau nom".

### RG_08 — Suppression

La suppression d'une entrée de la bibliothèque est une action confirmée explicitement par le joueur et ne supprime jamais la liste d'armée associée, qui peut être réutilisée pour d'autres déploiements.

### RT_06 — Persistance locale de la bibliothèque

La bibliothèque est persistée localement (mécanisme de stockage à trancher — voir EX_05/RT_08) sous forme d'enregistrements indexés par identifiant de déploiement, pour un accès à la liste sans dépendre du réseau.

### RT_07 — Clé de liaison liste/déploiement

La liaison entre un déploiement et sa liste d'armée d'origine utilise un identifiant stable de la liste (et non son contenu), afin qu'une liste modifiée après coup n'invalide pas les déploiements déjà sauvegardés qui la référencent.

---

## EX_05 — Fonctionnement hors-ligne

L'application doit rester pleinement utilisable sans connexion réseau pour la planification et la consultation de la bibliothèque, qui ne dépendent pas d'un accès serveur. L'import d'une nouvelle liste fait exception à ce principe (voir [[RG_13]]). Lorsque l'application ressort du mode hors-ligne, une éventuelle divergence entre les données locales et celles du serveur doit être arbitrée par le joueur, jamais résolue silencieusement (voir [[RG_11]]).

Satisfait par : [[RG_09]], [[RG_11]], [[RG_13]], [[RT_08]], [[RT_14]], [[RT_15]].

### RG_09 — Dégradation gracieuse du réseau

Toute fonctionnalité qui nécessite le réseau (synchronisation de compte notamment) échoue silencieusement en arrière-plan sans bloquer ni interrompre le travail en cours du joueur ; l'état "non synchronisé" reste visible mais non bloquant.

### RG_13 — Import de liste indisponible hors-ligne

L'import d'une nouvelle liste d'armée ([[RG_01]]) n'est pas proposé hors-ligne : contrairement aux autres fonctionnalités couvertes par [[EX_05]] (planification, bibliothèque), qui restent pleinement utilisables sans réseau, l'import est une restriction fonctionnelle volontaire. Si le joueur tente de lancer un import alors que l'application est hors-ligne, l'import est bloqué avant toute tentative de parsing et un message explicite informe le joueur que cette action nécessite une connexion réseau, en l'invitant à réessayer une fois reconnecté. Les listes déjà importées restent consultables et utilisables hors-ligne sans restriction.

### RT_08 — Stockage local

Les données de l'application (listes importées, référentiel de socles, bibliothèque de déploiements) sont persistées via le stockage local du terminal (IndexedDB en environnement web ; `@capacitor/preferences` ou équivalent pour les données de configuration légères sur mobile natif), lu/écrit systématiquement avant toute tentative de synchronisation réseau.

### RT_14 — Détection de connectivité pour le blocage de l'import

L'état de connectivité réseau est surveillé côté client (`@capacitor/network` sur mobile natif ; évènements `online`/`offline` du navigateur en environnement web) pour piloter le point d'entrée d'import : celui-ci est désactivé (ou son déclenchement intercepté) et le message prévu par [[RG_13]] est affiché tant que l'application est détectée hors-ligne, sans attendre l'échec d'un appel réseau.

### RT_15 — Détection de conflit à la resynchronisation

Chaque enregistrement synchronisable (déploiement, cf. [[RT_04]]/[[RT_07]]) conserve localement le jeton de version ([[RT_09]]) reçu lors de sa dernière synchronisation réussie. Au retour en ligne ([[RT_10]]), pour tout enregistrement modifié localement depuis ce jeton, le client compare son jeton local au jeton courant renvoyé par le serveur pour ce même enregistrement : s'ils divergent, un conflit est déclaré et l'interface de choix prévue par [[RG_11]] est présentée pour cet enregistrement précis, sans bloquer la synchronisation des autres enregistrements non conflictuels.

---

## EX_06 — Compte utilisateur et synchronisation multi-appareils

Le joueur doit pouvoir associer un compte à ses données pour retrouver ses listes et déploiements sur un autre appareil (ex. bureau puis téléphone).

Satisfait par : [[RG_10]], [[RG_11]], [[RT_09]], [[RT_10]].

### RG_10 — Compte optionnel

L'utilisation de l'application sans compte reste possible et fonctionnelle (données locales uniquement) ; la création de compte n'est nécessaire qu'au moment où le joueur souhaite explicitement synchroniser vers un second appareil.

### RG_11 — Résolution de conflit

Lorsque le même déploiement a été modifié hors-ligne sur deux appareils avant resynchronisation, l'application ne doit jamais choisir automatiquement une version au détriment de l'autre. À la détection du conflit — typiquement au retour en ligne après une session hors-ligne, cf. [[EX_05]] — la synchronisation de cet enregistrement est mise en attente et l'application présente explicitement au joueur les deux versions (locale et serveur, avec leur horodatage respectif) ; le joueur choisit celle à conserver, ce choix écrasant l'autre version pour cet enregistrement. Les enregistrements non conflictuels continuent de se synchroniser normalement sans attendre cette décision.

### RT_09 — Backend de synchronisation

Un backend nodejs expose une API de synchronisation par différence (delta) des enregistrements créés/modifiés/supprimés depuis la dernière synchronisation réussie, identifiée par un jeton de version côté client.

### RT_10 — Déclenchement de la synchronisation

La synchronisation se déclenche à la reprise du réseau et/ou au retour au premier plan de l'application, jamais de façon bloquante pour l'interaction en cours, conformément à RG_09.

---

## Suivi des décisions non tranchées

Les règles techniques suivantes contiennent un choix encore ouvert et doivent être mises à jour dès que la décision est prise :

aucune
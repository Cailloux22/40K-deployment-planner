# Spécification — Windfall Planner

> Périmètre de ce document : l'application de planification de déploiement Warhammer 40k décrite dans [CLAUDE.md](../CLAUDE.md) — import de liste d'armée, plan de déploiement sur plateau avec tokens de socles, bibliothèque des listes importées avec leurs déploiements sauvegardés, fonctionnement hors-ligne, compte utilisateur et synchronisation multi-appareils.
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

Satisfait par : [[RG_01]], [[RG_02]], [[RG_13]], [[RG_22]], [[RG_36]], [[RT_01]], [[RT_02]], [[RT_13]], [[RT_26]], [[RT_28]], [[RT_45]]. La scission d'une unité au récapitulatif d'import relève de [[EX_11]].

### RG_01 — Formats d'import acceptés

L'import accepte un ou plusieurs formats de liste d'armée standards du jeu (à minima un export texte/JSON d'un list-builder tiers). Un import qui ne peut pas être interprété est rejeté avec un message explicite ; aucune liste partiellement interprétée n'est enregistrée silencieusement.

### RG_02 — Association socle/unité

Chaque unité importée doit être résolue vers une forme et un diamètre de socle (ronde, ovale, etc.) via un référentiel d'unités connu de l'application. Une unité non reconnue par le référentiel est signalée au joueur, qui doit pouvoir lui assigner manuellement un socle avant de pouvoir la déployer. Cette assignation manuelle se fait directement sur l'écran d'import, au sein du récapitulatif prévu par [[RG_22]] — il n'existe pas d'écran séparé dédié à cette assignation.

**Une unité, plusieurs socles.** La résolution ne produit pas un socle unique par unité mais un socle **par profil de modèle** ([[RT_13]]) : une unité peut légitimement mêler plusieurs formes/tailles, ce que [[RG_16]] suppose explicitement en affichant ses socles « regroupés par forme/taille avec un compte ». Une unité porte donc une liste de **groupes de modèles** `{ nom du profil, compte, socle }` ; deux profils qui aboutissent au même socle sont fusionnés en un seul groupe (c'est le regroupement attendu par [[RG_16]]), les profils non résolus restant séparés pour que le joueur leur assigne un socle un par un. La somme des comptes des groupes est le nombre de modèles de l'unité. Ce modèle est reporté dans le contrat de synchronisation (`ArmyUnit.modelGroups`, voir [openapi.yml](openapi.yml)), l'unique `baseShapeId` par unité initialement prévu ne pouvant pas exprimer le cas de [[RG_16]].

**Socles conditionnels au sein d'une même ligne de modèle.** Une ligne du référentiel ([[RT_02]]) peut couvrir plusieurs modèles dont tous ne partagent pas le socle qu'elle annonce : la source porte l'exception en texte libre (« Combat Servitors and Gun Servitors » : 25 mm, *« Gun servitors 32mm »* ; « Skitarii Rangers » : 25 mm, *« 60 x 35mm if equipped with transuranic arquebus »*). Ces exceptions sont traduites à l'ingestion en **socles conditionnels** portés par la ligne, puis appliquées profil par profil à l'import : un profil dont le nom désigne le modèle visé, ou dont l'équipement ([[RT_13]]) déclenche la condition, reçoit le socle de l'exception ; les autres profils de la même ligne gardent le socle par défaut. Une unité de 10 Skitarii Rangers dont un porte l'arquebuse transuranique produit ainsi deux groupes (9 × rond 25 mm, 1 × ovale 60 × 35 mm) au lieu d'un seul, conformément à [[RG_16]]. Lorsqu'une exception existe mais n'est pas traduisible en règle décidable (la source pose elle-même une question), le socle par défaut n'est pas appliqué en confiance : le profil part en assignation manuelle plutôt que d'être deviné.

**Rapprochement des noms.** Le nom d'unité importé est rapproché du référentiel après normalisation (casse, accents, ponctuation, détail d'équipement entre parenthèses ou après « w/ » écartés). Quand plusieurs datasheets homonymes existent (unités portant le même nom dans plusieurs factions), le rapprochement n'est retenu que si toutes décrivent les mêmes socles — la comparaison porte sur les **socles**, pas sur le nom de leurs lignes de modèle : deux datasheets « Chaos Terminators » dont les lignes s'appellent « Chaos Terminators » et « Terminator Squad » mais qui annoncent toutes deux 40 mm restent interchangeables. Sinon l'unité part en assignation manuelle plutôt que de voir un socle choisi arbitrairement. Même principe au niveau du profil de modèle : à défaut de correspondance fiable, le socle n'est déduit que si tous les profils de la datasheet partagent le même — jamais deviné autrement.

**Résolution automatique des socles `Use model` via gabarits recherchés ([[RT_26]]).** Pour une ligne de référentiel ([[RT_02]]) dont `base_size` vaut `Use model` — GW ne publie alors aucun socle indépendant, renvoyant à l'emprise du modèle lui-même — l'unité n'est plus systématiquement renvoyée en assignation manuelle : la résolution consulte d'abord un référentiel complémentaire ([[RT_26]]) qui associe, quand la donnée a pu être établie, la longueur et la largeur réelles du modèle, dans la forme (rectangulaire le plus souvent pour une coque de véhicule, parfois ronde ou ovale) que la recherche a permis d'établir au cas par cas — voir [[RT_26]]. Une correspondance y résout le profil automatiquement, sans solliciter le joueur.

**Assignation manuelle en dernier recours.** Pour un profil que [[RT_26]] ne documente pas (encore), c'est le joueur, qui a le modèle physique en main, qui fait autorité : le profil part en assignation manuelle sur le récapitulatif ([[RG_22]]), de deux façons possibles :

- choisir un socle existant dans la liste des socles connus du référentiel ([[RT_02]]/[[RT_26]]) ;
- ou, si aucun de ces socles ne correspond, **définir lui-même un socle rectangulaire sur mesure** en saisissant, en millimètres, la longueur et la largeur qu'il mesure à l'horizontale sur son modèle physique ([[RT_28]]) — sans attendre qu'une entrée [[RT_26]] existe pour ce profil précis.

Ce choix, quelle que soit la façon dont il a été fait, n'est mémorisé nulle part au-delà de cet import — aucun store local ne le conserve d'un import à l'autre : un import ultérieur du même profil, tant qu'il n'est pas couvert par [[RT_26]], est de nouveau présenté au joueur pour assignation. Un socle sur mesure défini via [[RT_28]] n'alimente pas non plus le référentiel partagé [[RT_26]] (qui reste exclusivement écrit par l'assistant IA du projet) : c'est une donnée propre à cette unité de cette liste, pas une contribution au référentiel commun à tous les joueurs. Aucune valeur choisie une fois, même par erreur, ne doit pouvoir se réappliquer silencieusement à un import suivant à l'insu du joueur.

### RG_22 — Récapitulatif et confirmation avant enregistrement d'un import

Une fois le fichier importé interprété avec succès ([[RG_01]]) et chaque unité résolue vers un socle ([[RG_02]]), l'application affiche un récapitulatif — nombre d'unités, nombre de modèles et socles associés par unité — avant d'enregistrer la liste. Le nom de la liste, pré-rempli à partir de la donnée source (`roster.name`, [[RT_13]]), reste modifiable par le joueur sur cet écran. La liste n'est persistée qu'après validation explicite de ce récapitulatif ; le joueur peut aussi l'annuler, auquel cas rien n'est enregistré. Le récapitulatif présente aussi les unités attachées lues dans la source, que le joueur peut défaire ou constituer avant de valider ([[RG_36]]). Il permet enfin de scinder en deux une unité d'au moins 10 modèles ([[RG_40]]) ; une scission dont une moitié compte moins de 5 modèles bloque la validation.

### RT_01 — Parsing d'import

Le parsing des formats d'import est isolé dans une couche de service dédiée (un parseur par format supporté), indépendante de l'UI, afin de pouvoir ajouter un nouveau format sans toucher aux écrans d'import.

### RT_02 — Référentiel de socles

Le référentiel unité → socle (forme, diamètre) est livré comme donnée statique versionnée avec l'application (voir [src/assets/shapes.svg](../src/assets/shapes.svg) pour les formes disponibles), rechargeable indépendamment du code pour suivre les mises à jour d'errata sans publication complète.

Cette donnée statique est générée hors-ligne, au moment du build/de la mise à jour du référentiel (jamais par appel réseau à l'exécution de l'application, conformément à EX_05), par un script d'ingestion (`scripts/ingest-bases.mjs`) qui consomme l'export CSV public de Wahapedia (`Datasheets_models.csv`, colonnes `base_size` / `base_size_descr`, joint à `Datasheets.csv` pour le nom d'unité, cf. [wahapedia.ru/wh40k11ed/the-rules/data-export](https://wahapedia.ru/wh40k11ed/the-rules/data-export)) et le transforme vers le format interne du référentiel. Cet export n'est pas une API garantie (pas de SLA, format/URL susceptibles de changer) : le script d'ingestion doit échouer explicitement plutôt que produire un référentiel partiel en cas d'anomalie de format, et toute utilisation publique de la donnée doit mentionner « Powered by Wahapedia » conformément aux conditions d'usage de l'export (voir [CLAUDE.md](../CLAUDE.md)) — mention reprise par le bloc « Mentions des sources tierces » de l'écran Réglages ([[RG_18]], [[RT_20]]).

**Traduction des valeurs de socle.** `base_size` est interprété en forme + dimensions : `NNmm` → socle rond de diamètre NN, `AA x BBmm` → socle ovale, suffixe `flying base` conservé comme attribut. Les valeurs qui ne décrivent aucun socle (`Use model`, `No official base size`, valeur vide) ne sont **pas** devinées : le socle reste nul et l'unité concernée part en assignation manuelle ([[RG_02]]). Pour la valeur `Use model` spécifiquement, ce socle nul déclenche depuis en priorité la consultation du référentiel complémentaire de gabarits recherchés manuellement ([[RT_26]]) avant de retomber sur l'assignation manuelle ; les deux autres valeurs (`No official base size`, valeur vide) restent hors périmètre de [[RT_26]] et partent directement en assignation manuelle. Au 2026-09-10, 1380 des 1765 lignes de modèle portent un socle exploitable, pour 28 formes de socle distinctes.

**Interprétation de `base_size_descr`.** Cette colonne porte, en texte libre, les exceptions au `base_size` de la ligne. Elle n'est pas seulement conservée pour affichage : l'ingestion la traduit en **socles conditionnels** exploitables par [[RG_02]]. Deux tournures couvrent l'intégralité du corpus et sont les seules reconnues :

- `<désignation> <taille>` — un modèle nommé de la ligne prend un autre socle (« Gun servitors 32mm », « Cyber-mastiff 25mm ») ;
- `<taille> if|with <équipement>` — un équipement déclenche un autre socle (« 60 x 35mm if equipped with transuranic arquebus »), éventuellement combiné à une désignation (« Navis Armsman 28mm if armed with meltagun or plasmagun », où la désignation *et* l'une des armes citées sont exigées).

La désignation et l'équipement sont réduits, dès l'ingestion, à des termes normalisés comparables à ceux d'un profil importé ; les mots que le nom de la datasheet porte déjà en sont retirés, faute de discriminer les profils entre eux (« Gun servitors » dans « Servitor Battleclade » se réduit à « gun »). Toute note qui n'entre dans aucune des deux tournures — au 2026-09-10, la seule « Use the Chaos Daemon's Seeker base size (60 x 35mm)? », où la source elle-même s'interroge — marque la ligne comme à confirmer par le joueur ([[RG_02]]) plutôt que de laisser appliquer un socle par défaut peut-être inexact. Les socles cités par ces seules notes sont publiés dans la table des formes au même titre que les autres. Au 2026-09-10, 25 lignes de modèle portent une note, dont 21 traduites en socle conditionnel ; le décompte et la liste des notes non interprétées figurent dans les statistiques du référentiel généré, pour repérer une tournure récurrente à ajouter à la grammaire.

**Seuils d'échec du script.** L'échec explicite exigé ci-dessus est déclenché par : colonne attendue absente, ligne au nombre de colonnes incohérent, volume anormalement faible, ou proportion de socles exploitables inférieure à 50 % (indice d'un changement de format de `base_size`). En revanche, quelques lignes de `Datasheets_models.csv` référencent un `datasheet_id` absent de `Datasheets.csv` (entrées génériques du type « Greater Daemon » — 4 lignes sur 1765 au 2026-09-10) : c'est un trou d'intégrité de la source et non un changement de format, ces lignes sont donc écartées et comptées, l'ingestion n'échouant qu'au-delà de 1 % de lignes orphelines, seuil au-delà duquel les deux exports seraient structurellement désynchronisés.

### RT_13 — Format d'import « roster JSON » (BattleScribe / NewRecruit)

Un des formats supportés par [[RT_01]] est le roster JSON exporté par les list-builders de la famille BattleScribe/NewRecruit (structure `roster.forces[].selections[]`). [src/assets/list_import.example.json](../src/assets/list_import.example.json) sert de jeu de données de référence (fixture de test) pour ce parseur. Ce format expose, sans ambiguïté et sans appel réseau :

- **Nom de la liste** : `roster.name` (chaîne libre saisie par le joueur dans le list-builder) ; cette valeur sert de pré-remplissage éditable au récapitulatif d'import, [[RG_22]].
- **Disposition de force** : le nœud `force.selections[]` dont `type = "upgrade"` et `name = "Force Disposition"` porte lui-même une sous-sélection (`selections[0]`) avec `from = "group"` et `group = "Force Disposition"` ; le `name` de cette sous-sélection (ex. `"Priority Assets"`) est la disposition choisie par le joueur, à faire correspondre à l'une des 5 dispositions de [[RG_03]].
- **Nom de chaque unité** : chaque entrée de premier niveau de `force.selections[]` dont `type = "unit"` ou `type = "model"` (les catégories de configuration — `"Battle Size"`, `"Detachment"`, `"Force Disposition"` — sont de `type = "upgrade"` et donc explicitement exclues) ; son `name` est le nom d'unité à résoudre par [[RG_02]] contre le référentiel de socles ([[RT_02]]).
- **Nombre de modèles par unité** : pour une entrée de `type = "model"`, son propre champ `number` est le compte de modèles. Pour une entrée de `type = "unit"` (unité composée de plusieurs profils de modèle distincts, ex. meneur + troupe), le compte de modèles est la **somme des `number` des entrées `type = "model"` de son arborescence** (chaque profil de modèle différent au sein de l'unité étant une entrée séparée). Ces entrées ne sont pas toutes enfants directes de l'unité : le list-builder regroupe parfois les modèles de troupe sous un nœud `type = "upgrade"` qui porte l'option d'armement choisie (« 8 chainblades » → `model` « Jakhal » ×8). La recherche traverse donc ces nœuds intermédiaires — s'en tenir aux enfants directs perdrait purement et simplement les modèles ainsi regroupés. Le sous-arbre d'une entrée `model` n'est en revanche pas exploré à la recherche d'autres modèles : ce qui s'y trouve est son équipement (voir ci-dessous).

- **Équipement de chaque profil de modèle** : les sélections de `type = "upgrade"` situées sous une entrée de `type = "model"`, à tout niveau (certains list-builders les regroupent sous un nœud intermédiaire), ainsi que le nom du ou des nœuds `upgrade` qui *encadrent* le modèle le cas échéant, puisqu'ils décrivent eux aussi son armement (« 8 chainblades »). Leur `name` sert exclusivement aux socles conditionnels de [[RG_02]] (« 60 x 35mm if equipped with transuranic arquebus », [[RT_02]]), que le nom du profil ne suffit pas toujours à décider ; il n'est ni affiché ni persisté avec la liste.

Lorsque le roster déclare plusieurs `forces`, les sélections de toutes les forces contribuent à la liste déployée, la disposition de force n'étant elle déclarée qu'une seule fois. - **Unités attachées** : les champs `associations` / `incomingAssociations` des sélections de premier niveau, qui relient un personnage à l'unité qu'il mène ou soutient ([[RG_36]]). Leur lecture est décrite par [[RT_45]].

Le reste de l'arborescence (`rules`, `profiles`, `categories`, coûts en points, mots-clés d'armes...) est ignoré par ce parseur : seuls `roster.name`, le nœud `"Force Disposition"`, les champs `name`/`number`/`type` des sélections de premier niveau et de leurs enfants directs de `type = "model"`, le `name` des `type = "upgrade"` portés par ces modèles, et les associations de [[RT_45]] sont consommés. En particulier, le texte des capacités « Leader » (« This model can be attached to the following units: … ») n'est pas lu : il décrit les attachements **permis**, pas ceux que le joueur a choisis. Ce format ne fournit pas la forme/taille de socle : celle-ci reste résolue séparément via [[RG_02]]/[[RT_02]] à partir du nom d'unité extrait ci-dessus.

### RT_26 — Référentiel complémentaire des gabarits « Use model »

**Constat préalable.** Aucune source externe structurée et réutilisable n'a été trouvée pour les ~209 datasheets (essentiellement des véhicules/super-lourds) que [[RT_02]] laisse sans socle publié (`Use model`) : vérifié absents ou inexploitables au 2026-09-10 — chart de socles officiel Games Workshop pour 40k (n'existe pas, contrairement à Age of Sigmar), export BSData (aucun champ de taille de socle dans les catalogues), 40kdc-data (explicitement hors périmètre de ce jeu de données), charts communautaires (LITKO, Spikeybits, Magnet Baron, Grimdark Labs — pages éditoriales non structurées, sans licence de réutilisation affichée). La donnée n'est tout simplement publiée nulle part sous forme d'un export structuré unique : le socle réel dépend du kit physique livré en boîte. Ce constat motive le référentiel décrit ci-dessous : plutôt que de renvoyer systématiquement le joueur en assignation manuelle, l'application constitue elle-même, entrée par entrée, un référentiel de gabarits recherchés manuellement. Pour les profils qu'il ne couvre pas (encore), aucun filet de secours ne mémorise de choix du joueur : le profil part en assignation manuelle simple, redemandée à chaque import (voir [[RG_02]]).

**Principe.** Pour limiter le recours à l'assignation manuelle ([[RG_02]]) sur les ~209 datasheets que [[RT_02]] laisse sans socle publié (véhicules, super-lourds, monstres...), l'application embarque un second référentiel statique, complémentaire de [[RT_02]] : un gabarit `longueur x largeur` (en mm), mesuré à l'horizontale sur le modèle physique, par ligne de modèle concernée. Contrairement à [[RT_02]]/[[RT_12]], ce référentiel n'est pas produit par un script consommant un export structuré unique : aucune source de ce type n'existe pour ces dimensions (constat ci-dessus). Il est constitué **manuellement, entrée par entrée**, par recherche des dimensions réelles du modèle (page produit Games Workshop quand elle publie une taille, contenu de boîte, mesures communautaires...) ; chaque entrée cite sa source individuelle (`sourceNote`), pour rester vérifiable et corrigible si une mesure se révèle inexacte. On ne reprend jamais la mise en forme d'un chart tiers existant, seulement le fait physique — une longueur, une largeur — qu'aucune protection ne couvre.

**Décision (précédemment ouverte) : fichier JSON versionné avec l'application, alimenté par l'assistant IA.** L'outillage retenu n'est ni un formulaire dédié ni un agent de recherche autonome intégré à l'application, mais le plus simple des trois : un fichier JSON statique (`src/assets/referentials/use-model-footprints.json`), livré comme les autres référentiels embarqués ([[RT_02]], [[RT_23]]) et versionné avec le code de l'application — donc revu et modifiable comme n'importe quel autre fichier du dépôt (revue de PR, historique git par entrée). Il n'est pas régénéré par un script ([[RT_02]]/[[RT_12]]) faute de source structurée (constat ci-dessus) ; il est rempli entrée par entrée par l'assistant IA du projet (Claude), qui effectue lui-même la recherche des dimensions réelles pour chaque ligne de référentiel dont `base_size` vaut `Use model` et rédige la `sourceNote` correspondante — le joueur n'alimente jamais ce fichier depuis l'application, qui ne le consulte qu'en lecture ([[RG_02]]).

**Couverture exhaustive et deux niveaux de provenance (décision du 2026-09-11).** Ce référentiel couvre désormais la **totalité** des 208 lignes de modèle que [[RT_02]] laisse en `Use model` : aucune de ces lignes ne part plus en assignation manuelle. Cette exhaustivité n'a pas pu être atteinte à mesure égale, la donnée n'étant tout simplement pas publiée pour la majorité de ces modèles (essentiellement des kits Forge World hors production et des profils *Legends*) ; une entrée relève donc de l'un des deux niveaux de provenance suivants, que sa `sourceNote` énonce systématiquement :

1. **`mesure — ...`** — une mesure trouvée et citée (source communautaire, test de kit, fiche produit), éventuellement propagée telle quelle aux variantes qui partagent la **même coque** (un Razorback est le kit du Rhino, un Shadowsword celui du Baneblade) ; la `sourceNote` nomme alors le châssis de référence ;
2. **`estimation — ...`** — aucune mesure publiée n'a été trouvée : la valeur est déduite des proportions connues du kit et la `sourceNote` la marque explicitement comme estimation à confirmer.

Chaque `sourceNote` **commence** par l'un de ces deux mots suivi d'un tiret cadratin, de sorte que le niveau de provenance soit lisible d'un coup d'œil dans le libellé du socle ([[RG_02]]) comme vérifiable automatiquement.

Le second niveau est un compromis assumé : un gabarit approché à quelques millimètres près reste, pour planifier un déploiement, plus utile qu'une assignation manuelle redemandée à chaque import — mais il n'a pas la valeur d'une mesure et doit être corrigé dès qu'une mesure devient disponible. Les sessions de recherche ultérieures ne visent donc plus à *étendre* la couverture mais à **faire remonter des entrées du niveau 2 vers le niveau 1**.

**Forme du gabarit, au cas par cas.** Un modèle sans socle publié n'a le plus souvent pas de socle ovale du tout : son emprise au sol est celle de sa coque/carlingue, généralement **rectangulaire** (un char, un transport...), parfois arrondie à une extrémité ou franchement ovale/ronde (un monstre, un socle volant de grande taille...). Contrairement aux gabarits `AA x BBmm` de [[RT_02]], toujours traités comme un ovale, une entrée de [[RT_26]] ne présume donc pas systématiquement de la forme : celle-ci (`round`, `oval` ou **`rectangle`**) est établie individuellement à la recherche, à partir de ce que la source consultée donne à voir de la silhouette réelle du modèle, et enregistrée avec les deux dimensions. Ceci introduit une troisième forme de socle, rectangulaire, dans le référentiel de formes de [[RT_02]] (`BaseShapeKind`), en complément de `round` et `oval` — impactant en aval le rendu des tokens ([[RT_03]]) et le calcul d'échelle ([[RT_05]]), qui devront tous deux savoir dessiner un rectangle en plus d'un cercle/ovale.

**Clé et priorité de résolution.** Chaque entrée est indexée par une clé stable `<clé de la datasheet>::<clé de la ligne de modèle>` (mêmes clés normalisées que celles déjà utilisées pour le rapprochement de noms, [[RG_02]]). À la résolution d'un profil dont la ligne de référentiel publie `Use model`, cette table est consultée en priorité ; en l'absence d'entrée, le profil part en assignation manuelle simple ([[RG_02]]), sans mémorisation : le joueur devra la répéter à chaque import tant que l'entrée n'existe pas dans ce référentiel. Depuis la couverture exhaustive décrite ci-dessus, ce cas ne se présente plus pour les lignes `Use model` ; il resterait vrai d'une ligne `Use model` nouvellement introduite par une mise à jour de [[RT_02]] et pas encore renseignée ici.

**Portée.** Seules les lignes dont `base_size` vaut exactement `Use model` sont concernées ; les autres valeurs non exploitables de [[RT_02]] (`No official base size`, valeur vide) restent hors périmètre de ce référentiel et continuent de partir en assignation manuelle simple, faute même d'un modèle physique à mesurer de façon univoque pour ces cas.

### RT_28 — Socle rectangulaire personnalisé à l'assignation manuelle

**Principe.** En complément du choix d'un socle existant, l'assignation manuelle de [[RG_02]] propose au joueur de définir lui-même un socle rectangulaire, via deux champs numériques (`<input type="number">`) sur le récapitulatif d'import ([[RG_22]]) : longueur et largeur, toutes deux exprimées en **millimètres**, mesurées à l'horizontale sur le modèle physique en main — la même mesure que celle décrite pour [[RT_26]], mais faite par le joueur lui-même plutôt que recherchée par l'assistant IA. Seule la forme rectangulaire est proposée sur mesure (jamais ronde/ovale sur mesure) : un modèle dont l'emprise réelle est ronde ou ovale continue de piocher dans les socles déjà connus du référentiel, la forme rectangulaire étant la plus fréquente pour un modèle sans socle publié ([[RT_26]]). Les deux champs n'acceptent qu'une valeur strictement positive ; une valeur invalide ou manquante bloque la validation de l'assignation, sur le même principe que le reste du récapitulatif ([[RG_22]]).

**Modèle de données.** Contrairement à [[RT_26]] (référentiel partagé, indexé par profil), un socle sur mesure n'est pas une entrée de référentiel : c'est une donnée propre au groupe de modèles de cette unité, dans cette liste. `UnitModelGroup` porte un champ optionnel `customRectangleMm: { widthMm, lengthMm }`, mutuellement exclusif avec `baseShapeId` (l'un des deux est renseigné, jamais les deux) ; quand il est renseigné, le rendu du token ([[RT_03]]) et le calcul d'échelle ([[RT_05]]) l'utilisent directement en forme `rectangle` (introduite par [[RT_26]] dans `BaseShapeKind`), sans passer par la résolution du référentiel (`ReferentialService.baseShape`). Ce champ suit le cycle de vie normal de la liste : synchronisé avec elle comme n'importe quel autre champ d'`ArmyUnit.modelGroups` ([openapi.yml](openapi.yml)) — visible sur tous les appareils du joueur une fois synchronisé — mais, conformément à [[RG_02]], jamais réappliqué automatiquement à un import ultérieur du même profil, faute de mémorisation inter-imports.

### RG_36 — Unités attachées : lecture à l'import et modification au récapitulatif

Avant la bataille, le joueur peut attacher une unité de **personnage** à une unité **escortée** (*bodyguard*) que ce personnage peut mener. Les deux forment alors, pour toute la bataille, une seule **unité attachée**. Un personnage s'attache selon l'un de deux **rôles** : **meneur** (*leader*) ou **soutien** (*support*). La liste d'armée doit connaître ces attachements, parce qu'une unité attachée se déploie comme une seule unité ([[RG_37]]).

**Lecture à l'import.** Les attachements choisis par le joueur dans son list-builder sont lus dans la source ([[RT_13]], [[RT_45]]). Ils ne sont pas devinés à partir des capacités des personnages : qu'un personnage *puisse* mener une unité ne dit pas qu'il la mène.

**Composition.** Une unité attachée comprend une unité escortée et un ou plusieurs personnages, chacun avec son rôle. Les contraintes appliquées sont seulement structurelles :

- un personnage est attaché à **une seule** unité escortée ;
- une unité qui a un personnage attaché ne peut pas être elle-même attachée à une autre unité : les attachements ne s'enchaînent pas ;
- une unité ne peut pas être attachée à elle-même.

L'application **ne vérifie pas** les règles du jeu sur qui peut mener quoi, ni le nombre de meneurs et de soutiens par unité escortée. La règle générale est d'un de chaque, mais les exceptions (« sauf mention contraire ») sont propres à chaque datasheet. Le joueur, qui connaît sa liste, fait autorité. Un roster qui attache deux meneurs à la même unité est donc importé tel quel.

**Récapitulatif d'import ([[RG_22]]).** Le récapitulatif montre chaque unité attachée : la composition, les personnages avec leur rôle (« meneur », « soutien »), puis l'unité escortée. Avant de valider, le joueur peut :

- **défaire** un attachement : le personnage redevient une unité indépendante ;
- **constituer** un attachement : il choisit un personnage, une unité escortée et un rôle. Seuls les choix qui respectent les contraintes structurelles ci-dessus lui sont proposés.

Ces modifications ne valent que pour cet import. Comme les choix de socle de [[RG_02]], elles ne sont mémorisées nulle part ailleurs et ne se réappliquent pas à un import ultérieur.

**Attachement illisible.** Il arrive que la source déclare un attachement inexploitable. Par exemple, il vise une unité qui n'est pas retenue comme unité ([[RT_13]]), ou il enfreint une contrainte structurelle. L'attachement n'est alors **pas** créé, et le récapitulatif le signale en toutes lettres en nommant les unités concernées. Le joueur peut le recréer à la main s'il le souhaite. Le reste de la liste est importé normalement : un attachement est une information de déploiement, pas une condition pour interpréter la liste ([[RG_01]]).

**Après l'enregistrement.** Les attachements appartiennent à la liste d'armée, et donc à tous ses déploiements. Une fois la liste enregistrée, ils ne sont plus modifiables : pour en changer, le joueur ré-importe sa liste. Une liste importée avant cette règle n'a aucun attachement : ses unités se déploient comme avant, chacune indépendamment.

### RT_45 — Lecture des associations du roster JSON et modèle de données des attachements

**Source.** Dans le roster JSON de [[RT_13]], un attachement est décrit des deux côtés :

- la sélection de premier niveau du personnage porte une entrée `associations[]` de `type = "outgoing"`, dont `to` est l'`id` de la sélection de l'unité escortée ;
- l'unité escortée porte une entrée `incomingAssociations[]` symétrique, dont `from` est l'`id` du personnage.

Le `name` de l'association donne le rôle : `"Leading"` pour un meneur, `"Supporting"` pour un soutien. Les deux entrées portent le même `associationId`. Seule l'entrée `outgoing` fait foi. L'entrée `incoming` est redondante et n'est pas lue : une entrée `outgoing` sans contrepartie `incoming` reste donc prise en compte. Un `name` autre que ces deux valeurs rend l'attachement illisible au sens de [[RG_36]] : le rôle n'est pas deviné. Dans le jeu de référence [list_import.example.json](../src/assets/list_import.example.json), le Tech-Priest Manipulus mène les Kataphron Breachers, et le Cybernetica Datasmith soutient les Kastelan Robots.

**Résolution des identifiants.** Les `id` de sélection du roster ne sont pas conservés : chaque unité reçoit à l'import son propre identifiant stable ([[RT_07]]). Le parseur produit donc les attachements en **identifiants de sélection** ; la construction de la liste les convertit en identifiants d'unité de l'application, puis les contraintes structurelles de [[RG_36]] sont appliquées. Un `to` qui ne correspond à aucune unité retenue par [[RT_13]] produit un attachement illisible.

**Modèle de données.** Un personnage attaché porte sur son unité un champ optionnel `ArmyUnit.attachment: { bodyguardUnitId, role: 'leader' | 'support' }`. L'unité escortée ne porte rien : sa composition se dérive des unités qui la désignent, ce qui exclut deux descriptions divergentes du même lien. Le champ est absent pour une unité indépendante. Une liste enregistrée avant cette règle n'en a sur aucune unité et ne demande aucune migration ([[RT_08]]). Le champ fait partie du contrat de synchronisation (`ArmyUnit.attachment`, [openapi.yml](openapi.yml), [[RT_09]]), comme `modelGroups`.

**Duplication ([[RG_21]]).** La copie d'une liste attribue de nouveaux identifiants à ses unités. Les `bodyguardUnitId` sont convertis dans la même opération vers les identifiants de la copie, pour que la copie ne pointe jamais sur les unités de l'original.

**Lecture tolérante.** À la lecture d'une liste, une valeur qui ne respecte plus les contraintes de [[RG_36]] est ignorée sans erreur : le personnage est alors traité comme une unité indépendante. C'est le cas d'un `bodyguardUnitId` qui ne désigne aucune unité de la liste, d'une unité escortée elle-même attachée, ou d'un personnage attaché à lui-même. Cette lecture suit le même principe que les identifiants orphelins de [[RT_35]].

---

## EX_02 — Planification du déploiement sur plateau

Le joueur doit pouvoir positionner ses unités sur une représentation du plateau de jeu, en tenant compte de la disposition de force qu'il a choisie pour la partie.

Satisfait par : [[RG_03]], [[RG_04]], [[RG_05]], [[RG_12]], [[RG_14]], [[RG_15]], [[RG_16]], [[RG_17]], [[RG_20]], [[RT_03]], [[RT_04]], [[RT_11]], [[RT_12]], [[RT_16]], [[RT_17]], [[RT_18]], [[RT_19]], [[RT_22]], [[RT_23]], [[RT_24]], [[RT_27]], [[RT_34]], [[RG_25]], [[RT_35]], [[RG_26]], [[RT_36]], [[RG_30]], [[RG_31]], [[RT_40]], [[RG_32]], [[RT_41]], [[RG_37]], [[RT_46]]. L'agrandissement et le déplacement de la vue du plateau relèvent de [[EX_10]].

### RG_03 — Parcours de sélection : liste → disposition adverse → plateau → placement

Une fois qu'il a sélectionné, parmi celles déjà importées, la liste d'armée avec laquelle il joue, le joueur suit un parcours en trois étapes ordonnées avant de pouvoir placer la moindre unité. Sa propre disposition de force est déjà connue à ce stade — elle est fixée dès l'import de la liste ([[RG_02]]) et n'est pas redemandée dans ce parcours :

1. il choisit, parmi les **5 dispositions** proposées par l'application, celle de son **adversaire** — ces 5 dispositions (identifiant, libellé, icône) forment un référentiel statique embarqué, voir [[RT_23]]. Le rappel de la disposition du joueur affiché au centre du sélecteur n'est pas un choix : il est présenté dans une forme qui le distingue sans ambiguïté des 5 dispositions adverses sélectionnables, et ne porte jamais de code couleur de [[RG_12]] ;
2. il visualise les plateaux de jeu parmi les **3 plateaux** proposés pour le couple (sa disposition, la disposition adverse retenue à l'étape 1) ;
3. il accède à l'écran de placement des unités sur le plateau via les actions « Nouveau »/« Éditer » de [[RG_14]] une fois liste, disposition adverse et plateau déjà choisis pour une combinaison antérieure. Le contenu de cet écran de placement est détaillé par [[RG_15]] et [[RG_16]].Son affichage par [[RG_17]].

Chaque étape doit être complétée avant d'accéder à la suivante (pas de placement possible tant que la disposition adverse et le plateau n'ont pas été choisis). Le joueur peut revenir en arrière pour changer un choix précédent ; changer de disposition adverse ou de plateau après coup ne modifie pas les placements déjà enregistrés pour une autre combinaison liste/disposition adverse/plateau (voir [[RG_07]]). Aucune zone de déploiement n'est matérialisée ni validée automatiquement par l'application à l'étape 3 : le placement des tokens reste libre sur l'ensemble du plateau affiché, le joueur s'appuyant visuellement sur l'image (et sur la variante « with-measurements » en consultation, [[RG_14]]) pour respecter les règles de zone du jeu physique — c'est un choix de périmètre assumé, pas un oubli.

### RG_12 — Indicateurs de déploiement déjà enregistré (disposition adverse et plateau)

Le parcours décrit en [[RG_03]] affiche, à deux étapes, un indicateur de l'avancement des déploiements déjà sauvegardés pour la liste couramment sélectionnée. Ces indicateurs sont purement informatifs : ils n'empêchent jamais de créer un nouveau déploiement sur une combinaison déjà utilisée, et le joueur choisit explicitement s'il reprend un déploiement existant ou en démarre un nouveau.

**Étape 1 — choix de la disposition adverse.** Pour chacune des 5 dispositions adverses proposées, le bouton correspondant affiche un code couleur **et un compte** reflétant l'état des déploiements sauvegardés pour la combinaison (liste couramment sélectionnée, cette disposition adverse), sur l'ensemble des 3 plateaux qui lui seront associés à l'étape 2 :

- **Blanc** : aucun déploiement commencé sur les 3 plateaux (0 déploiement sur 3).
- **Jaune** : 1 ou 2 déploiements terminés sur les 3 plateaux (et aucun déploiement commencé mais non terminé parmi les 3).
- **Orange** : au moins un des 3 plateaux a un déploiement commencé mais non terminé — cet état est prioritaire sur les deux précédents, car il signale un travail interrompu que le joueur voudra probablement reprendre.
- **Vert** : les 3 déploiements sont terminés (3 déploiements sur 3).

Un déploiement sauvegardé est considéré **terminé** lorsque toutes les unités de la liste ont tous leurs modèles placés ou sont déclarées en réserve ([[RG_25]]) — c'est-à-dire lorsqu'aucune unité ne reste "en attente de déploiement" au sens de [[RG_05]] ; dans le cas contraire, il est considéré **commencé mais non terminé**. L'ordre de priorité pour déterminer la couleur est : Orange > Vert > Jaune > Blanc.

**Second canal ([[RG_24]]).** La couleur du bouton ne porte jamais seule l'information : chaque bouton affiche, sous le libellé de la disposition, le compte des déploiements terminés sur le nombre de plateaux du couple — `0/3`, `1/3`, `2/3`, `3/3` — suffixé de la mention « à reprendre » lorsque l'état orange s'applique, celui-ci n'étant pas déductible du seul compte (un déploiement commencé mais non terminé ne compte pas comme terminé et ne se distinguerait sinon pas de l'état blanc ou jaune). Une disposition sans aucun déploiement affiche donc `0/3`, une disposition avec deux plateaux terminés et un troisième interrompu affiche `2/3 · à reprendre`.

La légende des quatre couleurs, désormais redondante avec ce second canal, n'occupe plus l'écran en permanence : elle est repliée par défaut et dépliable à la demande, l'espace libéré revenant au sélecteur de disposition lui-même.

**Étape 2 — choix du plateau.** Une fois la disposition adverse retenue, l'application indique, pour chacun des 3 plateaux proposés, un statut individuel détaillé (code couleur à 3 états, distinct de celui de l'étape 1) ainsi que les actions de consultation/édition disponibles pour ce plateau — voir [[RG_14]].

### RG_14 — Statut individuel, consultation et actions par plateau (étape 2)

À l'étape 2 de [[RG_03]] (choix du plateau, une fois la disposition adverse retenue), chacun des 3 plateaux proposés affiche, en plus de son image, un **statut individuel** et jusqu'à trois actions contextuelles. Contrairement à l'indicateur agrégé de l'étape 1 ([[RG_12]]), ce statut porte sur le déploiement du triplet précis (liste, disposition adverse, ce plateau) :

- **Rouge** : déploiement manquant — aucun placement enregistré pour ce triplet, et aucune unité déclarée en réserve ([[RG_25]]) : rien n'y a encore été décidé.
- **Orange** : déploiement non fini — au moins un placement enregistré ou une unité en réserve, mais toutes les unités de la liste n'ont pas tous leurs modèles placés et ne sont pas non plus en réserve (au sens de [[RG_05]]).
- **Vert** : déploiement fait — toutes les unités de la liste ont tous leurs modèles placés ou sont en réserve.

**Présentation à l'écran.** Les 3 plateaux sont présentés un par un, dans un pager glissable horizontalement (un seul plateau visible à la fois) plutôt que juxtaposés côte à côte. Dans cette présentation, un unique bloc « Statut » et un unique jeu d'actions contextuelles sont affichés — en haut à droite du layout, immédiatement à droite du libellé « Statut » — et ne reflètent jamais que le plateau actuellement affiché par le pager ; ce statut individuel par plateau reste distinct de l'indicateur agrégé sur les 3 plateaux calculé à l'étape 1 ([[RG_12]]). Le bandeau des deux dispositions porte en outre le bouton « Missions », qui donne à lire la mission primaire du joueur et celle de l'adversaire pour ce couple ([[RG_48]]) ; il ne dépend pas du plateau affiché.

**Aperçu entièrement visible.** L'aperçu du plateau affiché tient entièrement dans la fenêtre, quelle que soit sa largeur : sur un écran large (navigateur de bureau, tablette ou téléphone en paysage), sa taille est bornée par la hauteur restant disponible sous le bandeau, le bloc « Statut » et les pastilles — et non plus seulement par la largeur — et il est centré horizontalement, de sorte que le joueur n'a jamais à faire défiler l'écran pour voir le plateau en entier avec son identification. Une hauteur plancher est conservée pour les fenêtres très basses, où l'écran redevient alors défilable plutôt que de réduire l'aperçu jusqu'à l'illisible.

**Second canal et identification du plateau ([[RG_24]]).** Le libellé de statut affiché dans le bloc « Statut » — « Déploiement manquant », « Déploiement non fini », « Déploiement fait » — est le second canal de ce code couleur, et l'application ne présente jamais le statut du plateau affiché sans lui. Les pastilles de navigation du pager, trop petites pour porter ce libellé, ne sont pas les porteuses du statut : elles reprennent sa couleur en rappel, exposent le libellé complet par leur nom accessible, et le numéro qu'elles portent désigne le plateau, pas son état.

Le plateau affiché est par ailleurs **identifié une seule fois** par cet écran, sous le pager, dans le même sens de lecture que le bandeau des deux dispositions qui le surmonte (la disposition du joueur d'abord, celle de l'adversaire ensuite) : une identification répétée, et *a fortiori* dans un ordre différent d'une occurrence à l'autre, empêche le joueur de savoir laquelle des deux dispositions est la sienne. Le bandeau de titre imprimé dans l'image du plateau par la source ([[RT_12]]) n'est pas une identification produite par l'application et ne compte pas comme telle ; il est masqué du cadrage de l'aperçu, sur le même principe que le rognage déjà retenu à l'écran de placement ([[RG_17]]/[[RT_19]]).

**Consultation du plateau seul, avec mesures.** Indépendamment du statut (y compris rouge), le joueur peut cliquer sur l'aperçu de chaque plateau pour l'afficher en plein écran avec les repères de mesure superposés (variante « with-measurements » de [[RT_12]]), avec possibilité de zoomer/dézoomer ; cette vue ne montre jamais les placements du joueur, seulement le plateau vierge, et sert à étudier le layout avant de s'engager sur un déploiement. L'invite indiquant que l'aperçu est agrandissable est placée en dehors de l'image, la légende imprimée en pied de celle-ci par la source ([[RT_12]]) étant un contenu porteur d'information qu'aucun élément superposé ne doit recouvrir ([[RT_31]]).

**Actions contextuelles, selon le statut :**

- **« Nouveau »** : toujours disponible, y compris quand un déploiement existe déjà (orange ou vert). Écrase le déploiement existant du triplet (remise à zéro des placements et des unités en réserve de [[RG_25]] ; la note de plan de jeu de [[RG_45]] est en revanche **conservée**) et ouvre l'écran de placement ([[RG_03]] étape 3) vide. Une action destructrice de ce type est confirmée explicitement par le joueur avant d'écraser quoi que ce soit, sur le même principe que [[RG_08]]. L'identifiant du déploiement du triplet ([[RT_07]]) est conservé (mise à jour en place, cf. [[RG_07]]) ; il n'existe jamais qu'un déploiement par triplet.
- **« Éditer »** : disponible uniquement quand un déploiement existe déjà pour ce triplet (statut orange ou vert) ; masqué/désactivé au statut rouge. Ouvre l'écran de placement préchargé avec les placements existants. Ce bouton est affiché en **orange** lorsque le déploiement existant est non fini, pour renforcer le signal donné par le statut du plateau.
- **« Consulter »** : disponible uniquement quand le déploiement de ce triplet est **terminé** (statut vert) ; masqué/désactivé aux statuts rouge et orange — un déploiement encore en cours de remplissage se reprend via « Éditer », pas via cette vue en lecture seule. Affiche en plein écran, zoomable, le plateau avec les placements du joueur superposés, en lecture seule (aucune édition possible), en utilisant cette fois la variante du plateau **sans** repères de mesure (« no-measurements » de [[RT_12]]). La note de plan de jeu du déploiement y est consultable en lecture seule ([[RG_46]]).

### RG_04 — Un token = un modèle

Un token posé sur le plateau représente un seul modèle physique, jamais une unité entière. Une unité de 10 modèles nécessite donc 10 placements distincts ; le joueur peut néanmoins déplacer/dupliquer rapidement les tokens restants d'une même unité pour accélérer la saisie.

### RG_20 — Rotation des tokens

Le joueur doit pouvoir faire pivoter un token déjà placé sur le plateau, notamment pour orienter correctement un socle non circulaire (ovale, rectangulaire...) par rapport à la disposition réelle du modèle sur la table. La rotation se manipule indépendamment de la position du token, à tout moment tant que l'écran de placement reste ouvert, et ne modifie ni son appartenance à une unité ni son statut de placement ([[RG_05]]).

### RG_05 — Unité non totalement déployée

Une unité dont tous les modèles n'ont pas encore été placés reste identifiable comme "en attente de déploiement" (par exemple dans une liste latérale), pour que le joueur n'oublie pas de modèles en réserve ou en attente. Une unité que le joueur a explicitement déclarée **en réserve** ([[RG_25]]) fait exception : elle n'a pas vocation à être posée sur le plateau et n'est donc plus en attente de déploiement.

### RG_25 — Mise en réserve d'une unité

Toutes les unités d'une liste ne commencent pas la partie sur la table : certaines sont annoncées **en réserve** et arrivent en cours de partie. L'écran de placement ([[RG_03]] étape 3) permet donc de déclarer en réserve l'unité couramment sélectionnée, par une **case à cocher** portée par le bandeau de [[RG_15]], et de l'en retirer par cette même case.

- **Une unité en réserve compte comme déployée.** Elle n'est plus « en attente de déploiement » au sens de [[RG_05]] : elle ne retient plus le statut « terminé » du déploiement ([[RG_12]], [[RG_14]]), compte comme complète dans le menu de [[RG_16]] et n'est plus proposée par les flèches du bandeau de [[RG_15]] — au même titre qu'une unité dont tous les modèles sont posés. Mettre une unité en réserve est une décision de déploiement que le joueur enregistre, pas un oubli qu'il faudrait lui rappeler.
- **La réserve appartient au déploiement, pas à la liste d'armée.** La même unité peut être en réserve sur un plateau et posée sur un autre : l'état est enregistré dans le déploiement du triplet (liste, disposition adverse, plateau), et suit ses règles de sauvegarde ([[RG_07]]) comme de remise à zéro ([[RG_14]], action « Nouveau »). Voir [[RT_35]].
- **Une unité en réserve n'a aucun token sur le plateau.** Mettre en réserve une unité dont des modèles sont déjà posés retire ces placements ([[RT_04]]) : l'opération étant destructrice, elle est confirmée explicitement par le joueur avant d'être appliquée, sur le même principe que [[RG_08]]. Le bandeau de [[RG_15]] ne propose alors plus aucun modèle pour cette unité.
- **Le retrait de la réserve est toujours possible.** Décocher la case remet l'unité en attente de déploiement, tous ses modèles à poser. Comme les flèches du bandeau ne s'arrêtent plus sur une unité en réserve, celle-ci reste atteignable par le menu de [[RG_16]], qui liste **toutes** les unités : l'y choisir positionne le bandeau dessus, case cochée, prête à être décochée.

**Unités attachées.** Une unité attachée ([[RG_36]]) entre en réserve et en sort tout entière, par une seule case ([[RG_37]]).

**Second canal ([[RG_24]]).** L'état de réserve est énoncé en toutes lettres partout où il change une lecture : le bandeau de [[RG_15]] remplace son compte de modèles restants par la mention « en réserve », et l'entrée du menu de [[RG_16]] porte cette même mention à côté de son compte `placés/total` — sans quoi le `0/10` d'une unité entièrement en réserve contredirait le fond vert de son entrée.

### RG_26 — Cohésion d'unité au placement

Une unité de plus d'un modèle doit être déployée **en cohésion**, conformément aux règles du jeu. Une unité est en cohésion lorsque **chacun** de ses modèles posés sur le plateau vérifie les deux conditions suivantes :

- **Contiguïté à 2".** Il se trouve à 2" au plus d'**au moins un autre** modèle de l'unité. Cette proximité doit former une **chaîne continue** : de proche en proche, par sauts de 2" au plus, tout modèle de l'unité doit pouvoir être relié à tous les autres. Deux grappes de modèles, chacune cohérente en interne mais séparées de plus de 2", ne forment **pas** une unité en cohésion, même si chaque modèle a individuellement un voisin à moins de 2".
- **Étendue maximale de 9".** Il se trouve à 9" au plus de **chacun** des autres modèles de l'unité — une chaîne continue ne suffit donc pas si elle s'étire au-delà de 9" d'un bout à l'autre.

**Mesure.** Conformément aux règles du jeu, une distance entre deux modèles est la **plus courte distance entre les bords de leurs tokens** — les points les plus proches de leurs deux socles —, et non la distance entre leurs centres : elle dépend donc de la forme, de la taille et de l'orientation ([[RG_20]]) de chaque socle, et vaut zéro pour deux socles qui se touchent. Voir [[RT_36]] pour le calcul. Le plateau étant une vue de dessus sans relief, seules les distances horizontales sont évaluées ; la condition verticale des règles du jeu (5") est réputée toujours satisfaite.

**Application au placement.** Le placement se faisant modèle par modèle ([[RG_04]]), la cohésion porte sur les modèles **déjà posés** de l'unité, pas sur ceux restant dans le bandeau de [[RG_15]] : le premier modèle posé d'une unité est toujours en cohésion, et chaque dépôt suivant doit la préserver. Tout geste qui modifierait la disposition des modèles posés d'une unité — dépôt d'un nouveau modèle, déplacement d'un token déjà posé, rotation ([[RG_20]]) — et qui la laisserait hors cohésion est **refusé**, au même titre qu'un dépôt hors du rectangle de jeu : aucun placement n'est créé ni modifié, et l'issue est annoncée au joueur **avant** le relâchement, pour qu'il sache que lâcher ici ne posera rien.

**Retrait d'un token qui coupe la chaîne.** Le retrait d'un token ([[RG_15]]) n'est pas refusé, mais il peut couper la chaîne de contiguïté en plusieurs groupes. Dans ce cas, l'application retire aussi des tokens jusqu'à ce que l'unité soit à nouveau en cohésion : elle **conserve le groupe qui garde le plus de tokens de l'unité sur le plateau**, et retire les autres. Les tokens retirés retournent dans le bandeau de [[RG_15]], l'unité redevenant en attente au sens de [[RG_05]]. Retirer un modèle ne peut pas faire dépasser l'étendue de 9" : seule la contiguïté est à rétablir. Parce qu'elle retire plus que le token choisi, l'opération est **confirmée explicitement** par le joueur avant d'être appliquée, sur le même principe que [[RG_08]], en indiquant combien de tokens supplémentaires seront retirés. Si plusieurs groupes sont à égalité de taille, le groupe conservé est celui qui contient le modèle posé le plus tôt.

**Déploiements enregistrés avant cette règle.** Un déploiement enregistré avant cette règle peut contenir des unités hors cohésion. Il est chargé **tel quel** : l'application ne retire ni ne déplace aucun token de son propre chef. Le refus des gestes vise seulement ceux qui feraient **perdre** la cohésion à une unité qui l'avait ; sur une unité déjà hors cohésion, les gestes restent permis pour que le joueur puisse la corriger, et le refus ne s'applique à nouveau qu'une fois la cohésion rétablie.

**Exemptions.** Une unité d'un seul modèle n'est pas concernée. Une unité en réserve ([[RG_25]]) n'a aucun token sur le plateau et n'est donc pas concernée non plus.

**Mode « Règle ».** En mode « Règle » ([[RG_33]]), le déplacement d'un token posé n'est pas refusé pour perte de cohésion ; la cohésion est rétablie à la sortie du mode, selon la règle du retrait ci-dessus ([[RG_35]]).

**Unités attachées.** La cohésion d'une unité attachée ([[RG_36]]) porte sur l'ensemble de ses composantes, personnages compris ([[RG_37]]).

### RG_30 — Sélection multiple par zone de sélection et déplacement groupé

Sur l'écran de placement ([[RG_03]] étape 3), le joueur peut sélectionner **plusieurs tokens posés à la fois** et les déplacer ensemble, pour repositionner d'un geste un groupe de modèles — une unité, une partie d'unité, ou des modèles de plusieurs unités — plutôt que token par token ([[RG_04]]).

**Zone de sélection.** Un glisser qui démarre sur une partie du plateau **où ne se trouve aucun token** trace un rectangle de sélection, matérialisé à l'écran pendant tout le geste. Le plateau n'étant ni zoomable ni déplaçable par le joueur ([[RG_17]]), ce geste n'entre en concurrence avec aucun pan. Au relâchement, sont sélectionnés **tous les tokens posés dont le socle est touché par le rectangle**, même partiellement : à l'échelle du plateau ([[RT_19]]), exiger qu'un socle soit entièrement contenu obligerait à un tracé d'une précision incompatible avec un doigt. Cette sélection remplace la précédente ; un rectangle qui ne touche aucun token, ou un simple appui sur le fond du plateau, désélectionne tout. Sur un appareil à clavier, maintenir **Maj** pendant le tracé **ajoute** les tokens touchés à la sélection existante au lieu de la remplacer. Seuls les tokens déjà posés sont sélectionnables : un modèle encore dans le bandeau ([[RG_15]]) ou en réserve ([[RG_25]]) n'a pas de position ([[RG_29]]). En mode « Règle » ([[RG_33]]), ce même geste trace une mesure au lieu d'un rectangle de sélection.

**Déplacement groupé.** Faire glisser **l'un des tokens sélectionnés** déplace tous les tokens sélectionnés du **même vecteur** : les positions relatives et les orientations ([[RG_20]]) sont conservées, seul `x`/`y` change. Faire glisser un token qui n'appartient pas à la sélection retombe sur le comportement de [[RG_04]] : la sélection devient ce seul token, et lui seul se déplace.

**Tout ou rien.** Le déplacement groupé est validé **dans son ensemble** ou pas du tout. Il est refusé, et **tous** les tokens reprennent leur position d'avant le geste, si l'un au moins des tokens déplacés :

- sortirait du rectangle de jeu ([[RT_19]]), au même titre qu'un dépôt hors du rectangle ([[RT_34]]) ;
- ferait perdre sa cohésion à une unité qui l'avait ([[RG_26]]). Une unité dont **tous** les modèles posés sont sélectionnés se translate rigidement et conserve donc sa cohésion ; une unité **partiellement** sélectionnée peut la perdre, et c'est alors le groupe entier qui est refusé. Les exemptions de [[RG_26]] (unité d'un seul modèle, unité déjà hors cohésion avant le geste) s'appliquent unité par unité.

Comme pour [[RG_26]], l'issue est annoncée au joueur **avant** le relâchement (état de dépôt refusé de [[RT_34]] appliqué à tous les tokens du groupe), pour qu'il sache que lâcher ici ne déplacera rien.

**Ce qui ne s'applique qu'à un token seul.** La rotation ([[RG_20]]), le retrait d'un token ([[RG_15]]/[[RG_26]]) et la coloration de la zone visible ([[RG_29]]) portent sur **un seul** token sélectionné : dès que la sélection en contient plusieurs, la poignée de rotation, l'action de retrait et la zone visible ne sont plus proposées. Ils redeviennent disponibles quand la sélection est ramenée à un token.

**Second canal ([[RG_24]]).** L'appartenance à la sélection ne repose jamais sur la seule couleur : chaque token sélectionné porte un contour distinct de son état non sélectionné, et le nombre de tokens sélectionnés est énoncé en toutes lettres (« N modèles sélectionnés ») tant que la sélection en contient plusieurs.

### RG_31 — Double clic sur un token : sélection de toute l'unité

Un **double clic** (double appui, sur écran tactile) sur un token posé sélectionne **tous les tokens posés de son unité**. Cette sélection remplace la précédente et se comporte ensuite comme toute sélection multiple ([[RG_30]]) : glisser l'un de ces tokens déplace l'unité entière d'un bloc, sans qu'elle perde sa cohésion ([[RG_26]]) puisque tous ses modèles posés se translatent ensemble.

- Seuls les modèles **déjà posés** de l'unité sont sélectionnés : ceux qui restent dans le bandeau ([[RG_15]]) ne le sont pas, et une unité en réserve ([[RG_25]]) n'a aucun token à sélectionner.
- Sur une unité d'un seul modèle, le double clic équivaut à la sélection simple du token.
- Le premier clic du double clic sélectionne le token comme d'ordinaire ([[RG_29]], [[RG_20]]) ; le second étend la sélection à l'unité, ce qui masque la zone visible et la poignée de rotation ([[RG_30]]).
- Pour un token d'une unité attachée ([[RG_36]]), l'unité sélectionnée est l'unité attachée entière ([[RG_37]]).

### RG_32 — Double appui sur le bandeau : saisie groupée des modèles restant à poser

Sur l'écran de placement ([[RG_03]] étape 3), un **double appui sur le bandeau** de [[RG_15]] — sur l'en-tête de l'unité ou sur sa rangée de modèles, mais ni sur les flèches ni sur la case « en réserve » — sélectionne **tous les modèles restant à poser** de l'unité courante. Glisser ensuite l'un de ces modèles vers le plateau emporte **tous** les modèles sélectionnés en un seul geste : ils sont matérialisés ensemble sous le point de contact ([[RT_34]]), en une **grappe compacte** de socles jointifs ([[RT_41]]), et posés ensemble au relâchement. Le double appui peut s'enchaîner directement avec le glisser : le second appui, maintenu, saisit déjà la grappe.

- **Périmètre.** Seuls les modèles encore dans le bandeau sont concernés ; les tokens déjà posés de l'unité ne sont ni sélectionnés ni déplacés par ce geste (leur sélection groupée relève de [[RG_31]]). Une unité en réserve ([[RG_25]]) ou complète n'a rien à sélectionner. S'il ne reste qu'un modèle, le double appui équivaut à un glisser ordinaire ([[RG_04]]).
- **Forme de la grappe.** La disposition est fixée par l'application, sans choix offert au joueur : les plus grands socles au centre, les autres jointifs autour, au plus près du centre ([[RT_41]]). Des socles jointifs sont à 2" les uns des autres par construction et tiennent la grappe dans l'étendue de 9" de [[RG_26]] pour les effectifs usuels d'une unité (voir « Suivi des écarts ») ; le joueur ajuste ensuite les modèles individuellement.
- **Orientation.** Tous les modèles de la grappe sont posés avec la rotation par défaut (0°). La rotation ([[RG_20]]) ne portant que sur un token seul ([[RG_30]]), le joueur oriente ensuite chaque socle non circulaire un par un.
- **Tout ou rien.** Comme pour [[RG_30]], le dépôt groupé est refusé **dans son ensemble** si le centre de l'un des socles tombe hors du rectangle de jeu ([[RT_19]]), ou si l'unité — ses modèles déjà posés compris — ne serait pas en cohésion ([[RG_26]]). Pour une unité déjà partiellement posée, la grappe doit donc rejoindre la chaîne existante. Les exemptions de [[RG_26]] s'appliquent (unité déjà hors cohésion avant le geste). L'issue est annoncée au joueur **avant** le relâchement, et un dépôt refusé ne pose rien : la sélection du bandeau est conservée pour une nouvelle tentative.
- **Après le dépôt.** Les tokens créés deviennent la sélection courante du plateau ([[RG_30]]) : le joueur peut aussitôt repositionner le groupe d'un bloc. Le bandeau se vide de ces modèles et l'avance automatique de [[RG_15]] s'applique.
- **Désélection.** Un appui sur le bandeau hors de sa rangée de modèles, un changement d'unité (flèches de [[RG_15]], menu de [[RG_16]], mise en réserve de [[RG_25]]), ou un appui sur le plateau (fond ou token) annule la sélection du bandeau.
- **Unités attachées.** Pour une unité attachée ([[RG_36]]), les modèles restant à poser sont ceux de toutes ses composantes, réunis en une seule grappe ([[RG_37]]).
- **Second canal ([[RG_24]]).** Les modèles sélectionnés dans le bandeau portent un contour distinct de leur état non sélectionné, et le bandeau énonce « N modèles sélectionnés » à la place de son compte de modèles restants tant que la sélection en contient plusieurs.

### RG_15 — Sélecteur d'unité à placer (bandeau bas d'écran)

L'écran de placement ouvert par l'étape 3 de [[RG_03]] (y compris via les actions « Nouveau »/« Éditer » de [[RG_14]]) affiche, ancré en bas de l'écran, un bandeau de sélection de l'unité en cours de placement, regroupant dans un même encadré :

- le **nom de l'unité** couramment sélectionnée ;
- une **flèche de part et d'autre** du bandeau permettant de passer à l'unité précédente/suivante de la liste, sans avoir à repasser par le menu détaillé de [[RG_16]] ;
- une **case à cocher « en réserve »** portant sur l'unité couramment sélectionnée ([[RG_25]]) : c'est le seul endroit d'où la réserve se déclare et d'où elle se retire ;
- la **liste des modèles individuels** de l'unité sélectionnée, disponibles au drag & drop un par un vers le plateau, conformément à [[RG_04]] (un token = un modèle) : une unité de 10 modèles présente ainsi 10 éléments distincts dans cette liste, jamais un seul élément représentant l'unité entière. Cette liste est **défilable horizontalement** pour rester ergonomique quel que soit le nombre de modèles de l'unité (voir [[RT_17]]). Un double appui sur le bandeau sélectionne tous ces modèles pour les poser d'un seul geste ([[RG_32]]).

Le bandeau ne liste que ce qu'il **reste à poser** : un modèle déposé sur le plateau en **sort immédiatement**, et une unité dont tous les modèles sont placés — ou qui est en réserve ([[RG_25]]) — n'est plus atteignable par les flèches du bandeau. Le bandeau répond ainsi à la seule question qu'il pose — « que me reste-t-il à déployer ? » (cf. [[RG_05]]) — sans que le joueur ait à distinguer, parmi des socles tous affichés, ceux qui sont déjà sur la table ; une liste qui se vide au fil des dépôts énonce du même coup l'avancement de l'unité.

Le passage à l'unité suivante est **automatique** dès que le dernier modèle de l'unité courante est posé : le bandeau bascule sur l'unité encore en attente qui suit, pour que le joueur enchaîne ses placements sans manipuler les flèches. Lorsque plus aucune unité n'est en attente, le bandeau reste sur l'unité courante et signale qu'elle est complète. À la réouverture d'un déploiement déjà commencé, le bandeau s'ouvre de la même façon sur la première unité encore en attente, et non sur la première unité de la liste.

Le **repositionnement** d'un modèle déjà posé se fait alors sur le plateau lui-même, en faisant glisser son token ([[RG_04]]), et son retrait par l'action prévue à cet effet ([[RG_20]]) — qui le fait réapparaître dans le bandeau, l'unité redevenant en attente au sens de [[RG_05]]. Le menu de [[RG_16]], lui, continue de lister **toutes** les unités, y compris celles qui sont complètes : c'est la vue d'ensemble du déploiement, et y choisir une unité complète reste possible — le bandeau s'y positionne et affiche qu'elle n'a plus rien à poser.

**Le bandeau suit la sélection du plateau.** Lorsque le joueur sélectionne sur le plateau un ou plusieurs tokens posés ([[RG_29]], [[RG_30]], [[RG_31]]) et que **tous** appartiennent à **une seule et même unité**, le bandeau bascule sur cette unité — y compris si elle est complète, auquel cas il affiche, comme depuis le menu de [[RG_16]], qu'elle n'a plus rien à poser. Le joueur retrouve ainsi sous le doigt les modèles restant à poser de l'unité qu'il est en train d'ajuster, sans passer par les flèches ni par le menu. Une sélection vide, ou mêlant des tokens de plusieurs unités, laisse le bandeau sur l'unité courante. Seule une sélection faite **sur le plateau** déclenche cette bascule : les tokens que crée un dépôt depuis le bandeau ([[RG_04]], [[RG_32]]) appartiennent déjà à l'unité courante, et l'avance automatique à l'unité suivante qui suit la pose du dernier modèle n'est pas annulée par eux.

**Unités attachées.** Une unité attachée ([[RG_36]]) est une seule entrée du bandeau, dont la rangée réunit les modèles de toutes ses composantes ([[RG_37]]).

### RG_16 — Menu unités (burger) : vue d'ensemble, regroupement par socle et statut

En haut à droite de l'écran de placement, une icône de menu (burger) ouvre une liste, **défilable verticalement**, de toutes les unités de la liste d'armée en cours de déploiement, rendue comme un panneau latéral coulissant depuis le bord droit de l'écran (le plateau reste partiellement visible sur sa gauche pendant que le panneau est ouvert — voir [[RT_24]]) :

- Chaque entrée affiche le **nom de l'unité**, ainsi que ses socles **regroupés par forme/taille avec un compte** associé à chaque groupe (par exemple, une unité composée de 10 socles de 40 mm, 9 socles de 20 mm et 1 socle ovale 20×40 mm affiche trois groupes avec leurs comptes respectifs : `× 10`, `× 9`, `× 1`). Le regroupement affiche la **forme du socle** (pictogramme, cf. référentiel [[RT_02]]) plutôt que sa valeur en millimètres, pour rester lisible d'un coup d'œil.
- Cliquer sur une entrée **ferme le menu burger** et **bascule le bandeau de [[RG_15]]** sur l'unité choisie, prête à recevoir des placements.
- Le fond de chaque entrée reflète l'**état de placement de l'unité** (au sens de [[RG_05]] : une unité dont tous les modèles ne sont pas placés reste identifiable comme en attente) **et ce même état est énoncé par un compte**, `modèles placés / modèles de l'unité`, affiché dans l'entrée à un cran typographique et une couleur de texte qui ne l'effacent pas devant le nom de l'unité ([[RT_30]]) :
  - **Blanc** : aucun modèle de l'unité n'est encore placé.
  - **Orange** : au moins un modèle est placé, mais au moins un des groupes de socle de l'unité n'est pas complètement placé.
  - **Vert** : tous les modèles de l'unité (tous groupes de socle confondus) sont placés, **ou** l'unité est déclarée en réserve ([[RG_25]]) — auquel cas l'entrée porte en toutes lettres la mention « en réserve », son compte `placés/total` restant celui des modèles réellement posés.

  Ce code couleur est propre à l'échelle de l'unité, dans ce menu ; il est distinct de ceux définis pour le statut d'un plateau ([[RG_14]]) et pour l'indicateur agrégé par disposition adverse ([[RG_12]]), qui portent sur un périmètre différent (tout le déploiement, pas une unité isolée).

**Second canal ([[RG_24]]).** Le compte `placés/total` de l'unité est le second canal de ce code couleur ; il est affiché pour toutes les unités, y compris à `0/10` et à `10/10`, et jamais seulement pour les unités partiellement placées. Le compte propre à chaque groupe de socle suit la même forme — `placés/total` — plutôt qu'une multiplication suivie d'un compte séparé : deux nombres consécutifs séparés par un simple espace (« × 1 0 posé ») se lisent comme un seul nombre et rendent le groupe inintelligible.

**Unités attachées.** Une unité attachée ([[RG_36]]) est une seule entrée du menu, à laquelle s'appliquent les comptes et le statut ci-dessus ([[RG_37]]).

### RG_17 — Affichage du plateau à taille maximale, zoom de base déterminé automatiquement

Sur l'écran de placement ([[RG_03]] étape 3), le plateau est affiché à la plus grande taille possible dans l'espace disponible (sous le bandeau de [[RG_15]] et sous l'accès au menu burger de [[RG_16]]), à un **niveau de zoom de base déterminé automatiquement** par l'application. Contrairement aux visualiseurs de consultation plein écran de [[RG_14]] (« plateau seul » et « Consulter », zoomables/déplaçables au doigt — [[RT_16]]), ce zoom n'est **pas réglable librement** sur l'écran de placement : pas de pincer-zoomer, pas de zoom à la molette, pas de défilement du plateau lui-même. Le joueur dispose seulement de **deux niveaux d'agrandissement, ×2 et ×4**, parcourus par un bouton unique ([[RG_38]]) et, une fois agrandi, du déplacement de la vue par le mode « Déplacement » ([[RG_39]]) ; hors de ces deux contrôles, seuls les tokens sont manipulables, par drag & drop ([[RG_04]]).

Tout ce qui entoure le rectangle de jeu dans l'image du plateau ([[RT_05]] : bandeau de titre en haut, pied de légende en bas, marges latérales) est **rogné** de cet affichage — voir [[RT_19]] pour le calcul — car cela ne porte plus d'information utile une fois liste, disposition adverse et plateau déjà choisis, et réduisait d'autant la taille utile du plateau à l'écran.

### RT_03 — Rendu du plateau et des tokens

Le plateau et les tokens sont rendus via SVG, pour un rendu net à n'importe quelle échelle — notamment au niveau de zoom fixe calculé par [[RT_19]] — et un drag-and-drop tactile précis des tokens sur mobile, sans perte de précision de positionnement. Contrairement aux visualiseurs de consultation ([[RT_16]]), le conteneur du plateau sur l'écran de placement n'expose aucun geste de zoom libre (voir [[RG_17]]) : hors du déplacement de vue de [[RG_39]]/[[RT_48]], seul le déplacement des tokens est interactif, et les facteurs ×2 et ×4 de [[RG_38]] ne s'obtiennent que par son bouton ([[RT_47]]). Le retour visuel de ce déplacement pendant le geste — token suivant le doigt ou le curseur — est décrit par [[RT_34]].

### RT_04 — Modèle de données de placement

Un placement est stocké comme un enregistrement `{ idUnite, idModele, x, y, rotation }` indépendant des autres modèles de la même unité, afin que RG_04 et RG_05 puissent être vérifiées par simple comptage/filtrage sans recalcul géométrique. Le champ `rotation` est celui manipulé par [[RG_20]]/[[RT_22]]. La mise en réserve d'une unité ([[RG_25]]) ne fabrique **aucun** enregistrement de placement : elle est stockée à part, sur le déploiement, par [[RT_35]] — la liste des placements reste ainsi le reflet exact de ce qui est posé sur le plateau.

### RT_22 — Interaction de rotation d'un token

La rotation d'un token sélectionné ([[RG_20]]) se pilote par un geste dédié (poignée de rotation affichée sur le token sélectionné, ou geste tactile à deux doigts) superposé au rendu SVG du plateau ([[RT_03]]) ; elle met à jour le seul champ `rotation` de l'enregistrement de placement ([[RT_04]]) sans toucher à `x`/`y`.

### RT_34 — Retour visuel du geste de glisser d'un token

**Principe.** Tout glisser de token de l'écran de placement est matérialisé **sous le point de contact, pendant toute la durée du geste** : le token suit le doigt (ou le curseur) du premier contact au relâchement, plutôt que de n'exister qu'une fois déposé. Sans ce retour, le glisser d'un modèle depuis le bandeau de [[RG_15]] ne produit aucun changement visible avant le dépôt : rien ne distingue un glisser en cours d'un appui sans effet, et le joueur ne voit pas où son modèle va se poser avant qu'il ne s'y trouve.

**Glisser depuis le bandeau ([[RG_15]]/[[RT_17]]).** Aucun enregistrement de placement ([[RT_04]]) n'est créé avant le relâchement — la règle reste inchangée : le retour est un **rendu seul**, sans écriture ni sauvegarde ([[RG_07]]) pendant le geste. Le token provisoire est dessiné dans la forme et la couleur du socle concerné ([[RG_06]], [[RT_05]]), **à la taille exacte qu'il aura une fois posé**, pour que le joueur juge l'emprise réelle du socle sur le plateau avant de lâcher. Il est rendu **hors du conteneur rogné** du plateau ([[RT_19]]) afin de rester visible tant que le doigt n'a pas encore quitté le bandeau. L'élément d'origine dans le bandeau s'affiche pendant ce temps comme **saisi** (et non retiré : le retirer rétrécirait la rangée sous le doigt, ce qu'interdit [[RT_33]]). Le glisser d'une grappe de modèles sélectionnés par double appui ([[RG_32]]) suit les mêmes principes pour chacun de ses socles, avec un repère propre au groupe ([[RT_41]]).

**Lisibilité sous le doigt.** Au zoom fixe de [[RT_19]], un socle de 32 mm mesure une dizaine de pixels CSS — moins que la surface de contact d'un doigt, qui le masque donc intégralement. Le token provisoire est par conséquent accompagné d'un **cercle de visée**, de rayon supérieur à celui du doigt, centré sur le point exact où le centre du socle se posera : c'est lui, et non le token, qui reste visible pendant le geste tactile.

**Dépôt refusé.** Un dépôt hors du rectangle de jeu ([[RT_19]]) ne crée aucun placement. Cette issue est annoncée **avant** le relâchement : dès que le point de contact sort du rectangle de jeu, le token provisoire et son cercle de visée passent dans un état distinct, pour que le joueur sache que lâcher ici ne posera rien.

**Déplacement d'un token déjà posé ([[RG_04]]).** Le token lui-même suit déjà le doigt, ses coordonnées [[RT_04]] étant mises à jour en continu ; le geste conserve l'écart entre le point de contact et le centre du socle relevé à la saisie, pour que le token ne saute pas sous le doigt au premier déplacement. S'y ajoute le seul retour manquant : le token saisi est rendu dans un état **saisi** distinct de l'état sélectionné, et porte le même cercle de visée, pour la même raison de lisibilité sous le doigt.

### RT_35 — Enregistrement de la mise en réserve et propagation aux statuts

**Stockage.** Les unités en réserve ([[RG_25]]) sont enregistrées dans le déploiement ([[RT_06]]) sous forme d'une liste d'identifiants d'unité, `reservedUnitIds`, à côté des placements de [[RT_04]] — et non dans la liste d'armée ([[RT_07]]), dont les déploiements sont multiples et indépendants les uns des autres. Un identifiant qui ne correspond à aucune unité de la liste (unité disparue d'un ré-import) est ignoré à la lecture : il ne produit ni erreur ni unité fantôme. Les enregistrements écrits avant cette règle n'ont pas le champ ; il est normalisé à la liste vide au chargement, aucune migration de schéma n'étant nécessaire ([[RT_08]]). Le champ fait partie du contrat de synchronisation ([openapi.yml](openapi.yml), [[RT_09]]) au même titre que les placements.

**Propagation.** Les calculs de [[RT_11]] et [[RT_18]] reçoivent l'ensemble des unités réservées en entrée, à côté des placements : une unité réservée est comptée comme complète sans qu'aucun placement ne soit fabriqué pour elle. Le rendu des tokens ([[RT_03]]) n'a donc pas à connaître la réserve, et la liste des placements reste le reflet exact de ce qui est posé sur le plateau.

**Statut « manquant ».** Un déploiement sans aucun placement mais portant au moins une unité en réserve n'est pas « déploiement manquant » au sens de [[RG_14]] : le joueur y a enregistré une décision. Le test du statut rouge porte donc sur l'absence **conjointe** de placement et d'unité réservée, et le compte de déploiements de l'écran d'accueil suit le même critère.

### RT_36 — Calcul de la cohésion d'unité

**Distance entre deux tokens.** La distance de [[RG_26]] est la plus courte distance entre les **bords** des deux tokens, calculée dans l'espace en pixels de l'image du plateau ([[RT_04]]) puis convertie en pouces avec l'échelle de [[RT_05]]. Chaque token est la forme de son socle (cercle, ovale, rectangle de [[RT_28]]) placée à son centre `x`/`y` et tournée de sa `rotation` ([[RT_22]]). Deux tokens qui se touchent ou se chevauchent sont à une distance nulle.

- **Deux cercles** : distance entre les centres, moins la somme des rayons (ramenée à zéro si négative). Calcul exact.
- **Tout autre couple** (au moins un ovale ou un rectangle) : les deux formes sont convexes. Un ovale est approché par un polygone inscrit dont le nombre de côtés garantit un écart inférieur à 0,01" avec l'ellipse réelle ; un rectangle est déjà un polygone. La distance est la plus courte distance entre les deux polygones convexes tournés (nulle s'ils se chevauchent).

Les seuils de 2" et 9" sont comparés avec une tolérance de 0,01", pour qu'un token posé exactement au seuil ne soit pas refusé à cause d'un arrondi.

**Contiguïté.** Les modèles posés d'une unité forment un graphe dont deux nœuds sont reliés quand leurs tokens sont à 2" au plus. La contiguïté de [[RG_26]] est respectée lorsque ce graphe forme une seule composante connexe (parcours en largeur depuis n'importe quel modèle). L'étendue de 9" est vérifiée sur toutes les paires de modèles.

**Contrôle pendant le geste.** Lors d'un dépôt ou d'un déplacement ([[RT_34]]), la cohésion est recalculée à chaque mouvement du point de contact, avec le token saisi à sa position provisoire. Un résultat hors cohésion met le token provisoire et son cercle de visée dans le même état de **dépôt refusé** qu'une sortie du rectangle de jeu ; au relâchement, aucun enregistrement de placement n'est écrit ([[RT_04]]) et un token déjà posé reprend sa position d'avant le geste. La rotation ([[RT_22]]) suit le même contrôle. Pour une unité déjà hors cohésion au début du geste (déploiement antérieur à [[RG_26]]), aucun geste n'est refusé. En mode « Règle », ce contrôle n'est pas appliqué aux déplacements ([[RT_44]]).

**Retrait.** Au retrait d'un token, les composantes connexes du graphe restant sont calculées. S'il y en a plus d'une, la plus grande est conservée ; en cas d'égalité, celle qui contient le placement le plus ancien. Le placement le plus ancien est déterminé par l'ordre des enregistrements de placement du déploiement, qui suit l'ordre des dépôts. Les placements des autres composantes sont supprimés dans la même écriture que celui du token retiré, après confirmation du joueur.

### RT_40 — Interaction de sélection multiple et de déplacement groupé

**Sélection.** L'état de sélection de l'éditeur de placement ([[RT_03]]) passe d'un token à un **ensemble** de tokens, identifiés par `{ idUnite, idModele }` ([[RT_04]]). Cet état est purement local à l'écran : il n'est ni persisté ni synchronisé ([[RT_09]]), et n'écrit aucun enregistrement de placement. Le rectangle de sélection ([[RG_30]]) est tracé aux Pointer events, dans le même repère que les tokens, et rendu dans le SVG **au-dessus** des tokens, en couleur de token de [[RT_29]] défini dans les deux thèmes. Le test d'appartenance est une intersection entre le rectangle et le **polygone** de chaque socle, tel que construit par [[RT_36]] (position `x`/`y`, `rotation`, forme cercle/ovale/rectangle), et non un test sur le centre du token.

**Double clic.** L'événement `dblclick` n'étant pas fiable sur écran tactile, le double clic ([[RG_31]]) est détecté à partir des Pointer events : deux appuis sur le **même token**, séparés de moins de 300 ms et de moins de 10 px, sans glisser entre les deux. Le second appui remplace la sélection par l'ensemble des placements de l'unité du token.

**Bandeau.** La bascule du bandeau sur l'unité sélectionnée ([[RG_15]]) est appliquée explicitement aux seuls points où un geste sur le plateau fixe la sélection (saisie d'un token, double clic, relâchement du rectangle, réduction d'un groupe à un token) — et non par un effet réactif sur l'état de sélection, qui ramènerait le bandeau sur l'unité qu'un dépôt vient de compléter, à l'encontre de son avance automatique. Le critère porte sur les `idUnite` ([[RT_04]]) des placements sélectionnés : un seul identifiant distinct fait basculer le bandeau, zéro ou plusieurs le laissent en place.

**Déplacement groupé.** Le geste de [[RT_34]] est conservé : l'écart entre le point de contact et le centre du token saisi est relevé à la saisie, et le **vecteur de déplacement** ainsi obtenu est appliqué à chaque token de la sélection. À chaque mouvement du point de contact, la validité du groupe est recalculée — appartenance de chaque socle au rectangle de jeu ([[RT_19]]), puis cohésion ([[RT_36]]) de chacune des seules unités dont au moins un token est déplacé, avec tous les tokens du groupe à leur position provisoire. Un seul résultat négatif met **tous** les tokens du groupe dans l'état de dépôt refusé de [[RT_34]]. Le rendu pendant le geste est un rendu seul : les coordonnées [[RT_04]] ne sont écrites qu'au relâchement, **en une seule écriture** pour tous les tokens déplacés (une seule sauvegarde, [[RG_07]]), ou pas du tout en cas de refus. La zone visible ([[RT_38]]) n'est pas calculée tant que la sélection contient plus d'un token.

### RT_41 — Double appui sur le bandeau et formation de la grappe

**Sélection du bandeau.** La sélection de [[RG_32]] est un ensemble d'identifiants de modèle (`idModele`) de l'unité courante, distinct de la sélection de tokens posés de [[RT_40]] : il désigne des modèles qui n'ont encore aucun placement ([[RT_04]]). Comme elle, elle est purement locale à l'écran, ni persistée ni synchronisée ([[RT_09]]). Elle est vidée à tout changement d'unité du bandeau et à tout appui sur le plateau ; un modèle qui quitte le bandeau en sort de fait, la liste du bandeau étant dérivée des placements ([[RT_17]]).

**Détection.** Même critère que le double clic de [[RT_40]] : deux appuis dans la zone du bandeau, séparés de moins de 300 ms et de moins de 10 px, sans glisser entre les deux. Les flèches et la case « en réserve » ne participent pas à la détection. Un défilement horizontal de la rangée ([[RT_17]]) dépasse 10 px et n'est donc jamais pris pour un appui. Le premier appui, sur un modèle, commence un glisser ordinaire ([[RT_34]]) qui, relâché dans le bandeau, ne pose rien ; le second remplace la sélection du bandeau par tous ses modèles et, s'il est sur un modèle, saisit la grappe.

**Formation.** À la saisie, les socles sélectionnés sont convertis en pouces réels ([[RT_05]], comme pour [[RT_36]]), rotation 0, et triés par plus grande dimension décroissante (ordre du bandeau à égalité). Le premier est placé à l'origine. Chacun des suivants est placé, parmi 24 directions autour de chaque socle déjà placé, à la position où il **touche** ce socle à 0,5 mm près le long de cette direction, sans chevaucher aucun autre, en retenant celle qui est la plus proche du premier socle — un centre de gravité mobile ferait dériver la grappe du côté des petits socles. Tous les socles étant à rotation nulle, contact et chevauchement se décident par les **fonctions de support** du cercle, de l'ellipse et du rectangle (demi-étendue du socle projeté sur une direction ; le contact est exact pour deux socles ronds, et l'absence de chevauchement est garantie par un axe séparateur) plutôt que par les polygones de [[RT_36]] : la formation d'une unité de 20 ovales reste instantanée. Le résultat est recentré sur le centre de son rectangle englobant, puis converti en décalages en pixels d'asset. Ces décalages sont **figés** pour toute la durée du geste : chaque mouvement ne fait que les translater pour que le centre de la grappe suive le point de contact, sans recalcul de la formation. La formation est une fonction pure (`src/app/deployment/cluster.ts`), indépendante de l'affichage.

**Validité pendant le geste.** À chaque mouvement, les placements candidats (point de contact + décalage de chaque socle) sont contrôlés : centre de chaque socle dans le rectangle de jeu ([[RT_19]]), puis cohésion de l'unité ([[RT_36]]) avec ses placements existants et tous les candidats, sauf si l'unité était déjà hors cohésion à la saisie. Un seul résultat négatif met toute la grappe dans l'état de dépôt refusé.

**Rendu pendant le geste.** Ce que [[RT_34]] prévoit pour un token seul s'applique à toute la grappe : chaque socle provisoire à sa taille exacte, dans la couleur de l'unité ([[RG_06]]), rendu hors du conteneur rogné du plateau, et les modèles d'origine affichés comme « saisis » dans le bandeau. S'y ajoutent un **cercle de visée** sur le centre de la grappe — le point qui suit le doigt — et un **cercle englobant** tracé autour de tous les socles, qui matérialise l'emprise du groupe ; tous deux portent l'état de dépôt refusé.

**Écriture.** Au relâchement validé, tous les placements ([[RT_04]]) sont créés **en une seule écriture** (une seule sauvegarde, [[RG_07]]), avec la rotation 0, puis deviennent la sélection de [[RT_40]]. En cas de refus, rien n'est écrit.

### RG_37 — Déploiement d'une unité attachée comme une seule unité

Selon les règles du jeu, une unité attachée ([[RG_36]]) est **une seule unité** pendant toute la bataille. L'écran de placement ([[RG_03]] étape 3) la traite donc comme une unité **unique** dans toutes les règles de déploiement. Ses composantes (personnages et unité escortée) restent cependant distinctes par leurs socles et leurs couleurs.

**Ce qui porte sur l'unité attachée entière.** Dans les règles suivantes, une unité attachée tient lieu d'« unité » :

- **Bandeau ([[RG_15]]).** L'unité attachée est **une seule entrée**, et les flèches s'y arrêtent une seule fois. Son nom énonce sa composition : les personnages d'abord, puis l'unité escortée (« Tech-Priest Manipulus + Kataphron Breachers »). Sa rangée réunit les modèles restant à poser de toutes ses composantes, dans le même ordre. L'avance automatique à l'unité suivante a lieu quand le dernier modèle de **toute** l'unité attachée est posé. Le bandeau bascule sur l'unité attachée quand la sélection du plateau ne contient que des tokens de cette unité attachée, quelles que soient leurs composantes.
- **Menu unités ([[RG_16]]).** L'unité attachée est **une seule entrée**, sous le même nom composé. Ses groupes de socle sont ceux de toutes ses composantes. Son compte `placés/total` et son fond blanc / orange / vert portent sur l'ensemble de ses modèles. Choisir l'entrée positionne le bandeau sur l'unité attachée.
- **Réserve ([[RG_25]]).** La case « en réserve » porte sur l'unité attachée entière : la cocher met toutes ses composantes en réserve, et la décocher les en retire toutes. La confirmation de retrait des tokens déjà posés compte les tokens de toutes les composantes.
- **Cohésion ([[RG_26]]).** La contiguïté à 2" et l'étendue de 9" sont évaluées sur **tous** les modèles posés de l'unité attachée, toutes composantes confondues. Un personnage doit donc être en cohésion avec son unité escortée. Une unité escortée sans son meneur doit être en cohésion avec elle-même, et le meneur doit ensuite la rejoindre. Le retrait d'un token qui coupe la chaîne conserve le plus grand groupe de **l'unité attachée**. Les exemptions de [[RG_26]] s'appliquent à l'unité attachée : elle est exemptée si elle n'a qu'un seul modèle posé, mais pas parce qu'une de ses composantes n'en a qu'un. Le mode « Règle » ([[RG_35]]) retaille de même l'unité attachée entière à sa sortie.
- **Sélection de toute l'unité ([[RG_31]]).** Un double clic sur un token sélectionne les tokens posés de **toute** l'unité attachée.
- **Saisie groupée ([[RG_32]]).** Un double appui sur le bandeau sélectionne les modèles restant à poser de **toute** l'unité attachée. La grappe les réunit tous, les plus grands socles au centre, sans distinction de composante.
- **Statuts ([[RG_05]], [[RG_12]], [[RG_14]]).** Ces statuts ne changent pas. Ils comptent les modèles posés de chaque composante, et le total de l'unité attachée est la somme de ces comptes.

**Ce qui reste propre à chaque composante.**

- **Couleur ([[RG_06]]).** Chaque composante garde sa propre couleur, dans le bandeau comme sur le plateau. Le personnage reste ainsi repérable au milieu de son unité escortée. Le joueur réassigne la couleur d'une composante comme celle de toute unité.
- **Socles ([[RG_02]]).** Chaque modèle garde le socle de sa composante. Le regroupement par socle du menu peut donc réunir des modèles de composantes différentes qui partagent un même socle ; il ne se fait pas par composante.
- **Zone visible ([[RG_29]]) et rotation ([[RG_20]]).** Elles portent toujours sur un token seul et ne sont pas concernées.

**Second canal ([[RG_24]]).** L'appartenance d'un token à une composante ne repose jamais sur sa seule couleur. Le nom composé de l'entrée, dans le bandeau et dans le menu, énonce la composition. Chaque modèle du bandeau et chaque token du plateau énonce aussi, dans son nom accessible, sa composante et, pour un personnage, son rôle (« meneur », « soutien »).

**Listes sans attachement.** Une liste sans unité attachée, dont toutes les listes importées avant [[RG_36]], se déploie exactement comme avant cette règle : chaque unité y est sa propre unité de déploiement.

### RT_46 — Groupe de déploiement : dérivation et propagation aux calculs du placement

**Groupe de déploiement.** Les règles de placement ne reçoivent plus directement des unités de la liste, mais des **groupes de déploiement**. Un groupe réunit soit une unité attachée ([[RG_36]]), soit une unité indépendante seule. Les groupes sont dérivés de la liste par une fonction pure (`src/app/deployment/`), indépendante de l'affichage et couverte par des tests unitaires. Cette fonction lit `ArmyUnit.attachment` ([[RT_45]]) avec la lecture tolérante de [[RT_45]]. Un groupe porte :

- un identifiant, celui de l'unité escortée (ou de l'unité indépendante) ;
- un nom composé ;
- la liste ordonnée de ses unités : meneurs, puis soutiens, puis unité escortée, dans l'ordre de la liste à rôle égal.

Les groupes ne sont **ni persistés ni synchronisés** : ils se recalculent à chaque chargement de la liste.

**Les enregistrements ne changent pas.** Un placement ([[RT_04]]) porte toujours l'`idUnite` de sa **composante** et non celui du groupe. La couleur et le socle de chaque token se résolvent donc comme avant. Les unités réservées ([[RT_35]]) restent une liste d'`idUnite` de composantes : mettre un groupe en réserve y inscrit toutes ses unités, et l'en retirer les en retire toutes, en une seule écriture. À la lecture, un groupe est en réserve dès que l'une de ses unités y figure, et la liste est complétée à la prochaine écriture. Ce cas se présente pour un déploiement synchronisé depuis une liste dont les attachements diffèrent. Les calculs de [[RT_11]], qui comparent les placements et la réserve unité par unité, restent donc exacts sans modification.

**Propagation.** Les calculs suivants sont menés par groupe et non plus par unité :

- **Bandeau ([[RT_17]]).** Le bandeau parcourt les groupes. Sa rangée est la différence entre les identifiants de modèle de toutes les unités du groupe et les placements. Un modèle y est identifié par le couple `{ idUnite, idModele }`, puisque deux composantes peuvent avoir des `idModele` de même forme.
- **Menu unités ([[RT_18]]).** Le regroupement par socle et le statut portent sur les modèles de toutes les unités du groupe.
- **Cohésion ([[RT_36]]).** Le graphe de contiguïté et le contrôle d'étendue sont construits sur les placements de toutes les unités du groupe. Le contrôle pendant le geste, le retrait et l'instantané du mode « Règle » ([[RT_44]]) prennent un groupe là où ils prenaient une unité. Le « placement le plus ancien » se lit dans l'ordre des enregistrements, toutes composantes confondues.
- **Sélection ([[RT_40]]).** Le double clic sélectionne les placements de toutes les unités du groupe du token. La bascule du bandeau compte les identifiants de **groupe** distincts parmi les placements sélectionnés, et non plus les `idUnite`.
- **Grappe ([[RT_41]]).** La sélection du bandeau devient un ensemble de couples `{ idUnite, idModele }`. La formation trie les socles de toutes les composantes ensemble. Chaque socle provisoire, puis chaque placement créé, garde l'`idUnite` et la couleur de sa composante.

### RT_11 — Calcul des indicateurs de déploiement existant

Les indicateurs prévus par [[RG_12]] sont calculés en interrogeant les déploiements sauvegardés en local ([[RT_06]]), avant l'affichage de l'écran correspondant, sans appel réseau (conformément à [[EX_05]]), et recalculés à chaque affichage de l'étape pour refléter les sauvegardes les plus récentes :

- **Étape 2 (choix du plateau)** : filtrage sur le triplet (identifiant de liste, identifiant de disposition adverse choisie à l'étape 1, identifiant de plateau). Si aucun déploiement n'existe pour ce triplet, ou s'il ne porte ni placement ni unité en réserve ([[RG_25]]/[[RT_35]]), le statut est **Rouge** ([[RG_14]]). Sinon, le nombre de placements enregistrés ([[RT_04]]) est comparé, pour chaque unité de la liste, au nombre de modèles de l'unité (issu de [[RG_02]]), une unité en réserve étant tenue pour complète sans comparaison : toutes les unités complètes donnent le statut **Vert**, sinon **Orange**.
- **Étape 1 (choix de la disposition adverse)** : pour chacune des 5 dispositions adverses candidates, filtrage sur le couple (identifiant de liste, identifiant de disposition adverse candidate) sur les 3 plateaux qui lui sont associés. Pour chaque déploiement sauvegardé trouvé, le statut terminé/non terminé est déterminé en comparant, pour chaque unité de la liste, le nombre de placements enregistrés ([[RT_04]]) au nombre de modèles de l'unité (issu de [[RG_02]]), les unités en réserve ([[RG_25]]/[[RT_35]]) étant tenues pour complètes. Le code couleur du bouton de disposition en résulte selon l'ordre de priorité défini en [[RG_12]] (Orange > Vert > Jaune > Blanc).

### RT_23 — Référentiel des dispositions de force

Les 5 dispositions de force manipulées par [[RG_03]] (étapes 1 et 2) sont un référentiel statique embarqué (identifiant, libellé textuel, icône), au même titre que les référentiels de socles ([[RT_02]]) et de plateaux ([[RT_12]]) — et non une simple énumération de chaînes de caractères codée en dur dans les écrans. Les 5 identifiants retenus sont `take-and-hold`, `purge-the-foe`, `reconnaissance`, `priority-assets` et `disruption` ; ils servent aussi de clé de rapprochement avec les noms d'assets du référentiel de plateaux ([[RT_12]]). Contrairement à [[RT_02]] et [[RT_12]], ce référentiel n'est pas dérivé d'une source tierce : il est écrit à la main et n'ouvre donc droit à aucune attribution ([[RT_20]]). L'icône y est stockée sous forme de tracés vectoriels, pour être rendue sans dépendance à un jeu d'icônes externe et rester disponible hors-ligne. Ce référentiel fait correspondre le libellé texte extrait d'un import ([[RT_13]]) à un identifiant stable de disposition, et fournit l'icône affichée par les différents sélecteurs de disposition de l'application (récapitulatif d'import [[RG_22]], choix de la disposition adverse, en-tête du choix de plateau).

### RT_12 — Référentiel des plateaux (Battlemaster / gdmissions.app)

**Décision : chargement réseau direct à l'exécution, avec une version embarquée en dernier recours.** Ces layouts ont vocation à évoluer côté source (Battlemaster/gdmissions.app peut corriger un plateau), et les figer au moment du build exposerait le joueur à une version qui se périme au fil des mises à jour du site — contrairement au référentiel de socles ([[RT_02]]), dont les valeurs n'ont pas cette volatilité. Chaque image nécessaire (étape 2 de [[RG_03]], écran de placement, visualiseurs plein écran de [[RG_14]]) est donc obtenue, quand l'appareil est en ligne, par un appel réseau **direct** du client vers l'URL statique publiée sur [gdmissions.app](https://gdmissions.app/11th/layouts) sous `/assets/11th/layouts/{no-measurements|with-measurements}/{fichier}` — sans relais serveur (décision précédemment ouverte : la source répond `Access-Control-Allow-Origin: *`, constaté au 2026-10-02, et le backend de [[RT_09]] n'existe pas). Le résultat de chaque appel réussi est mis en cache localement et sert ensuite hors-ligne ([[RT_27]]).

La métadonnée du référentiel (`boards.json` : liste des plateaux, `playArea` de [[RT_05]], noms de fichiers, URLs distantes) reste, elle, générée hors-ligne par `scripts/ingest-boards.mjs` et versionnée avec l'application, de même que les images qui ont servi à la mesurer : cette version embarquée sert d'image de dernier recours (premier lancement hors-ligne, source injoignable sans cache) et de matière à l'extraction du terrain ([[RT_37]]). Le chargement réseau rafraîchit donc les **images** des plateaux connus ; un plateau **nouvellement publié** par la source n'apparaît qu'après régénération du référentiel, faute de `playArea` et de terrain mesurés pour lui.

**Contrôle d'une image distante.** Les placements sont exprimés dans le repère de l'image ([[RT_04]]/[[RT_05]]) et le `playArea` comme le terrain ont été mesurés sur la version embarquée : une image distante n'est acceptée (affichée et mise en cache) que si c'est un PNG aux dimensions exactes du plateau dans le référentiel (1653×2833, [[RT_19]]). Toute autre réponse — erreur HTTP, contenu non PNG, dimensions différentes, délai dépassé — est écartée sans message, au profit de la version en cache puis de la version embarquée ([[RG_09]]).

**Convention de nommage réellement constatée** (vérifiée au 2026-09-10, 45 plateaux = 15 couples × 3 ; l'algorithme ci-dessous est exécuté par le script d'ingestion, qui enregistre pour chaque plateau le nom de fichier résolu et ses URLs distantes `remoteAssets` — le client appelle exactement ces URLs, sans énumérer de candidats) :

- le nom de fichier encode un couple **non ordonné** — il n'y a pas de « disposition du joueur » puis « adversaire », mais un seul des deux ordres possibles publié pour chaque paire (par exemple `disruption-vs-priority-assets-1`, sans contrepartie `priority-assets-vs-disruption-1`). Le référentiel indexe donc les couples par une clé normalisée indépendante de l'ordre : le même triplet d'images sert quel que soit le camp du joueur ;
- `{disposition}-mirror-{1|2|3}` lorsque les deux dispositions sont identiques ;
- le suffixe `-portrait` est présent sur **certains assets seulement** (et concerne indifféremment les paires croisées et les miroirs) : il désigne les layouts dont les zones de déploiement courent le long des bords latéraux plutôt que des bords haut/bas. Il fait partie du nom de fichier, pas d'une variante à choisir ;
- les deux variantes `no-measurements` et `with-measurements` réutilisent **exactement le même nom de fichier**.

Plutôt que de figer ces conventions, le script énumère les noms candidats pour le triplet demandé (les deux ordres possibles, avec et sans `-portrait`) et retient celui qui répond ; si aucun ne répond, il échoue explicitement plutôt que de produire un référentiel partiel. Côté client, une URL distante qui ne répond plus (changement de convention côté source) se traite comme une source injoignable : repli silencieux sur le cache puis la version embarquée. Ces données sont elles-mêmes sourcées par gdmissions.app auprès de Battlemaster (battlemaster.online) et non garanties par une API stable ; toute utilisation publique de ces plateaux doit créditer **Battlemaster** (battlemaster.online) — mention reprise par le bloc « Mentions des sources tierces » de l'écran Réglages ([[RG_18]], [[RT_20]]), embarquée dans le référentiel quelle que soit la provenance de l'image affichée.

---

## EX_03 — Représentation fidèle des socles

Les tokens affichés doivent respecter la forme et la taille réelle du socle de chaque unité, et permettre de distinguer visuellement les unités entre elles.

Satisfait par : [[RG_02]], [[RG_06]], [[RT_05]], [[RT_32]].

### RG_06 — Couleur par unité

Chaque unité importée se voit attribuer une couleur distincte (automatiquement, avec possibilité de réassignation manuelle par le joueur) ; tous les tokens d'une même unité partagent cette couleur pour rester identifiables sur un plateau chargé.

Les couleurs proposées au joueur pour une réassignation sont désignées par un libellé lisible en français accompagné d'un aperçu de la couleur, jamais par leur notation technique.

### RT_05 — Échelle des tokens

La taille d'un token à l'écran est calculée au pixel près à partir du diamètre réel du socle (en mm) et de l'échelle courante du plateau affiché, pour que deux socles de tailles différentes restent proportionnellement corrects à tout niveau de zoom.

**Calibrage millimètres → pixels.** Les images du référentiel [[RT_12]] ne contiennent pas que le plateau : elles portent un bandeau de titre et un pied de légende. Les dimensions de l'image (1653×2833, cf. [[RT_19]]) ne donnent donc pas l'échelle. Le rectangle du plateau dans l'image (`playArea`, détecté par son rapport de forme 44″×60″) doit être connu pour en déduire l'échelle par rapport à la taille physique du plateau (`boardInches`, 44″ × 60″, valeur également imprimée en pied des images) — soit ≈ 1,007 px d'asset par millimètre réel. Deux gabarits d'image coexistent (layouts standards et layouts `-portrait`), dont les rectangles diffèrent de ~0,5 %. **Décision (précédemment ouverte) : mesure à l'ingestion, conservée malgré le chargement réseau.** Cette mesure est faite une fois par asset au moment de l'ingestion hors-ligne de [[RT_12]] et enregistrée dans le référentiel. Le chargement réseau des images ([[RT_12]]) ne la refait pas côté client : il n'accepte qu'une image aux mêmes dimensions que celle qui a été mesurée, et une source qui déplacerait le cadre du plateau à dimensions égales exige une régénération du référentiel (voir « Suivi des écarts »).

**Repère des coordonnées.** Les coordonnées de placement de [[RT_04]] sont exprimées dans le repère de l'image d'asset, en pixels d'asset — jamais en pixels d'écran. Un déploiement enregistré reste donc valide quel que soit le terminal, le niveau de zoom ou l'orientation, et se superpose correctement à l'autre variante d'image en consultation ([[RT_16]]), les deux variantes cadrant le plateau au même endroit (vérifié sur le corpus au 2026-09-10).

### RT_32 — Choix de la couleur de texte lisible sur une couleur d'unité

La couleur de texte superposée à un token coloré ([[RG_06]]) — libellé d'un socle dans le bandeau ([[RT_17]]) ou dans le menu unités ([[RG_16]]) — est choisie **par calcul**, et non par convention, de façon à rester lisible sur n'importe quelle couleur d'unité.

Le calcul utilise la **luminance relative** telle que définie par les règles d'accessibilité du web : composantes ramenées à l'intervalle [0, 1], linéarisées individuellement, puis pondérées. Une moyenne pondérée appliquée directement aux composantes non linéarisées (formule de luminance vidéo, dite BT.601) n'est pas cette grandeur et ne prédit pas le contraste perçu ; elle ne peut donc pas servir ici.

Aucun seuil de luminance n'est retenu. La couleur de texte est celle des deux candidates — une quasi-noire et une quasi-blanche — dont le **rapport de contraste réellement calculé** avec la couleur de fond est le plus élevé : un seuil arbitraire produit inévitablement une frange de couleurs pour lesquelles il choisit la moins lisible des deux.

La fonction accepte toutes les notations de couleur que l'application est susceptible de produire, y compris les couleurs générées au-delà de la palette de base de [[RG_06]]. Une notation qu'elle ne sait pas interpréter est une erreur de programmation et doit être signalée comme telle : retomber silencieusement sur une couleur par défaut produit exactement le défaut que cette règle existe pour empêcher — un texte blanc sur un fond clair, sans que rien ne le signale.

La couleur de repli employée lorsqu'une unité n'a pas de couleur résolue respecte les mêmes seuils de contraste que les tokens de [[RT_29]].

---

## EX_04 — Déploiements sauvegardés, liés à la liste d'armée d'origine

Le joueur doit pouvoir sauvegarder un déploiement aussi bien **rempli** qu'**en cours de remplissage** : la sauvegarde n'est pas une action ponctuelle déclenchée uniquement en fin de saisie, elle reflète en continu l'état courant du placement au fil de la saisie ([[RG_07]]). Ce déploiement est automatiquement lié à la liste d'armée qu'il utilise pour le remplir ([[RT_07]]), sans étape de liaison manuelle.

Satisfait par : [[RG_07]], [[RG_08]], [[RG_21]], [[RT_06]], [[RT_07]]. La note de plan de jeu sauvegardée avec chaque déploiement relève de [[EX_13]].

Les déploiements sauvegardés ne sont pas présentés sur un écran séparé : le joueur les retrouve en cliquant sur sa liste depuis la bibliothèque des listes importées de l'écran d'accueil ([[RG_18]]), puis en suivant le même cheminement que pour un nouveau déploiement ([[RG_03]]) : choix de la disposition adverse (étape 1, indicateur [[RG_12]]) → choix du plateau parmi les 3 layouts proposés (étape 2) → bouton **« Consulter »**, qui n'apparaît que lorsque le statut du plateau est **vert**, c'est-à-dire le déploiement terminé ([[RG_14]]) — ou bouton **« Éditer »**, déjà visible au statut orange, pour reprendre un déploiement encore en cours de remplissage.

### RG_07 — Sauvegarde nommée

Un déploiement sauvegardé conserve un nom (par défaut : liste + plateau + date), la référence à la liste d'armée importée, le plateau et la disposition choisis, l'ensemble des placements, et la note de plan de jeu du joueur ([[RG_45]]). Toute modification ultérieure du déploiement est enregistrée comme mise à jour de la même entrée : il n'existe qu'**un seul déploiement par triplet** (liste, disposition adverse, plateau), et l'application ne propose **aucune** sauvegarde « sous un nouveau nom » ni copie d'un déploiement. La sauvegarde étant continue ([[EX_04]]), l'écran de placement ne porte **aucun bouton d'enregistrement**.

*Décision (précédemment : copie « Enregistrer sous un nouveau nom » depuis l'en-tête de l'écran de placement) :* ce bouton à icône de disquette a été retiré. Il était pris pour une sauvegarde nécessaire, et la copie qu'il créait portait le même triplet : invisible au choix du plateau ([[RG_14]], un déploiement par plateau), sans écran pour l'ouvrir ni la supprimer, elle était pourtant comptée par le cadran ([[RG_12]]/[[RG_24]], « 2/3 » pour un seul plateau) et par l'accueil (« 2 déploiements sauvegardés »).

### RG_08 — Suppression

La suppression d'un déploiement sauvegardé est une action confirmée explicitement par le joueur et ne supprime jamais la liste d'armée associée, qui peut être réutilisée pour d'autres déploiements.

### RG_21 — Suppression et duplication d'une liste d'armée

Le joueur peut supprimer ou dupliquer une liste d'armée importée directement depuis l'accueil ([[RG_18]]), indépendamment de la suppression d'un déploiement sauvegardé ([[RG_08]]) :

- **Suppression** : action confirmée explicitement par le joueur (sur le même principe que [[RG_08]]). Si des déploiements sauvegardés référencent cette liste ([[RT_07]]), le joueur en est informé avant confirmation, et ces déploiements sont supprimés avec elle (suppression en cascade) plutôt que laissés en entrées orphelines.
- **Duplication** : crée une copie indépendante de la liste, avec son propre identifiant stable ([[RT_07]]) et son propre nom (par défaut « nom d'origine (copie) », modifiable) ; la copie démarre sans aucun déploiement associé, au même titre qu'une liste nouvellement importée. La copie reprend les unités attachées de la liste d'origine ([[RG_36]], [[RT_45]]).

### RT_06 — Persistance locale des déploiements sauvegardés

Les déploiements sauvegardés sont persistés localement **en IndexedDB** (décision prise, voir [[RT_08]]) sous forme d'enregistrements indexés par identifiant de déploiement, pour un accès sans dépendre du réseau. Le store `deployments` porte un index secondaire sur `listId` ([[RT_07]]), qui est la clé de filtrage de tous les indicateurs de [[RT_11]].

### RT_07 — Clé de liaison liste/déploiement

La liaison entre un déploiement et sa liste d'armée d'origine utilise un identifiant stable de la liste (et non son contenu), afin qu'une liste modifiée après coup n'invalide pas les déploiements déjà sauvegardés qui la référencent.

---

## EX_05 — Fonctionnement hors-ligne

L'application doit rester pleinement utilisable sans connexion réseau pour la planification et la consultation des déploiements sauvegardés, qui ne dépendent pas d'un accès serveur. L'import d'une nouvelle liste fait exception à ce principe (voir [[RG_13]]) ; un plateau s'affiche hors-ligne dans la dernière version obtenue en ligne, à défaut dans celle livrée avec l'application (voir [[RG_23]]). Lorsque l'application ressort du mode hors-ligne, une éventuelle divergence entre les données locales et celles du serveur doit être arbitrée par le joueur, jamais résolue silencieusement (voir [[RG_11]]).

Satisfait par : [[RG_09]], [[RG_11]], [[RG_13]], [[RG_23]], [[RT_08]], [[RT_14]], [[RT_15]], [[RT_27]]. Dans le navigateur, ou une fois installée depuis celui-ci ([[EX_12]]), ce fonctionnement hors-ligne repose en plus sur [[RG_42]] et [[RT_54]]. Les cartes de mission primaire suivent la même politique que les plateaux ([[RG_49]], [[RT_65]]).

### RG_09 — Dégradation gracieuse du réseau

Toute fonctionnalité qui nécessite le réseau (synchronisation de compte notamment) échoue silencieusement en arrière-plan sans bloquer ni interrompre le travail en cours du joueur ; l'état "non synchronisé" reste visible mais non bloquant.

### RG_13 — Import de liste indisponible hors-ligne

L'import d'une nouvelle liste d'armée ([[RG_01]]) n'est pas proposé hors-ligne : contrairement aux autres fonctionnalités couvertes par [[EX_05]] (planification, déploiements sauvegardés), qui restent pleinement utilisables sans réseau, l'import est une restriction fonctionnelle volontaire. Si le joueur tente de lancer un import alors que l'application est hors-ligne, l'import est bloqué avant toute tentative de parsing et un message explicite informe le joueur que cette action nécessite une connexion réseau, en l'invitant à réessayer une fois reconnecté. Les listes déjà importées restent consultables et utilisables hors-ligne sans restriction.

### RG_23 — Version du plateau affichée : la plus récente obtenue en ligne, conservée pour le hors-ligne

Pour que le joueur voie toujours la version la plus à jour publiée par la source, chaque image de plateau (étape 2 de [[RG_03]], écran de placement, visualiseurs de [[RG_14]]) est demandée à la source quand l'appareil est en ligne ([[RT_12]]). Toute version ainsi obtenue est conservée sur l'appareil et remplace la précédente ([[RT_27]]) : hors-ligne, ou si la source ne répond pas, le plateau s'affiche dans la **dernière version obtenue en ligne sur cet appareil**, et à défaut — plateau jamais affiché en ligne — dans la version livrée avec l'application. Aucun plateau n'est donc jamais bloqué faute de réseau : reprendre hors-ligne un déploiement déjà commencé, le cas d'usage central de [[EX_05]], fonctionne toujours, au pire sur une version moins récente du plateau. Dans le navigateur ([[EX_12]]), la version livrée avec l'application n'est présente sur l'appareil qu'une fois téléchargée : [[RG_42]] décrit cette seule exception.

Le passage d'une version à l'autre est silencieux ([[RG_09]]) : aucun message n'informe le joueur que l'image affichée vient du cache ou de l'application plutôt que de la source. Une version distante n'est retenue que si elle reste compatible avec les placements déjà enregistrés (même cadrage, [[RT_12]]) ; sinon la version conservée continue d'être affichée.

### RT_08 — Stockage local

Les données de l'application (listes importées, référentiel de socles, déploiements sauvegardés) sont persistées via le stockage local du terminal (IndexedDB en environnement web ; `@capacitor/preferences` ou équivalent pour les données de configuration légères sur mobile natif), lu/écrit systématiquement avant toute tentative de synchronisation réseau.

**Répartition retenue.** Les enregistrements métier (listes, déploiements, et les marqueurs de suppression à pousser au prochain sync, cf. [[RT_15]]) vont en IndexedDB, un store par type, indexés par identifiant ([[RT_06]]). Les données de configuration légères — jeton d'appareil obtenu par [[RT_21]] ([[RT_67]]), jeton de version de [[RT_15]], horodatage du dernier sync — passent par une paire d'accesseurs dédiée, aujourd'hui adossée à `localStorage` en web ; c'est le seul point à réimplémenter pour `@capacitor/preferences` sur mobile natif, aucun appelant n'ayant à changer. Toute indisponibilité du stockage de configuration (navigation privée, quota) est absorbée silencieusement : l'application reste utilisable en usage local ([[RG_10]]), simplement sans session mémorisée. Les référentiels réellement statiques ([[RT_02]], [[RT_23]]), eux, ne sont pas recopiés en base : ils sont livrés comme fichiers d'assets et lus une fois par session, ce qui permet de les remplacer indépendamment du code lors d'une mise à jour d'errata. La métadonnée du référentiel de plateaux ([[RT_12]]) et ses images embarquées suivent la même règle ; les images obtenues par le réseau, elles, sont mises en cache dans un store IndexedDB séparé, dédié à ce cache, décrit par [[RT_27]].

### RT_27 — Cache local des plateaux chargés par le réseau

**Décision (précédemment ouverte) : store IndexedDB dédié aux blobs.** Chaque image de plateau acceptée par [[RT_12]] est enregistrée, sous forme de blob, dans un store IndexedDB `boardImages` distinct des stores d'enregistrements métier de [[RT_08]], indexé par `{variante}/{nom de fichier}` — une entrée par variante, puisque chaque écran ne demande que celle qu'il affiche. IndexedDB est préféré à la Cache API parce qu'il est déjà la base de [[RT_08]], qu'il est disponible à l'identique dans le navigateur et la WebView Capacitor, et qu'il stocke les blobs nativement. Implémentation : `src/app/referentials/board-image.service.ts`.

**Politique de fraîcheur — réseau d'abord.** Pour chaque image, la résolution suit l'ordre :

1. **en ligne** ([[RT_14]]) : appel direct de l'URL distante de [[RT_12]], borné à 8 secondes, en revalidant le cache HTTP du navigateur (`cache: 'no-cache'`, la source publiant un `ETag`) ; une image acceptée remplace l'entrée du cache et est affichée ;
2. sinon, ou en cas d'échec : l'entrée du cache ;
3. sinon : l'image embarquée.

L'appel réseau n'a lieu qu'une fois par image et par session d'application : l'image résolue est conservée en mémoire (URL d'objet) pour les affichages suivants de la session, si bien qu'une mise à jour de la source est vue au lancement suivant. Une écriture du cache qui échoue (quota, stockage indisponible) est ignorée : l'image reçue est affichée quand même. Il n'y a pas de purge automatique du cache par ancienneté : la dernière version obtenue reste disponible tant que l'application n'est pas désinstallée ou son stockage vidé.

### RT_14 — Détection de connectivité pour le blocage de l'import

L'état de connectivité réseau est surveillé côté client (`@capacitor/network` sur mobile natif ; évènements `online`/`offline` du navigateur en environnement web) pour piloter le point d'entrée d'import : celui-ci est désactivé (ou son déclenchement intercepté) et le message prévu par [[RG_13]] est affiché tant que l'application est détectée hors-ligne, sans attendre l'échec d'un appel réseau.

### RT_15 — Détection de conflit à la resynchronisation

Chaque enregistrement synchronisable (déploiement, cf. [[RT_04]]/[[RT_07]]) conserve localement le jeton de version ([[RT_09]]) reçu lors de sa dernière synchronisation réussie. Au retour en ligne ([[RT_10]]), pour tout enregistrement modifié localement depuis ce jeton, le client compare son jeton local au jeton courant renvoyé par le serveur pour ce même enregistrement : s'ils divergent, un conflit est déclaré et l'interface de choix prévue par [[RG_11]] est présentée pour cet enregistrement précis, sans bloquer la synchronisation des autres enregistrements non conflictuels. Les jetons de base, les suppressions versionnées et les trois natures de conflit sont précisés par [[RT_68]].

### RT_16 — Visualiseur plein écran zoomable de plateau

Les deux vues plein écran prévues par [[RG_14]] (plateau seul avec mesures, et déploiement avec placements sans mesures) partagent un même composant de visualisation image plein écran avec pan/zoom tactile, distinct de l'éditeur de placement interactif de [[RT_03]] (celui-ci reste dédié à la saisie drag-and-drop et n'est pas concerné par ce composant).

**Décision (précédemment ouverte) : implémentation propre, sans librairie tierce.** Le pan/zoom est réalisé avec les évènements `Pointer` du navigateur et une transformation CSS (`translate` + `scale`) appliquée au conteneur de l'image : un doigt déplace, deux doigts pincent (le zoom est centré sur le milieu du geste pour que le point regardé reste sous les doigts), la molette servant d'équivalent au pincement sur poste de travail. Ce choix évite une dépendance supplémentaire pour un besoin réduit à un geste, et ne coûte que quelques dizaines de lignes ; il reste indépendant de la règle de gestion, qui ne prescrit aucune technologie. Ce composant sélectionne l'asset du référentiel [[RT_12]] à afficher — variante `with-measurements` pour la consultation du plateau seul, variante `no-measurements` pour la consultation « Consulter » — et, dans ce second cas, superpose par-dessus le rendu SVG des placements existants ([[RT_04]]) en lecture seule (pas d'interaction de déplacement). L'entrée dans ce mode se fait par un simple tap sur l'aperçu du plateau ; une fois en plein écran, le pincement (pinch-to-zoom) pilote le niveau de zoom, et un bouton de fermeture (croix), toujours affiché en haut à gauche de l'écran, permet de sortir de ce mode et de revenir à l'écran d'origine.

### RT_17 — Composant de sélection d'unité et de modèles (bandeau bas)

Le bandeau prévu par [[RG_15]] est un composant d'interface distinct de l'éditeur de plateau ([[RT_03]]), superposé en bas de l'écran de placement. Sa liste de modèles utilise un défilement horizontal natif (avec ancrage/scroll-snap par élément) pour rester ergonomique au doigt quel que soit le nombre de modèles de l'unité (ex. 10 éléments pour une unité de 10 modèles), sans dépendre d'une librairie tierce de carrousel. Chaque élément de la liste est rendu comme un token draggable identique en forme et en couleur au token qui sera posé sur le plateau ([[RG_06]], [[RT_05]]), pour que le joueur identifie visuellement ce qu'il s'apprête à placer avant même de le déposer ; le drag & drop d'un élément du bandeau vers le plateau crée un enregistrement de placement au sens de [[RT_04]], le geste lui-même étant matérialisé sous le doigt conformément à [[RT_34]].

La case à cocher « en réserve » de [[RG_25]] est portée par l'en-tête du bandeau, sur la même ligne que le nom de l'unité : elle est présente pour toute unité, quelle que soit la longueur de sa rangée de modèles, et occupe une hauteur constante d'une unité à l'autre ([[RT_33]]).

Le contenu du bandeau est **dérivé** des placements de [[RT_04]] et de l'ensemble des unités réservées de [[RT_35]], et non d'un état propre : la liste des modèles de l'unité courante est celle de ses identifiants de modèle (`idModele`) qui n'apparaissent dans aucun placement, et les flèches ne parcourent que les unités ayant encore au moins un tel identifiant. Le retrait d'un modèle placé du bandeau ([[RG_15]]) comme sa réapparition après suppression du token ([[RG_20]]) découlent donc du seul recalcul de cette différence, sans code de synchronisation dédié ni divergence possible entre le bandeau et le plateau. L'avance automatique à l'unité suivante est évaluée après chaque dépôt, sur ce même critère.

### RT_18 — Calcul du regroupement par socle et du statut du menu unités

Pour chaque unité, le menu de [[RG_16]] regroupe ses modèles par forme/diamètre de socle (issus du référentiel [[RT_02]] via [[RG_02]]) et calcule, pour chaque groupe, le nombre de modèles déjà placés parmi ceux du groupe, en filtrant les placements de [[RT_04]] par identifiant d'unité et en croisant chaque modèle placé avec le socle qui lui est associé. Le statut global de l'unité (blanc/orange/vert de [[RG_16]]) est dérivé de ces comptes : **blanc** si le nombre total de modèles placés de l'unité est nul, **vert** si ce total égale le nombre total de modèles de l'unité **ou** si l'unité est en réserve ([[RG_25]]/[[RT_35]]), **orange** dans tous les autres cas. Les comptes par groupe de socle restent, eux, ceux des modèles réellement posés : une unité en réserve affiche donc des groupes à `0/n` sous un statut vert, que la mention « en réserve » de [[RG_16]] explique. Ce calcul est effectué à l'ouverture du menu burger ainsi qu'après chaque placement réalisé depuis le bandeau ([[RG_15]]), afin que le menu reste synchronisé sans rechargement de l'écran.

### RT_24 — Conteneur du menu unités (panneau latéral)

Le menu de [[RG_16]] est implémenté comme un panneau latéral (« side sheet ») ancré au bord droit de l'écran de placement et superposé par-dessus le plateau sans le masquer entièrement, plutôt que comme un écran séparé ou une feuille modale plein écran. Son ouverture/fermeture n'interrompt ni ne recalcule l'affichage à zoom fixe du plateau ([[RG_17]]/[[RT_19]]).

La largeur du panneau est bornée de sorte qu'une bande de plateau d'au moins 160 pixels CSS reste visible à sa gauche sur les largeurs d'écran les plus étroites visées : « partiellement visible » n'est pas satisfait par un liseré.

### RT_19 — Calcul du zoom fixe d'affichage du plateau

Le zoom fixe prévu par [[RG_17]] se calcule par un ajustement « contenir » (contain-fit, ratio unique min(largeur dispo / `playArea.width`, hauteur dispo / `playArea.height`)), non pas sur l'image de plateau entière, mais directement sur le **rectangle de jeu mesuré** (`playArea`, [[RT_05]]) : tout ce qui l'entoure dans l'image (bandeau de titre, pied de légende, marges latérales) est en dehors du cadre affiché. Ce rognage est purement visuel : il déplace la portion visible de l'image/du SVG (dont l'origine du cadre affiché correspond à `(playArea.left, playArea.top)` dans le repère de l'asset), sans toucher au repère de coordonnées des placements ([[RT_04]]/[[RT_05]], toujours exprimé dans le repère de l'image entière) ni au rectangle utilisé pour borner les tokens (`playArea`, [[RT_05]]) — ce même rectangle sert donc à la fois de cadre visible et de borne de placement.

Aucune mesure ni calcul spécifique à chaque plateau n'est nécessaire au-delà de la valeur déjà mesurée à l'ingestion ([[RT_05]]) : tous les assets du référentiel [[RT_12]], quelle que soit la combinaison de dispositions ou la variante (`with-measurements`/`no-measurements`), sont livrés avec exactement les **mêmes dimensions en pixels et le même ratio** (vérifié à chaque ingestion, qui échoue sinon : 1653×2833, y compris pour les layouts au suffixe `-portrait`), et un `playArea` qui ne varie que de ~0,5 % d'un gabarit à l'autre. Le même facteur d'échelle s'applique donc identiquement à n'importe quel plateau chargé ; il n'est recalculé que lorsque l'espace disponible change (rotation de l'écran, redimensionnement de fenêtre), jamais par changement de plateau ou de disposition. Le conteneur du plateau désactive tout geste de zoom/pan natif du navigateur ou de l'OS sur cette zone (ex. `touch-action: none`, `user-scalable=no` équivalent) pour que seuls le drag-and-drop des tokens ([[RT_03]]) et le déplacement de vue de [[RT_48]] y restent interactifs, conformément à [[RG_17]].

**Agrandissement ×2 / ×4 ([[RG_38]]).** Le facteur calculé ci-dessus est le **facteur de base** ; l'échelle d'affichage effective vaut ce facteur multiplié par le niveau d'agrandissement (1, 2 ou 4) de [[RT_47]]. Le recalcul sur changement d'espace disponible ne porte que sur le facteur de base et conserve le niveau d'agrandissement en cours.

---

## EX_06 — Compte utilisateur et synchronisation multi-appareils

Le joueur doit pouvoir associer un compte à ses données pour retrouver ses listes et déploiements sur un autre appareil (ex. bureau puis téléphone).

Satisfait par : [[RG_10]], [[RG_11]], [[RG_18]], [[RG_19]], [[RG_50]], [[RG_51]], [[RG_52]], [[RG_53]], [[RG_54]], [[RT_09]], [[RT_10]], [[RT_20]], [[RT_21]], [[RT_67]], [[RT_68]], [[RT_69]], [[RT_70]], [[RT_71]], [[RT_72]]. Le contrat d'API est [openapi.yml](openapi.yml), le schéma de la base [schema.sql](schema.sql).

### RG_10 — Compte optionnel

L'utilisation de l'application sans compte reste possible et fonctionnelle (données locales uniquement) ; la création de compte n'est nécessaire qu'au moment où le joueur souhaite explicitement synchroniser vers un second appareil.

### RG_11 — Résolution de conflit

Lorsque le même déploiement a été modifié hors-ligne sur deux appareils avant resynchronisation, l'application ne doit jamais choisir automatiquement une version au détriment de l'autre. À la détection du conflit — typiquement au retour en ligne après une session hors-ligne, cf. [[EX_05]] — la synchronisation de cet enregistrement est mise en attente et l'application présente explicitement au joueur les deux versions (locale et serveur, avec leur horodatage respectif) ; le joueur choisit celle à conserver, ce choix écrasant l'autre version pour cet enregistrement. Les enregistrements non conflictuels continuent de se synchroniser normalement sans attendre cette décision. Les cas de conflit et les informations présentées pour chacun (date, heure et appareil de chaque version) sont détaillés par [[RG_54]].

### RG_18 — Point d'accès compte et informations sur l'écran d'accueil (bouton Réglages)

L'écran d'accueil — la bibliothèque des listes d'armée déjà importées ([[RG_01]]) — affiche un bouton « Réglages » (icône engrenage), toujours visible quel que soit le nombre de listes déjà importées. Ce bouton ouvre un écran (ou panneau) Réglages qui regroupe, sans quitter l'application, des blocs distincts :

1. **Compte**, dont le contenu dépend de l'état de connexion du joueur ([[RG_10]]) :
   - non connecté : les actions « Créer un compte » et « Se connecter », menant aux formulaires de sign up / sign in ;
   - connecté : les informations du compte prévues par [[RG_19]], une action de déconnexion (retour à un usage local uniquement, sans suppression des données locales), et la gestion du compte ([[RG_52]]). Il n'y a pas de liste des appareils connectés : un appareil connecté le reste ([[RG_53]]).
2. **Informations utilisateur**, détaillées par [[RG_19]].
3. **Mentions des sources tierces** : la liste des attributions requises par les référentiels tiers dont l'application dépend, qu'ils soient générés hors-ligne ([[RT_02]], « Powered by Wahapedia ») ou chargés par le réseau à l'exécution ([[RT_12]], Battlemaster) — conformément aux conditions d'usage de ces sources (voir [CLAUDE.md](../CLAUDE.md)). Chaque mention indique l'adresse de la source et la rend directement ouvrable, plutôt que de l'afficher comme un texte inerte : c'est par cette adresse que le joueur vérifie l'attribution.

4. **Application**, présent seulement hors application Android empaquetée ([[EX_12]]) : l'invitation à installer l'application tant qu'elle ne l'est pas ([[RG_41]]), l'état de préparation au hors-ligne et le téléchargement des plateaux ([[RG_42]]), et l'état de conservation des données sur l'appareil ([[RG_44]]).
5. **Version**, en bas de l'écran et dans tous les contextes (application Android comme version web) : le numéro de version de l'application ([[RG_47]]).

Le bloc « Mentions des sources tierces » et la consultation des informations déjà connues du bloc « Compte » restent accessibles hors-ligne ; seules les actions qui nécessitent le réseau (création de compte, connexion, synchronisation) sont soumises à la dégradation gracieuse prévue par [[RG_09]].

### RG_19 — Informations utilisateur affichées

Lorsque le joueur est connecté, le bloc « Compte » de l'écran Réglages ([[RG_18]]) affiche a minima l'identifiant du compte (adresse email) et l'état de synchronisation courant (synchronisé / en attente / hors-ligne, conformément à [[RG_09]]). Le joueur peut s'y déconnecter à tout moment ; la déconnexion ne supprime aucune donnée stockée localement ([[RT_08]]), qui reste utilisable en usage local seul ([[RG_10]]).

### RG_47 — Numéro de version affiché

L'écran Réglages ([[RG_18]]) affiche le numéro de version de l'application sous la forme `MAJEUR.MINEUR.CORRECTIF`, consultable hors-ligne. Il permet au joueur de savoir quelle version tourne sur chacun de ses appareils, et de la citer lorsqu'il signale un problème. Chaque modification du code livrée fait évoluer ce numéro ([[RT_63]]) ; une modification de la seule spécification ne le change pas.

### RT_09 — Backend de synchronisation

Un backend nodejs expose une API de synchronisation par différence (delta) des enregistrements créés/modifiés/supprimés depuis la dernière synchronisation réussie, identifiée par un jeton de version côté client. Le protocole est détaillé par [[RT_68]], la persistance (PostgreSQL) par [[RT_70]], l'adresse du serveur par [[RT_71]].

### RT_10 — Déclenchement de la synchronisation

La synchronisation se déclenche à la reprise du réseau et/ou au retour au premier plan de l'application, ainsi qu'à la sortie de l'écran de placement (quelle que soit la façon de le quitter : bouton retour de l'écran, retour système ou navigateur), une fois l'enregistrement en attente du déploiement écrit localement — pour que le déploiement qui vient d'être modifié parte vers le serveur sans attendre un autre déclencheur. Elle n'est jamais bloquante pour l'interaction en cours, conformément à RG_09 : la navigation hors de l'écran n'attend pas la passe.

### RT_20 — Génération de la liste de mentions tierces

La liste affichée par le bloc « Mentions des sources tierces » de [[RG_18]] n'est pas codée en dur dans l'écran Réglages : chaque référentiel tiers déclare, quelle que soit sa façon d'être livré — donnée statique versionnée pour [[RT_02]], métadonnées associées au chargement réseau à l'exécution pour [[RT_12]] —, le nom de la source et le texte d'attribution requis par ses conditions d'usage. L'écran Réglages se contente d'énumérer les référentiels effectivement actifs dans le build courant et d'en afficher l'attribution associée, pour qu'un nouveau référentiel (donc une nouvelle source tierce) ajouté ultérieurement apparaisse automatiquement sans modification du code de l'écran.

### RT_21 — Authentification (sign up / sign in)

Les actions « Créer un compte » / « Se connecter » de [[RG_18]] s'appuient sur le même backend de synchronisation que [[RT_09]] (endpoints d'inscription/connexion). Le jeton d'appareil obtenu ([[RT_67]]) est persisté localement au même titre que les autres données de configuration légères ([[RT_08]]), pour que la synchronisation ([[RT_10]]) démarre sans ressaisie dès la connexion établie. La détection de connectivité de [[RT_14]] est réutilisée pour désactiver ces deux actions — et afficher un message explicite — lorsque l'application est hors-ligne, sur le même principe que [[RG_13]] pour l'import. Ce jeton n'expire pas ([[RG_53]]) ; l'adresse du serveur appelé dépend de l'environnement ([[RT_71]]).

### RG_50 — Inscription et connexion

Le compte s'identifie par une adresse email et un mot de passe, sans fournisseur tiers. L'adresse est normalisée (espaces retirés, minuscules) avant tout contrôle, et un compte au plus existe par adresse. Le mot de passe compte de 8 à 128 caractères, sans autre contrainte de composition.

- **Pas de vérification de l'adresse.** Le compte est utilisable, et synchronisable, dès sa création. Aucun courriel n'est envoyé par l'application.
- **Pas de récupération de mot de passe.** Faute d'adresse vérifiée, un mot de passe oublié ne peut pas être réinitialisé. Le formulaire d'inscription le dit explicitement, avant validation. Les appareils déjà connectés le restent ([[RG_53]]) et continuent de synchroniser ; seul un nouvel appareil ne peut plus se connecter. Les données locales de chaque appareil restent intactes ([[RG_10]]) et peuvent être versées dans un nouveau compte ([[RG_51]]).
- **Échec de connexion.** Le message est le même pour une adresse inconnue et pour un mot de passe erroné, pour ne pas révéler l'existence d'un compte. Après des échecs répétés, les tentatives sont temporairement refusées ([[RT_69]]) ; le message indique alors le délai d'attente.
- **Hors-ligne.** Inscription et connexion sont désactivées, avec un message explicite ([[RT_21]]).

### RG_51 — Première connexion d'un appareil

Juste après une inscription ou une connexion, et avant toute synchronisation, l'application compare les données de l'appareil à celles du compte :

- **l'appareil n'a aucune liste** : il récupère simplement celles du compte ;
- **le compte est vide** (cas d'une inscription) : les listes et déploiements de l'appareil y sont versés, sans question ;
- **les deux ont des données** : le joueur choisit explicitement, en voyant le nombre de listes et de déploiements de chaque côté, entre
  - **« Ajouter ces données au compte »** (fusion) : les enregistrements de l'appareil sont versés dans le compte, à côté de ceux qui s'y trouvent. Une même liste importée séparément sur deux appareils apparaît alors en double ; le joueur supprime le doublon s'il le souhaite ([[RG_21]]). Rien n'est rapproché automatiquement ;
  - **« Les remplacer par celles du compte »** : les listes et déploiements de l'appareil sont supprimés, puis ceux du compte récupérés. L'action est destructrice et confirmée explicitement, sur le même principe que [[RG_08]], en rappelant ce qui sera perdu.

  Tant que le joueur n'a pas choisi, aucune synchronisation n'a lieu ; fermer le choix sans répondre déconnecte l'appareil, sans rien modifier.

**Changement de compte.** Un appareil peut avoir été synchronisé avec un compte, puis déconnecté ([[RG_19]]), puis connecté à un **autre** compte. Ses données locales sont alors traitées comme celles d'un appareil jamais synchronisé : la même comparaison s'applique, et en cas de fusion elles sont versées dans le nouveau compte comme des créations. Reconnecter le **même** compte reprend la synchronisation là où elle s'était arrêtée, sans question.

### RG_52 — Gestion du compte

Le bloc « Compte » des Réglages ([[RG_18]]), une fois connecté, propose trois actions, toutes soumises à la saisie du mot de passe courant et indisponibles hors-ligne ([[RG_09]]) :

- **Changer le mot de passe.** Le nouveau mot de passe ne sert qu'aux connexions suivantes : tous les appareils déjà connectés le restent ([[RG_53]]).
- **Changer l'adresse email.** Mêmes règles que l'inscription ([[RG_50]]) ; les appareils restent connectés.
- **Supprimer le compte.** Action confirmée explicitement ([[RG_08]]), dont le texte précise que les listes et déploiements enregistrés sur le serveur sont définitivement supprimés, et que ceux de l'appareil sont conservés. La suppression est **immédiate et totale** : à la réponse du serveur, il ne conserve plus aucune donnée du joueur — compte, adresse, listes, déploiements, traces de suppression, appareils connectés ([[RT_70]]). Rien n'est différé ni récupérable. L'appareil courant repasse aussitôt en usage local seul ([[RG_10]]), les autres appareils à leur prochaine tentative de synchronisation, chacun avec ses données locales.

### RG_53 — Connexion permanente d'un appareil

Un appareil connecté à un compte **le reste** : la connexion n'expire pas, ne demande jamais de ressaisir le mot de passe, et n'est interrompue ni par l'inactivité, ni par un changement de mot de passe ou d'adresse ([[RG_52]]), ni depuis un autre appareil. Elle ne prend fin que dans deux cas :

- le joueur se déconnecte **depuis cet appareil** ([[RG_19]]) ;
- le compte est supprimé ([[RG_52]]) — l'appareil repasse alors en « Usage local uniquement » à sa prochaine tentative de synchronisation, sans perdre ses données locales.

Il n'existe ni liste des appareils connectés, ni déconnexion à distance. Conséquence assumée : un appareil perdu ou prêté garde l'accès au compte tant qu'il n'y est pas déconnecté lui-même, ou que le compte n'est pas supprimé.

### RG_54 — Conflits entre appareils

Complète [[RG_11]]. Toute divergence née de modifications faites sur plusieurs appareils sans synchronisation intermédiaire — le plus souvent hors-ligne ([[EX_05]]) — est **tranchée par le joueur**, jamais par l'application ni par le serveur, quel que soit l'ordre d'arrivée des modifications ou leurs horodatages. Pour chaque conflit, l'application présente les deux versions, chacune avec **la date et l'heure de la modification** et **l'appareil qui l'a faite** (« Ce téléphone », ou le nom de l'autre appareil), et le joueur désigne celle qui prime. Les cas sont les suivants :

- **Modifié des deux côtés.** Le même déploiement, ou la même liste, a été modifié sur deux appareils.
- **Modifié ici, supprimé ailleurs** (et l'inverse). L'une des deux versions est « supprimé le … sur … ».
- **Liste supprimée, déploiement modifié.** Un appareil supprime une liste (donc ses déploiements, [[RG_21]]) pendant qu'un autre modifie ou crée un déploiement de cette liste. Garder la suppression supprime aussi ce déploiement ; garder le déploiement conserve aussi sa liste. Les déploiements concernés sont listés avec le conflit.
- **Même plateau créé deux fois.** Deux appareils créent chacun le déploiement d'un même triplet liste, disposition adverse, plateau ([[RG_14]]) sans avoir vu celui de l'autre. Le joueur garde l'un des deux ; l'autre est supprimé.

Les horodatages sont **affichés, jamais comparés** : ils aident le joueur à choisir mais ne décident de rien, d'autant que l'horloge de deux appareils peut différer. Un conflit en attente ne bloque pas la synchronisation des autres enregistrements.

### RT_67 — Jeton d'appareil

- **Un jeton par appareil, sans expiration.** L'inscription et la connexion renvoient un **jeton d'appareil** : une valeur aléatoire opaque (256 bits), jointe à chaque appel ([[RT_21]]). Il n'a pas de durée de validité et n'est jamais renouvelé ([[RG_53]]) ; il n'y a donc ni access token court, ni refresh token. Le client le conserve dans sa configuration légère ([[RT_08]]).
- **Identité de l'appareil.** Le client génère, à la première ouverture, un identifiant d'appareil (UUID) conservé dans la configuration légère, et l'envoie avec un libellé (« Chrome — Windows », « Pixel 8 »…) et une plateforme (`android`, `ios`, `web`) à l'inscription et à la connexion. Le serveur rattache ce libellé à chaque écriture, pour l'afficher dans les conflits ([[RG_54]]). Une nouvelle connexion du même appareil remplace son jeton précédent.
- **Fin du jeton.** Le jeton est supprimé à la déconnexion depuis l'appareil — la déconnexion locale est effective même si l'appel échoue ([[RG_19]]) — et à la suppression du compte. Un jeton inconnu reçoit `401` : le client repasse en usage local sans erreur bloquante ([[RG_09]]).
- **Serveur.** Mots de passe hachés en argon2id ; jetons d'appareil stockés hachés (SHA-256), jamais en clair. Comme un jeton n'expire pas, sa fuite donne un accès durable : il ne doit jamais apparaître dans une URL ni dans les journaux.
- **Changement de compte ([[RG_51]]).** Le client mémorise l'identifiant du dernier compte synchronisé. S'il diffère de celui du compte connecté, il efface son jeton de synchronisation ([[RT_15]]) et le `versionToken` de chaque enregistrement local avant de synchroniser.

### RT_68 — Protocole de synchronisation

Précise [[RT_09]] et [[RT_15]] ; le contrat est celui de [openapi.yml](openapi.yml), la mécanique des jetons celle de [[RT_70]].

- **Jeton de base par enregistrement.** Chaque liste ou déploiement poussé porte le `versionToken` reçu à sa dernière synchronisation ; une création n'en porte pas. Le serveur écrit l'enregistrement seulement si ce jeton est encore le sien, et renvoie alors le nouveau jeton, que le client conserve pour cet enregistrement.
- **Suppressions versionnées.** Une suppression locale part avec le jeton de la version supprimée. Une suppression d'un enregistrement jamais synchronisé est acceptée sans effet.
- **Conflits ([[RG_54]]).** Le serveur n'écrit rien et renvoie un conflit dans chacun des cas suivants :
  - jeton de base différent du jeton courant (modifié des deux côtés, ou supprimé ici et modifié ailleurs) ;
  - enregistrement supprimé sur le serveur (modifié ici, supprimé ailleurs) ;
  - suppression d'une liste alors que le serveur porte, pour cette liste, un déploiement absent des suppressions de la même poussée ou modifié depuis : le conflit porte sur la liste et liste ces déploiements ;
  - création ou modification d'un déploiement dont la liste a été supprimée sur le serveur : le conflit porte sur le déploiement ;
  - création d'un déploiement alors que le serveur porte déjà un déploiement du même triplet (liste, disposition adverse, plateau) écrit **après** le jeton d'appareil `since` envoyé avec la poussée — c'est-à-dire que l'appareil ne l'a pas encore vu.

  Chaque conflit renvoie la version serveur, sa date de modification et le libellé de l'appareil qui l'a écrite.
- **Cascade ([[RG_21]]).** Une suppression de liste acceptée supprime ses déploiements sur le serveur ; les autres appareils les reçoivent comme suppressions au pull suivant. Le client envoie la suppression de la liste **et** celle de chacun de ses déploiements, chacune avec son jeton de base.
- **Ordre dans une poussée.** Le serveur traite d'abord les listes écrites, puis les déploiements écrits, puis les suppressions de déploiements, puis les suppressions de listes. Un déploiement peut ainsi référencer une liste créée dans la même poussée, et une liste n'est supprimée qu'après ses déploiements.
- **Traitement par enregistrement.** Chaque enregistrement est accepté, en conflit ou rejeté (non conforme au schéma ou à ses bornes, déploiement dont la liste n'a jamais existé, ou dont la liste changerait — la liaison de [[RT_07]] est immuable). Aucun n'empêche les autres d'être acceptés. Un enregistrement rejeté reste intact sur l'appareil et le rejet est signalé par l'état de synchronisation ([[RG_19]]).
- **Résolution.** Le joueur ayant choisi ([[RG_54]]), le client envoie sa décision. Garder la version locale l'écrit sur le serveur, en y restaurant si besoin la liste du déploiement ; garder la version serveur la renvoie au client, avec les enregistrements liés à restaurer (déploiements d'une liste dont la suppression est abandonnée) ou à supprimer (déploiement en double écarté).
- **Résolution périmée.** Une résolution cite le jeton de la version serveur présentée au joueur. Si le serveur a changé depuis, elle est refusée, et le conflit est présenté à nouveau avec la nouvelle version : le joueur ne tranche jamais contre une version qu'il n'a pas vue.
- **Horodatages.** `createdAt`/`updatedAt` sont fixés par l'appareil au moment où le joueur fait la modification — c'est l'heure qu'il reconnaît — et conservés tels quels par le serveur, qui ne s'en sert pour aucune décision. Seuls les jetons décident d'un conflit ; les dates ne sont qu'affichées ([[RG_54]]).
- **Pull paginé.** Le pull renvoie les changements par pages (200 enregistrements par défaut), avec un indicateur « il en reste ». Le client applique chaque page puis mémorise son jeton avant de demander la suivante : une synchronisation interrompue reprend là où elle s'est arrêtée. Seul le pull fait avancer ce jeton ; le pull suivant renvoie donc aussi les écritures de l'appareil lui-même, reconnues à leur `versionToken` et ignorées. Une liste supprimée sur le serveur n'est pas supprimée localement tant qu'un de ses déploiements y est modifié : elle attend l'issue du conflit.
- **Poussée découpée.** Au-delà de 200 enregistrements ou 5 Mo, le client découpe sa poussée en plusieurs requêtes, une liste et ses déploiements restant dans la même requête.
- **Jeton trop ancien.** Le serveur conserve la trace des suppressions 90 jours. Au-delà, un pull reçoit `410` : le client refait un pull complet et supprime localement les enregistrements synchronisés que le compte n'a plus, sauf ceux modifiés localement, qui partent au push suivant.
- **Idempotence.** Chaque poussée et chaque résolution de conflit porte une clé `Idempotency-Key`, réutilisée en cas de nouvelle tentative : une requête rejouée après une réponse perdue renvoie la réponse initiale au lieu de produire des conflits contre ses propres écritures.
- **Précisions d'implémentation** (décidées par le porteur du produit à l'initialisation du serveur, le 2026-10-06) :
  - une suppression d'un enregistrement déjà supprimé sur le serveur est acceptée sans effet ; une suppression **sans** jeton d'un enregistrement que le serveur porte encore est un conflit « supprimé ici, modifié ailleurs » ; une création dont l'identifiant existe déjà sur le serveur est un conflit « modifié des deux côtés » ;
  - une écriture dont l'enregistrement n'existe plus sur le serveur (trace purgée, retour d'un `410`) est acceptée comme une création ; un déploiement dont la liste n'existe plus sur le serveur pour la même raison est rejeté (`UNKNOWN_LIST`) ;
  - une suppression de liste qui laisse sur le serveur des déploiements de cette liste donne le conflit « liste supprimée ici », même si le jeton de la liste est aussi périmé ; les suppressions refusées de ses déploiements sont renvoyées comme conflits distincts ;
  - « même plateau créé deux fois » ne compare qu'aux déploiements du triplet écrits après le `since` de la poussée et avant elle, par un autre appareil — deux créations du même triplet dans une même poussée ne se gênent pas ; s'il y en a plusieurs, le plus récent est présenté ;
  - le `serverVersionToken` d'un conflit est la plus haute révision de son groupe — une liste et tous ses déploiements, ou un déploiement et sa liste. Une résolution est périmée dès que ce maximum a changé, y compris pour « garder la version serveur » ; le `409` porte le corps d'erreur commun, le client tire puis représente le conflit ;
  - la date d'une suppression présentée dans un conflit est le `deletedAt` envoyé par l'appareil (colonne `client_deleted_at`, [[RT_70]]), à défaut la date serveur ;
  - « garder la version serveur » d'un déploiement dont la liste a été supprimée renvoie à supprimer localement la liste et les déploiements de cette liste connus du serveur ; pour « même plateau créé deux fois », il renvoie le déploiement local comme supprimé et celui de l'autre appareil dans `relatedRecords` ;
  - une poussée dont un élément est inexploitable (pas un objet, `id` qui n'est pas une chaîne, `resourceType` inconnu) est refusée en entier (`400`) ; seuls les champs du contrat sont conservés ; un déploiement reçu sans `note` est stocké avec une note vide ;
  - le `lastChangeAt` du résumé ([[RG_51]]) est le plus récent `updatedAt` (heure de l'appareil) des enregistrements actifs ;
  - le corps d'une requête autre que la poussée et la résolution est limité à 64 ko (`400` au-delà).

### RT_69 — Erreurs, limites et compatibilité

- **Erreurs.** Toutes les routes renvoient le même corps d'erreur : un `code` énuméré, sur lequel le client décide, et un `message` en français, affichable tel quel.
- **Limitation de débit.** Le serveur répond `429` avec un délai `Retry-After`, que le client respecte sans bloquer le joueur ([[RG_09]]). Seuils :

  | Action | Limite |
  |---|---|
  | Connexion échouée, par adresse email | 5 par 15 minutes |
  | Connexion, par adresse IP | 20 par 15 minutes |
  | Inscription, par adresse IP | 5 par heure |
  | Mot de passe erroné sur une action de [[RG_52]], par compte | 5 par 15 minutes |
  | Toute autre requête, par jeton d'appareil | 120 par minute |

- **Bornes des données.** Le contrat ([openapi.yml](openapi.yml)) borne chaque champ, pour que le schéma de base et la validation du serveur soient déterminés. Ces bornes sont larges devant tout usage réel — une liste d'armée compte quelques dizaines d'unités — et ne visent qu'à refuser un enregistrement aberrant ou malveillant :

  | Donnée | Borne |
  |---|---|
  | Identifiant d'enregistrement, d'unité, de groupe, de socle, de référentiel | 100 caractères (`idModele` : 150) |
  | Nom de liste, de déploiement, d'unité, de profil de modèle | 200 caractères |
  | Email / mot de passe / libellé d'appareil | 254 / 8 à 128 / 80 caractères |
  | Note de plan de jeu ([[RG_45]]) | 4 000 caractères (inchangé) |
  | Unités par liste, unités en réserve | 300 |
  | Groupes de modèles par unité | 50 |
  | Modèles par groupe et par unité | 500 |
  | Placements par déploiement | 2 000 |
  | Coordonnées `x`/`y` (pixels d'asset, [[RT_04]]) | 0 à 10 000 |
  | Rotation | −3 600° à 3 600° |
  | Socle sur mesure ([[RT_28]]) | > 0 et ≤ 1 000 mm |
  | Couleur d'unité ([[RG_06]]) | `#RRGGBB` |
  | Poussée | 200 enregistrements, 5 Mo |

  Le serveur ne vérifie pas que les identifiants de référentiel (`boardId`, `forceDispositionId`, `opponentDispositionId`, `baseShapeId`) existent : les référentiels sont embarqués dans le client ([[RT_02]], [[RT_12]], [[RT_23]]) et le serveur ne les connaît pas. Il les stocke tels quels.
- **Compatibilité.** Chaque appel porte la version de l'application ([[RG_47]]) dans l'en-tête `X-Client-Version`. Un client trop ancien pour le schéma servi reçoit `426` : il suspend la synchronisation, garde ses données locales, et l'état de synchronisation ([[RG_19]]) invite à mettre l'application à jour.

### RT_70 — Persistance serveur

Le serveur de [[RT_09]] (Node.js) stocke ses données dans **PostgreSQL**. Il ne fait que ranger, versionner et renvoyer les listes et déploiements : il n'en interprète pas le contenu, au-delà des contrôles de [[RT_68]] et des bornes de [[RT_69]].

**Révisions : ce que sont `since` et `versionToken`.** Chaque compte a un **compteur de révision**, un entier qui part de 0. Toute écriture sur le compte (création, modification, suppression d'une liste ou d'un déploiement) l'incrémente de 1, et l'enregistrement écrit garde la valeur obtenue comme **révision**. Les deux jetons du contrat sont ces nombres, transmis sous forme de chaîne :

- le `versionToken` d'un enregistrement est la révision de sa dernière écriture ;
- le `since` d'un appareil est la plus haute révision qu'il a reçue par le pull.

Exemple. Le compte est à la révision 41. Le téléphone pousse une liste nouvelle : elle prend la révision 42. La tablette, à `since = 40`, demande les changements : le serveur renvoie tout ce dont la révision dépasse 40, soit cette liste (42) et ce qui avait été écrit en 41, et le nouveau `since` de la tablette est 42. Plus tard, téléphone et tablette, hors-ligne, modifient tous deux cette liste, qui est à la révision 42. Le téléphone pousse le premier : sa base est 42, égale à la révision courante, l'écriture est acceptée et prend la révision 43. La tablette pousse ensuite avec la base 42 : elle diffère de 43, c'est un conflit ([[RG_54]]). Le compteur est par compte, et non global : l'activité d'un joueur ne touche jamais celle d'un autre.

**Tables.**

| Table | Contenu | Clé |
|---|---|---|
| `users` | email (unique, normalisé), hash argon2id du mot de passe, compteur de révision, dates de création | `id` (UUID) |
| `device_tokens` | compte, hash SHA-256 du jeton, identifiant, libellé et plateforme de l'appareil, date de création | hash du jeton ; unique (`user_id`, `device_id`) |
| `records` | compte, type (`list`/`deployment`), identifiant, révision, supprimé (booléen), contenu complet en **JSONB**, `list_id` et triplet (`opponent_disposition_id`, `board_id`) extraits pour les déploiements, libellé de l'appareil auteur, date de suppression (serveur, pour la purge) et date de suppression fixée par l'appareil (affichée dans les conflits, [[RT_68]]) | (`user_id`, `resource_type`, `id`) ; index (`user_id`, `revision`) pour le pull ; index (`user_id`, `list_id`) pour la cascade et le triplet |
| `idempotency_keys` | compte, clé, empreinte du corps, réponse renvoyée, date | (`user_id`, `key`) |

Une suppression ne retire pas la ligne de `records` : elle la marque supprimée, vide son contenu et lui donne une révision — c'est la trace que le pull transmet aux autres appareils. Les traces de plus de 90 jours sont purgées, et le compte retient la plus haute révision purgée : un `since` inférieur reçoit `410` ([[RT_68]]). Les clés d'idempotence sont purgées après 24 heures.

**Concurrence.** Une poussée s'exécute dans une transaction qui verrouille la ligne du compte dans `users` : deux poussées du même compte ne s'entrelacent jamais, et la révision croît sans trou visible.

**Suppression du compte ([[RG_52]]).** Une seule transaction supprime toutes les lignes du compte dans les quatre tables, puis le compte lui-même. Les journaux du serveur ne contiennent ni adresse email, ni jeton, ni contenu d'enregistrement.

**Démarrage.** Le serveur vérifie que la base répond avant d'écouter sur son port. Si elle est injoignable — refus de connexion, identifiants refusés, ou aucune connexion établie en 5 secondes —, il journalise la cause (code d'erreur seulement, jamais l'adresse de connexion ni ses identifiants) et s'arrête avec un code de sortie non nul : il n'accepte jamais de requête sans base. Il ne réessaie pas ; le redémarrage relève de l'hébergeur. Une fois démarré, une base devenue injoignable ne l'arrête pas : `GET /health` répond alors `503`.

La portée des identifiants d'enregistrement — uniques par compte, ce que suppose la clé de `records` — sera précisée ultérieurement (voir « Suivi des décisions non tranchées »).

### RT_71 — Adresse du serveur selon l'environnement

L'adresse du serveur de [[RT_09]] dépend de l'environnement de build du client, et ne figure qu'à un seul endroit par environnement : `syncApiBaseUrl` dans `src/environments/environment*.ts`. Aucun autre fichier ne la contient.

| Environnement | Build | Adresse |
|---|---|---|
| Développement | `ng serve`, `ionic serve` | `http://localhost:3000/v1` |
| Production | `ng build` (web, PWA, APK) | non tranchée (voir « Suivi des décisions non tranchées ») |

Tant que l'adresse de production n'est pas tranchée, `environment.prod.ts` porte `syncApiBaseUrl: null` : un build de production n'émet aucune requête vers un serveur, et le bloc « Compte » des Réglages ([[RG_18]]) indique que la synchronisation entre appareils n'est pas encore disponible dans cette version, au lieu des formulaires d'inscription et de connexion. Passer en production ne demande que de renseigner l'adresse de `environment.prod.ts` : le remplacement de fichier par Angular au build ([angular.json](../angular.json)) fait le reste. L'adresse est **absolue** dans les deux cas : l'APK Android est servi depuis l'origine `https://localhost` de Capacitor, où une adresse relative comme `/v1` ne mène à aucun serveur.

**Développement sur appareil Android.** Sur l'APK, `localhost` désigne le téléphone et non l'ordinateur de développement : un émulateur atteint ce dernier par `http://10.0.2.2:3000/v1`, un téléphone réel par l'adresse IP locale de l'ordinateur. Ce cas passe par un environnement de build dédié (`environment.android-dev.ts`), et non par une modification de l'environnement de développement.

**CORS.** Le serveur autorise les origines du client, et elles seules :

- en développement : `http://localhost:4200` (`ng serve`), `http://localhost:8100` (`ionic serve`), `http://localhost:8080` (`npm run serve:pwa`) et `https://localhost` (APK Android) ;
- en production : l'origine de la version web ([[RT_59]]) et `https://localhost`.

Il autorise les en-têtes `Authorization`, `Content-Type`, `Idempotency-Key` et `X-Client-Version`, et expose `Retry-After`.

### RT_72 — Version du serveur de synchronisation

Le serveur de [[RT_09]] a son propre numéro de version, `MAJEUR.MINEUR.CORRECTIF`, indépendant de celui de l'application ([[RG_47]], [[RT_63]]) : le champ `version` du `package.json` du serveur, parti de `0.1.0`.

- Chaque commit qui modifie le code ou la configuration du serveur incrémente son correctif dans ce même commit (`npm version patch --no-git-tag-version` dans le dépôt du serveur). Un commit qui ne touche que la spécification ou la documentation ne l'incrémente pas.
- Un commit du serveur ne change jamais la version de l'application, et inversement.
- La version est exposée par `GET /health` (hors `/v1`, non authentifié).
- La version minimale de l'application que le serveur accepte (`426`, [[RT_69]]) est un réglage distinct (`MIN_CLIENT_VERSION`), sans lien avec la version du serveur.

Les incréments mineur et majeur sont décidés par le porteur du produit.

---

### RT_63 — Source et incrément du numéro de version

Le champ `version` de `package.json` est l'unique source du numéro de [[RG_47]] :
- l'application le lit à la compilation (import du seul champ `version`, les autres champs de `package.json` n'étant pas embarqués dans le bundle), sans appel réseau ni fichier généré à tenir à jour ;
- l'application Android en dérive à la compilation son `versionName` (identique) et son `versionCode` (`MAJEUR × 1 000 000 + MINEUR × 1 000 + CORRECTIF`, strictement croissant comme l'exige le Play Store).

Chaque commit qui modifie du code (application, scripts, configuration de build, référentiels générés) incrémente le correctif dans ce même commit, par `npm run version:patch` (`npm version patch --no-git-tag-version`, qui met aussi à jour `package-lock.json`). Un commit qui ne touche que la spécification (`specification/`) ou la documentation ne l'incrémente pas. Les incréments mineur et majeur sont décidés par le porteur du produit.

## EX_07 — Lisibilité et accessibilité de l'interface

Quel que soit l'appareil, l'orientation et le thème d'affichage retenu par le système (clair ou sombre), toute information affichée par l'application doit rester lisible et actionnable : contraste suffisant entre le texte et son fond, taille de texte exploitable sur un téléphone tenu à bout de bras au-dessus d'une table de jeu, cibles tactiles atteignables au doigt, et information jamais portée par la seule couleur. Cette exigence est transverse : elle s'applique à tous les écrans du parcours, y compris ceux déjà spécifiés par [[EX_01]] à [[EX_06]], et ne modifie aucun de leurs comportements fonctionnels.

Elle ne porte aucune direction artistique : l'application conserve l'apparence par défaut du cadre d'interface retenu ([[RT_29]]), sans identité visuelle propre, sans police de titrage ni thématisation graphique liée à l'univers du jeu. Le seul objectif est la lisibilité.

Satisfait par : [[RG_24]], [[RT_29]], [[RT_30]], [[RT_31]], [[RT_32]], [[RT_33]].

### RG_24 — Double canal d'information des codes couleur

Les trois codes couleur de statut définis par l'application — indicateur agrégé par disposition adverse ([[RG_12]]), statut individuel par plateau ([[RG_14]]) et état de placement par unité ([[RG_16]]) — conservent chacun leurs couleurs, mais aucun d'eux ne porte seul l'information : chaque élément qui affiche un de ces codes affiche **également** la même information sous forme textuelle ou chiffrée, à côté de la couleur et non à sa place.

Ce second canal n'est pas une redondance décorative : il est la source d'information de référence dès lors que la couleur n'est pas perceptible — daltonisme (les couples blanc/jaune de [[RG_12]] et rouge/vert de [[RG_14]] sont indistinguables en deutéranopie), écran lu en plein soleil au bord d'une table, thème d'affichage inhabituel. La couleur reste le canal de lecture rapide, le texte ou le compte le canal de vérification.

Le second canal retenu pour chaque code est précisé par la règle qui le définit : un compte « terminés sur total » pour [[RG_12]], le libellé de statut déjà prévu pour [[RG_14]], le compte « modèles placés sur modèles de l'unité » pour [[RG_16]]. Un élément trop petit pour porter ce texte (une pastille de navigation, par exemple) n'est jamais le seul porteur du statut : il en expose alors le libellé par son nom accessible, et le statut est affiché en toutes lettres ailleurs sur le même écran.

Corollaire sur les légendes : une légende qui explique la signification des couleurs n'est plus nécessaire en permanence dès lors que chaque élément porte son second canal. Elle reste disponible, repliée par défaut, pour que l'espace de l'écran serve d'abord au choix que le joueur est venu faire.

### RT_29 — Système de thème et tokens de couleur

**Principe.** L'application déclare l'intégralité de ses couleurs sous forme de **tokens nommés** définis en un point unique, [variables.scss](../src/theme/variables.scss), et n'utilise aucune valeur de couleur littérale (notation hexadécimale, `rgb()`, `hsl()`) dans les feuilles de style des écrans ni dans les styles portés par les composants. Une couleur codée en dur dans un écran est un défaut au sens de cette règle, y compris quand elle « rend bien » dans le thème courant : elle est par construction insensible au changement de thème.

**Deux thèmes, tous deux tokenisés.** L'application suit le thème d'affichage du système (clair ou sombre) via la palette système du cadre d'interface. Les deux thèmes sont traités à égalité : chaque token porte une valeur claire et une valeur sombre, aucune n'étant déduite de l'autre par transformation automatique (inversion, filtre). Le thème clair n'est pas « le défaut auquel le sombre déroge ».

**Articulation avec les variables natives du cadre d'interface.** Seules les variables natives réellement définies dans les deux thèmes sont consommées : la couleur de fond de page et la couleur de texte. Les échelons intermédiaires (`--ion-color-step-*`) **ne sont pas utilisés** : vérifié au 2026-09-11 sur la version embarquée, ils ne sont définis par le cadre dans aucun des deux thèmes — ce ne sont que des points d'override, et toute lecture repose en réalité sur la valeur de repli codée à côté, donc sur une valeur claire, y compris en thème sombre. Les variables de surface propres au thème sombre n'existent par ailleurs que sous les classes de mode de la racine du document, jamais sur la racine nue. L'application définit donc ses propres échelons de surface plutôt que d'emprunter ceux du cadre. De même, les couleurs nommées du cadre (`--ion-color-dark`, `--ion-color-medium`, `--ion-color-warning-tint`...) **ne sont jamais employées comme couleur de texte ou de fond générique** : ce sont des couleurs d'accentuation dont la valeur s'inverse d'un thème à l'autre (`--ion-color-dark` vaut une teinte claire en thème sombre) et dont le contraste n'est garanti que face à leur propre couleur de contraste.

**Familles de tokens.** Surfaces (page, surélevée, encastrée, superposition, scène sombre du plateau) ; bordures (discrète, structurante, interactive) ; textes (principal, secondaire, atténué, sur scène sombre) ; surfaces d'alerte et d'erreur avec leur couleur de texte associée ; et une famille de statut **par code couleur** de [[RG_24]], chacune déclarant, par état, un fond, une bordure et la couleur de texte lisible sur ce fond. Les trois familles de statut restent distinctes même lorsque deux d'entre elles partagent une teinte, pour qu'un ajustement sur l'une n'en déplace jamais une autre — cette séparation reprend celle que [[RG_12]], [[RG_14]] et [[RG_16]] posent déjà entre leurs périmètres respectifs.

Une surface d'alerte, d'erreur ou de statut n'est jamais posée sans la couleur de texte qui lui est associée : c'est l'omission de cette seconde déclaration, le texte héritant alors de la couleur de page, qui produit l'essentiel des défauts de contraste constatés en thème sombre.

**Objectif de contraste.** Tout couple (texte, fond) effectivement produit par ces tokens atteint au minimum **4,5:1** dans les deux thèmes, y compris les textes secondaires et les libellés posés sur une surface de statut. Tout élément non textuel porteur d'information ou de délimitation d'un contrôle (bordure d'un bouton, pastille de statut) atteint au minimum **3:1** face à la surface qui l'entoure. Aucune paire n'est réputée conforme par principe : elle est vérifiée ([[RT_32]] pour les couleurs calculées, et la procédure ci-dessous pour les tokens).

**Vérification.** Les couples de tokens et leur ratio visé sont déclarés en commentaire au point de définition, et contrôlés par un script hors-ligne dédié plutôt que par relecture visuelle ; un token dont la valeur est modifiée sans que le couple correspondant reste au-dessus du seuil fait échouer ce contrôle.

### RT_30 — Échelle typographique

**Principe.** Les tailles de texte de l'application proviennent d'une **échelle fermée de cinq crans**, déclarée avec les tokens de [[RT_29]] : aucune feuille de style d'écran ne fixe de taille de police littérale. Les crans sont exprimés en unité relative à la taille de police du document, pour que le réglage système de taille de texte du joueur continue de s'appliquer.

**Plancher de lisibilité.** Le cran le plus petit de l'échelle constitue un plancher : aucun texte de l'application ne descend en dessous, quel que soit son rôle (mention, légende, compteur, unité de mesure). Un contenu qui ne tient pas à cette taille dans l'espace qui lui est alloué est traité en redimensionnant son conteneur, en le tronquant avec un nom accessible complet, ou en le repliant — jamais en réduisant sa taille de police.

**Hiérarchie.** Sur un même bloc, l'élément que le joueur cherche en premier — le nom d'une liste, le nom d'une unité, le nom d'un plateau — porte un cran supérieur et une couleur de texte principale ; ses métadonnées (compte de modèles, disposition, date, nombre de déploiements) portent un cran inférieur et une couleur de texte secondaire. L'inverse est un défaut au sens de cette règle. De même, un titre de section porte toujours un cran supérieur ou égal aux libellés des lignes qu'il coiffe.

**Aucune identité typographique.** L'échelle ne s'accompagne d'aucune police de caractères propre à l'application : la pile de polices par défaut du cadre d'interface est conservée, conformément à [[EX_07]]. Seules les tailles, graisses et hauteurs de ligne sont normalisées.

**Langue du document.** Le document déclare la langue effective de son contenu, pour que la synthèse vocale, la coupure des mots et les dictionnaires du navigateur s'appliquent correctement.

### RT_31 — Cibles tactiles et contrôles natifs

**Taille minimale.** Tout élément actionnable au doigt — bouton, pastille de pagination, entrée de liste cliquable, poignée — offre une surface tactile d'au moins **44 × 44 pixels CSS**, y compris lorsque sa représentation visuelle est plus petite : la surface est alors étendue par du remplissage ou une zone d'atteinte transparente, sans agrandir le dessin. Un espacement d'au moins 8 pixels sépare deux cibles adjacentes, pour qu'une frappe imprécise ne déclenche pas la voisine.

**Contrôles natifs non stylés.** Un contrôle rendu par le navigateur avec son apparence et son libellé par défaut (le sélecteur de fichier natif, notamment) n'est jamais l'action principale d'un écran : sa taille, son libellé et sa langue échappent à l'application, et sa cible tactile est en pratique inférieure au minimum ci-dessus. L'action principale est portée par un bouton de l'application, qui délègue au contrôle natif maintenu hors du flux visible — mais toujours atteignable au clavier et par les technologies d'assistance, jamais retiré de l'arbre d'accessibilité. Cela ne change rien au comportement fonctionnel de l'action concernée ([[RG_01]], [[RT_01]] pour l'import).

**Recouvrement.** Aucun élément superposé de nature décorative ou indicative (invite, pastille, filigrane) n'est positionné par-dessus un contenu porteur d'information — une légende imprimée dans une image de plateau ([[RT_12]]), par exemple. Ces éléments sont placés hors du contenu qu'ils commentent.

**Grossissement du document.** La restriction des gestes de zoom natifs exigée par [[RT_19]] porte sur le seul conteneur du plateau de l'écran de placement, où l'application implémente elle-même le geste. Elle n'est jamais appliquée au document entier : le joueur conserve partout ailleurs le grossissement offert par son navigateur et par son système.

### RT_33 — Stabilité de la mise en page

**Principe.** Un bloc dont le contenu change sans que le joueur ait changé d'écran occupe une hauteur **réservée et constante** : c'est le contenu qui varie à l'intérieur du bloc, jamais la place que le bloc prend dans le flux. Un bloc qui grandit ou rétrécit sous le doigt déplace tout ce qui l'entoure, et la cible que le joueur visait au moment où il a touché l'écran n'est plus là où il l'a visée ([[RT_31]]). La hauteur réservée est dimensionnée sur le contenu le plus grand que le bloc puisse recevoir ; un contenu plus petit y est centré plutôt que de la réduire.

**Conséquence sur le bandeau de [[RG_15]].** Les socles du référentiel de [[RT_02]] vont de 25 mm à 170 mm. À échelle fixe, la hauteur du bandeau suivrait la taille des socles de l'unité courante et changerait donc à chaque flèche « unité précédente / suivante » — et avec elle l'espace restant pour le plateau, dont le zoom « contenir » se recalcule sur cet espace ([[RG_17]]/[[RT_19]]) : le plateau entier serait re-cadré à chaque changement d'unité. La hauteur du bandeau est donc posée une fois pour toutes et c'est **l'échelle des socles qui s'y adapte** : une échelle nominale commune à toutes les unités, réduite pour la seule unité dont le plus grand socle ne tiendrait pas dans la hauteur réservée. Les proportions relatives des socles d'une même unité sont dans tous les cas conservées, conformément à [[RT_05]].

**Conséquence sur les cartes de liste de l'accueil.** Le nom d'une liste est saisi par le joueur ([[RG_01]], [[RG_21]]) : sa longueur n'est pas bornée. Laissé libre de se replier, il donne à chaque carte une hauteur différente, et la bibliothèque se réorganise à chaque import, renommage ou duplication. Le nom de la liste et ses métadonnées sont donc tronqués à une ligne chacun, conformément au traitement prévu par [[RT_30]] — le texte complet restant présent dans l'arbre d'accessibilité —, et la carte occupe la même hauteur quelle que soit la liste qu'elle décrit.

**Conséquence sur la barre d'actions de token de [[RG_20]].** Les actions portant sur le token sélectionné — rotation au pas fixe, retrait — n'existent que tant qu'un token est sélectionné. Insérées dans le flux, elles apparaissent et disparaissent au fil des sélections et re-cadrent le plateau à chaque fois, exactement comme le ferait un bandeau de hauteur variable. Elles sont donc **superposées à la zone du plateau** plutôt qu'insérées entre celle-ci et le bandeau : leur apparition ne consomme aucune hauteur et ne modifie donc jamais l'échelle d'affichage de [[RG_17]]/[[RT_19]].

Cette superposition ne relève pas de l'interdiction de recouvrement de [[RT_31]], qui vise les éléments décoratifs ou indicatifs posés sur un contenu porteur d'information : il s'agit ici de contrôles, et le rognage au rectangle de jeu de [[RT_19]] écarte déjà de l'affichage la légende imprimée que cette interdiction protège. La barre est ancrée dans un angle de la zone, hors du centre où se fait la manipulation, et reste soumise aux cibles tactiles de [[RT_31]] comme tout autre contrôle. Le délimiteur du contrôle porte le contraste exigé face à la scène sombre sur laquelle il flotte, et non seulement face à sa propre surface.

---

## EX_08 — Visualisation de la zone visible depuis un modèle

Sur l'écran de placement, le joueur doit pouvoir sélectionner un modèle déjà posé et voir instantanément, colorée sur le plateau, **toute la surface que ce modèle voit** — conformément aux règles de ligne de vue du jeu (tracé depuis n'importe quel point du socle, terrain obscurcissant, murs) — pour juger d'un coup d'œil ce qu'une position couvre et ce qu'elle laisse à l'abri, sans avoir à viser à l'œil sur la table physique.

Satisfait par : [[RG_27]], [[RG_28]], [[RG_29]], [[RT_37]], [[RT_38]], [[RT_39]].

### RG_27 — Zone visible depuis un modèle

La zone visible depuis un modèle posé est l'ensemble des points du rectangle de jeu ([[RT_05]]) vers lesquels il est possible de tracer une ligne droite imaginaire, **large de 1 mm**, depuis **n'importe quel point** du socle de ce modèle, sans que cette ligne ne soit interceptée par un obstacle au sens de [[RG_28]]. Il suffit qu'**une seule** ligne dégagée existe, depuis un seul point du socle, pour qu'un point du plateau soit visible : un grand socle voit donc plus loin autour d'un obstacle qu'un petit.

**Les modèles ne sont pas des obstacles.** La règle du jeu ignore, pour tracer une ligne de vue, les modèles de l'unité observatrice et ceux de l'unité observée. Une zone visible n'a pas de modèle observé — elle décrit ce que *verrait* le modèle sélectionné d'un point quelconque du plateau — et cette exclusion n'y est donc pas exprimable. La zone est par conséquent calculée contre le **seul terrain** : aucun modèle posé, ami ou adverse, ne masque une partie de la zone visible. Elle décrit ainsi ce que la position couvre en vertu du plateau, indépendamment des autres tokens posés.

**Vue de dessus.** Comme pour [[RG_26]], le plateau est une vue de dessus sans relief : la hauteur des modèles et des éléments de terrain n'est pas prise en compte, un obstacle au sens de [[RG_28]] bloquant la vue quelle que soit la taille du modèle.

### RG_28 — Terrain obscurcissant et murs

Une zone de terrain du plateau peut être marquée **obscurcissante**. Un point du plateau n'est pas visible depuis le modèle sélectionné ([[RG_27]]) lorsque **toute** ligne tracée depuis son socle jusqu'à ce point traverse au moins une zone obscurcissante — deux exceptions s'appliquant, conformément à la règle du jeu qui exclut les zones obscurcissantes dans lesquelles l'un ou l'autre des deux modèles se trouve :

- **Le modèle est dans la zone.** Une zone obscurcissante que le socle du modèle sélectionné chevauche ne lui masque rien : il voit à travers elle comme si elle n'était pas obscurcissante.
- **Le point est dans la zone.** Un point situé à l'intérieur d'une zone obscurcissante n'est jamais masqué par **cette même zone** — un modèle qui s'y trouverait serait lui-même « dans la zone ». Le modèle sélectionné voit donc l'intérieur d'une zone de terrain qui lui fait face, mais pas au-delà : la zone reste obscurcissante pour tout ce qui se trouve derrière elle.

**Correspondance avec la légende des plateaux.** Les plateaux de [[RT_12]] distinguent trois éléments de terrain dans leur légende. Chaque **socle de ruine** (« Baseplate », emprise grise hachurée cerclée de noir) est une zone obscurcissante. Les **murs de ruine** (« Ruin walls », en vert) sont les murs de l'alinéa suivant. Les **obstacles** (« Obstacles », en orange) ne bloquent pas la vue et ne jouent aucun rôle dans ce calcul : ils sont presque toujours posés sur un socle de ruine, qui obscurcit déjà. Les **icônes** d'objectif (disques cerclés portant un pictogramme) ne sont pas du terrain et sont ignorées : le terrain qu'elles recouvrent compte comme s'il était visible, et une icône ne relie jamais deux terrains entre eux.

**Terrains accolés.** Deux socles de ruine dont les contours noirs se touchent le long d'un côté forment une **seule** zone obscurcissante : le trait qui les sépare n'est pas une frontière de terrain. C'est le cas des deux moitiés d'un socle fendu, de deux socles posés bout à bout ou de l'extrémité d'un socle étroit posée contre le côté d'un autre. Un modèle posté dans l'un voit donc à travers les deux, et un point de l'un n'est pas masqué par l'autre. Deux socles qui ne se touchent que **par un angle** restent en revanche deux zones distinctes.

**Murs.** Indépendamment de son statut obscurcissant, une zone de terrain peut porter des **murs** — des tracés qui bloquent la vue de façon inconditionnelle dès qu'une ligne les traverse. Aucune des deux exceptions ci-dessus ne s'applique à un mur : un modèle posté à l'intérieur d'une ruine voit à travers l'emprise de la ruine, mais pas à travers ses murs, et un point situé dans la ruine reste masqué s'il se trouve derrière un de ses murs.

### RG_29 — Coloration de la zone visible à la sélection d'un modèle posé

Sur l'écran de placement ([[RG_03]] étape 3), sélectionner un token déjà posé colore sur le plateau la zone visible depuis ce modèle ([[RG_27]]). Seule la surface visible est colorée : le reste du plateau est laissé tel quel, et c'est l'absence de coloration qui désigne les espaces à l'abri de ce modèle. Désélectionner le token, ou en sélectionner un autre, retire la coloration précédente ; au plus une zone visible est affichée à la fois, celle du token sélectionné, sur le même principe de sélection que [[RG_20]]. Lorsque la sélection compte plusieurs tokens ([[RG_30]], [[RG_31]]), aucune zone visible n'est affichée. Un modèle encore dans le bandeau ([[RG_15]]) ou en réserve ([[RG_25]]) n'a pas de position et n'a donc pas de zone visible.

**Mise à jour.** La zone est recalculée à la fin de tout geste qui déplace ou fait pivoter le token sélectionné ([[RG_04]], [[RG_20]]) — la forme de son socle et son orientation changeant ce qu'il voit. Pendant le glisser du token sélectionné, la coloration est masquée plutôt que laissée à son ancienne position, pour ne jamais afficher une zone qui ne correspond plus à la position du token. Les gestes portant sur d'autres tokens ne la modifient pas, les modèles n'étant pas des obstacles ([[RG_27]]).

**Plateau sans terrain décrit.** Si la géométrie du terrain du plateau affiché n'est pas encore disponible ([[RT_37]]), aucune zone n'est colorée et un message indique que la zone visible n'est pas disponible pour ce plateau : colorer le plateau entier ferait croire à tort qu'aucun obstacle ne s'y trouve.

### RT_37 — Référentiel des zones de terrain par plateau

**Constat préalable.** Le référentiel de plateaux ([[RT_12]]) ne fournit que des images : aucune source structurée (gdmissions.app/Battlemaster) ne publie la géométrie des éléments de terrain qui y sont visibles, ni leurs propriétés de jeu (obscurcissant, mur). Sans cette donnée, [[RG_28]] est incalculable.

**Décision (précédemment « saisie manuelle par l'assistant IA ») : extraction hors-ligne par script, depuis les images des plateaux.** Les images de [[RT_12]] dessinent le terrain dans des couleurs franches, fixées par leur légende ([[RG_28]]) : la géométrie s'en déduit donc par analyse des pixels, sans saisie manuelle. Le script `scripts/ingest-terrain.mjs` lit l'image `no-measurements` de chaque plateau de `boards.json`, en réutilisant le décodeur PNG déjà employé pour mesurer le `playArea` ([[RT_05]]), et produit un fichier unique, `src/assets/referentials/terrain.json`, indexé par identifiant de plateau. Comme les autres scripts d'ingestion ([[RT_02]], [[RT_12]]), il s'exécute hors-ligne, jamais à l'exécution de l'application, et **échoue explicitement** plutôt que de produire un référentiel partiel : couleur de mur absente de la légende (indice d'un changement de format), plateau sans socle ou sans mur, nombre de socles hors d'une plage plausible.

**Extraction.** Chaque composante connexe de pixels verts est un **mur** ; un mur en forme de cadre est traité comme plein, ce qui ne change rien à la vue qu'il bloque. Les **socles de ruine** se reconstituent à partir des régions grises que délimitent les traits noirs, dans le rectangle de jeu. Le fond du plateau (grille, zones de déploiement) est lui aussi une région, mais sans gris ; il est écarté. Trois difficultés commandent la reconstitution :

- **Les barres découpent leur socle.** Un mur ou un obstacle est une barre de couleur cernée d'un liseré noir fin, qui découpe son socle en morceaux (de part et d'autre de la barre, dans un cadre). Les morceaux qu'une même barre touche à travers son seul liseré sont réunis en un socle.
- **Un côté ou un angle.** Deux morceaux qui se rejoignent à travers un trait noir — fente entre deux demi-socles, contours de deux socles accolés — sont réunis en une seule zone ([[RG_28]], terrains accolés), et le trait qui les séparait est intégré à la zone. Le contact est un côté lorsqu'il s'étend au-delà de l'épaisseur du trait : 12 px au moins, alors que deux socles qui ne se touchent que par un angle se rejoignent sur 8 à 10 px, et que le plus court contact par un côté mesuré — l'extrémité d'une barre contre un socle — en fait 13. Deux morceaux qui ne se touchent que par un angle ne sont jamais réunis, même par une barre qui les chevauche ; ce refus vaut pour les socles reconstitués tout entiers. Les contacts les plus longs avec une barre sont réunis d'abord : une barre borde son propre socle sur toute sa longueur, et ne mord sur un socle voisin que par son extrémité.
- **Les icônes d'objectif sont ignorées.** Une icône (disque blanc cerclé de rouge, de bleu, de sarcelle ou de noir) n'est ni un morceau de socle, ni un trait de terrain : elle ne relie aucun morceau à un autre. Son disque reste infranchissable pendant la reconstitution, faute de quoi une icône posée à cheval sur le bord d'un socle relierait l'intérieur du socle au fond. Le terrain qu'elle recouvre est restitué ensuite : la partie du disque comprise dans l'enveloppe convexe du socle qui l'entoure lui revient — pour une icône posée sur un bord droit, exactement le demi-disque que ce bord délimite.

Une barre est rattachée au socle qu'elle borde le plus longuement. Les obstacles orange servent à reconstituer les socles mais ne sont pas extraits comme obstacles à la vue ([[RG_28]]). Les contours des socles sont simplifiés à 2,5 px près, ceux des murs à 1,5 px — soit quelques millimètres, précision suffisante pour planifier un déploiement et qui limite le coût du calcul de [[RT_38]]. Une option du script produit, par plateau, une image de contrôle qui superpose les polygones extraits au plateau, un socle par couleur, pour relire l'extraction. Le script lit les images `no-measurements` embarquées dans le dépôt : il dépend de la façon dont [[RT_12]] livre ces images (voir « Suivi des écarts »).

**Format.** Pour chaque plateau : une liste de **zones** (socles de ruine, toutes obscurcissantes) et une liste de **murs**, chacun décrit par un polygone (`points: [[x, y], …]`) dans le **repère de l'image d'asset** ([[RT_04]]/[[RT_05]]). Les murs sont des polygones et non des segments, car ce sont des barres épaisses sur l'image. Un mur n'est rattaché à aucune zone : il bloque la vue quelle que soit la zone où il se trouve ([[RG_28]]), et ce rattachement ne servirait à aucun calcul. Le fichier porte un bloc `source` qui crédite Battlemaster, dont les images sont la source ; ce bloc n'ajoute pas de mention à l'écran Réglages ([[RT_20]]), Battlemaster y étant déjà crédité par [[RT_12]].

**Plateau absent.** Un plateau absent du fichier a un terrain **non décrit**, ce qui ne veut pas dire qu'il n'a pas de terrain : aucune zone visible n'est alors calculée et le message prévu par [[RG_29]] est affiché. Un plateau sans aucun terrain se décrirait par des listes vides.

### RT_38 — Calcul de la zone visible

**Repère.** Tout le calcul se fait dans le repère en pixels de l'image d'asset ([[RT_04]]), les millimètres étant convertis avec l'échelle de [[RT_05]]. Le socle du modèle sélectionné est le polygone de [[RT_36]] (cercle, ovale approché à moins de 0,01", rectangle de [[RT_28]]), placé à son `x`/`y` et tourné de sa `rotation` ([[RT_22]]). Le résultat est borné au rectangle de jeu (`playArea`, [[RT_05]]).

**Largeur de 1 mm.** Une ligne de 1 mm de large est dégagée si et seulement si sa ligne médiane passe à au moins 0,5 mm de tout obstacle. Chaque obstacle — polygone de zone obscurcissante, polygone de mur ([[RT_37]]) — est donc **dilaté de 0,5 mm**, une fois par plateau au chargement de son terrain, et le reste du calcul raisonne sur des lignes d'épaisseur nulle contre ces obstacles dilatés. La première exception de [[RG_28]] (socle dans la zone) est évaluée sur le contour **non dilaté** de la zone.

**Obstacles retenus.** Les zones obscurcissantes que le socle du modèle sélectionné chevauche sont écartées ([[RG_28]], première exception) ; les murs sont toujours retenus, y compris ceux de ces zones écartées. Aucun socle de modèle n'est un obstacle ([[RG_27]]). Un point échantillon situé dans la marge de dilatation d'une zone — à moins de 0,5 mm de son contour — est tenu pour dans cette zone, qui est alors écartée pour lui : sans quoi il la verrait de l'intérieur, sans y être. Un point échantillon pris dans un mur ne voit rien.

**Zone visible depuis le socle.** Pour un point hors du socle, une ligne dégagée depuis un point intérieur du socle croise le contour du socle, et le tronçon qui en part est lui aussi dégagé : il suffit donc de considérer les points du **contour** du socle. Le contour est échantillonné — ses sommets, plus des points intermédiaires espacés de 2 mm au plus — et, pour chaque point échantillon, on calcule son **polygone de visibilité** contre les obstacles retenus (balayage angulaire classique autour des sommets des obstacles). La zone visible est la **réunion** de ces polygones de visibilité. L'échantillonnage du contour est une approximation acceptée, du même ordre que celle de [[RT_36]] pour les ovales : un point que seule une portion du contour comprise entre deux échantillons verrait serait manqué, écart non jugé bloquant pour un outil de planification.

**Intérieur des zones obscurcissantes.** La seconde exception de [[RG_28]] (un point dans une zone n'est pas masqué par cette zone) se traite dans le même balayage, par la règle d'arrêt de chaque rayon. Un rayon qui touche d'abord un **mur** ou le **bord** du rectangle de jeu s'arrête à ce premier impact. Un rayon qui touche d'abord le contour d'une **zone** Z y entre et s'arrête au **second** impact : la sortie de Z, un mur ou une autre zone. Les points de Z que ce tronçon traverse sont vus en vertu de l'exception ; ceux qui sont au-delà ne le sont pas, puisqu'ils ne sont plus dans Z. Le polygone de visibilité de chaque échantillon reste ainsi étoilé depuis ce point, et la réunion des polygones intègre l'intérieur des zones sans calcul séparé. Pour que ce balayage reste exact, les points où deux contours d'obstacles se croisent (un mur posé à cheval sur le contour d'un socle) s'ajoutent aux sommets autour desquels les rayons sont lancés.

**Rayons lancés.** Un sommet dont les deux arêtes restent du même côté du rayon qui l'atteint est une **silhouette** : la vue y saute de l'obstacle au lointain, et un rayon est lancé de part et d'autre du sommet. Un autre sommet n'est qu'un coin du polygone de visibilité : un seul rayon, exactement vers lui, suffit. Un croisement de contours peut faire sauter la vue (un mur passe devant une zone) : il est traité comme une silhouette. Chaque rayon ne teste que les arêtes des cases qu'il traverse, dans une grille d'accélération construite avec le terrain préparé. Ces deux mesures ramènent le calcul à quelques dizaines de millisecondes pour un socle courant (mesuré à environ 50 ms pour un socle de 105 × 70 mm dans le navigateur).

**Déclenchement.** Le calcul est lancé à la sélection d'un token et au relâchement d'un geste de déplacement ou de rotation du token sélectionné ([[RG_29]]), jamais à chaque mouvement du point de contact pendant le geste. Son résultat n'est pas persisté : ce n'est ni un enregistrement de placement ([[RT_04]]) ni une donnée synchronisée ([[RT_09]]).

### RT_39 — Rendu de la zone visible

La zone visible est rendue dans le SVG de l'éditeur de placement ([[RT_03]]), au-dessus de l'image du plateau et **sous** les tokens, pour que les tokens posés dans la zone restent pleinement lisibles. Elle n'a pas besoin d'être réduite à un seul polygone : les polygones de visibilité de [[RT_38]] sont tous dessinés comme les sous-chemins d'un **même chemin** SVG, avec une règle de remplissage `nonzero` et des sous-chemins parcourus dans le même sens (celui du balayage angulaire). Un chemin se remplit d'un seul tenant, avec une seule opacité : les recouvrements entre polygones ne s'additionnent pas, et la réunion apparaît d'une teinte uniforme sans calcul booléen de polygones.

La couleur du voile est un token de [[RT_29]] défini dans les deux thèmes, choisi pour se distinguer de la scène sombre du plateau sans masquer ce que l'image y montre (zones de déploiement, éléments de terrain) ; il se distingue aussi des couleurs d'unité de [[RG_06]], pour que la zone ne se confonde pas avec un token.

---

## EX_09 — Mesure de distances sur le plateau

Sur l'écran de placement, le joueur doit pouvoir **mesurer une distance en pouces** sur le plateau — entre deux points quelconques, ou la distance parcourue par un token qu'il déplace — comme il le ferait avec un mètre ruban sur la table physique, pour vérifier une portée, un écart à une zone ou une distance de mouvement avant de valider sa position.

Satisfait par : [[RG_33]], [[RG_34]], [[RG_35]], [[RT_42]], [[RT_43]], [[RT_44]].

### RG_33 — Mode « Règle » et mesure entre deux points

**Accès.** L'écran de placement ([[RG_03]] étape 3) porte, **en haut à gauche de la zone du plateau**, un bouton à icône de règle. Il est superposé au plateau, comme la barre d'actions de token de [[RG_20]] ([[RT_33]]) : son affichage ne consomme aucune hauteur et ne modifie pas l'échelle de [[RG_17]]. Un appui sur ce bouton active le **mode « Règle »** ; un nouvel appui le désactive. Le mode reste actif jusqu'à ce que le joueur le désactive ; il n'est ni enregistré ni synchronisé, et l'écran de placement s'ouvre toujours mode désactivé.

**Mesure entre deux points.** En mode « Règle », un glisser qui démarre sur une partie du plateau **où ne se trouve aucun token** ne trace plus le rectangle de sélection de [[RG_30]] : il trace un **segment** dont le premier point est le point d'appui et le second le point de contact courant (curseur ou doigt). Pendant tout le geste, la **longueur du segment en pouces** est affichée à côté de lui et suit le point de contact. Au relâchement, le second point est fixé à la position du relâchement, et le segment reste affiché avec sa mesure. Un simple appui, sans glisser, ne mesure rien et ne laisse aucun tracé. Un glisser hors mode « Règle », ou un glisser qui démarre sur un token, conserve son comportement habituel ([[RG_30]], [[RG_04]]).

**Mesure.** La distance affichée est la distance en ligne droite entre les deux points, dans la vue de dessus du plateau (comme pour [[RG_26]], sans relief), exprimée en pouces au dixième (par exemple `6,3"`). Elle n'est pas soumise aux règles de mesure bord à bord entre socles de [[RG_26]] : la règle mesure entre les points que le joueur désigne.

**Disparition.** Un tracé — de cette règle ou de [[RG_34]] — disparaît au **premier appui ou clic suivant sur l'écran**, où qu'il porte (plateau, token, bandeau, bouton), à une exception près : les contrôles de vue de [[EX_10]] — le bouton d'agrandissement ([[RG_38]]), le bouton du mode « Déplacement » et tout geste de déplacement de la vue ([[RG_39]]) — ne changent rien au contenu du plateau et **conservent** le tracé, pour que le joueur puisse agrandir ou déplacer la vue afin de lire une mesure. Cet appui conserve par ailleurs son effet ordinaire : un appui sur un token le sélectionne ([[RG_29]]), un appui qui commence une nouvelle mesure en trace aussitôt une nouvelle. Au plus un tracé est donc affiché à la fois. Désactiver le mode « Règle » efface aussi le tracé affiché.

**Ce que le mode ne change pas.** La sélection simple d'un token ([[RG_29]]), le double clic ([[RG_31]]), la rotation ([[RG_20]]), le retrait et le dépôt depuis le bandeau ([[RG_15]], [[RG_32]]) restent disponibles et inchangés en mode « Règle » ; seule la sélection multiple par rectangle ([[RG_30]]) cède sa place à la mesure, le geste qui la déclenche étant le même. Le déplacement d'un token posé est en revanche libéré du contrôle de cohésion ([[RG_35]]). Un appui simple sur le fond du plateau désélectionne toujours tout. Une mesure n'écrit **rien** : ni placement ([[RT_04]]), ni sauvegarde ([[RG_07]]).

**Second canal ([[RG_24]]).** L'état actif du mode ne repose pas sur la seule couleur du bouton : il change de rendu (plein / contour) et son nom accessible énonce l'état (« Règle activée » / « Règle désactivée »). La mesure elle-même est un texte, jamais seulement une couleur ou une longueur de trait.

### RG_34 — Mesure du déplacement d'un token en mode « Règle »

En mode « Règle » ([[RG_33]]), faire glisser un token déjà posé ([[RG_04]]) trace en plus un segment entre le **centre du token à sa position d'avant le geste** et le **centre du token à sa position courante**, avec la longueur en pouces affichée à côté selon les mêmes règles de mesure que [[RG_33]]. Le segment suit le token pendant tout le geste ; au relâchement, son second point est fixé au centre du token à sa position finale et il reste affiché jusqu'au premier appui suivant ([[RG_33]], disparition).

- **Centre du token, pas point de contact.** Le geste conservant l'écart entre le doigt et le centre du socle ([[RT_34]]), c'est le déplacement du **centre** qui est mesuré : la mesure est celle du déplacement du modèle, indépendante de l'endroit où le joueur l'a saisi.
- **Déplacement groupé ([[RG_30]], [[RG_31]]).** Tous les tokens de la sélection se déplaçant du même vecteur, un seul segment est tracé, depuis le centre du token **saisi** ; sa longueur vaut celle du déplacement de chacun.
- **Déplacement refusé.** En mode « Règle », un déplacement n'est plus refusé pour perte de cohésion ([[RG_35]]) : seule la sortie du rectangle de jeu ([[RT_19]], [[RG_30]]) le refuse encore. Un déplacement refusé ramène le ou les tokens à leur position d'avant le geste, mais le segment reste affiché jusqu'au relâchement compris, dans l'état de dépôt refusé de [[RT_34]], avec la distance tentée : le joueur lit ainsi la distance qu'il cherchait à parcourir. Il disparaît comme tout tracé au premier appui suivant.
- **Hors périmètre.** Un dépôt depuis le bandeau ([[RG_15]], [[RG_32]]) n'a pas de position d'origine sur le plateau et ne trace donc aucun segment. La rotation ([[RG_20]]) ne déplace pas le centre et n'en trace pas non plus.

### RG_35 — Cohésion en mode « Règle » : déplacement libre, rétablissement à la sortie du mode

En mode « Règle », le joueur mesure en déplaçant des tokens ([[RG_34]]) — pour vérifier jusqu'où un modèle peut aller, par exemple — et ces essais n'ont pas à respecter la cohésion de son unité.

**Déplacement libre.** En mode « Règle », le déplacement d'un token posé ([[RG_04]]), seul ou en groupe ([[RG_30]], [[RG_31]]), **n'est pas refusé** lorsqu'il ferait perdre sa cohésion à son unité ([[RG_26]]) : le token est posé là où le joueur le lâche, et aucun état de dépôt refusé n'est annoncé pour ce motif. Le déplacement reste refusé, tout ou rien, s'il sortirait du rectangle de jeu ([[RT_19]]). Le contrôle de cohésion est conservé pour tout ce qui n'est pas un déplacement : le dépôt depuis le bandeau ([[RG_15]], [[RG_32]]) et la rotation ([[RG_20]]) suivent [[RG_26]] comme hors du mode — y compris son exemption des unités déjà hors cohésion, qui s'applique alors à une unité qu'un déplacement libre vient de sortir de sa cohésion.

**Rétablissement à la sortie du mode.** Lorsque le joueur désactive le mode « Règle », chaque unité qui était **en cohésion à l'activation du mode** et ne l'est plus est ramenée en cohésion **de la même manière qu'au retrait d'un token** ([[RG_26]]) : l'application conserve le groupe contigu à 2" qui garde le plus de tokens de l'unité sur le plateau — à égalité, celui qui contient le modèle posé le plus tôt — et retire les autres, qui retournent dans le bandeau de [[RG_15]], l'unité redevenant en attente au sens de [[RG_05]]. Les tokens conservés restent à la position où le joueur les a laissés : rien n'est ramené à sa position d'avant le mode.

- **Confirmation.** Parce qu'elle retire des tokens, l'opération est **confirmée explicitement** par le joueur avant d'être appliquée, sur le même principe que [[RG_08]], en indiquant combien de tokens seront retirés et de quelles unités. Si le joueur annule, rien n'est retiré et le mode « Règle » reste actif. Si aucune unité n'est concernée, le mode se désactive sans confirmation.
- **Étendue de 9".** Le retrait d'un token ne rétablit que la contiguïté ([[RG_26]]) ; un déplacement libre peut en revanche étirer une unité au-delà de 9" sans couper sa chaîne. Le groupe conservé n'est pas réduit pour autant : s'il dépasse l'étendue de 9", il est laissé tel quel, et l'unité est traitée comme une unité déjà hors cohésion ([[RG_26]], déploiements enregistrés avant cette règle) — ses gestes restent permis jusqu'à ce que le joueur la corrige. La confirmation le signale en nommant l'unité ; si aucun token n'est à retirer, aucune confirmation n'est présentée et un message non bloquant nomme l'unité.
- **Unités déjà hors cohésion à l'activation.** Une unité qui n'était pas en cohésion à l'activation du mode (déploiement antérieur à [[RG_26]]) n'est jamais retaillée à sa sortie : l'application ne retire aucun token de son propre chef d'une unité que le mode n'a pas sortie de sa cohésion ([[RG_26]]).
- **Sortie de l'écran.** Quitter l'écran de placement avec le mode « Règle » actif équivaut à désactiver le mode : la même confirmation est présentée, et une annulation laisse le joueur sur l'écran, mode actif.

**Second canal ([[RG_24]]).** Tant que le mode est actif, une unité qu'un déplacement libre a sortie de sa cohésion est signalée en toutes lettres (« hors cohésion ») dans le bandeau de [[RG_15]] lorsqu'il est positionné sur elle et dans son entrée du menu de [[RG_16]], pour que le joueur sache, avant de quitter le mode, quelles unités seront retaillées.

### RT_42 — Interaction et calcul de la règle

**État.** Le mode « Règle » est un booléen local à l'éditeur de placement ([[RT_03]]), initialisé à faux à l'ouverture de l'écran, ni persisté ([[RT_06]]) ni synchronisé ([[RT_09]]). Le tracé courant est un état local `{ depuis: {x, y}, jusqu'à: {x, y}, refusé: booléen } | null`, exprimé, comme les placements, dans le **repère en pixels de l'image d'asset** ([[RT_04]]/[[RT_05]]) et non en pixels d'écran.

**Geste.** Les deux mesures reposent sur les Pointer events déjà employés par [[RT_34]] et [[RT_40]], sans librairie tierce. Au `pointerdown` sur le fond du plateau en mode « Règle », le point d'appui est converti dans le repère d'asset par la même transformation inverse que celle du rectangle de sélection de [[RT_40]], et devient `depuis` ; chaque `pointermove` met à jour `jusqu'à` ; le `pointerup` le fige. Le point courant est **borné au rectangle de jeu** ([[RT_19]]), pour que la mesure ne porte jamais sur une partie rognée de l'image. Pour [[RG_34]], `depuis` est le centre `x`/`y` du token saisi relevé au `pointerdown`, `jusqu'à` son centre provisoire recalculé à chaque mouvement par [[RT_34]]/[[RT_40]], et `refusé` reprend le résultat de validité déjà calculé par ces règles — aucun calcul de validité supplémentaire.

**Disparition.** Un écouteur de `pointerdown` posé en phase de **capture** sur la racine de l'écran de placement remet le tracé à `null` avant que l'évènement n'atteigne sa cible ; il n'appelle ni `preventDefault` ni `stopPropagation`, pour que l'appui conserve son effet ordinaire ([[RG_33]]). Il laisse le tracé en place lorsque l'appui porte sur un contrôle de vue ([[RT_49]]) ou commence un déplacement de vue ([[RT_48]] : mode « Déplacement » actif ou bouton du milieu), conformément à l'exception de [[RG_33]]. Le geste qui démarre une nouvelle mesure crée son tracé dans son propre gestionnaire, appelé après cette remise à zéro. La désactivation du mode remet aussi le tracé à `null`.

**Calcul.** La longueur est la distance euclidienne entre `depuis` et `jusqu'à` en pixels d'asset, convertie en millimètres par l'échelle de [[RT_05]] puis en pouces (÷ 25,4), arrondie au dixième. C'est une fonction pure de `src/app/deployment/geometry.ts`, indépendante de l'affichage et couverte par des tests unitaires ; elle n'est recalculée qu'aux mouvements du point de contact et ne déclenche ni le calcul de zone visible de [[RT_38]] ni aucune écriture ([[RT_04]], [[RG_07]]).

### RT_44 — Contrôle de cohésion suspendu et rétablissement à la sortie du mode « Règle »

**Instantané à l'activation.** À l'activation du mode « Règle » ([[RT_42]]), l'éditeur calcule par [[RT_36]] l'ensemble des `idUnite` ([[RT_04]]) posés **en cohésion** et le conserve dans son état local, ni persisté ([[RT_06]]) ni synchronisé ([[RT_09]]). Seules ces unités sont candidates au rétablissement de [[RG_35]].

**Pendant le mode.** Le contrôle de validité des déplacements de [[RT_34]]/[[RT_40]] ne retient plus que l'appartenance au rectangle de jeu ([[RT_19]]) ; l'étape de cohésion de [[RT_36]] n'y est pas évaluée. Les dépôts depuis le bandeau ([[RT_34]], [[RT_41]]) et la rotation ([[RT_22]]) gardent leur contrôle complet. Chaque déplacement validé est écrit au relâchement comme hors du mode ([[RT_04]], une écriture, [[RG_07]]). La mention « hors cohésion » de [[RG_35]] est dérivée, après chaque écriture, du calcul de cohésion de [[RT_36]] sur les unités de l'instantané.

**Désactivation.** Pour chaque unité de l'instantané qui n'est plus en cohésion, les composantes connexes du graphe de contiguïté à 2" sont calculées par l'algorithme du retrait de [[RT_36]] (plus grande composante conservée, égalité départagée par le placement le plus ancien dans l'ordre des enregistrements), puis l'étendue de 9" est évaluée sur la composante conservée, pour le seul signalement de la confirmation. Si au moins un placement est à supprimer, la confirmation de [[RG_35]] est présentée ; à sa validation, les placements de toutes les unités concernées sont supprimés **en une seule écriture** ([[RT_04]], une seule sauvegarde [[RG_07]]), puis le mode passe à faux, l'instantané et le tracé ([[RT_42]]) sont vidés. Une annulation ne modifie rien.

**Sortie de l'écran.** Le retour arrière de l'écran de placement passe par une garde de navigation qui, mode actif, déclenche la même désactivation et n'autorise la navigation qu'après sa validation. Une fermeture de l'application (arrêt du processus, onglet fermé) échappe à cette garde : les déplacements libres étant déjà écrits, le déploiement est rechargé tel quel au prochain chargement, ses unités hors cohésion relevant alors de l'exemption de [[RG_26]] (voir « Suivi des écarts »).

### RT_43 — Rendu du bouton et du tracé de la règle

**Bouton.** Le bouton est positionné en absolu dans l'angle supérieur gauche de la zone du plateau, au-dessus du SVG et sous le panneau d'unités de [[RT_24]], sur le même principe que la barre d'actions de [[RT_33]] — premier d'une rangée de contrôles que complètent les boutons de vue de [[RT_49]] ; il ne recouvre pas l'angle inférieur droit où se trouve cette barre. Il offre la cible tactile de [[RT_31]] (44 × 44 px CSS au moins), porte `aria-pressed` reflétant l'état du mode, et son délimiteur porte le contraste exigé face à la scène sombre du plateau. L'icône est une règle, rendue par le composant d'icône déjà employé par l'application (voir « Suivi des écarts » : elle n'est pas dans son jeu d'icônes).

**Tracé.** Le segment est rendu dans le SVG de l'éditeur ([[RT_03]]), **au-dessus** des tokens et de la zone visible ([[RT_39]]), pour rester lisible quand il traverse un socle. Son épaisseur est fixée en pixels d'écran (`vector-effect: non-scaling-stroke`) et non en pixels d'asset, pour rester lisible au zoom fixe de [[RT_19]] ; ses deux extrémités sont marquées. Sa couleur est un token de [[RT_29]] défini dans les deux thèmes, distinct des couleurs d'unité de [[RG_06]], du voile de [[RT_39]] et du rectangle de sélection de [[RT_40]] ; l'état refusé de [[RG_34]] reprend la couleur de dépôt refusé de [[RT_34]].

**Étiquette.** La mesure est un texte posé à côté du second point du segment, sur une pastille de fond opaque qui assure son contraste quel que soit le plateau en dessous ([[RT_29]], [[RT_32]]) et à une taille de [[RT_30]] exprimée elle aussi en pixels d'écran. Elle est décalée hors de la surface du doigt, du côté opposé au premier point, et ramenée à l'intérieur de la zone du plateau lorsqu'elle en sortirait, pour la même raison de lisibilité sous le doigt que le cercle de visée de [[RT_34]]. Pendant le geste, la mesure est également exposée aux technologies d'assistance dans une région `aria-live` polie, mise à jour au relâchement seulement pour ne pas saturer la lecture.

---

## EX_10 — Agrandissement et déplacement de la vue du plateau

Sur l'écran de placement, le joueur doit pouvoir **agrandir le plateau** pour poser ou ajuster des tokens avec précision — sur un écran de téléphone, un socle de 32 mm ne mesure qu'une dizaine de pixels au zoom de base ([[RT_34]]) — à **deux niveaux d'agrandissement (×2 et ×4)** parcourus en cycle par un seul bouton, et, une fois agrandi, **déplacer la vue** pour atteindre n'importe quelle partie du plateau, le déplacement de la vue étant **activé d'office** à l'entrée dans un niveau agrandi et désactivé au retour au zoom de base, sans perdre la simplicité d'un écran dont le cadrage reste prévisible ([[RG_17]]).

Satisfait par : [[RG_38]], [[RG_39]], [[RT_47]], [[RT_48]], [[RT_49]].

### RG_38 — Agrandissement ×2 / ×4 du plateau

**Accès.** L'écran de placement ([[RG_03]] étape 3) porte, **en haut à gauche de la zone du plateau**, dans la même rangée que le bouton de [[RG_33]], un bouton d'agrandissement. Il est superposé au plateau ([[RT_33]]) : son affichage ne consomme aucune hauteur. C'est un **cycle à trois états** et non un réglage : chaque appui passe au niveau suivant dans l'ordre **zoom de base de [[RG_17]] → ×2 → ×4 → zoom de base → ×2 → …** Le passage de ×4 au zoom de base est direct, sans repasser par ×2. Aucun autre niveau n'est proposé, et aucun geste (pincement, molette, double appui sur le plateau) ne modifie l'agrandissement.

**Cadrage.** Chaque passage à un niveau supérieur (base → ×2, ×2 → ×4) garde **sous le centre de la zone du plateau le point du plateau qui s'y trouvait** : la vue agrandie montre le milieu de ce que le joueur regardait, y compris après un déplacement de vue à ×2 ([[RG_39]]). Le retour au zoom de base (depuis ×4) rétablit le cadrage de [[RG_17]] (plateau entier visible) et annule tout déplacement de vue ([[RG_39]]).

**Mode « Déplacement » associé ([[RG_39]]).** Entrer dans un niveau agrandi — ×2 depuis le zoom de base, comme ×4 depuis ×2 — **active le mode « Déplacement »**, même si le joueur l'avait désactivé au niveau précédent ; revenir au zoom de base le **désactive**. Le joueur reste libre de basculer le mode à la main ensuite, au niveau où il se trouve ([[RG_39]], accès).

**Ce que l'agrandissement ne change pas.** Il ne modifie que l'affichage : aucun placement ([[RT_04]]) n'est déplacé ni écrit, rien n'est sauvegardé ([[RG_07]]). Les tokens, le rectangle de sélection ([[RG_30]]), la zone visible ([[RG_29]]), le tracé de la règle ([[RG_33]]) et les retours visuels de glisser ([[RT_34]]) sont agrandis avec le plateau ; les tokens provisoires glissés depuis le bandeau ([[RG_15]]) sont rendus à la taille qu'ils auront une fois posés **à l'agrandissement courant**. Le bandeau de [[RG_15]] garde sa propre échelle ([[RT_33]]). Tous les gestes de l'écran restent disponibles à ×2 et ×4 — ceux du plateau une fois le mode « Déplacement » désactivé par le joueur ([[RG_39]]) —, y compris le dépôt depuis le bandeau sur la partie visible du plateau, qui ne dépend pas de ce mode. L'agrandissement est local à l'écran : il n'est ni enregistré ni synchronisé, et l'écran de placement s'ouvre toujours au zoom de base. Changer l'orientation de l'écran ou la taille de la fenêtre conserve l'agrandissement en cours.

**Second canal ([[RG_24]]).** L'état n'est pas porté par la seule couleur du bouton : son icône annonce l'appui suivant (loupe « + » au zoom de base et à ×2, loupe « − » à ×4), il change de rendu (contour au zoom de base, plein à ×2 et ×4), il affiche le **niveau courant** en texte (« ×2 » / « ×4 », rien au zoom de base) pour distinguer les deux niveaux agrandis, et son nom accessible énonce l'action proposée (« Agrandir le plateau ×2 » au zoom de base / « Agrandir le plateau ×4 » à ×2 / « Revenir à la taille d'origine » à ×4).

### RG_39 — Mode « Déplacement » de la vue du plateau

**Accès.** Un bouton à icône de main, placé **en haut de la zone du plateau** dans la même rangée que les boutons de [[RG_33]] et [[RG_38]], active le **mode « Déplacement »** ; un nouvel appui le désactive. Le mode n'a de sens que lorsque le plateau dépasse de la zone affichée : le bouton est donc **désactivé au zoom de base** et n'est actif qu'à ×2 et ×4 ([[RG_38]]). Le mode **s'active de lui-même à chaque entrée dans un niveau agrandi** (×2 depuis le zoom de base, ×4 depuis ×2) — l'état est alors exactement celui qu'aurait produit un appui sur le bouton à main — et revenir au zoom de base le désactive ([[RG_38]], mode associé). Entre deux changements de niveau, le bouton à main garde son rôle de bascule : le joueur le désactive pour retrouver les gestes ordinaires du plateau au niveau agrandi courant, et peut le réactiver. Comme le mode « Règle », il n'est ni enregistré ni synchronisé, et l'écran s'ouvre mode désactivé.

**Geste.** En mode « Déplacement », le curseur prend sur le plateau la forme d'une **main ouverte**, et d'une **main fermée** pendant le geste. Tout glisser qui démarre sur le plateau — sur le fond **comme sur un token** — **déplace la vue** : le plateau suit le doigt ou le curseur. Le déplacement est borné : la vue ne peut pas sortir du plateau, le rectangle de jeu ([[RT_19]]) couvrant toujours toute la zone affichée. Un geste de déplacement de la vue n'écrit rien ([[RT_04]], [[RG_07]]).

**Ce que le mode suspend.** Tant qu'il est actif, un appui ou un glisser sur le plateau ne sélectionne ni ne désélectionne aucun token ([[RG_29]], [[RG_31]]), ne déplace ni ne fait pivoter aucun token ([[RG_04]], [[RG_20]]), ne trace ni rectangle de sélection ([[RG_30]]) ni mesure ([[RG_33]], [[RG_34]]) : seul le déplacement de la vue y répond. Les contrôles hors du plateau gardent leur effet : boutons de la barre d'actions du token sélectionné ([[RG_20]]), bandeau ([[RG_15]]), et dépôt d'un modèle glissé depuis le bandeau sur le plateau ([[RG_15]], [[RG_32]]), ce dernier geste démarrant hors du plateau. Le mode « Règle » ([[RG_33]]) peut rester actif en même temps : il reprend son effet sur les gestes du plateau dès que le mode « Déplacement » est désactivé, et sa suspension du contrôle de cohésion ([[RG_35]]) n'est pas affectée.

**Bouton du milieu de la souris.** Sur poste de travail, **maintenir enfoncé le bouton du milieu** (clic molette) sur le plateau fait entrer dans le même déplacement de vue **pour la seule durée de l'appui**, quel que soit l'état du bouton du mode et quel que soit le mode en cours (« Règle » compris) : le curseur passe en main fermée, le plateau suit la souris, et relâcher le bouton rend aux gestes leur comportement d'avant l'appui. Ce maintien ne change pas l'état affiché du bouton du mode « Déplacement ». Au zoom de base, il ne déplace rien (le plateau tient entier dans la zone) mais ne déclenche pas pour autant le défilement automatique du navigateur.

**Second canal ([[RG_24]]).** Comme pour [[RG_33]], l'état actif du mode change le rendu du bouton (plein / contour) et son nom accessible (« Déplacement de la vue activé » / « Déplacement de la vue désactivé ») ; le bouton désactivé au zoom de base est rendu comme tel et non masqué, pour que la rangée de contrôles garde sa disposition ([[RT_33]]).

### RT_47 — Échelle d'affichage agrandie et décalage de vue

**État.** L'éditeur de placement ([[RT_03]]) porte un niveau d'agrandissement `zoom ∈ {1, 2, 4}` et un décalage de vue `{ dx, dy }` en **pixels CSS**, tous deux locaux à l'écran, initialisés à `1` et `{0, 0}`, ni persistés ([[RT_06]]) ni synchronisés ([[RT_09]]). L'échelle d'affichage — celle qu'emploient le rendu des tokens, le retour visuel de glisser ([[RT_34]], [[RT_41]]), la règle ([[RT_43]]) et les conversions entre pixels d'écran et pixels d'asset — vaut `facteur de base ([[RT_19]]) × zoom`. Les placements restent exprimés dans le repère de l'asset ([[RT_04]]) : aucun calcul géométrique (cohésion [[RT_36]], sélection [[RT_40]], zone visible [[RT_38]], mesure [[RT_42]]) ne dépend de l'agrandissement.

**Rendu.** La surface du plateau (image rognée et SVG, [[RT_19]]) est dimensionnée à l'échelle d'affichage, centrée dans la zone du plateau, et décalée de `{ dx, dy }` par une transformation CSS `translate` ; la zone du plateau masque ce qui en dépasse. La conversion d'un point d'écran en point d'asset lit la position **rendue** de la surface (rectangle englobant, transformation comprise), si bien que les gestes existants ([[RT_34]], [[RT_40]], [[RT_42]]) restent justes à tout agrandissement et à tout décalage sans modification de leur calcul. Un point d'écran hors de la zone du plateau peut toutefois correspondre à une partie masquée de la surface agrandie : un dépôt depuis le bandeau ([[RT_34]], [[RT_41]]) n'est donc accepté que si le point de contact est **dans la zone du plateau**, et passe sinon dans l'état de dépôt refusé de [[RT_34]] ([[RG_38]], partie visible).

**Bornes.** Sur chaque axe, `|d| ≤ max(0, (taille de la surface − taille de la zone) / 2)` : la surface couvre toujours la zone dans l'axe où elle la dépasse, et reste centrée dans l'axe où elle tient. Le décalage est reborné à chaque changement d'espace disponible ([[RT_19]]) et remis à `{0, 0}` au retour à `zoom = 1`. **Cycle des niveaux.** Le bouton de [[RG_38]] fait passer `zoom` de `1` à `2`, de `2` à `4` et de `4` à `1` ; le niveau suivant est une fonction pure de `src/app/deployment/geometry.ts` (`nextZoomLevel`), couverte par des tests unitaires. La surface étant centrée, le point sous le centre de la zone au zoom de base est le centre du plateau ; le passage à `zoom = 2` part donc du décalage nul, qui garde ce point sous le centre de la zone ([[RG_38]], cadrage). Le passage de `2` à `4` multiplie le décalage par le rapport des niveaux, `{ dx, dy } ← { 2·dx, 2·dy }`, ce qui garde sous le centre de la zone le point qui s'y trouvait ; le résultat est reborné par la formule ci-dessus (il y tient toujours, la borne à `zoom = 4` dépassant le double de la borne à `zoom = 2`). Le passage de `4` à `1` remet le décalage à `{0, 0}`. Ces calculs de bornes et de décalage sont des fonctions pures de `src/app/deployment/geometry.ts`, couvertes par des tests unitaires.

### RT_48 — Interaction du mode « Déplacement »

**État.** Le mode est un booléen local à l'éditeur ([[RT_03]]), initialisé à faux, ni persisté ni synchronisé. Il est **lié aux transitions de `zoom`** ([[RT_47]]), dans le même traitement que le changement de niveau : mis à vrai à chaque transition vers un niveau agrandi (`1 → 2`, `2 → 4`), quelle que soit sa valeur précédente, et remis à faux lorsque `zoom` repasse à `1` (`4 → 1`). Hors de ces transitions, seul le bouton à main ([[RT_49]]) le modifie. Un geste de déplacement de vue en cours au moment d'un changement de niveau n'est pas possible au doigt (l'appui sur le bouton démarre hors du plateau) ; pour le bouton du milieu maintenu, le geste en cours est clos au changement de niveau, son décalage de départ n'étant plus valable. Le geste de déplacement en cours est un état local `{ pointerId, départ écran, décalage de départ }`.

**Démarrage.** Un `pointerdown` reçu sur la zone du plateau démarre un déplacement de vue **avant** tout autre traitement de geste du plateau (tokens, poignée de rotation, fond — [[RT_34]], [[RT_22]], [[RT_40]], [[RT_42]]) lorsque le mode est actif, quel que soit le bouton ou le contact, ou, quel que soit le mode, lorsque le bouton enfoncé est le **bouton du milieu** (`button === 1`). Il est écouté en phase de **capture** sur la zone du plateau et appelle alors `stopPropagation`, pour qu'aucun gestionnaire de token ou de fond ne le reçoive, et `preventDefault`, pour neutraliser le défilement automatique que les navigateurs de poste de travail associent au clic molette (le `mousedown` du bouton du milieu sur la même zone est annulé de la même façon). Les contrôles superposés à la zone ([[RT_49]], barre d'actions de [[RT_33]]) en sont exclus. Au zoom de base, le geste est reconnu et neutralisé de la même manière mais son décalage borné ([[RT_47]]) reste nul.

**Suivi.** Les Pointer events déjà employés par [[RT_34]] et [[RT_40]] suffisent, sans librairie tierce : chaque `pointermove` du même `pointerId` fixe le décalage à `décalage de départ + (point courant − départ écran)`, borné par [[RT_47]] ; le pointeur est capturé au démarrage pour que le geste survive à une sortie de la zone. Le `pointerup` ou `pointercancel` du même `pointerId` clôt le geste ; pour le bouton du milieu, c'est la fin du maintien ([[RG_39]]). Aucune écriture, aucun calcul de zone visible ([[RT_38]]) n'est déclenché.

**Curseur.** La zone du plateau porte le curseur `grab` tant que le mode est actif, et `grabbing` pendant un geste de déplacement (mode actif ou bouton du milieu) ; ce curseur prend le pas sur ceux des tokens et des poignées.

### RT_49 — Rendu des contrôles de vue

Les boutons d'agrandissement ([[RG_38]]) et de mode « Déplacement » ([[RG_39]]) prennent place, à la suite du bouton de la règle ([[RT_43]]), dans une **rangée horizontale** positionnée en absolu dans l'angle supérieur gauche de la zone du plateau, au-dessus de la surface décalée de [[RT_47]] et sous le panneau d'unités de [[RT_24]] : ils ne bougent pas avec la vue. Chacun offre la cible tactile de [[RT_31]], porte le délimiteur contrasté de [[RT_43]] face à la scène sombre, et est un bouton natif pour la même raison que celui-ci (voir « Suivi des écarts »). Le bouton d'agrandissement porte `aria-pressed` reflétant `zoom > 1`, et, à `zoom ∈ {2, 4}`, un libellé texte « ×2 » / « ×4 » accolé à l'icône, à la taille de [[RT_30]], masqué aux technologies d'assistance (`aria-hidden`) puisque le nom accessible porte déjà l'information ([[RG_38]], second canal) ; la cible tactile de [[RT_31]] l'englobe. Le bouton de déplacement porte `aria-pressed` reflétant le mode — y compris quand il a été activé d'office par un changement de niveau ([[RT_48]]) — et l'attribut `disabled` au zoom de base. La main est celle du jeu d'icônes de l'application ; les loupes « + » et « − », absentes de ce jeu comme la règle de [[RT_43]], sont des SVG propres au projet (voir « Suivi des écarts »). Ces boutons portent un marqueur commun que l'écouteur de remise à zéro du tracé de [[RT_42]] reconnaît pour laisser la mesure en place.

---

## EX_11 — Scission d'une unité à l'import

Le joueur doit pouvoir déployer une unité nombreuse en deux unités distinctes, réparties à sa convenance entre leurs modèles, sans avoir à modifier sa liste dans son list-builder.

Satisfait par : [[RG_40]], [[RT_50]], [[RT_51]], [[RT_52]]. La scission s'inscrit dans le récapitulatif d'import de [[EX_01]] ([[RG_22]]).

### RG_40 — Scission d'une unité en deux au récapitulatif d'import

**Principe.** Au récapitulatif d'import ([[RG_22]]), le joueur peut scinder en **deux unités** toute unité qui compte **au moins 10 modèles**, donc au moins 10 tokens ([[RG_04]]). Le seuil porte sur les modèles de l'unité elle-même : les personnages qui lui sont attachés ([[RG_36]]) n'entrent pas dans le compte. Une unité de moins de 10 modèles ne propose pas la scission. Un personnage attaché à une autre unité ne la propose pas non plus. Une unité ne se scinde qu'une fois, et toujours en deux exactement : une moitié issue d'une scission ne peut pas être scindée à nouveau.

**Minimum de 5 modèles par moitié.** Chacune des deux moitiés doit compter **au moins 5 modèles** pour que la liste puisse être enregistrée. Une unité de 10 modèles s'enregistre donc toujours en 5 + 5, une unité de 13 modèles en 5 + 8, 6 + 7, 7 + 6 ou 8 + 5. Ce minimum ne bloque pas la répartition en cours : il bloque l'enregistrement (voir « Moitié sous le minimum » ci-dessous).

**Répartition proposée par défaut.** Quand le joueur demande la scission, l'application propose aussitôt une répartition, qu'il peut valider telle quelle :

- les modèles sont répartis en deux moitiés aussi égales que possible (10 → 5 + 5, 11 → 6 + 5) ; la première moitié reçoit le modèle en plus quand le compte est impair ;
- chaque groupe de modèles de [[RG_02]] (profil + socle) est réparti aussi également que possible entre les deux moitiés, pour que chacune conserve la composition de l'unité d'origine. Quand un groupe ne se partage pas également, son modèle en plus va à la moitié la moins nombreuse à ce stade ; un groupe d'un seul modèle (un sergent, un porteur d'arme spéciale) suit la même règle.

La répartition par défaut respecte toujours le minimum de 5 par moitié.

**Répartition libre par glisser-déposer.** La répartition par défaut n'est qu'une proposition. Le joueur ajuste la répartition par **glisser-déposer**, modèle par modèle :

- **déposer un modèle dans l'autre moitié** l'y fait passer. Le dépôt est **toujours accepté**, même s'il fait tomber la moitié de départ sous 5 modèles, voire à 0 ;
- **déposer un modèle sur un modèle de l'autre moitié** échange les deux. Les effectifs ne changent pas, seule la composition change. C'est le moyen le plus direct de changer la composition d'une unité de 10 modèles sans quitter le 5 + 5.

**Moitié sous le minimum.** Tant qu'une moitié compte moins de 5 modèles, l'unité est signalée **en erreur** sur le récapitulatif : le message nomme la moitié concernée et le nombre de modèles qui lui manquent (« Moitié (2) : 3 modèles, il en faut au moins 5 »). L'erreur reste visible tant qu'elle n'est pas résolue, et **la liste ne peut pas être enregistrée** tant qu'une unité scindée est en erreur, sur le même principe qu'un socle non assigné ([[RG_02]], [[RG_22]]). Le joueur la résout en rééquilibrant les moitiés ou en annulant la scission. L'erreur disparaît dès que les deux moitiés comptent au moins 5 modèles.

Chaque déplacement peut aussi se faire sans glisser, par une action explicite sur le modèle, pour le joueur qui ne peut pas ou ne veut pas faire le geste ([[EX_07]]). Le joueur peut **annuler la scission** tant que la liste n'est pas enregistrée : l'unité retrouve sa forme d'origine, attachements compris.

**Résultat.** À l'enregistrement de la liste, les deux moitiés deviennent **deux unités indépendantes** de la liste d'armée. Chacune a son propre nom, formé du nom d'origine suivi de « (1) » ou « (2) », sa propre couleur ([[RG_06]]), ses propres groupes de modèles et son propre statut de déploiement ([[RG_05]], [[RG_14]]). Elles se déploient séparément, et chacune est soumise à sa propre cohésion ([[RG_26]]).

**Unité attachée.** Quand l'unité scindée est l'unité escortée d'un attachement ([[RG_36]]), le ou les personnages attachés restent attachés à **une seule** des deux moitiés, la première par défaut. Le joueur peut désigner l'autre moitié sur le récapitulatif. L'autre moitié est une unité indépendante. Les actions « défaire » et « constituer » de [[RG_36]] s'appliquent ensuite à chaque moitié comme à n'importe quelle unité.

**Portée.** Comme les choix de socle de [[RG_02]] et les attachements de [[RG_36]], une scission ne vaut que pour cet import. Elle n'est mémorisée nulle part ailleurs et ne se réapplique pas à un import ultérieur de la même liste. Une fois la liste enregistrée, la scission n'est plus modifiable : pour la changer, le joueur ré-importe sa liste.

### RT_50 — État de scission au récapitulatif et calcul de la répartition

**Calcul pur.** La logique de scission est isolée dans un module sans dépendance à l'interface (`src/app/import/unit-split.ts`), sur le modèle de `selection.ts` ou `cluster.ts` ([[RT_40]], [[RT_41]]), et couverte par des tests unitaires. Il expose :

- `canSplit(unit)` : vrai si l'unité compte au moins 10 modèles (`modelCount`, qui exclut les personnages attachés), ne porte pas elle-même d'`attachment` ([[RT_45]]) et n'est pas déjà une moitié ;
- `defaultSplit(unit)` : la répartition par défaut de [[RG_40]] ;
- `moveModel(split, groupId, from)` et `swapModels(split, groupIdA, groupIdB, from)` : la nouvelle répartition après un dépôt. Ces opérations ne refusent jamais un dépôt pour cause d'effectif : seul un dépôt incohérent (groupe absent de la moitié de départ) laisse la répartition inchangée ;
- `splitErrors(split)` : la liste des moitiés sous le minimum de 5, avec leur effectif. Elle est vide quand la scission est valide.

**Représentation.** Une scission en cours est un état du récapitulatif, jamais persisté ([[RG_40]], portée) :

```ts
interface UnitSplitDraft {
  readonly unitId: string;
  /** Effectif de chaque groupe de modèles (UnitModelGroup.id) dans chaque moitié. */
  readonly halves: readonly [Readonly<Record<string, number>>, Readonly<Record<string, number>>];
  /** Moitié qui reçoit les personnages attachés (RG_36). */
  readonly bodyguardHalf: 0 | 1;
}
```

Un modèle n'a pas d'identité propre dans la liste ([[RT_13]] ne produit que des comptes par profil) : déplacer « un modèle », c'est retirer 1 au compte de son groupe dans une moitié et ajouter 1 dans l'autre. L'invariant garanti après chaque opération est : pour chaque groupe, la somme des deux moitiés égale son `count` d'origine. Le minimum de 5 par moitié n'est pas un invariant : c'est une condition de validité, contrôlée par `splitErrors`.

**Blocage de l'enregistrement.** La condition de validation du récapitulatif ([[RG_22]]), qui exige déjà que tous les socles soient assignés ([[RG_02]]), exige aussi que `splitErrors` soit vide pour chaque scission en cours. Le bouton de validation reste désactivé tant que ce n'est pas le cas, et le récapitulatif indique pourquoi.

**Répartition par défaut.** Les groupes sont parcourus dans l'ordre de `modelGroups`. Pour chacun, la part arrondie au supérieur (`ceil(count / 2)`) va à la moitié la moins nombreuse à ce stade (la première en cas d'égalité), le reste à l'autre. L'écart entre les deux moitiés ne dépasse donc jamais 1, et comme l'unité compte au moins 10 modèles, chaque moitié en reçoit au moins 5. Exemple : `[sergent ×1, troupe ×9]` donne 1 + 4 pour la première moitié et 0 + 5 pour la seconde, soit 5 + 5.

### RT_51 — Interaction de répartition des modèles sur le récapitulatif

**Rendu.** Sur le récapitulatif ([[RG_22]]), une unité scindée affiche ses deux moitiés côte à côte, ou l'une sous l'autre en largeur mobile. Chaque moitié est une zone de dépôt qui montre son effectif (« 6 modèles ») et une **pastille par modèle**, à la forme et aux proportions relatives de son socle, dans la couleur de la moitié ([[RT_52]]). Les pastilles d'un même groupe sont adjacentes et portent le nom de leur profil en libellé accessible.

**Geste.** Le glisser-déposer repose sur les évènements `Pointer` avec capture du pointeur, comme les gestes de l'écran de placement ([[RT_34]], [[RT_40]]). L'API HTML de glisser-déposer n'est pas utilisée : elle ne réagit pas au toucher sur mobile. Pendant le geste, la pastille suit le doigt et la zone survolée est mise en évidence. Un dépôt dont la cible est une pastille de l'autre moitié appelle `swapModels`, un dépôt ailleurs dans l'autre moitié appelle `moveModel`. Un dépôt dans la moitié d'origine ou hors des deux moitiés ne fait rien : la pastille revient à sa place.

**Signalement de l'erreur.** Quand `splitErrors` n'est pas vide, la moitié concernée est encadrée et son effectif affiché comme une erreur. Le message de [[RG_40]] s'affiche sous l'unité, dans une zone `role="alert"` pour être annoncé par les technologies d'assistance dès son apparition. L'erreur ne repose pas sur la seule couleur : l'encadré s'accompagne d'une icône et du texte ([[RG_24]]). Ce message reste visible jusqu'à ce que l'erreur soit résolue.

**Alternative sans geste.** Chaque pastille est un bouton natif. Un appui l'ouvre sur deux actions : « Passer dans l'autre moitié » et « Échanger avec… », qui propose les profils présents dans l'autre moitié. Comme le geste, ces actions restent disponibles même quand elles font passer une moitié sous le minimum. Les pastilles respectent la cible tactile de [[RT_31]] : la surface reste de 44 × 44 pixels CSS même quand le dessin du socle est plus petit.

**Commandes de l'unité.** L'action « Scinder » n'est affichée que si `canSplit` est vrai. Une unité scindée affiche à la place « Annuler la scission » et, si elle escorte des personnages, le choix de la moitié qui les reçoit (`bodyguardHalf`).

### RT_52 — Matérialisation des deux unités à l'enregistrement de la liste

**Construction.** À la validation du récapitulatif ([[RG_22]]), chaque `UnitSplitDraft` remplace son unité d'origine par deux `ArmyUnit` ordinaires, placées à sa position dans la liste :

- chacune reçoit un nouvel identifiant stable ([[RT_07]]). L'identifiant d'origine disparaît : aucun déploiement ne peut encore y faire référence, la liste n'étant pas enregistrée ;
- `name` vaut le nom d'origine suivi de « (1) » ou « (2) » ;
- `modelGroups` reprend les groupes d'origine avec l'effectif de la moitié, un groupe à 0 étant omis. Chaque groupe reçoit un nouvel `id` pour rester unique dans la liste. Le socle (`baseShapeId` ou `customRectangleMm`, [[RT_28]]) est celui que le joueur a résolu sur le groupe d'origine ;
- `modelCount` est la somme de ces effectifs.

**Couleurs ([[RG_06]]).** La première moitié garde la couleur de l'unité d'origine. La seconde reçoit une couleur automatique (`autoUnitColor`, `src/app/import/unit-colors.ts`) distincte de celles déjà portées par les unités de la liste. Les deux restent réassignables par le joueur comme toute autre unité.

**Attachements ([[RT_45]]).** Le `bodyguardUnitId` de chaque personnage qui escortait l'unité d'origine est réécrit vers l'identifiant de la moitié désignée par `bodyguardHalf`. Les contraintes structurelles de [[RG_36]] sont ensuite appliquées à la liste construite, comme pour tout import.

**Aucune trace de la scission.** Les deux unités n'ont aucun champ qui les relie l'une à l'autre ni à l'unité d'origine. Elles sont indiscernables d'unités importées séparément pour le placement, le menu unités, la duplication ([[RG_21]]) et la synchronisation. Le contrat de synchronisation ([openapi.yml](openapi.yml), `ArmyUnit`) est donc inchangé.

---

## EX_12 — Installation de l'application depuis le navigateur

Le joueur doit pouvoir installer l'application sur n'importe quel appareil, iPhone et iPad compris, sans passer par un magasin d'applications. Depuis le site, il l'ajoute à son écran d'accueil. Il la lance ensuite comme une application à part entière : en plein écran, sans barre de navigateur, y compris sans réseau. Cette voie complète l'application Android empaquetée et tient lieu d'application iOS tant qu'aucune n'est publiée.

Satisfait par : [[RG_41]], [[RG_42]], [[RG_43]], [[RG_44]], [[RT_53]], [[RT_54]], [[RT_55]], [[RT_56]], [[RT_57]], [[RT_58]], [[RT_59]]. Une fois installée, l'application suit [[EX_05]] comme sous toute autre forme.

### RG_41 — Invitation à installer l'application

**Quand.** L'invitation n'est proposée que si l'application tourne dans un onglet de navigateur, sans être installée. Elle n'apparaît ni dans l'application lancée depuis l'écran d'accueil, ni dans l'application Android empaquetée.

**Où.**

- **Écran d'accueil** : un bandeau au-dessus de la bibliothèque des listes ([[RG_18]]), fermable. Une fois fermé, il ne réapparaît plus sur cet appareil.
- **Réglages** : le bloc « Application » ([[RG_18]]) propose l'installation tant qu'elle n'est pas faite, même après fermeture du bandeau.

L'invitation n'est jamais présentée sur l'écran de placement et ne bloque aucune action.

**Comment, selon le navigateur.**

- **Le navigateur propose sa propre installation** (Chrome et Edge sur Android et sur ordinateur) : un bouton « Installer l'application » ouvre la demande d'installation du navigateur. S'il accepte, l'invitation disparaît. S'il refuse, le bouton disparaît aussi, jusqu'à ce que le navigateur propose de nouveau l'installation : une demande du navigateur ne peut servir qu'une fois, et c'est lui seul qui décide quand en émettre une autre. Le joueur garde l'installation par le menu du navigateur.
- **Le navigateur ne permet qu'un ajout manuel** (tous les navigateurs sur iPhone et iPad) : l'invitation affiche la marche à suivre, « Partager » puis « Sur l'écran d'accueil », illustrée par l'icône Partager du système.
- **Le navigateur ne permet pas l'installation** (Firefox sur ordinateur, par exemple) : aucune invitation. L'application reste utilisable dans l'onglet.

**iPhone et iPad : installer avant d'importer.** Sur ces appareils, l'application installée ne retrouve pas les données saisies dans l'onglet du navigateur : les deux disposent chacune de leur propre stockage. L'invitation le dit explicitement (« Installez l'application avant d'importer vos listes : celles importées dans le navigateur n'y seront pas reprises »). Elle est présentée dès la première ouverture, donc avant le premier import. Sans compte synchronisé ([[EX_06]]), aucun transfert n'est possible de l'un à l'autre.

### RG_42 — Fonctionnement hors-ligne dès la première ouverture

**Application.** Après une première ouverture complète en ligne, l'application s'ouvre et fonctionne sans réseau, installée ou non, selon les règles de [[EX_05]] : écrans, référentiels de socles, de dispositions et de terrain. L'import reste indisponible hors-ligne ([[RG_13]]).

**Plateaux.** Les images de plateaux (45 plateaux en deux variantes, environ 35 Mo) ne sont pas exigées à la première ouverture. Elles sont téléchargées en arrière-plan, sans bloquer ni ralentir l'usage. Un plateau déjà affiché en ligne sur cet appareil reste toujours disponible ([[RG_23]]) : reprendre hors-ligne un déploiement commencé fonctionne donc dès la première visite.

Tant que ce téléchargement n'est pas terminé, un plateau **jamais affiché** sur cet appareil peut être indisponible hors-ligne. Son image est alors remplacée par le message « Plateau non disponible hors-ligne », jamais par une image cassée. Le plateau reste sélectionnable ; seule son image manque. C'est la seule exception à la garantie de [[RG_23]] (« aucun plateau n'est jamais bloqué faute de réseau ») : dans le navigateur, la « version livrée avec l'application » n'est présente sur l'appareil qu'une fois téléchargée.

**État visible.** Le bloc « Application » des Réglages ([[RG_18]]) indique :

- « Prêt pour le hors-ligne » une fois tous les plateaux téléchargés ;
- sinon « Téléchargement des plateaux et missions : n / 126 » (90 images de plateau, puis les 25 rectos et 11 versos des cartes de mission de [[RG_49]]), avec la mention « en pause » hors-ligne.

Le téléchargement reprend seul au retour du réseau ou au lancement suivant. Si l'appareil signale une connexion en mode économie de données, il n'est pas lancé automatiquement : le bloc propose alors « Télécharger les plateaux maintenant ».

### RG_43 — Mise à jour de l'application installée

Une nouvelle version publiée est téléchargée en arrière-plan, référentiels compris : une mise à jour d'errata ([[RT_02]]) suit donc ce même chemin. Une fois la version prête, un message non bloquant annonce « Nouvelle version disponible », avec les actions « Recharger » et « Plus tard ».

Le joueur n'est jamais interrompu :

- le message n'est pas présenté sur l'écran de placement ; il attend que le joueur en sorte ;
- « Plus tard » ferme le message jusqu'au lancement suivant ; que le joueur réponde ainsi ou pas du tout, la nouvelle version s'applique d'elle-même au lancement suivant ;
- recharger ne perd aucune donnée, listes et placements étant déjà enregistrés ([[RT_08]]).

### RG_44 — Conservation des données sur l'appareil

Hors application Android empaquetée, les listes et les déploiements vivent dans le stockage du navigateur. Le navigateur peut l'effacer de lui-même : par manque d'espace, ou, sur iPhone et iPad, pour un site non installé resté quelques jours sans visite. Tant que la synchronisation de compte ([[EX_06]]) n'est pas disponible, ce stockage est la **seule copie** des données du joueur. En conséquence :

- l'application demande au navigateur de conserver durablement ses données ;
- le bloc « Application » des Réglages ([[RG_18]]) indique si les données sont protégées (« Données conservées sur cet appareil ») ou non (« Le navigateur peut effacer les données de l'application ») ;
- quand elles ne le sont pas, ce bloc recommande d'installer l'application ([[RG_41]]) et, dès que la synchronisation existe, de se connecter à un compte ([[RG_10]]).

### RT_53 — Manifeste d'application web et métadonnées d'installation

**Manifeste.** Un fichier `src/manifest.webmanifest` est copié à la racine du build (`assets` de `angular.json`) et référencé par `<link rel="manifest">` dans `index.html`. Il déclare :

- `name` « Windfall Planner », `short_name` « Windfall » (affiché sous l'icône, repris par `apple-mobile-web-app-title`) ;
- `id`, `start_url` et `scope` relatifs (`./`), pour suivre le `base href` de [[RT_59]] ;
- `display: standalone` et `orientation: any`, le placement servant en portrait comme en paysage ;
- `theme_color` et `background_color` : le fond de l'application du thème clair de [[RT_29]], le manifeste n'acceptant qu'une valeur ;
- des icônes PNG 192 et 512 px (`purpose: any`) et une icône 512 px `maskable`, dont le motif tient dans la zone de sécurité.

**Métadonnées de `index.html`.**

- `<title>` au nom de l'application et `lang="fr"`, à la place des valeurs du starter (« Ionic App », `en`) ;
- `<meta name="theme-color">` en double, avec `media="(prefers-color-scheme: …)"`, pour suivre les deux thèmes de [[RT_29]] ;
- pour iOS : `apple-touch-icon` (180 px), `apple-mobile-web-app-title`, et `apple-mobile-web-app-status-bar-style` à `black-translucent`. Le contenu passe alors sous la barre d'état ; les marges de sécurité sont déjà gérées par le cadre d'interface (`viewport-fit=cover` est posé).

**Icônes : une image maîtresse unique.** Toutes les icônes de l'application, web comme natives, sont dérivées d'une seule image fournie par le product owner, `resources/icon.png` : carrée, 1024 px, un motif clair (parachute portant un dé) sur un fond uni. Aucune icône n'est dessinée ni retouchée à la main. Le script `scripts/generate-icons.mjs`, sans dépendance, les régénère toutes. Changer d'icône revient donc à remplacer ce fichier et relancer le script. Le script lit la couleur du fond dans le coin de l'image. Il isole le motif d'après son écart à ce fond, ce qui permet de le réduire sans réduire le fond.

| Cible | Fichiers | Règle |
|---|---|---|
| Web (manifeste, favicon) | `src/assets/icon/favicon.png` (64 px), `icon-192.png`, `icon-512.png` | l'image maîtresse telle quelle, à pleine page |
| Web, `maskable` | `icon-maskable-512.png` | motif réduit dans un rayon de 37 % du côté, en deçà du cercle de sécurité de 40 % ; le fond couvre tout le carré |
| iOS (PWA) | `apple-touch-icon.png` (180 px) | image maîtresse **opaque** : iOS arrondit lui-même les coins et remplit la transparence en noir |
| Android, lanceurs antérieurs à l'API 26 | `mipmap-*/ic_launcher.png` (carré arrondi), `ic_launcher_round.png` (disque), 48 dp | l'image maîtresse découpée, aux cinq densités (mdpi à xxxhdpi) |
| Android, icône adaptative (API 26+) | `mipmap-*/ic_launcher_foreground.png` (calque de 108 dp) + couleur `ic_launcher_background` (`values/ic_launcher_background.xml`) | calque : motif blanc sur transparent, dans un rayon de 30 dp, en deçà du disque de 66 dp que tout masque laisse visible ; fond : la couleur unie de l'image maîtresse |

Le jeu de fichiers que l'outil d'export du product owner produisait pour Android n'est pas repris. Son calque adaptatif portait un carré bleu sur un fond blanc, et le lanceur aurait affiché un carré bleu dans une pastille blanche. Le catalogue `AppIcon.appiconset` destiné à Xcode n'est pas utilisé non plus : l'application n'a pas de projet iOS natif. Sur iPhone et iPad, elle s'installe comme PWA ([[EX_12]]) et son icône est alors l'`apple-touch-icon`. Si un projet `ios/` est ajouté, son icône sera dérivée de la même image maîtresse.

### RT_54 — Service worker et mise en cache de l'application

**Choix : `@angular/service-worker`.** Le service worker d'Angular (`ngsw-worker.js`, configuré par `ngsw-config.json`) est enregistré dans `AppModule`. Il est actif seulement si l'application est un build de production **et** ne tourne pas dans l'application empaquetée (`Capacitor.isNativePlatform()`). Dans l'APK, les fichiers sont déjà locaux, et un service worker y figerait des versions en concurrence avec les mises à jour de l'application native. Stratégie d'enregistrement : `registerWhenStable:30000`, pour ne pas concurrencer le premier affichage.

**Groupes d'assets.**

| Groupe | Contenu | `installMode` | `updateMode` |
|---|---|---|---|
| `app` | `index.html`, `manifest.webmanifest`, bundles JS/CSS, icônes de l'application, `assets/icons/**` | `prefetch` | `prefetch` |
| `referentials` | `assets/referentials/*.json` (environ 1 Mo) | `prefetch` | `prefetch` |
| `boards` | `assets/referentials/boards/**` (90 images) | `lazy` | `lazy` |

Les groupes `prefetch` assurent la partie « application » de [[RG_42]]. Le groupe `boards` n'est rempli qu'à la demande, par l'affichage ou par [[RT_56]].

**Icônes Ionicons.** Le dossier `svg/` copié depuis `ionicons` (environ 1 350 fichiers, 2,6 Mo) n'est pas mis en cache. Les icônes réellement utilisées sont enregistrées dans le bundle par `addIcons` et ne sont donc plus chargées par le réseau. Sans cela, une icône jamais affichée en ligne manquerait hors-ligne.

**Aucun groupe de données.** L'API de synchronisation ([[RT_09]]) ne doit pas être servie depuis un cache. Les images distantes de gdmissions.app ([[RT_12]]) ont déjà leur propre cache ([[RT_27]]). Les requêtes vers d'autres origines, non déclarées, traversent le service worker sans être interceptées.

**Navigation.** Les `navigationUrls` par défaut servent `index.html` pour tout chemin de l'application : un lien profond (écran de placement) s'ouvre hors-ligne.

**Ordre de [[RT_27]] inchangé.** La résolution réseau → cache IndexedDB → image embarquée reste celle de `BoardImageService`. Hors-ligne, l'étape « image embarquée » est servie par le cache du service worker si l'image s'y trouve. Le service le vérifie par une requête qui passe par le service worker, comme [[RT_56]]. Si elle échoue, le service rend une image de remplacement aux dimensions de l'asset, portant le message de [[RG_42]]. Ce remplacement n'est pas retenu pour la session : le plateau est redemandé au prochain affichage.

### RT_55 — Détection du contexte et déclenchement de l'installation

**Capture au démarrage.** Un service racine (`InstallService`) est instancié au démarrage de l'application, avant tout écran : l'évènement `beforeinstallprompt` peut survenir avant l'affichage de l'accueil. Le service l'intercepte (`preventDefault()`) et le conserve. Le bouton de [[RG_41]] appelle son `prompt()` puis lit `userChoice`. L'évènement `appinstalled` fait passer l'état à « installée ».

**Mode d'invitation**, exposé en signal, évalué dans cet ordre :

1. `Capacitor.isNativePlatform()` → `none` ;
2. `matchMedia('(display-mode: standalone)').matches` ou `navigator.standalone === true` (iOS) → `installed` ;
3. iPhone, iPad ou iPod d'après l'agent utilisateur, ou iPadOS se déclarant « Macintosh » avec `navigator.maxTouchPoints > 1` → `ios-instructions` ;
4. évènement `beforeinstallprompt` capturé → `prompt` ;
5. sinon → `none`.

**Fermeture du bandeau.** Elle est mémorisée par la paire `getConfig`/`setConfig` de [[RT_08]]. Un échec d'écriture est absorbé : le bandeau peut alors réapparaître au lancement suivant.

### RT_56 — Téléchargement des plateaux en arrière-plan

**Conditions.** Le téléchargement n'a lieu que si un service worker contrôle la page (`navigator.serviceWorker.controller`, [[RT_54]]) : il est sans objet dans l'APK, qui embarque les images. Il démarre une fois l'application stable, après le premier affichage. Si `navigator.connection?.saveData` est vrai, il ne démarre que sur l'action des Réglages ([[RG_42]]).

**Déroulement.** Pour chaque plateau et chaque variante de `boards.json`, l'image embarquée (`assets[variante]`) est demandée par `fetch(url)`, **en passant par le service worker** :

- si elle est dans le cache de sa version active, il la sert sans requête réseau ;
- sinon, il la télécharge et la range dans le groupe `boards` avant de répondre ;
- hors-ligne, une image absente rend une erreur 504.

Une réponse en succès compte l'image comme présente ; son corps n'est pas lu. Ce contrôle remplace `caches.match`, qui parcourt aussi les caches d'une version précédente que le service worker ne sert plus, et peut donc déclarer présente une image qu'il ne servira pas. `caches.match` ne sert qu'en attente de l'accord du joueur (économie de données), pour compter les images sans rien télécharger.

Les images sont demandées une à une, jamais en parallèle, pour ne pas concurrencer l'usage. Le compteur `présentes / total` alimente l'état de [[RG_42]].

**Interruptions.** Le passage hors-ligne ([[RT_14]]) suspend la boucle, et le retour en ligne la reprend. Une image en échec est sautée, puis retentée au lancement suivant.

**Indépendance de [[RT_27]].** Ce téléchargement porte sur les images **embarquées**, servies par la même origine que l'application : elles ont les dimensions exactes du référentiel et ne dépendent pas de la disponibilité de gdmissions.app. Le cache IndexedDB des versions distantes n'est pas touché : il continue d'être rempli à l'affichage, et reste prioritaire sur la version embarquée.

### RT_57 — Détection et application des mises à jour

- **Version prête.** `SwUpdate.versionUpdates`, filtré sur `VERSION_READY`, déclenche un toast avec les actions « Recharger » et « Plus tard » (cibles tactiles de [[RT_31]]). « Recharger » appelle `activateUpdate()` puis recharge le document. « Plus tard » ferme le toast, qui n'est plus présenté avant le lancement suivant.
- **Report sur l'écran de placement.** Tant que la route active est celle de l'écran de placement, l'annonce est mise en attente. Elle est présentée au premier changement de route qui en sort.
- **Vérification.** `checkForUpdate()` est appelé au retour au premier plan (`visibilitychange`), en plus de la vérification que fait le service worker à chaque ouverture.
- **Échecs.** `VERSION_INSTALLATION_FAILED` est ignoré silencieusement ([[RG_09]]). Un état `unrecoverable` (cache du service worker incohérent) recharge le document après un message, aucune donnée n'étant en jeu.

### RT_58 — Demande de stockage persistant

- **Appel automatique.** En mode installé ([[RT_55]]), l'application appelle `navigator.storage.persisted()` au lancement, puis `navigator.storage.persist()` si le stockage n'est pas encore persistant. Chrome accorde la persistance sans demande au joueur ; WebKit l'accorde aux applications installées sur l'écran d'accueil.
- **Hors installation.** L'appel n'est fait que sur l'action « Protéger mes données » du bloc « Application », car certains navigateurs (Firefox) présentent alors leur propre demande d'autorisation, qui ne doit pas surgir sans geste du joueur.
- **Affichage.** Le résultat de `persisted()` alimente l'état de [[RG_44]]. Une API absente est traitée comme « non protégé ».
- **APK.** Sans objet : les données vivent dans le bac à sable de l'application.

### RT_59 — Hébergement de la version web

- **Contenu.** Le site sert le contenu de `www/` produit par le build de production, **en HTTPS** : un service worker ne s'enregistre pas autrement, hors `localhost`.
- **Liens profonds.** Tout chemin inconnu du serveur est réécrit vers `index.html`, pour qu'un lien profond fonctionne avant que le service worker soit installé.
- **En-têtes de cache.** `ngsw-worker.js`, `ngsw.json`, `index.html` et `manifest.webmanifest` sont servis avec `Cache-Control: no-cache`, faute de quoi les mises à jour de [[RT_57]] ne seraient pas détectées. Les bundles, dont le nom porte une empreinte, peuvent être mis en cache longuement.
- **Politique de sécurité.** Si une politique de sécurité du contenu est posée, elle autorise gdmissions.app en `connect-src` et `img-src` ([[RT_12]]), ainsi que l'URL de l'API de synchronisation ([[RT_09]]).
- **`base href`.** Il vaut `/`. Un hébergement dans un sous-chemin demande `ng build --base-href /<chemin>/`, que le manifeste suit grâce à ses chemins relatifs ([[RT_53]]).
- **Mentions.** Le site rend les référentiels publics : les mentions de [[RT_20]], accessibles hors-ligne dans les Réglages, y satisfont les conditions d'usage de Wahapedia et de Battlemaster.

**Décision non tranchée : hébergeur et domaine** (voir « Suivi des décisions non tranchées »).

---

## EX_13 — Note de plan de jeu attachée à un déploiement

Le joueur doit pouvoir **rédiger, sur l'écran de placement, une note libre** attachée au déploiement en cours, pour y consigner son plan de jeu (objectifs visés, rôle de chaque unité, entrée des réserves, réponse attendue à la disposition adverse…), puis **la relire en lecture seule** lorsqu'il consulte un déploiement terminé. La note est une donnée du déploiement au même titre que ses placements : elle est sauvegardée avec lui ([[EX_04]]), disponible hors-ligne ([[EX_05]]) et synchronisée entre appareils ([[EX_06]]).

Satisfait par : [[RG_45]], [[RG_46]], [[RT_60]], [[RT_61]], [[RT_62]].

### RG_45 — Édition de la note de plan de jeu depuis l'écran de placement

**Accès.** L'en-tête de l'écran de placement ([[RG_03]] étape 3) porte un bouton à **icône de plan**, placé **immédiatement à gauche du menu des unités** ([[RG_16]]). Il est toujours disponible, quel que soit l'état du déploiement (aucun token posé, déploiement non fini ou terminé), le mode en cours (« Règle » [[RG_33]], « Déplacement » [[RG_39]]) ou l'agrandissement ([[RG_38]]).

**Fenêtre d'édition.** Un appui ouvre une **fenêtre modale** titrée « Plan de jeu », qui contient un unique **champ texte multiligne** pré-rempli avec la note existante (vide sinon) et deux actions :

- **« Valider »** enregistre le texte saisi comme note du déploiement et ferme la fenêtre ;
- **« Annuler »** (ou le geste/bouton retour du système) ferme la fenêtre sans rien enregistrer. Si le texte a été modifié, l'abandon est confirmé explicitement par le joueur avant d'être appliqué, sur le même principe que [[RG_08]] ; s'il ne l'a pas été, la fenêtre se ferme directement.

**Contenu.** La note est du **texte brut**, sans mise en forme ; les retours à la ligne saisis sont conservés. Sa longueur est limitée à **4 000 caractères** ; le champ affiche le nombre de caractères utilisés sur ce maximum et n'accepte pas de saisie au-delà. Une note qui ne contient que des espaces ou des retours à la ligne est tenue pour **vide** : la valider revient à supprimer la note.

**Enregistrement.** « Valider » enregistre immédiatement la note dans le déploiement du triplet courant, comme mise à jour de la même entrée ([[RG_07]]) — sans attendre d'autre action et sans dépendre du réseau ([[EX_05]]). Une sauvegarde « sous un nouveau nom » ([[RG_07]]) reprend la note du déploiement d'origine. La note n'est pas modifiable ailleurs que dans cette fenêtre.

**Ce que la note ne change pas.** La note n'entre dans **aucun** statut ni compte : un déploiement qui ne porte qu'une note, sans placement ni unité en réserve, reste « déploiement manquant » ([[RG_14]], [[RG_12]], [[RG_05]]). Ouvrir, éditer ou fermer la fenêtre ne modifie ni les placements ([[RT_04]]), ni la sélection courante du plateau ([[RG_30]]), ni l'unité courante du bandeau ([[RG_15]]), ni l'agrandissement et le cadrage de la vue ([[RG_38]], [[RG_39]]), ni le mode « Règle » en cours ([[RG_33]]).

**Remise à zéro.** L'action « Nouveau » de [[RG_14]] **conserve la note** : elle ne remet à zéro que les placements et les unités en réserve. Le plan de jeu reste ainsi disponible pour reprendre le déploiement de zéro sur le même triplet, et la note se retrouve pré-remplie dans la fenêtre d'édition de l'écran de placement ouvert vide. La présence d'une note ne déclenche donc pas, à elle seule, la confirmation de « Nouveau », dont le texte précise que la note est conservée. Pour effacer la note, le joueur la vide et la valide ([[RG_45]], « Contenu »).

**Second canal ([[RG_24]]).** L'existence d'une note n'est pas portée par la seule couleur du bouton : son icône change de rendu (contour sans note, plein avec note) et son nom accessible l'énonce (« Rédiger le plan de jeu » / « Modifier le plan de jeu »).

### RG_46 — Consultation en lecture seule de la note de plan de jeu

**Accès.** Le visualiseur plein écran ouvert par l'action **« Consulter »** de [[RG_14]] — déploiement terminé, placements superposés au plateau sans repères de mesure — porte, **en haut à droite de l'écran** (la croix de fermeture occupant l'angle supérieur gauche, [[RT_16]]), le même bouton à icône de plan qu'en [[RG_45]], lorsque le déploiement consulté porte une note. Sans note, le bouton n'est pas affiché : la consultation n'offre rien à rédiger. Le visualiseur « plateau seul » de [[RG_14]], qui ne montre aucun déploiement, ne porte pas ce bouton.

**Lecture seule.** Un appui ouvre une fenêtre titrée « Plan de jeu » qui affiche le texte de la note, retours à la ligne conservés, **sans aucun champ éditable** : ni saisie, ni clavier virtuel, ni action « Valider ». Le texte peut être sélectionné et copié. Une unique action « Fermer » (ou le geste/bouton retour du système) ramène au visualiseur, dans l'état de zoom et de cadrage où le joueur l'avait laissé. Une note trop longue pour l'écran défile à l'intérieur de la fenêtre.

**Modifier la note.** La consultation n'offre aucun raccourci d'édition : comme pour les placements, la note se modifie en reprenant le déploiement par « Éditer » ([[RG_14]]), puis par [[RG_45]].

### RT_60 — Modèle de données et persistance de la note

**Stockage.** La note est un champ texte `note` de l'enregistrement de déploiement ([[RT_06]]), à côté de `placements` ([[RT_04]]) et de `reservedUnitIds` ([[RT_35]]), et non un enregistrement séparé : elle suit sans traitement particulier la mise à jour en place de [[RG_07]], la suppression de [[RG_08]] et la suppression en cascade de [[RG_21]]. Une note vide est stockée comme chaîne vide `""`. Les enregistrements écrits avant cette règle n'ont pas le champ ; il est normalisé à `""` au chargement, sans migration de schéma ([[RT_08]]), comme `reservedUnitIds` ([[RT_35]]).

**Écriture.** À la validation ([[RG_45]]), le texte est ramené à `""` s'il ne contient que des blancs (`trim()` vide) ; sinon il est enregistré **tel que saisi**, blancs de début et de fin compris, pour ne pas altérer la mise en page voulue par le joueur. La longueur est contrôlée à l'écriture (au plus 4 000 caractères, comptés en unités de code UTF-16, soit la mesure de l'attribut `maxlength` du champ), en plus de la limite de saisie du champ, pour qu'aucun chemin d'écriture ne la contourne. L'écriture met à jour `updatedAt` et marque l'enregistrement modifié localement (`dirty`), ce qui l'inscrit au prochain envoi de synchronisation ([[RT_10]]). Si le déploiement du triplet n'existe pas encore (écran de placement ouvert par « Nouveau », rien encore posé), la validation de la note le crée, comme le ferait le premier placement.

**Remise à zéro.** L'action « Nouveau » de [[RG_14]] vide `placements` et `reservedUnitIds` mais **ne touche pas** au champ `note`, qui est recopié tel quel dans l'enregistrement mis à jour en place. Le déclenchement de sa confirmation ne teste que la présence d'un placement ou d'une unité réservée, le champ `note` n'y entrant pas.

**Statuts.** Les calculs de [[RT_11]] et [[RT_18]] ne lisent pas le champ `note` ([[RG_45]], « ce que la note ne change pas »).

**Synchronisation.** Le champ fait partie du contrat de synchronisation ([openapi.yml](openapi.yml), [[RT_09]]) au même titre que les placements : une chaîne, requise en écriture, longueur maximale 4 000. Un enregistrement reçu du serveur sans le champ (client antérieur) est normalisé à `""`. Le conflit de [[RT_15]] reste détecté **par enregistrement** : une note modifiée sur deux appareils hors-ligne produit un conflit sur le déploiement entier, arbitré par [[RG_11]] sans fusion de texte ; les deux versions présentées au joueur incluent leur note respective.

### RT_61 — Fenêtre d'édition de la note sur l'écran de placement

**Bouton.** Le bouton est un `ion-button` icône seule inséré dans le groupe `ion-buttons` de fin de l'en-tête de l'écran de placement, **avant** le bouton d'enregistrement, avec la cible tactile de [[RT_31]]. L'icône est `clipboard-outline` sans note et `clipboard` avec note, du jeu d'icônes de l'application (Ionicons), et le nom accessible suit [[RG_45]].

**Fenêtre.** La fenêtre est un `ion-modal` ouvert par le contrôleur de modales, qui reçoit en entrée la note courante et rend en sortie soit le nouveau texte (« Valider »), soit un abandon. Le champ est un `ion-textarea` à hauteur automatique, `maxlength="4000"` avec compteur de caractères, `autocapitalize="sentences"`, prenant le focus à l'ouverture. Le clavier virtuel redimensionne la fenêtre plutôt que de la recouvrir (`@capacitor/keyboard` en natif, `interactive-widget=resizes-content` en web), pour que les deux actions restent atteignables pendant la saisie.

**Abandon.** La fenêtre compare le texte courant à la note reçue ; s'ils diffèrent, la fermeture par « Annuler », par le bouton retour matériel, par le geste de balayage ou par un appui hors de la fenêtre passe par la garde `canDismiss` de la modale, qui demande la confirmation de [[RG_45]]. « Valider » ferme la fenêtre sans confirmation et délègue l'écriture à [[RT_60]].

**Isolation des gestes.** Tant que la fenêtre est ouverte, les gestes de l'écran de placement ([[RT_34]], [[RT_40]], [[RT_42]], [[RT_48]]) ne reçoivent aucun évènement : la modale recouvre l'écran, et l'écouteur du bouton du milieu de [[RT_48]] est inactif. Aucun état local de l'éditeur ([[RT_47]], sélection, bandeau, mode) n'est réinitialisé à l'ouverture ni à la fermeture.

### RT_62 — Fenêtre de consultation de la note dans le visualiseur « Consulter »

**Bouton.** Le visualiseur plein écran partagé de [[RT_16]] reçoit en entrée la note du déploiement consulté. Lorsqu'elle est non vide, il affiche le bouton `clipboard` de [[RT_61]], positionné en absolu dans l'angle supérieur droit, au-dessus de la surface zoomée et hors de la transformation `translate` + `scale`, avec la cible tactile de [[RT_31]] et le délimiteur contrasté de [[RT_43]] face à la scène. Le `pointerdown` sur ce bouton n'est pas transmis au pan/zoom du visualiseur. Le visualiseur « plateau seul » ne lui transmet aucune note.

**Fenêtre.** La fenêtre est un `ion-modal` dont le contenu est un bloc de texte en `white-space: pre-wrap`, `user-select: text`, défilant à l'intérieur de la modale. Le texte est inséré par **interpolation de texte** et jamais comme HTML, la note pouvant provenir d'un autre appareil par la synchronisation ([[RT_09]]). Aucun `ion-textarea` ni élément éditable n'y figure, si bien que le clavier virtuel ne s'ouvre pas. La fermeture, par « Fermer », par le bouton retour matériel ou par le geste de balayage, ne demande aucune confirmation et laisse intacts le zoom et le décalage du visualiseur.

---

## EX_14 — Consultation des missions primaires du couple de dispositions

Au moment de choisir un plateau ([[RG_03]] étape 2), puis pendant qu'il place ses unités ([[RG_03]] étape 3) ou qu'il consulte un déploiement terminé ([[RG_14]]), le joueur doit pouvoir **lire la carte de mission primaire qu'il jouera et celle que jouera son adversaire**, telles que les fixe le couple (sa disposition de force, la disposition adverse). Ces deux cartes conditionnent la façon de déployer : sans elles, le joueur planifie son déploiement sans connaître ce qui rapportera des points, à lui comme à l'adversaire. Sur un écran assez large, il doit pouvoir les lire **à côté du plateau**, pour confronter objectifs et zones sans changer de vue. Lorsqu'une carte porte au dos une règle complémentaire — son recto y renvoie (« see reverse ») —, le joueur doit pouvoir **retourner la carte** pour en lire le verso. Les cartes, recto comme verso, sont consultables hors-ligne ([[EX_05]]), au même titre que les plateaux.

Satisfait par : [[RG_48]], [[RG_49]], [[RT_64]], [[RT_65]], [[RT_66]].

### RG_48 — Bouton « Missions » et fenêtre des deux missions primaires

**Ce qu'est une mission primaire.** Chaque disposition de force ([[RT_23]]) possède un jeu de **5 cartes de mission primaire**, une par disposition adverse possible. Le couple (disposition du joueur, disposition adverse) désigne donc exactement :

- **la mission du joueur** : la carte du jeu de **sa** disposition prévue contre la disposition adverse ;
- **la mission de l'adversaire** : la carte du jeu de la disposition **adverse** prévue contre celle du joueur.

Contrairement aux plateaux ([[RT_12]]), le couple est ici **ordonné** : « Purge the Foe contre Priority Assets » donne au joueur *Destroyer's Wrath* et à l'adversaire *Vital Link*, l'inverse donnerait les deux cartes inversées. Lorsque les deux dispositions sont identiques (couple **miroir**), les deux joueurs jouent **la même carte** (par exemple *Meatgrinder* pour Purge the Foe contre Purge the Foe).

**Accès.** La même fenêtre s'ouvre depuis trois points, toujours pour le couple (disposition de la liste, disposition adverse) en cours :

- **écran de choix du plateau** ([[RG_03]] étape 2, [[RG_14]]) : un bouton **« Missions »** (icône de carte + libellé) attaché au **bandeau des deux dispositions** qui surmonte le pager — et non au bloc « Statut » ni au plateau affiché : la mission dépend du couple, elle est la même pour les 3 plateaux proposés. Le bouton est toujours disponible, quel que soit le plateau affiché par le pager et son statut ([[RG_14]]) ;
- **écran de placement** ([[RG_03]] étape 3) : un bouton à **icône de carte**, dans l'en-tête, **immédiatement à gauche** du bouton du plan de jeu ([[RG_45]]). Comme ce dernier, il est toujours disponible, quel que soit l'état du déploiement, le mode en cours (« Règle » [[RG_33]], « Déplacement » [[RG_39]]) ou l'agrandissement ([[RG_38]]) ;
- **visualiseur « Consulter »** ([[RG_14]]) : le même bouton à icône de carte, en haut à droite de l'écran, **à gauche** du bouton du plan de jeu de [[RG_46]] lorsque celui-ci est affiché, à sa place sinon. Le visualiseur « plateau seul », ouvert depuis l'écran de choix du plateau qui porte déjà le bouton, ne le reprend pas.

Chacun de ces accès reste disponible hors-ligne (voir [[RG_49]]). Ouvrir puis fermer la fenêtre depuis l'écran de placement ne modifie rien de ce qu'énumère [[RG_45]] (« ce que la note ne change pas ») : placements, sélection, unité courante du bandeau, agrandissement, cadrage, mode « Règle » ; depuis le visualiseur « Consulter », le zoom et le cadrage du visualiseur sont conservés.

**Fenêtre.** Un appui ouvre une **fenêtre modale plein écran** titrée « Missions primaires », par-dessus l'écran de choix du plateau, qui comporte :

- un **sélecteur à deux onglets**, dans le même sens de lecture que le bandeau des dispositions ([[RG_14]], « identification du plateau ») : **« Ma mission »** d'abord, **« Mission adverse »** ensuite. La fenêtre s'ouvre sur « Ma mission ». Chaque onglet porte, sous son libellé, le **nom de la carte** et l'icône de la disposition à laquelle elle appartient ([[RT_23]]), pour que le joueur sache sans ambiguïté laquelle des deux cartes il lit — l'onglet actif n'est jamais signalé par la seule couleur ([[RG_24]]) ;
- l'**image de la carte** de l'onglet actif, affichée en entier à l'ouverture (ajustée à la zone disponible, sans rognage — la carte n'a ni bandeau ni légende à masquer, contrairement au plateau de [[RG_17]]), **agrandissable par pincement** (molette sur poste de travail) et déplaçable une fois agrandie, sur le même principe que les visualiseurs de [[RG_14]]. Le passage d'un onglet à l'autre se fait par appui sur l'onglet ou par **balayage horizontal** de la carte lorsqu'elle est à son zoom d'ouverture ; changer d'onglet remet l'autre carte à son zoom d'ouverture ;
- une action **« Fermer »** (croix en haut à gauche, comme [[RT_16]]), le bouton/geste retour du système fermant aussi la fenêtre. La fermeture ramène à l'écran d'origine **dans l'état exact où le joueur l'avait laissé** : même plateau affiché par le pager et aucun statut recalculé sur l'écran de choix du plateau, état de l'éditeur intact sur l'écran de placement, zoom et cadrage intacts dans le visualiseur.

**Couleur de la disposition.** Chaque carte est présentée sur un fond à la **couleur de la disposition à laquelle elle appartient** — une couleur propre à chacune des 5 dispositions de [[RT_23]], déclinée pour les deux thèmes ([[RT_66]]) : l'onglet de la carte et la zone qui l'entoure en prennent la teinte, pour que le joueur reconnaisse d'un coup d'œil laquelle des deux cartes il lit. Cette couleur n'est qu'un **rappel** : le libellé de l'onglet (« Ma mission » / « Mission adverse »), le nom de la carte et l'icône de disposition restent les porteurs de l'information ([[RG_24]]), et les textes posés sur cette couleur sont lisibles dans les deux thèmes ([[RT_29]]). Dans un couple miroir, l'unique carte prend la couleur de la disposition commune.

**Affichage côte à côte sur écran large.** Lorsque la fenêtre dispose d'assez de largeur pour présenter trois colonnes portrait lisibles — en pratique une tablette, ou un téléphone tenu en paysage —, elle abandonne les onglets au profit d'une **vue côte à côte** : le **plateau** à gauche, puis **« Ma mission »**, puis **« Mission adverse »**, dans le sens de lecture du bandeau des dispositions ([[RG_14]]). Chaque colonne porte en tête son libellé (« Plateau » suivi de l'identification du plateau de [[RG_14]], « Ma mission » / « Mission adverse » suivis du nom de la carte), et chacune est agrandissable et déplaçable indépendamment des autres. Le plateau affiché est :

- sur l'écran de choix du plateau, celui que le pager affichait à l'ouverture ;
- sur l'écran de placement et dans le visualiseur « Consulter », celui du déploiement en cours.

Il est présenté dans la variante **avec repères de mesure** et **sans les placements du joueur**, comme la consultation du plateau seul de [[RG_14]] : la vue sert à étudier objectifs et zones, pas à relire le déploiement. Le passage d'une présentation à l'autre suit la largeur disponible, y compris quand le joueur fait pivoter l'appareil fenêtre ouverte ; la carte de l'onglet actif est alors conservée. Dans un couple miroir, la vue côte à côte n'a que deux colonnes (plateau, carte commune).

**Couple miroir.** Les deux cartes étant identiques, la fenêtre n'affiche **pas de sélecteur** : une seule carte, titrée de son nom, accompagnée de la mention « Mission miroir : les deux joueurs jouent cette même carte ».

**Recto et verso.** Certaines cartes portent au dos une règle complémentaire, à laquelle leur recto renvoie : par exemple l'action « Triangulate » de *Triangulation*. Au 2026-10-06, 11 cartes sur 25 sont dans ce cas ([[RT_64]]). La source imprime dans l'image un repère « 1/2 » ; ce n'est pas un contrôle de l'application. Pour chacune de ces cartes, la fenêtre propose un bouton qui **retourne la carte** :

- **Présence.** Le bouton n'existe que pour une carte dont le référentiel connaît le verso ; une carte sans verso n'en porte pas, plutôt qu'un bouton désactivé qui laisserait croire à un verso manquant.
- **Emplacement.** Il est placé **hors de l'image**, au-dessus de la carte, pour ne recouvrir aucun contenu imprimé ([[RT_31]]) : sous le sélecteur d'onglets (ou sous la mention miroir) en présentation à onglets, dans l'en-tête de la colonne de la carte en vue côte à côte. Chaque colonne de carte a le sien ; la colonne « Plateau » n'en a pas.
- **Libellé et second canal.** Son libellé annonce la face qui sera montrée : « Voir le verso » quand le recto est affiché, « Voir le recto » quand le verso l'est. La face affichée est en outre écrite à côté du nom de la carte (« Recto » / « Verso ») : elle n'est jamais portée par la seule icône ni par l'animation ([[RG_24]]).
- **Effet.** Un appui remplace l'image par l'autre face, présentée **en entier**, à son zoom d'ouverture ; un nouvel appui revient à la première. Le retournement est animé brièvement, par une rotation de la carte sur son axe vertical, sauf si le joueur a demandé à son système de réduire les animations : l'image change alors sans transition.

Chaque carte garde la face choisie **tant que la fenêtre est ouverte**. Changer d'onglet puis revenir, ou passer d'une présentation à l'autre en tournant l'appareil, retrouve la face laissée. À chaque nouvelle ouverture de la fenêtre, toutes les cartes repartent sur leur **recto**. Le balayage horizontal change toujours d'onglet et ne retourne jamais la carte : le seul moyen de retourner une carte est le bouton. Dans un couple miroir, la carte commune a un seul bouton. Le verso est en lecture seule, comme le recto.

**Lecture seule.** La fenêtre ne permet ni de choisir, ni de changer, ni d'annoter une mission : elle n'écrit rien dans le déploiement ([[RT_04]], [[RT_60]]) et n'entre dans aucun statut ni compte ([[RG_12]], [[RG_14]]). La mission découle entièrement du couple de dispositions déjà retenu ; pour en lire une autre, le joueur revient à l'étape 1 et change de disposition adverse.

**Couple sans carte connue.** Si le référentiel ne contient pas de carte pour l'un des deux sens du couple (référentiel incomplet après un changement côté source, voir [[RT_64]]), l'onglet correspondant reste présent et affiche « Mission non disponible pour ce couple » à la place de l'image ; le bouton « Missions » n'est masqué que si **aucune** des deux cartes n'est connue.

### RG_49 — Disponibilité hors-ligne et version des cartes de mission

Les cartes de mission suivent la même politique que les images de plateau ([[RG_23]]) : la version affichée est **la plus récente obtenue en ligne** sur cet appareil, conservée pour le hors-ligne, et à défaut la version **livrée avec l'application**. Aucune carte n'est jamais bloquée faute de réseau dans l'application empaquetée.

Dans le navigateur ([[EX_12]]), les cartes rejoignent le **téléchargement en arrière-plan** de [[RG_42]] : elles n'y sont pas exigées à la première ouverture, et tant que ce téléchargement n'est pas terminé, une carte jamais affichée sur cet appareil peut être indisponible hors-ligne. Son image est alors remplacée par le message « Mission non disponible hors-ligne », jamais par une image cassée, et l'onglet reste consultable (nom de la carte et disposition affichés). L'état visible du bloc « Application » des Réglages compte les cartes avec les plateaux (« Téléchargement des plateaux et missions : n / 126 » au 2026-10-06 : 90 images de plateau, 25 rectos et 11 versos).

**Verso.** Le verso d'une carte suit la même politique que son recto, image par image : il peut être à jour en ligne, en cache ou embarqué indépendamment du recto. Un verso indisponible hors-ligne ne retire pas le bouton de [[RG_48]] : la face retournée affiche « Mission non disponible hors-ligne », et un nouvel appui ramène au recto.

**Attribution.** Les cartes proviennent, comme les plateaux, de gdmissions.app : leur source et le texte d'attribution requis apparaissent dans le bloc « Mentions des sources tierces » des Réglages ([[RG_18]], [[RT_20]]), quelle que soit la provenance de l'image affichée (réseau, cache, embarquée). Le texte exact de cette mention est une décision encore ouverte (voir « Suivi des décisions non tranchées »).

### RT_64 — Référentiel des missions primaires (gdmissions.app)

**Source.** Les cartes sont les images statiques publiées par [gdmissions.app](https://gdmissions.app/11th/primary-missions) (pack de missions « GDM 2026 », 11ᵉ édition), sous `/assets/11th/primary-missions/{disposition}/{carte}.png`. La page de chaque carte, `/11th/primary-missions/{disposition}/{carte}`, indique la disposition adverse à laquelle elle s'applique (« Opponent · {disposition} ») ou la mention « Mirror · {disposition} » pour la carte miroir. Le segment `{disposition}` reprend **exactement** les 5 identifiants de [[RT_23]] (`take-and-hold`, `purge-the-foe`, `reconnaissance`, `priority-assets`, `disruption`), qui servent donc de clé de rapprochement sans table de correspondance. Constaté au 2026-10-05 : 25 cartes, 5 par disposition, toutes en PNG 1653 × 2833 (environ 200 ko l'une, 5 Mo au total), servies avec `Access-Control-Allow-Origin: *`.

**Verso.** Le verso d'une carte est publié sous `/assets/11th/primary-missions/{disposition}/{carte}-back.png`. La page de la carte le **déclare** dans ses données (`"back":"/assets/…-back.png"`, et `"$undefined"` pour une carte sans verso) ; c'est cette déclaration qui fait foi, pas la présence d'un fichier à l'adresse attendue. Constaté au 2026-10-06 : 11 cartes ont un verso, toutes en PNG 1653 × 2833 comme leur recto (environ 1,9 Mo au total) :

- Reconnaissance : *Gather Intel*, *Surveil the Foe*, *Triangulation* ;
- Priority Assets : *Extract Relic*, *Sabotage*, *Secure Asset*, *Vanguard Operation*, *Vital Link* ;
- Disruption : *Death Trap*, *Locate and Deny*, *Smoke and Mirrors* ;
- aucune carte de Take and Hold ni de Purge the Foe.

Le verso est déclaré pour exactement ces 11 cartes, et l'URL déclarée suit dans chaque cas la convention `{carte}-back.png`.

**Matrice constatée au 2026-10-05** (ligne : disposition du joueur, donc jeu de la carte ; colonne : disposition adverse) :

| Joueur ↓ / Adversaire → | Take and Hold | Purge the Foe | Reconnaissance | Priority Assets | Disruption |
| --- | --- | --- | --- | --- | --- |
| **Take and Hold** | Battlefield Dominance *(miroir)* | Immovable Object | Purge and Secure | Inescapable Dominion | Determined Acquisition |
| **Purge the Foe** | Unstoppable Force | Meatgrinder *(miroir)* | Consecrate | Destroyer's Wrath | Punishment |
| **Reconnaissance** | Reconnaissance Sweep | Triangulation | Gather Intel *(miroir)* | Search and Scour | Surveil the Foe |
| **Priority Assets** | Secure Asset | Vital Link | Vanguard Operation | Sabotage *(miroir)* | Extract Relic |
| **Disruption** | Death Trap | Delaying Action | Smoke and Mirrors | Locate and Deny | Outmanoeuvre *(miroir)* |

La mission du joueur est la case (sa disposition, disposition adverse) ; celle de l'adversaire, la case transposée (disposition adverse, sa disposition) ; sur la diagonale, les deux coïncident ([[RG_48]]).

**Ingestion hors-ligne.** Le référentiel est généré par un script `scripts/ingest-missions.mjs`, exécuté hors de l'application comme ceux de [[RT_02]] et [[RT_12]] ([[EX_05]] : jamais à l'exécution). Pour chaque disposition de [[RT_23]], le script lit la page du jeu `/11th/primary-missions/{disposition}`, en énumère les cartes, lit sur la page de chaque carte son nom, sa disposition adverse (ou la mention miroir) et la déclaration de son verso, télécharge l'image du recto — et celle du verso s'il est déclaré — et en relève les dimensions. Il écrit `src/assets/referentials/missions.json` et les images sous `src/assets/referentials/missions/` :

- un bloc `source` (nom de la source, URL, texte d'attribution, date d'ingestion), lu par l'énumération des mentions de [[RT_20]] — le référentiel est ajouté à cette énumération dans `src/app/referentials/referential.service.ts` ;
- une entrée par carte : `id` (`{disposition}/{carte}`), `name` (nom affiché, tel que publié par la source), `disposition` (jeu de la carte), `opponent` (disposition adverse, égale à `disposition` pour la carte miroir), `width`/`height` (dimensions mesurées), `asset` (chemin de l'image embarquée), `remoteAsset` (URL distante), et `back` (`{ asset, remoteAsset }` du verso, sous `missions/{disposition}/{carte}-back.png`), **absent** pour une carte sans verso. Le verso n'a pas de dimensions propres : il est vérifié aux dimensions du recto.

Le script **échoue explicitement**, sans écrire de référentiel partiel, si une disposition de [[RT_23]] n'a pas exactement 5 cartes, si une carte n'indique pas sa disposition adverse, si deux cartes d'un même jeu visent la même disposition adverse, si une image n'est pas un PNG, ou si un verso déclaré est introuvable ou n'a pas les dimensions de son recto. Un verso non déclaré n'est jamais recherché : son absence n'est pas une erreur. La matrice étant complète par construction, l'état « Mission non disponible pour ce couple » de [[RG_48]] ne survient que si un référentiel produit par une version antérieure du script est embarqué avec un référentiel de dispositions plus récent.

**Lecture par le client.** La résolution des deux cartes d'un couple est une fonction pure du référentiel (aucun appel réseau, aucun accès au stockage), testable unitairement : `missionFor(joueur, adversaire)` rend l'entrée dont `disposition = joueur` et `opponent = adversaire`, et la fenêtre de [[RT_66]] l'appelle dans les deux sens. Une carte a un verso si et seulement si son entrée porte `back`. Un changement de pack de missions côté source (nouvelle saison) se traite par une nouvelle exécution du script, comme un changement de plateaux ([[RT_12]]) : les cartes ne sont rattachées à aucun déploiement sauvegardé, si bien que remplacer le référentiel n'invalide aucune donnée du joueur.

### RT_65 — Résolution des images de cartes : réseau, cache, embarquée

**Même chaîne que les plateaux.** L'image de chaque carte est résolue comme celle d'un plateau ([[RT_27]]) : en ligne, appel direct de `remoteAsset` borné à 8 secondes avec `cache: 'no-cache'` ; sinon, ou en cas d'échec, l'entrée du cache local ; sinon, l'image embarquée `asset`. Une image distante n'est acceptée (affichée et mise en cache) que si c'est un PNG **aux dimensions `width`/`height` de l'entrée du référentiel** ; toute autre réponse est écartée sans message ([[RG_09]]). Un appel réseau au plus par image et par session d'application, l'image résolue étant conservée en mémoire (URL d'objet) pour les affichages suivants. Le **verso** est une image à part entière de cette chaîne : il est résolu à partir de `back.remoteAsset` puis `back.asset`, aux dimensions `width`/`height` de l'entrée, seulement au premier retournement de la carte et pas à l'ouverture de la fenêtre.

**Mise en œuvre.** La logique de résolution de `BoardImageService` (`src/app/referentials/board-image.service.ts`) est factorisée pour être paramétrée par le type d'image, plutôt que dupliquée : les cartes sont stockées dans un store IndexedDB `missionImages`, distinct de `boardImages` ([[RT_27]]) et de ceux de [[RT_08]], indexé par l'`id` de la carte pour le recto et par `{id}#back` pour le verso. Les templates passent par un pipe `missionImage` (déclaré dans `SharedModule`, à l'image de `boardImage`), avec la face en argument (`card | missionImage: 'front' | async`, `'back'` pour le verso, `'front'` par défaut), jamais par `asset` ou `back.asset` directement. Le pipe rend le recto pour une face `'back'` demandée sur une carte sans verso, cas que l'interface n'offre pas.

**Version web.** Dans `ngsw-config.json` ([[RT_54]]), un groupe `missions` (`assets/referentials/missions/**`, `installMode: lazy`, `updateMode: lazy`) s'ajoute au groupe `boards` ; `missions.json` est couvert par le groupe `referentials` existant (`prefetch`). Le groupe couvre les versos, rangés dans le même dossier. Le téléchargement en arrière-plan de [[RT_56]] parcourt les cartes **après** les plateaux — tous les rectos, puis les versos —, dans la même boucle séquentielle et avec les mêmes conditions (service worker actif, économie de données, pause hors-ligne), et le compteur `présentes / total` les inclut. Hors-ligne, l'étape « embarquée » vérifie que le service worker sait servir la carte, comme pour les plateaux ; sinon elle rend un SVG « Mission non disponible hors-ligne » ([[RG_49]]).

### RT_66 — Bouton « Missions » et fenêtre de consultation

**Ouverture.** Un service partagé, `MissionsService` (`src/app/shared/`, sur le modèle de `GameplanNoteService`), expose une méthode unique `open({ playerDispositionId, opponentDispositionId, board })` utilisée par les trois points d'accès de [[RG_48]]. Il résout les deux cartes par la fonction pure de [[RT_64]] et ouvre un `ion-modal` plein écran par le contrôleur de modales ; la fenêtre ne rend rien en sortie. Le `board` transmis est celui de la colonne « Plateau » de la vue côte à côte.

**Boutons.**

- *Choix du plateau* (`src/app/pages/board-choice/`) : dans le bandeau « VS », sous les deux dispositions, centré, un `ion-button` `fill="outline"` `size="small"` à icône et libellé « Missions », avec la cible tactile de [[RT_31]] ; son nom accessible est « Voir les missions primaires ». Il n'est rendu qu'une fois les deux dispositions du couple connues, et transmet le plateau affiché par le pager.
- *Placement* (`src/app/pages/placement/`) : un `ion-button` icône seule, inséré dans le groupe `ion-buttons` de fin de l'en-tête **avant** les boutons du plan de jeu de [[RT_61]], nom accessible « Voir les missions primaires ». L'écouteur du bouton du milieu de [[RT_48]] et les gestes de l'éditeur sont isolés pendant l'ouverture comme pour la note ([[RT_61]], « Isolation des gestes ») ; aucun état local de l'éditeur n'est réinitialisé.
- *Visualiseur « Consulter »* (`src/app/shared/board-viewer.component.ts`) : le visualiseur reçoit en entrée le couple de dispositions (absent pour le « plateau seul ») et affiche, lorsqu'il l'a reçu, un bouton rond positionné comme celui de la note de [[RT_62]] — hors de la transformation, `pointerdown` non transmis au pan/zoom —, à gauche de ce dernier s'il est présent.

L'icône des trois boutons est `document-text-outline` d'Ionicons, enregistrée dans `src/app/icons.ts`, faute de quoi elle manquerait hors-ligne ([[RT_54]]).

**Fenêtre.** Le composant `MissionCardsComponent` (`src/app/shared/`) reçoit les cartes résolues (une seule pour le couple miroir), les deux dispositions et le plateau. Son en-tête porte la croix de fermeture à gauche et le titre « Missions primaires ».

- **Onglets** (largeur inférieure à 720 px CSS) : un `ion-segment` à deux `ion-segment-button`, dont le texte (libellé, nom de la carte, icône de disposition) porte l'information d'onglet actif ; l'état sélectionné est exposé par `aria-selected` et pas par la seule couleur ([[RG_24]]). Le balayage horizontal ne change d'onglet qu'au zoom d'ouverture, pour ne pas entrer en conflit avec le déplacement d'une carte agrandie.
- **Côte à côte** (largeur d'au moins 720 px CSS, détectée par `matchMedia('(min-width: 720px)')` et suivie à chaque changement, rotation comprise) : une grille de trois colonnes égales (deux pour le miroir), chacune avec son en-tête textuel et sa propre surface de pan/zoom. La colonne « Plateau » affiche la variante `with-measurements` du plateau transmis par le pipe `boardImage` ([[RT_27]]), sans calque de placements. 720 px est la largeur à partir de laquelle une colonne dépasse 240 px, seuil retenu pour qu'une carte entière reste déchiffrable avant tout agrandissement ; un téléphone en paysage et une tablette dans les deux orientations y sont au-dessus.

Chaque image — carte ou plateau — est rendue par le pan/zoom de [[RT_16]], **extrait** du visualiseur `board-viewer.component.ts` en un composant partagé `app-pan-zoom` (contenu projeté, dimensions natives en entrée, ajustement initial *contain*, signal « au zoom d'ouverture » exposé pour la règle du balayage), dont le visualiseur devient lui-même un consommateur : les gestes restent écrits une seule fois. Une carte porte le texte alternatif « Carte de mission primaire {nom} — {disposition de la carte} contre {disposition adverse} ».

**Retournement d'une carte.**

- **État.** La face affichée de chaque carte est un état local de `MissionCardsComponent`, un signal indexé par l'`id` de la carte (`'front' | 'back'`), vide à la création. Le composant étant recréé à chaque ouverture de la modale, toutes les cartes repartent sur leur recto ([[RG_48]]). L'état survit au changement d'onglet et de présentation, qui ne recréent pas le composant.
- **Bouton.** Un `ion-button` `fill="outline"` `size="small"`, avec l'icône `sync-outline` d'Ionicons (enregistrée dans `src/app/icons.ts`, [[RT_54]]) et le libellé « Voir le verso » / « Voir le recto » ; la cible tactile est celle de [[RT_31]]. Le bouton n'est rendu que si l'entrée de la carte porte `back`. Le libellé visible sert de nom accessible, complété du nom de la carte (« Voir le verso de Triangulation »). Comme pour la note ([[RT_61]]), ce sont **deux boutons** à libellé fixe, l'un ou l'autre rendu selon la face, plutôt qu'un `aria-label` lié : `ion-button` relit ses attributs `aria-*` avant d'être initialisé ([[RT_43]]). La mention de face (« Recto » / « Verso ») est un texte placé à côté du nom de la carte, dans le bloc sous les onglets ou dans l'en-tête de colonne.
- **Image.** Le `app-pan-zoom` de la carte reçoit l'image de la face courante ; le changement de face rappelle son ajustement *contain*, si bien que l'autre face s'affiche en entier, quel que soit l'agrandissement laissé sur la précédente. Les deux faces ayant les mêmes dimensions ([[RT_64]]), les dimensions natives transmises ne changent pas. Le texte alternatif du verso est celui de la carte suffixé de « — verso ».
- **Animation.** Une rotation CSS de 180° sur l'axe Y (`transform: rotateY`, environ 300 ms) est appliquée au conteneur de l'image : la nouvelle face remplace l'ancienne à mi-course, quand la carte est vue par la tranche. Sous `@media (prefers-reduced-motion: reduce)`, la règle d'animation est retirée et l'image est remplacée directement. Le bouton est inactif pendant l'animation, pour qu'un double appui ne laisse pas l'image et la mention de face désaccordées.
- **Balayage.** Le balayage de `app-pan-zoom` reste attaché au changement d'onglet (« Onglets » ci-dessus) et ne touche pas à la face.

**Couleurs de disposition.** Les 5 couleurs de [[RG_48]] sont des tokens de thème `--app-dispo-color-{identifiant}` (fond) et `--app-dispo-color-{identifiant}-on` (texte posé dessus) définis dans `src/theme/variables.scss` pour les deux thèmes ([[RT_29]]), l'identifiant étant celui de [[RT_23]] — si bien que le référentiel des dispositions n'a pas à porter de valeur de couleur. Les teintes reprennent celles par lesquelles gdmissions.app distingue les dispositions (constaté au 2026-10-05 : Take and Hold `#2f6b4f`, Purge the Foe `#8a2b2b`, Reconnaissance `#1f7a82`, Priority Assets `#a17b14`, Disruption `#1f4f8a`) ; chaque couple fond/texte est ajouté au contrôle de `scripts/check-contrast.mjs` et doit atteindre 4,5:1 dans les deux thèmes. L'onglet sélectionné et l'en-tête de colonne d'une carte prennent le fond de sa disposition ; la zone qui entoure la carte en prend une version atténuée (mélange avec la surface de scène `--app-surface-stage`), pour ne pas concurrencer la carte elle-même.

**État préservé.** L'ouverture et la fermeture de la modale ne touchent ni à l'index du pager ni aux statuts calculés par [[RT_11]] (aucun recalcul au retour), ni à l'état de l'éditeur de placement ([[RT_47]], sélection, bandeau, mode), ni à la transformation du visualiseur, ni aux paramètres de navigation de l'écran. Tant que la modale est ouverte, les gestes de l'écran d'origine ne reçoivent aucun évènement.

---

## Suivi des décisions non tranchées

Les règles techniques suivantes contiennent un choix encore ouvert et doivent être mises à jour dès que la décision est prise :

- **[[RT_59]] — hébergeur et domaine de la version web.** Toute offre d'hébergement statique en HTTPS convient, à condition de permettre la réécriture des chemins vers `index.html` et des en-têtes de cache par fichier (Netlify, Cloudflare Pages… ; GitHub Pages ne permet pas ces en-têtes). Le domaine fixe l'origine, donc le stockage des données du joueur : en changer après publication revient à repartir d'une application vide sur chaque appareil.
- **[[RG_49]] / [[RT_64]] — texte d'attribution des cartes de mission.** Les plateaux sont crédités à Battlemaster, source déclarée par gdmissions.app ([[RT_12]]) ; pour les cartes de mission primaire, gdmissions.app ne nomme pas d'autre source que le pack « GDM 2026 » lui-même. Reste à fixer, avant implémentation, le nom de source et le texte que le script d'ingestion écrira dans le bloc `source` de `missions.json` (au minimum « gdmissions.app », éventuellement complété de l'éditeur du pack de missions).
- **[[RT_71]] — adresse du serveur de production.** Le développement se fait contre un serveur local (`http://localhost:3000/v1`). L'adresse de production, et donc l'hébergement du serveur de [[RT_09]], reste à choisir ; elle ne demandera que de renseigner `environment.prod.ts` et la liste des origines CORS. Elle est liée au choix de [[RT_59]] (origine de la version web).
- **[[RT_70]] — portée des identifiants d'enregistrement.** Les identifiants sont générés par le client (`list_<uuid>`, `depl_<uuid>`, ou repris de l'import pour les unités). [[RT_70]] suppose qu'ils sont uniques par compte — clé (`user_id`, `resource_type`, `id`) —, ce qu'exige la fusion lors d'un changement de compte ([[RG_51]]), qui verse les mêmes identifiants dans un second compte. À confirmer.

Les décisions suivantes, précédemment ouvertes, sont tranchées : [[RT_12]] (appel direct du client vers gdmissions.app, sans relais serveur, version embarquée en dernier recours), [[RT_05]] (`playArea` mesuré à l'ingestion, image distante acceptée seulement à dimensions identiques), [[RT_27]] (store IndexedDB dédié aux blobs), [[RT_16]] (pan/zoom implémenté sans librairie tierce, sur les évènements `Pointer` et une transformation CSS), [[RT_06]]/[[RT_08]] (IndexedDB pour les enregistrements métier, stockage de configuration léger séparé) [[RT_26]] (fichier JSON versionné avec l'application, alimenté entrée par entrée par l'assistant IA du projet) et [[RT_37]] (terrain extrait des images de plateau par un script hors-ligne plutôt que saisi à la main).

## Suivi des écarts entre spécification et implémentation

- **[[EX_14]] / [[RG_48]] / [[RG_49]] / [[RT_64]] / [[RT_65]] / [[RT_66]] — implémentées, vérifiées en navigateur par Cypress.** `scripts/ingest-missions.mjs` a produit `missions.json` et les 25 cartes (5,1 Mo) le 2026-10-06, matrice identique à celle de [[RT_64]]. La résolution des couples (`src/app/referentials/missions.ts`) est couverte par des tests unitaires sur le référentiel livré, et le téléchargement en arrière-plan compte les cartes après les plateaux. La chaîne réseau → cache → embarquée est désormais `src/app/referentials/remote-image.service.ts`, que `BoardImageService` et `MissionImageService` paramètrent. Le pan/zoom est `src/app/shared/pan-zoom.component.ts`, consommé par le visualiseur et par la fenêtre (`mission-cards.component.ts`, ouverte par `missions.service.ts`). Le test `cypress/e2e/missions.cy.ts` contrôle les onglets à l'étroit, le couple miroir, la vue côte à côte en 1024 × 768, et l'accès depuis le placement et « Consulter », absent du « plateau seul ». Restent des écarts :
  - **Texte d'attribution provisoire.** Le script écrit « Primary mission cards (GDM 2026) via gdmissions.app », en attendant la décision ouverte ci-dessus.
  - **Or de Priority Assets assombri.** La teinte `#a17b14` de gdmissions.app n'atteint que 3,9:1 avec un texte blanc ; le token vaut `#8a6a10` (5,1:1), les quatre autres teintes sont reprises telles quelles.
  - **Onglet non sélectionné neutre.** Seul l'onglet actif prend la couleur de sa disposition ; l'autre reste sur la surface surélevée, pour que l'onglet actif se distingue aussi par le contraste.
  - **Recto/verso implémenté, vérifié en navigateur par Cypress.** `ingest-missions.mjs` lit la déclaration du verso de chaque page ; le référentiel régénéré le 2026-10-06 porte `back` sur les 11 cartes de [[RT_64]], avec leurs 11 images (7,0 Mo pour l'ensemble des cartes). Les tests unitaires couvrent la liste des cartes à verso, la clé de cache `{id}#back` et l'ordre de téléchargement (rectos puis versos). Le test `cypress/e2e/missions.cy.ts` contrôle le retournement de *Triangulation*, l'absence de bouton sur *Consecrate*, la face conservée au changement d'onglet, le retour au recto à la réouverture, et la vue côte à côte où seule la colonne de la carte à verso porte le bouton. La rotation elle-même et son retrait sous `prefers-reduced-motion` n'ont pas été contrôlés automatiquement : les captures ne montrent que l'état final.
  - **Non vérifié sur appareil.** Ni le balayage au doigt entre les onglets, ni le passage d'une présentation à l'autre par rotation réelle n'ont été contrôlés sur un téléphone ou une tablette ; chaque présentation n'a été vue qu'à une taille de fenêtre fixe, sans redimensionnement fenêtre ouverte.

- **[[RG_47]] / [[RT_63]] — implémentées.** Le numéro est exposé par `src/app/app-version.ts` et affiché en bas des Réglages ; `android/app/build.gradle` lit `package.json` pour `versionName`/`versionCode`. Le build Android n'a pas été relancé pour le vérifier.

- **[[EX_13]] / [[RG_45]] / [[RG_46]] / [[RT_60]] / [[RT_61]] / [[RT_62]] — implémentées, vérifiées en navigateur.** La normalisation de la note (`src/app/deployment/gameplan-note.ts`) et le statut rouge d'un déploiement qui ne porte qu'une note sont couverts par des tests unitaires ; le champ `note` figure au schéma `Deployment` de [openapi.yml](openapi.yml). La fenêtre est `src/app/shared/gameplan-note.component.ts`, ouverte par `gameplan-note.service.ts`. Le test de bout en bout `cypress/e2e/gameplan-note.cy.ts` (375 × 812 environ) contrôle la rédaction, l'abandon confirmé d'un texte modifié, la fermeture sans confirmation d'un texte inchangé, le changement de nom accessible du bouton, la conservation de la note par « Nouveau » sans confirmation au statut rouge, et la lecture seule dans « Consulter » ; le déploiement « fait » y est obtenu en écrivant directement la réserve de toutes les unités dans IndexedDB. Le bouton de l'écran de placement est rendu par deux `ion-button` à libellé fixe plutôt que par un `aria-label` lié, pour la raison donnée sous [[RT_43]]. Le redimensionnement par le clavier virtuel ([[RT_61]]) repose en web sur `interactive-widget=resizes-content` (`src/index.html`) et en natif sur le comportement par défaut d'Android ; aucun réglage `@capacitor/keyboard` n'a été ajouté, et rien n'a été vérifié sur appareil.

- **[[EX_12]] / [[RG_41]] à [[RG_44]] / [[RT_53]] à [[RT_58]] — implémentées, vérifiées en navigateur sur le build de production servi en local ; installation réelle non vérifiée.** Le code est dans `src/app/pwa/`, avec `ngsw-config.json`, `src/manifest.webmanifest` et les icônes produites par `scripts/generate-icons.mjs` à partir de `resources/icon.png` (y compris les icônes du lanceur Android, contrôlées image par image mais pas encore vues sur un appareil). `scripts/serve-www.mjs` (`npm run serve:pwa`) sert `www/` comme le demande [[RT_59]]. Les tests unitaires couvrent la détection du contexte d'installation, le téléchargement des plateaux (pause, reprise, échec, économie de données) et le plateau indisponible hors-ligne.

  Contrôlé dans le navigateur intégré de l'environnement de développement :
  - l'installation du service worker et le téléchargement des 90 plateaux ;
  - le rechargement complet de l'application serveur coupé, lien profond compris, icônes affichées ;
  - le message « Plateau non disponible hors-ligne » pour les plateaux retirés du cache ;
  - l'annonce d'une nouvelle version, puis le passage à celle-ci par « Recharger » ;
  - le bloc « Application » des Réglages.

  Ce navigateur n'émet pas `beforeinstallprompt` : le bouton d'installation et la fermeture du bandeau ont été vérifiés avec un évènement simulé. Le mode `ios-instructions` et la demande de stockage persistant n'ont été vérifiés que par les tests unitaires. **Aucune installation n'a été faite sur un iPhone ou un téléphone Android**, faute d'hébergement HTTPS ([[RT_59]], non tranché) ; la mention « en pause » n'a été vue qu'en test unitaire, l'état hors-ligne du navigateur n'ayant pu être que simulé.
- **[[RT_59]] — hébergement non réalisé.** Aucun hébergeur ni domaine n'est choisi (voir « Suivi des décisions non tranchées ») : la version web installable n'est publiée nulle part. Tant que la synchronisation de compte ([[RT_09]]) n'est pas servie, rien ne permet de transférer ses données d'un onglet Safari vers l'application installée sur iPhone ([[RG_41]]), ni d'un appareil à l'autre.

- **[[RT_09]] — serveur de synchronisation réalisé et vérifié en local, non déployé.** Le serveur est le dépôt `Windfall-Planner-api`, à côté de ce dépôt (Node.js 24, Express 5, Prisma 7, PostgreSQL 18 sous Docker), conforme à [openapi.yml](openapi.yml) v1.1.0 et à [schema.sql](schema.sql) ; ses copies de ces deux fichiers sont à tenir alignées sur celles-ci. Vérifié le 2026-10-06 :
  - 112 tests (règles pures, et intégration contre une vraie base PostgreSQL), chaque réponse étant validée contre openapi.yml. Ils couvrent l'inscription, la connexion et l'échec indistinguable ([[RG_50]]), le 401 sur jeton inconnu, la reconnexion qui remplace le jeton ([[RT_67]]), la gestion du compte et sa suppression sans aucune ligne restante ([[RG_52]]), le pull paginé et le 410, la poussée acceptée, les cinq cas de conflit de [[RT_68]], la cascade ([[RG_21]]), l'ordre de traitement, les rejets, les limites (413), la résolution locale, serveur et périmée, le rejeu idempotent et la clé réutilisée, le 426, les cinq seuils du 429 ([[RT_69]]), CORS ([[RT_71]]), deux poussées concurrentes sans trou ni doublon de révision, et les purges.
  - Un scénario `curl` de bout en bout contre le serveur compilé et la base Docker : inscription, poussée, pull, conflit « modifié des deux côtés » depuis un second appareil, résolution, puis suppression du compte (401 pour l'autre appareil).

  Non vérifié ou non fait : aucun déploiement (adresse de production non tranchée, [[RT_71]]) ; la limitation de débit garde ses compteurs en mémoire, exacte pour une seule instance seulement ; la purge n'est planifiée nulle part ; le client, désormais aligné sur la v1.1.0, n'a été essayé contre ce serveur qu'en local (entrée suivante). [[EX_06]] n'est donc satisfaite qu'en développement : sans serveur déployé, un build de production ne synchronise pas ([[RT_71]]) ; conformément à [[RG_09]] et [[RG_10]], l'application y fonctionne intégralement en local.
- **[[RG_50]] à [[RG_54]] / [[RT_67]] à [[RT_71]] — client aligné sur le contrat v1.1.0, vérifié en navigateur contre le serveur local.** [openapi.yml](openapi.yml) est en v1.1.0, validé par `redocly lint` avec deux avertissements assumés : pas de licence déclarée, et un serveur `localhost` ([[RT_71]]). Le client est dans `src/app/net/` : `auth.service.ts` (jeton d'appareil, [[RG_50]], [[RG_52]], [[RG_53]], [[RT_67]]), `auth.interceptor.ts` (jeton, `X-Client-Version`, retour à l'usage local sur `401 UNAUTHENTICATED`), `device.service.ts` (identité de l'appareil, [[RT_67]]), `sync.service.ts` (première connexion [[RG_51]], pull paginé, poussée découpée et idempotente, `410`, `413`, `426`, `429`, conflits et rejets, [[RT_68]], [[RT_69]]) et `sync-protocol.ts` (règles pures du protocole). Les écrans : `src/app/shared/conflict-resolution.component.ts` (les six natures de [[RG_54]], appareil et date de chaque version, déploiements liés), `src/app/shared/first-sync-choice.component.ts` (fusion, ou remplacement confirmé, [[RG_51]]), `src/app/pages/settings/account-management.component.ts` ([[RG_52]]), et l'avertissement d'absence de récupération du mot de passe sur le formulaire d'inscription ([[RG_50]]).

  Les règles pures (conversion, application d'une page de pull, découpage de la poussée, empreinte d'idempotence) et l'identité de l'appareil sont couvertes par des tests unitaires. Contrôlé le 2026-10-06 dans le navigateur intégré (`ng serve`), contre le serveur local et un second appareil simulé par `curl` :
  - inscription avec des données locales et un compte vide : versement sans question, jeton de base attribué à chaque enregistrement ;
  - conflit « modifié des deux côtés » affiché avec l'appareil et l'heure de chaque version, puis « garder la version de l'autre appareil » ;
  - conflit « liste supprimée ici » avec le déploiement créé ailleurs listé, puis liste et déploiement restaurés ;
  - suppression faite sur l'autre appareil, reçue au pull ;
  - connexion à un compte qui a déjà des données : choix présenté, fusion, puis les deux listes sur le compte ;
  - mot de passe courant erroné sur un changement de mot de passe (message du serveur, appareil toujours connecté), puis suppression du compte depuis les Réglages (données locales conservées, retour à l'usage local).

  Non vérifié, ou écarts restants :
  - **environnement Android de développement ([[RT_71]])** : `environment.android-dev.ts` n'existe pas ; l'APK, servi depuis `https://localhost`, devra en outre être autorisé à appeler un serveur en HTTP (contenu mixte). Rien n'a été essayé sur appareil ;
  - **production ([[RT_71]])** : adresse non tranchée, `syncApiBaseUrl` vaut `null` et la synchronisation n'est pas proposée ;
  - **conflits non conservés au redémarrage** : ils sont gardés en mémoire ; un enregistrement en conflit reste modifié localement et est poussé de nouveau à chaque passe, ce qui représente le conflit après un redémarrage ;
  - **libellé de socle non résolu** : `unresolvedReason` ([[RG_02]]) est un libellé d'affichage local, hors du contrat ; une liste reçue d'un autre appareil ne le porte pas ;
  - vérifiés seulement par lecture et tests unitaires, pas en navigateur : `410` et pull complet, `413`, `426`, `429`, rejeu idempotent après une réponse perdue, résolution périmée (`409`), « modifié ici, supprimé ailleurs », « même plateau créé deux fois », remplacement à la première connexion, changement d'adresse.
- **[[RT_68]] / [[RT_69]] — écarts du contrat relevés à l'écriture du serveur, non tranchés.**
  - **Pull complet paginé après purge.** Un pull complet sans `since` renvoie les enregistrements actifs par révision croissante. Si le compte en compte plus d'une page dont la révision précède la plus haute trace purgée, le `nextToken` d'une page intermédiaire est inférieur à cette révision, et la page suivante reçoit `410` : le client boucle sur le pull complet. Le contrat ne permet pas d'y échapper (un seul `since` numérique, 500 enregistrements au plus par page) ; le client ne boucle pas : un second `410` pendant le pull complet remonte en erreur de synchronisation ([[RG_09]]). Pistes : laisser `since` vide sur toute la suite d'un pull complet et ajouter un curseur distinct, ou ne renvoyer `410` qu'à un `since` antérieur à une trace purgée qui concerne l'appareil. Le serveur applique le contrat à la lettre.
  - **Garder la version serveur d'un déploiement jamais écrit sur le serveur, dont la liste a été supprimée.** Le contrat exclut `localRecord` d'une résolution `keepServer`, alors que seul ce dernier désigne alors la liste du déploiement. Le serveur accepte `localRecord` (ou `localList`) dans ce cas et répond `400` s'il manque ; le client joint `localRecord` à toute résolution de ce conflit, quel que soit le choix.
  - **Statuts non déclarés.** Le serveur contrôle `X-Client-Version` et limite le débit sur toutes les routes, comme l'énonce [[RT_69]] ; `426` et `429` ne sont pourtant pas déclarés sur `/auth/logout`, `GET /account`, `/auth/me` (`426` non plus sur `/account/*`), ni `400` sur `/account/delete`.
- **[[RG_01]] — un seul format d'import.** Seul le roster JSON de [[RT_13]] est branché derrière [[RT_01]], ce qui satisfait le « à minima un export texte/JSON d'un list-builder tiers » de la règle. L'ajout d'un second format ne demande qu'une entrée supplémentaire dans la table des formats, sans toucher aux écrans.
- **[[RG_03]] étape 3 — aucune zone de déploiement matérialisée.** Choix de périmètre déjà assumé par la règle ; l'implémentation borne simplement les tokens au rectangle du plateau mesuré ([[RT_05]]), sans validation des règles de zone du jeu.
- **[[RT_26]] — 130 des 208 gabarits sont des estimations, pas des mesures.** La couverture des lignes `Use model` est complète (208/208) mais inégale : 78 entrées remontent à une mesure trouvée et citée — directement ou par un châssis partagé (Rhino, Predator, Land Raider, Leman Russ, Chimera, Baneblade, Drop Pod, Stompa, Thunderhawk, Manta, Trukk) — et les 130 autres sont des estimations, préfixées `estimation — ` dans leur `sourceNote`. Écart assumé et non bloquant — un gabarit approché reste exploitable pour planifier un déploiement — mais à résorber entrée par entrée : toute mesure réelle obtenue ultérieurement remplace l'estimation correspondante.
- **[[RT_12]] / [[RG_23]] / [[RT_27]] — image distante non re-mesurée.** Une image distante n'est acceptée qu'à dimensions identiques à la version embarquée, mais son `playArea` ([[RT_05]]) et son terrain ([[RT_37]]) ne sont pas recalculés côté client : si la source redessinait un plateau (cadre déplacé, ruines modifiées) sans changer les dimensions de l'image, les tokens resteraient bornés à l'ancien cadre et la zone visible ([[RG_29]]) serait calculée sur l'ancien terrain, jusqu'à régénération du référentiel (`ingest-boards.mjs` puis `ingest-terrain.mjs`). De même, un plateau nouvellement publié par la source n'apparaît qu'après cette régénération. Écart assumé : les corrections de la source sont surtout graphiques, et re-mesurer côté client demanderait de porter la détection du cadre et l'extraction du terrain dans l'application.
- **[[RT_12]] / [[RT_27]] — implémentées, vérifiées en navigateur.** La résolution réseau → cache → embarqué et le contrôle des dimensions (`src/app/referentials/board-image.service.ts`) sont couverts par des tests unitaires. Le chargement direct depuis gdmissions.app puis l'affichage depuis le cache hors-ligne ont été contrôlés dans le navigateur, pas sur appareil Android.
- **[[EX_07]] — socle de règles d'interface écrit, implémentation en cours.** [[RG_24]], [[RT_29]] à [[RT_32]] viennent d'être posées à partir d'un audit de l'application tournant en 375×812 dans les deux thèmes. L'implémentation les suit écran par écran ; tant qu'elle n'est pas achevée, les constats de cet audit restent vrais : 14 usages de `--ion-color-step-*` (non défini par le cadre d'interface dans aucun des deux thèmes, donc toujours rabattu sur un repli clair), `--ion-color-dark` employé comme couleur de texte sur des fonds blancs littéraux, surfaces d'alerte posées sans couleur de texte associée, 17 tailles de police ad hoc dont 12 sous le plancher de [[RT_30]], et une couleur de texte secondaire à 2,6:1 dans les deux thèmes. Contraste mesuré le plus bas : 1:1 sur les noms d'unité du menu de [[RG_16]], qui sont donc invisibles en thème sombre.
- **[[RT_31]] — grossissement du document désactivé globalement.** Le document désactive aujourd'hui le zoom du navigateur sur l'ensemble de l'application, alors que [[RT_19]] ne l'exige que sur le conteneur du plateau de l'écran de placement, où les gestes sont déjà neutralisés par la feuille de style. La restriction dépasse donc son périmètre et prive le joueur du grossissement système partout ailleurs. À résorber en même temps que la reformulation de [[RT_19]].
- **[[RT_37]] — deux socles reliés par un mur, sans contact noir, sont extraits comme un seul.** L'extraction réunit les socles accolés par un côté et sépare ceux qui ne se touchent que par un angle ([[RG_28]]) : 608 zones sur les 45 plateaux, de 11 à 16 par plateau. Sur quelques plateaux, un mur en cadre posé à cheval sur l'espace qui sépare deux socles les réunit aussi, alors que leurs contours noirs ne se touchent pas. Le mur relie physiquement les deux socles, ce qui rend la lecture défendable ; elle reste un écart à la lettre de [[RG_28]], à corriger à la main dans `terrain.json` si un joueur le signale. Le seuil qui distingue un côté d'un angle (12 px) est proche des mesures de part et d'autre (8 à 10 px pour un angle, 13 px pour le plus court côté) : une nouvelle version des images peut exiger de le recalibrer, ce que les images de contrôle du script permettent de vérifier.
- **[[RG_30]] / [[RG_31]] / [[RT_40]] — implémentées, non vérifiées en navigateur.** Le calcul de sélection (`src/app/deployment/selection.ts`) est couvert par des tests unitaires ; les gestes de l'écran de placement (rectangle, déplacement groupé, double appui) ont été contrôlés par compilation et non par un parcours manuel sur appareil tactile.
- **[[RG_32]] / [[RT_41]] — implémentées, vérifiées en navigateur par évènements de pointeur simulés.** La formation de la grappe (`src/app/deployment/cluster.ts`) est couverte par des tests unitaires. Le double appui, la saisie, le refus en bord de plateau et le dépôt groupé ont été contrôlés dans le navigateur avec des évènements de pointeur simulés, mais pas par un parcours manuel sur un appareil tactile.
- **[[RG_32]] — étendue de 9" non garantie pour les très grandes unités.** La grappe de [[RT_41]] est jointive, donc contiguë par construction, mais son diamètre croît avec l'effectif. Les effectifs usuels restent largement dans l'étendue (60 socles de 32 mm passent ; 40 socles de 40 mm ne passent plus), mais une unité nombreuse à grands socles peut la dépasser, et son dépôt est alors toujours refusé par [[RG_26]]. Le joueur doit dans ce cas poser l'unité en plusieurs fois.
- **[[EX_09]] / [[RG_33]] / [[RG_34]] / [[RG_35]] / [[RT_42]] / [[RT_43]] / [[RT_44]] — implémentées, vérifiées en navigateur par évènements de pointeur simulés.** Le calcul de la mesure (`measureInches`/`formatInches` de `src/app/deployment/geometry.ts`) est couvert par des tests unitaires. La mesure libre, la mesure d'un déplacement seul et groupé, l'effacement au premier appui, le déplacement libéré de la cohésion, la confirmation de sortie (annulation comprise), la garde du bouton retour et le maintien du contrôle hors mode ont été contrôlés dans le navigateur, en 1024 × 768 et en 375 × 812, mais pas par un parcours manuel sur appareil tactile.
- **[[RT_43]] — icône de règle hors du jeu d'icônes.** Le jeu d'icônes de l'application (Ionicons) ne contient pas de règle ; l'icône est un SVG propre au projet, `src/assets/icons/ruler.svg`, dessiné dans le même style au trait et rendu par le même composant d'icône. Le bouton est un bouton natif et non un bouton du cadre d'interface : ce dernier relit ses attributs `aria-*` liés dynamiquement avant d'être initialisé et lève alors une erreur.
- **[[RG_35]] — fermeture de l'application en mode « Règle ».** Le mode n'étant pas persisté et les déplacements libres étant écrits au relâchement, une application fermée mode actif laisse un déploiement dont des unités sont hors cohésion sans que le rétablissement de [[RG_35]] ait eu lieu. Au rechargement, ces unités sont traitées comme des unités déjà hors cohésion ([[RG_26]]) et ne sont pas retaillées. Écart assumé : le rendre impossible demanderait de différer l'écriture des déplacements jusqu'à la sortie du mode.
- **[[RG_36]] / [[RG_37]] / [[RT_45]] / [[RT_46]] — implémentées, vérifiées en navigateur par évènements de pointeur simulés.** Les contraintes structurelles, la lecture tolérante et les groupes de déploiement (`src/app/deployment/attachments.ts`), la lecture des associations ([[RT_13]]), la conversion à l'import et les vues du menu sont couverts par des tests unitaires. Dans le navigateur, en 1024 × 768, ont été contrôlés :
  - l'import de la liste de référence, avec ses deux unités attachées ;
  - les actions « Détacher » et « Attacher à… » du récapitulatif ;
  - l'entrée unique au bandeau et au menu ;
  - la cohésion commune (personnage refusé loin de son unité, accepté à son contact) ;
  - le double clic sur toute l'unité attachée ;
  - la bascule du bandeau ;
  - la grappe, puis l'avance automatique ;
  - la mise en réserve et le retrait de la réserve de toutes les composantes.

  La mise en réserve d'une unité attachée dont des tokens sont posés n'a été vérifiée que jusqu'à sa confirmation : le texte, qui compte les tokens de toutes les composantes, est conforme, mais l'alerte n'a pas pu être validée dans un navigateur sans rendu. Rien de tout cela n'a été vérifié par un parcours manuel sur appareil tactile.
- **[[RG_36]] — règles « peut mener » non contrôlées.** L'application ne vérifie ni qu'un personnage peut mener l'unité à laquelle il est attaché, ni le nombre de meneurs et de soutiens par unité escortée. Ces règles dépendent de chaque datasheet, et aucun référentiel embarqué ne les décrit. Écart assumé : le joueur fait autorité sur sa liste.
- **[[EX_11]] / [[RG_40]] / [[RT_50]] / [[RT_51]] / [[RT_52]] — implémentées, vérifiées en navigateur par évènements de pointeur simulés.** Le calcul (`src/app/import/unit-split.ts`) est couvert par des tests unitaires : seuil, répartition par défaut, passage et échange, erreurs sous le minimum, matérialisation, couleurs et attachements. La répartition est éditée par `src/app/pages/import/unit-split-editor.component.ts`. Dans le navigateur, en 1024 × 768, avec la liste de référence, ont été contrôlés : l'action « Scinder » proposée aux deux seules unités de 10 modèles ; la répartition par défaut 5 + 5 des Skitarii Rangers, l'arquebusier passant dans la seconde moitié ; un dépôt qui fait passer une moitié à 4, accepté, signalé et bloquant l'enregistrement ; l'échange de deux modèles ; la correction de l'erreur ; l'action sans geste ; l'enregistrement en deux unités aux couleurs distinctes. Le choix de la moitié qui reçoit les personnages attachés n'a été vérifié que par les tests unitaires, la liste de référence n'attachant aucun personnage à une unité de 10 modèles. La disposition en largeur mobile et le geste au doigt n'ont pas été vérifiés par un parcours manuel.
- **[[EX_10]] / [[RG_38]] / [[RG_39]] / [[RT_47]] / [[RT_48]] / [[RT_49]] — implémentées, vérifiées en navigateur par évènements de pointeur simulés.** Le calcul des bornes du décalage (`clampViewOffset` de `src/app/deployment/geometry.ts`) est couvert par des tests unitaires. Dans le navigateur, en 1024 × 768, ont été contrôlés : la bascule ×1 / ×2 et son cadrage centré, le bouton « Déplacement » désactivé au zoom de base et son mode quitté au retour à ×1, le déplacement de vue en mode actif depuis un token (token inchangé) et au bouton du milieu hors mode, les bornes du décalage, la mesure de la règle conservée par le déplacement de vue et le bouton d'agrandissement puis effacée par un appui ordinaire, la justesse de la mesure et du dépôt depuis le bandeau après décalage, et le refus d'un dépôt sur la partie masquée. La rangée de boutons a été vue en 375 × 812. Le défilement automatique du clic molette, la forme effective du curseur et le geste au doigt n'ont pas été vérifiés par un parcours manuel.
- **[[RG_38]] / [[RG_39]] / [[RT_47]] / [[RT_48]] / [[RT_49]] — cycle ×1 → ×2 → ×4 et activation d'office du mode « Déplacement » : implémentés, vérifiés par un test de bout en bout.** Le cycle des niveaux et le décalage après changement de niveau (`nextZoomLevel`, `zoomViewOffset` de `src/app/deployment/geometry.ts`) sont couverts par des tests unitaires, y compris le maintien dans les bornes de ×4 d'un décalage doublé depuis la borne de ×2. `cypress/e2e/board-zoom.cy.ts` contrôle, en taille de téléphone : les noms accessibles et le libellé « ×2 » / « ×4 » à chaque niveau, l'échelle de la surface (×2 puis ×4 de la base), le mode « Déplacement » activé à l'entrée dans ×2, désactivé à la main puis réactivé par l'entrée dans ×4, et le retour direct au zoom de base, mode désactivé et décalage nul. Le cadrage conservé au passage de ×2 à ×4 après un déplacement de vue, et la clôture d'un maintien du bouton du milieu lors d'un changement de niveau, ne sont vérifiés que par lecture du code et les tests unitaires ; le geste au doigt à ×4 n'a pas été vérifié par un parcours manuel.
- **[[RT_49]] — loupes hors du jeu d'icônes.** Ionicons ne contient pas de loupe « + » / « − » ; les icônes sont des SVG propres au projet, `src/assets/icons/zoom-in.svg` et `zoom-out.svg`, dérivés de sa loupe et rendus par le même composant d'icône que la règle de [[RT_43]].

# Spécification — 40K Deployment Planner

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

Satisfait par : [[RG_01]], [[RG_02]], [[RG_13]], [[RG_22]], [[RT_01]], [[RT_02]], [[RT_13]], [[RT_26]], [[RT_28]].

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

Une fois le fichier importé interprété avec succès ([[RG_01]]) et chaque unité résolue vers un socle ([[RG_02]]), l'application affiche un récapitulatif — nombre d'unités, nombre de modèles et socles associés par unité — avant d'enregistrer la liste. Le nom de la liste, pré-rempli à partir de la donnée source (`roster.name`, [[RT_13]]), reste modifiable par le joueur sur cet écran. La liste n'est persistée qu'après validation explicite de ce récapitulatif ; le joueur peut aussi l'annuler, auquel cas rien n'est enregistré.

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

Lorsque le roster déclare plusieurs `forces`, les sélections de toutes les forces contribuent à la liste déployée, la disposition de force n'étant elle déclarée qu'une seule fois. Le reste de l'arborescence (`rules`, `profiles`, `categories`, coûts en points, mots-clés d'armes...) est ignoré par ce parseur : seuls `roster.name`, le nœud `"Force Disposition"`, les champs `name`/`number`/`type` des sélections de premier niveau et de leurs enfants directs de `type = "model"`, et le `name` des `type = "upgrade"` portés par ces modèles sont consommés. Ce format ne fournit pas la forme/taille de socle : celle-ci reste résolue séparément via [[RG_02]]/[[RT_02]] à partir du nom d'unité extrait ci-dessus.

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

---

## EX_02 — Planification du déploiement sur plateau

Le joueur doit pouvoir positionner ses unités sur une représentation du plateau de jeu, en tenant compte de la disposition de force qu'il a choisie pour la partie.

Satisfait par : [[RG_03]], [[RG_04]], [[RG_05]], [[RG_12]], [[RG_14]], [[RG_15]], [[RG_16]], [[RG_17]], [[RG_20]], [[RT_03]], [[RT_04]], [[RT_11]], [[RT_12]], [[RT_16]], [[RT_17]], [[RT_18]], [[RT_19]], [[RT_22]], [[RT_23]], [[RT_24]], [[RT_27]], [[RT_34]], [[RG_25]], [[RT_35]], [[RG_26]], [[RT_36]].

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

**Présentation à l'écran.** Les 3 plateaux sont présentés un par un, dans un pager glissable horizontalement (un seul plateau visible à la fois) plutôt que juxtaposés côte à côte. Dans cette présentation, un unique bloc « Statut » et un unique jeu d'actions contextuelles sont affichés — en haut à droite du layout, immédiatement à droite du libellé « Statut » — et ne reflètent jamais que le plateau actuellement affiché par le pager ; ce statut individuel par plateau reste distinct de l'indicateur agrégé sur les 3 plateaux calculé à l'étape 1 ([[RG_12]]).

**Second canal et identification du plateau ([[RG_24]]).** Le libellé de statut affiché dans le bloc « Statut » — « Déploiement manquant », « Déploiement non fini », « Déploiement fait » — est le second canal de ce code couleur, et l'application ne présente jamais le statut du plateau affiché sans lui. Les pastilles de navigation du pager, trop petites pour porter ce libellé, ne sont pas les porteuses du statut : elles reprennent sa couleur en rappel, exposent le libellé complet par leur nom accessible, et le numéro qu'elles portent désigne le plateau, pas son état.

Le plateau affiché est par ailleurs **identifié une seule fois** par cet écran, sous le pager, dans le même sens de lecture que le bandeau des deux dispositions qui le surmonte (la disposition du joueur d'abord, celle de l'adversaire ensuite) : une identification répétée, et *a fortiori* dans un ordre différent d'une occurrence à l'autre, empêche le joueur de savoir laquelle des deux dispositions est la sienne. Le bandeau de titre imprimé dans l'image du plateau par la source ([[RT_12]]) n'est pas une identification produite par l'application et ne compte pas comme telle ; il est masqué du cadrage de l'aperçu, sur le même principe que le rognage déjà retenu à l'écran de placement ([[RG_17]]/[[RT_19]]).

**Consultation du plateau seul, avec mesures.** Indépendamment du statut (y compris rouge), le joueur peut cliquer sur l'aperçu de chaque plateau pour l'afficher en plein écran avec les repères de mesure superposés (variante « with-measurements » de [[RT_12]]), avec possibilité de zoomer/dézoomer ; cette vue ne montre jamais les placements du joueur, seulement le plateau vierge, et sert à étudier le layout avant de s'engager sur un déploiement. L'invite indiquant que l'aperçu est agrandissable est placée en dehors de l'image, la légende imprimée en pied de celle-ci par la source ([[RT_12]]) étant un contenu porteur d'information qu'aucun élément superposé ne doit recouvrir ([[RT_31]]).

**Actions contextuelles, selon le statut :**

- **« Nouveau »** : toujours disponible, y compris quand un déploiement existe déjà (orange ou vert). Écrase le déploiement existant du triplet (remise à zéro des placements et des unités en réserve de [[RG_25]]) et ouvre l'écran de placement ([[RG_03]] étape 3) vide. Une action destructrice de ce type est confirmée explicitement par le joueur avant d'écraser quoi que ce soit, sur le même principe que [[RG_08]]. L'identifiant du déploiement du triplet ([[RT_07]]) est conservé (mise à jour en place, cf. [[RG_07]]) ; une sauvegarde distincte n'est créée que si le joueur choisit ensuite explicitement d'enregistrer sous un nouveau nom.
- **« Éditer »** : disponible uniquement quand un déploiement existe déjà pour ce triplet (statut orange ou vert) ; masqué/désactivé au statut rouge. Ouvre l'écran de placement préchargé avec les placements existants. Ce bouton est affiché en **orange** lorsque le déploiement existant est non fini, pour renforcer le signal donné par le statut du plateau.
- **« Consulter »** : disponible uniquement quand le déploiement de ce triplet est **terminé** (statut vert) ; masqué/désactivé aux statuts rouge et orange — un déploiement encore en cours de remplissage se reprend via « Éditer », pas via cette vue en lecture seule. Affiche en plein écran, zoomable, le plateau avec les placements du joueur superposés, en lecture seule (aucune édition possible), en utilisant cette fois la variante du plateau **sans** repères de mesure (« no-measurements » de [[RT_12]]).

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

### RG_15 — Sélecteur d'unité à placer (bandeau bas d'écran)

L'écran de placement ouvert par l'étape 3 de [[RG_03]] (y compris via les actions « Nouveau »/« Éditer » de [[RG_14]]) affiche, ancré en bas de l'écran, un bandeau de sélection de l'unité en cours de placement, regroupant dans un même encadré :

- le **nom de l'unité** couramment sélectionnée ;
- une **flèche de part et d'autre** du bandeau permettant de passer à l'unité précédente/suivante de la liste, sans avoir à repasser par le menu détaillé de [[RG_16]] ;
- une **case à cocher « en réserve »** portant sur l'unité couramment sélectionnée ([[RG_25]]) : c'est le seul endroit d'où la réserve se déclare et d'où elle se retire ;
- la **liste des modèles individuels** de l'unité sélectionnée, disponibles au drag & drop un par un vers le plateau, conformément à [[RG_04]] (un token = un modèle) : une unité de 10 modèles présente ainsi 10 éléments distincts dans cette liste, jamais un seul élément représentant l'unité entière. Cette liste est **défilable horizontalement** pour rester ergonomique quel que soit le nombre de modèles de l'unité (voir [[RT_17]]).

Le bandeau ne liste que ce qu'il **reste à poser** : un modèle déposé sur le plateau en **sort immédiatement**, et une unité dont tous les modèles sont placés — ou qui est en réserve ([[RG_25]]) — n'est plus atteignable par les flèches du bandeau. Le bandeau répond ainsi à la seule question qu'il pose — « que me reste-t-il à déployer ? » (cf. [[RG_05]]) — sans que le joueur ait à distinguer, parmi des socles tous affichés, ceux qui sont déjà sur la table ; une liste qui se vide au fil des dépôts énonce du même coup l'avancement de l'unité.

Le passage à l'unité suivante est **automatique** dès que le dernier modèle de l'unité courante est posé : le bandeau bascule sur l'unité encore en attente qui suit, pour que le joueur enchaîne ses placements sans manipuler les flèches. Lorsque plus aucune unité n'est en attente, le bandeau reste sur l'unité courante et signale qu'elle est complète. À la réouverture d'un déploiement déjà commencé, le bandeau s'ouvre de la même façon sur la première unité encore en attente, et non sur la première unité de la liste.

Le **repositionnement** d'un modèle déjà posé se fait alors sur le plateau lui-même, en faisant glisser son token ([[RG_04]]), et son retrait par l'action prévue à cet effet ([[RG_20]]) — qui le fait réapparaître dans le bandeau, l'unité redevenant en attente au sens de [[RG_05]]. Le menu de [[RG_16]], lui, continue de lister **toutes** les unités, y compris celles qui sont complètes : c'est la vue d'ensemble du déploiement, et y choisir une unité complète reste possible — le bandeau s'y positionne et affiche qu'elle n'a plus rien à poser.

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

### RG_17 — Affichage du plateau à taille maximale, zoom fixe non pilotable par le joueur

Sur l'écran de placement ([[RG_03]] étape 3), le plateau est affiché à la plus grande taille possible dans l'espace disponible (sous le bandeau de [[RG_15]] et sous l'accès au menu burger de [[RG_16]]), à un **niveau de zoom fixe déterminé automatiquement** par l'application. Contrairement aux visualiseurs de consultation plein écran de [[RG_14]] (« plateau seul » et « Consulter », zoomables/déplaçables au doigt — [[RT_16]]), ce zoom n'est **ni réglable ni déplaçable par le joueur** sur l'écran de placement : pas de pincer-zoomer, pas de pan, pas de défilement du plateau lui-même. Seuls les tokens y sont manipulables, par drag & drop ([[RG_04]]).

Tout ce qui entoure le rectangle de jeu dans l'image du plateau ([[RT_05]] : bandeau de titre en haut, pied de légende en bas, marges latérales) est **rogné** de cet affichage — voir [[RT_19]] pour le calcul — car cela ne porte plus d'information utile une fois liste, disposition adverse et plateau déjà choisis, et réduisait d'autant la taille utile du plateau à l'écran.

### RT_03 — Rendu du plateau et des tokens

Le plateau et les tokens sont rendus via SVG, pour un rendu net à n'importe quelle échelle — notamment au niveau de zoom fixe calculé par [[RT_19]] — et un drag-and-drop tactile précis des tokens sur mobile, sans perte de précision de positionnement. Contrairement aux visualiseurs de consultation ([[RT_16]]), le conteneur du plateau sur l'écran de placement n'expose aucun geste de zoom/pan piloté par le joueur (voir [[RG_17]]) : seul le déplacement des tokens est interactif. Le retour visuel de ce déplacement pendant le geste — token suivant le doigt ou le curseur — est décrit par [[RT_34]].

### RT_04 — Modèle de données de placement

Un placement est stocké comme un enregistrement `{ idUnite, idModele, x, y, rotation }` indépendant des autres modèles de la même unité, afin que RG_04 et RG_05 puissent être vérifiées par simple comptage/filtrage sans recalcul géométrique. Le champ `rotation` est celui manipulé par [[RG_20]]/[[RT_22]]. La mise en réserve d'une unité ([[RG_25]]) ne fabrique **aucun** enregistrement de placement : elle est stockée à part, sur le déploiement, par [[RT_35]] — la liste des placements reste ainsi le reflet exact de ce qui est posé sur le plateau.

### RT_22 — Interaction de rotation d'un token

La rotation d'un token sélectionné ([[RG_20]]) se pilote par un geste dédié (poignée de rotation affichée sur le token sélectionné, ou geste tactile à deux doigts) superposé au rendu SVG du plateau ([[RT_03]]) ; elle met à jour le seul champ `rotation` de l'enregistrement de placement ([[RT_04]]) sans toucher à `x`/`y`.

### RT_34 — Retour visuel du geste de glisser d'un token

**Principe.** Tout glisser de token de l'écran de placement est matérialisé **sous le point de contact, pendant toute la durée du geste** : le token suit le doigt (ou le curseur) du premier contact au relâchement, plutôt que de n'exister qu'une fois déposé. Sans ce retour, le glisser d'un modèle depuis le bandeau de [[RG_15]] ne produit aucun changement visible avant le dépôt : rien ne distingue un glisser en cours d'un appui sans effet, et le joueur ne voit pas où son modèle va se poser avant qu'il ne s'y trouve.

**Glisser depuis le bandeau ([[RG_15]]/[[RT_17]]).** Aucun enregistrement de placement ([[RT_04]]) n'est créé avant le relâchement — la règle reste inchangée : le retour est un **rendu seul**, sans écriture ni sauvegarde ([[RG_07]]) pendant le geste. Le token provisoire est dessiné dans la forme et la couleur du socle concerné ([[RG_06]], [[RT_05]]), **à la taille exacte qu'il aura une fois posé**, pour que le joueur juge l'emprise réelle du socle sur le plateau avant de lâcher. Il est rendu **hors du conteneur rogné** du plateau ([[RT_19]]) afin de rester visible tant que le doigt n'a pas encore quitté le bandeau. L'élément d'origine dans le bandeau s'affiche pendant ce temps comme **saisi** (et non retiré : le retirer rétrécirait la rangée sous le doigt, ce qu'interdit [[RT_33]]).

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

**Contrôle pendant le geste.** Lors d'un dépôt ou d'un déplacement ([[RT_34]]), la cohésion est recalculée à chaque mouvement du point de contact, avec le token saisi à sa position provisoire. Un résultat hors cohésion met le token provisoire et son cercle de visée dans le même état de **dépôt refusé** qu'une sortie du rectangle de jeu ; au relâchement, aucun enregistrement de placement n'est écrit ([[RT_04]]) et un token déjà posé reprend sa position d'avant le geste. La rotation ([[RT_22]]) suit le même contrôle. Pour une unité déjà hors cohésion au début du geste (déploiement antérieur à [[RG_26]]), aucun geste n'est refusé.

**Retrait.** Au retrait d'un token, les composantes connexes du graphe restant sont calculées. S'il y en a plus d'une, la plus grande est conservée ; en cas d'égalité, celle qui contient le placement le plus ancien. Le placement le plus ancien est déterminé par l'ordre des enregistrements de placement du déploiement, qui suit l'ordre des dépôts. Les placements des autres composantes sont supprimés dans la même écriture que celui du token retiré, après confirmation du joueur.

### RT_11 — Calcul des indicateurs de déploiement existant

Les indicateurs prévus par [[RG_12]] sont calculés en interrogeant les déploiements sauvegardés en local ([[RT_06]]), avant l'affichage de l'écran correspondant, sans appel réseau (conformément à [[EX_05]]), et recalculés à chaque affichage de l'étape pour refléter les sauvegardes les plus récentes :

- **Étape 2 (choix du plateau)** : filtrage sur le triplet (identifiant de liste, identifiant de disposition adverse choisie à l'étape 1, identifiant de plateau). Si aucun déploiement n'existe pour ce triplet, ou s'il ne porte ni placement ni unité en réserve ([[RG_25]]/[[RT_35]]), le statut est **Rouge** ([[RG_14]]). Sinon, le nombre de placements enregistrés ([[RT_04]]) est comparé, pour chaque unité de la liste, au nombre de modèles de l'unité (issu de [[RG_02]]), une unité en réserve étant tenue pour complète sans comparaison : toutes les unités complètes donnent le statut **Vert**, sinon **Orange**.
- **Étape 1 (choix de la disposition adverse)** : pour chacune des 5 dispositions adverses candidates, filtrage sur le couple (identifiant de liste, identifiant de disposition adverse candidate) sur les 3 plateaux qui lui sont associés. Pour chaque déploiement sauvegardé trouvé, le statut terminé/non terminé est déterminé en comparant, pour chaque unité de la liste, le nombre de placements enregistrés ([[RT_04]]) au nombre de modèles de l'unité (issu de [[RG_02]]), les unités en réserve ([[RG_25]]/[[RT_35]]) étant tenues pour complètes. Le code couleur du bouton de disposition en résulte selon l'ordre de priorité défini en [[RG_12]] (Orange > Vert > Jaune > Blanc).

### RT_23 — Référentiel des dispositions de force

Les 5 dispositions de force manipulées par [[RG_03]] (étapes 1 et 2) sont un référentiel statique embarqué (identifiant, libellé textuel, icône), au même titre que les référentiels de socles ([[RT_02]]) et de plateaux ([[RT_12]]) — et non une simple énumération de chaînes de caractères codée en dur dans les écrans. Les 5 identifiants retenus sont `take-and-hold`, `purge-the-foe`, `reconnaissance`, `priority-assets` et `disruption` ; ils servent aussi de clé de rapprochement avec les noms d'assets du référentiel de plateaux ([[RT_12]]). Contrairement à [[RT_02]] et [[RT_12]], ce référentiel n'est pas dérivé d'une source tierce : il est écrit à la main et n'ouvre donc droit à aucune attribution ([[RT_20]]). L'icône y est stockée sous forme de tracés vectoriels, pour être rendue sans dépendance à un jeu d'icônes externe et rester disponible hors-ligne. Ce référentiel fait correspondre le libellé texte extrait d'un import ([[RT_13]]) à un identifiant stable de disposition, et fournit l'icône affichée par les différents sélecteurs de disposition de l'application (récapitulatif d'import [[RG_22]], choix de la disposition adverse, en-tête du choix de plateau).

### RT_12 — Référentiel des plateaux (Battlemaster / gdmissions.app)

**Décision (précédemment « généré hors-ligne, jamais par appel réseau à l'exécution ») : chargement réseau à l'exécution, sans bundling.** Contrairement à [[RT_02]], les images de plateau ne sont **plus** livrées comme donnée statique versionnée avec l'application : ces layouts ont vocation à évoluer côté source (Battlemaster/gdmissions.app peut corriger un plateau ou en publier de nouveaux), et les figer au moment du build exposerait le joueur à une version qui se périme au fil des mises à jour du site — contrairement au référentiel de socles ([[RT_02]]), dont les valeurs n'ont pas cette volatilité. Chaque image nécessaire (étape 2 de [[RG_03]], écran de placement, visualiseurs plein écran de [[RG_14]]) est donc obtenue par un appel réseau au moment de l'affichage, directement vers les URLs statiques publiées sur [gdmissions.app](https://gdmissions.app/11th/layouts) sous `/assets/11th/layouts/{no-measurements|with-measurements}/`, plutôt que via un script d'ingestion préalable qui les aurait recopiées dans le build (contrairement à l'ancienne approche, encore décrite par `scripts/ingest-boards.mjs` — ce script est obsolète pour la livraison des images et à faire évoluer, voir la décision ouverte ci-dessous). Le résultat de chaque appel réussi est mis en cache localement pour rester utilisable hors-ligne par la suite ([[RT_27]]) ; un échec (hors-ligne ou source injoignable) sans version en cache se traduit par le blocage explicite prévu par [[RG_23]], plutôt qu'un plateau blanc silencieux.

**Convention de nommage réellement constatée** (vérifiée au 2026-09-10, 45 plateaux = 15 couples × 3 ; l'algorithme ci-dessous, auparavant exécuté par le script d'ingestion, s'exécute désormais côté client au moment de la résolution des URLs à appeler) :

- le nom de fichier encode un couple **non ordonné** — il n'y a pas de « disposition du joueur » puis « adversaire », mais un seul des deux ordres possibles publié pour chaque paire (par exemple `disruption-vs-priority-assets-1`, sans contrepartie `priority-assets-vs-disruption-1`). Le référentiel indexe donc les couples par une clé normalisée indépendante de l'ordre : le même triplet d'images sert quel que soit le camp du joueur ;
- `{disposition}-mirror-{1|2|3}` lorsque les deux dispositions sont identiques ;
- le suffixe `-portrait` est présent sur **certains assets seulement** (et concerne indifféremment les paires croisées et les miroirs) : il désigne les layouts dont les zones de déploiement courent le long des bords latéraux plutôt que des bords haut/bas. Il fait partie du nom de fichier, pas d'une variante à choisir ;
- les deux variantes `no-measurements` et `with-measurements` réutilisent **exactement le même nom de fichier**.

Plutôt que de figer ces conventions, le client énumère les noms candidats pour le triplet demandé (les deux ordres possibles, avec et sans `-portrait`) et tente les appels réseau correspondants jusqu'à en obtenir un qui répond ; si aucun candidat ne répond alors que l'appareil est en ligne, cela signalerait un changement de convention côté source plutôt qu'une simple absence de réseau, et est traité comme tel (message d'erreur distinct de celui de [[RG_23]], qui lui suppose l'absence de réseau). Ces données sont elles-mêmes sourcées par gdmissions.app auprès de Battlemaster (battlemaster.online) et non garanties par une API stable ; toute utilisation publique de ces plateaux doit créditer **Battlemaster** (battlemaster.online) — mention reprise par le bloc « Mentions des sources tierces » de l'écran Réglages ([[RG_18]], [[RT_20]]), qui reste embarquée dans l'application indépendamment du fait que les images elles-mêmes ne le soient plus.

---

## EX_03 — Représentation fidèle des socles

Les tokens affichés doivent respecter la forme et la taille réelle du socle de chaque unité, et permettre de distinguer visuellement les unités entre elles.

Satisfait par : [[RG_02]], [[RG_06]], [[RT_05]], [[RT_32]].

### RG_06 — Couleur par unité

Chaque unité importée se voit attribuer une couleur distincte (automatiquement, avec possibilité de réassignation manuelle par le joueur) ; tous les tokens d'une même unité partagent cette couleur pour rester identifiables sur un plateau chargé.

Les couleurs proposées au joueur pour une réassignation sont désignées par un libellé lisible en français accompagné d'un aperçu de la couleur, jamais par leur notation technique.

### RT_05 — Échelle des tokens

La taille d'un token à l'écran est calculée au pixel près à partir du diamètre réel du socle (en mm) et de l'échelle courante du plateau affiché, pour que deux socles de tailles différentes restent proportionnellement corrects à tout niveau de zoom.

**Calibrage millimètres → pixels.** Les images du référentiel [[RT_12]] ne contiennent pas que le plateau : elles portent un bandeau de titre et un pied de légende. Les dimensions de l'image (1653×2833, cf. [[RT_19]]) ne donnent donc pas l'échelle. Le rectangle du plateau dans l'image (`playArea`, détecté par son rapport de forme 44″×60″) doit être connu pour en déduire l'échelle par rapport à la taille physique du plateau (`boardInches`, 44″ × 60″, valeur également imprimée en pied des images) — soit ≈ 1,007 px d'asset par millimètre réel. Deux gabarits d'image coexistent (layouts standards et layouts `-portrait`), dont les rectangles diffèrent de ~0,5 %. Tant que [[RT_12]] produisait sa donnée par ingestion hors-ligne, cette mesure était faite une fois par asset au moment de l'ingestion et enregistrée dans le référentiel ; son passage en chargement réseau à l'exécution ([[RT_12]]) retire l'étape offline qui la portait — la façon dont `playArea` est désormais obtenue (les deux constantes par gabarit, standard/`-portrait`, suffisent-elles à la précision déjà tolérée de ~0,5 %, ou faut-il une détection du cadre côté client à chaque image chargée) est un choix technique encore ouvert, voir « Suivi des décisions non tranchées ».

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

Satisfait par : [[RG_07]], [[RG_08]], [[RG_21]], [[RT_06]], [[RT_07]].

Les déploiements sauvegardés ne sont pas présentés sur un écran séparé : le joueur les retrouve en cliquant sur sa liste depuis la bibliothèque des listes importées de l'écran d'accueil ([[RG_18]]), puis en suivant le même cheminement que pour un nouveau déploiement ([[RG_03]]) : choix de la disposition adverse (étape 1, indicateur [[RG_12]]) → choix du plateau parmi les 3 layouts proposés (étape 2) → bouton **« Consulter »**, qui n'apparaît que lorsque le statut du plateau est **vert**, c'est-à-dire le déploiement terminé ([[RG_14]]) — ou bouton **« Éditer »**, déjà visible au statut orange, pour reprendre un déploiement encore en cours de remplissage.

### RG_07 — Sauvegarde nommée

Un déploiement sauvegardé conserve un nom (par défaut : liste + plateau + date), la référence à la liste d'armée importée, le plateau et la disposition choisis, et l'ensemble des placements. Toute modification ultérieure du déploiement est enregistrée comme mise à jour de la même entrée, sauf sauvegarde explicite "sous un nouveau nom".

### RG_08 — Suppression

La suppression d'un déploiement sauvegardé est une action confirmée explicitement par le joueur et ne supprime jamais la liste d'armée associée, qui peut être réutilisée pour d'autres déploiements.

### RG_21 — Suppression et duplication d'une liste d'armée

Le joueur peut supprimer ou dupliquer une liste d'armée importée directement depuis l'accueil ([[RG_18]]), indépendamment de la suppression d'un déploiement sauvegardé ([[RG_08]]) :

- **Suppression** : action confirmée explicitement par le joueur (sur le même principe que [[RG_08]]). Si des déploiements sauvegardés référencent cette liste ([[RT_07]]), le joueur en est informé avant confirmation, et ces déploiements sont supprimés avec elle (suppression en cascade) plutôt que laissés en entrées orphelines.
- **Duplication** : crée une copie indépendante de la liste, avec son propre identifiant stable ([[RT_07]]) et son propre nom (par défaut « nom d'origine (copie) », modifiable) ; la copie démarre sans aucun déploiement associé, au même titre qu'une liste nouvellement importée.

### RT_06 — Persistance locale des déploiements sauvegardés

Les déploiements sauvegardés sont persistés localement **en IndexedDB** (décision prise, voir [[RT_08]]) sous forme d'enregistrements indexés par identifiant de déploiement, pour un accès sans dépendre du réseau. Le store `deployments` porte un index secondaire sur `listId` ([[RT_07]]), qui est la clé de filtrage de tous les indicateurs de [[RT_11]].

### RT_07 — Clé de liaison liste/déploiement

La liaison entre un déploiement et sa liste d'armée d'origine utilise un identifiant stable de la liste (et non son contenu), afin qu'une liste modifiée après coup n'invalide pas les déploiements déjà sauvegardés qui la référencent.

---

## EX_05 — Fonctionnement hors-ligne

L'application doit rester pleinement utilisable sans connexion réseau pour la planification et la consultation des déploiements sauvegardés, qui ne dépendent pas d'un accès serveur. L'import d'une nouvelle liste fait exception à ce principe (voir [[RG_13]]), de même que l'affichage d'un plateau jamais chargé en ligne auparavant (voir [[RG_23]]). Lorsque l'application ressort du mode hors-ligne, une éventuelle divergence entre les données locales et celles du serveur doit être arbitrée par le joueur, jamais résolue silencieusement (voir [[RG_11]]).

Satisfait par : [[RG_09]], [[RG_11]], [[RG_13]], [[RG_23]], [[RT_08]], [[RT_14]], [[RT_15]], [[RT_27]].

### RG_09 — Dégradation gracieuse du réseau

Toute fonctionnalité qui nécessite le réseau (synchronisation de compte notamment) échoue silencieusement en arrière-plan sans bloquer ni interrompre le travail en cours du joueur ; l'état "non synchronisé" reste visible mais non bloquant.

### RG_13 — Import de liste indisponible hors-ligne

L'import d'une nouvelle liste d'armée ([[RG_01]]) n'est pas proposé hors-ligne : contrairement aux autres fonctionnalités couvertes par [[EX_05]] (planification, déploiements sauvegardés), qui restent pleinement utilisables sans réseau, l'import est une restriction fonctionnelle volontaire. Si le joueur tente de lancer un import alors que l'application est hors-ligne, l'import est bloqué avant toute tentative de parsing et un message explicite informe le joueur que cette action nécessite une connexion réseau, en l'invitant à réessayer une fois reconnecté. Les listes déjà importées restent consultables et utilisables hors-ligne sans restriction.

### RG_23 — Disponibilité hors-ligne d'un plateau conditionnée à un premier chargement en ligne

Les images de plateau ne sont plus livrées avec l'application mais chargées par appel réseau au moment où elles sont nécessaires ([[RT_12]]), pour que le joueur voie toujours la version la plus à jour publiée par la source (voir [[RT_12]]). Cela introduit une seconde exception, après l'import ([[RG_13]]), au principe d'usage hors-ligne complet de [[EX_05]] : un plateau que le joueur n'a **jamais** affiché avec succès pendant qu'il était en ligne (étape 2 de [[RG_03]], écran de placement, ou l'un des visualiseurs de [[RG_14]]) ne peut pas être affiché hors-ligne — l'étape ou l'écran concerné affiche un message explicite invitant le joueur à se reconnecter, sur le même principe que [[RG_13]], plutôt qu'un plateau blanc ou une erreur silencieuse.

À l'inverse, un plateau déjà chargé avec succès une fois reste disponible hors-ligne indéfiniment par la suite (mise en cache locale, [[RT_27]]) : reprendre hors-ligne un déploiement déjà commencé sur un plateau déjà consulté — le cas d'usage central de [[EX_05]] — continue donc de fonctionner sans réseau, seul un plateau **encore jamais vu** sur cet appareil exige une connexion. Cette restriction ne s'applique qu'aux images de plateau : la liste des 5 dispositions ([[RT_23]]) et le référentiel de socles ([[RT_02]]) restent des données embarquées, disponibles hors-ligne dès l'installation.

### RT_08 — Stockage local

Les données de l'application (listes importées, référentiel de socles, déploiements sauvegardés) sont persistées via le stockage local du terminal (IndexedDB en environnement web ; `@capacitor/preferences` ou équivalent pour les données de configuration légères sur mobile natif), lu/écrit systématiquement avant toute tentative de synchronisation réseau.

**Répartition retenue.** Les enregistrements métier (listes, déploiements, et les marqueurs de suppression à pousser au prochain sync, cf. [[RT_15]]) vont en IndexedDB, un store par type, indexés par identifiant ([[RT_06]]). Les données de configuration légères — session obtenue par [[RT_21]], jeton de version de [[RT_15]], horodatage du dernier sync — passent par une paire d'accesseurs dédiée, aujourd'hui adossée à `localStorage` en web ; c'est le seul point à réimplémenter pour `@capacitor/preferences` sur mobile natif, aucun appelant n'ayant à changer. Toute indisponibilité du stockage de configuration (navigation privée, quota) est absorbée silencieusement : l'application reste utilisable en usage local ([[RG_10]]), simplement sans session mémorisée. Les référentiels réellement statiques ([[RT_02]], [[RT_23]]), eux, ne sont pas recopiés en base : ils sont livrés comme fichiers d'assets et lus une fois par session, ce qui permet de les remplacer indépendamment du code lors d'une mise à jour d'errata. Le référentiel de plateaux ([[RT_12]]) n'entre plus dans cette dernière catégorie depuis son passage en chargement réseau à l'exécution : les images obtenues par [[RT_12]] sont mises en cache dans un store séparé, dédié à ce cache, décrit par [[RT_27]].

### RT_27 — Cache local des plateaux chargés par le réseau

**Principe.** Chaque image de plateau obtenue avec succès par [[RT_12]] (variantes `no-measurements` et `with-measurements` d'un même triplet) est copiée dans un cache local dédié — Cache API du navigateur (adaptée au stockage de réponses HTTP binaires) ou, à défaut de disponibilité sur la cible, un store IndexedDB dédié aux blobs d'images — distinct des stores d'enregistrements métier de [[RT_08]]. Cette copie sert de source pour tout affichage ultérieur de ce même triplet sur cet appareil, en ligne comme hors-ligne, et fonde la garantie de [[RG_23]].

**Politique de fraîcheur.** Un triplet déjà en cache n'empêche pas une tentative de rechargement réseau à chaque nouvelle visite de l'écran qui l'affiche : si l'appareil est en ligne, l'appel réseau de [[RT_12]] est retenté et, en cas de succès, remplace silencieusement la version en cache (l'image affichée peut donc changer d'une session à l'autre si la source a été mise à jour) ; en cas d'échec réseau (hors-ligne ou source injoignable), la version en cache déjà présente est utilisée sans interrompre le joueur, et c'est seulement l'absence de toute version en cache qui déclenche le blocage prévu par [[RG_23]]. Il n'y a pas de purge automatique du cache par ancienneté : un plateau une fois vu reste disponible hors-ligne tant que l'application n'est pas désinstallée ou son stockage vidé par le joueur.

### RT_14 — Détection de connectivité pour le blocage de l'import

L'état de connectivité réseau est surveillé côté client (`@capacitor/network` sur mobile natif ; évènements `online`/`offline` du navigateur en environnement web) pour piloter le point d'entrée d'import : celui-ci est désactivé (ou son déclenchement intercepté) et le message prévu par [[RG_13]] est affiché tant que l'application est détectée hors-ligne, sans attendre l'échec d'un appel réseau.

### RT_15 — Détection de conflit à la resynchronisation

Chaque enregistrement synchronisable (déploiement, cf. [[RT_04]]/[[RT_07]]) conserve localement le jeton de version ([[RT_09]]) reçu lors de sa dernière synchronisation réussie. Au retour en ligne ([[RT_10]]), pour tout enregistrement modifié localement depuis ce jeton, le client compare son jeton local au jeton courant renvoyé par le serveur pour ce même enregistrement : s'ils divergent, un conflit est déclaré et l'interface de choix prévue par [[RG_11]] est présentée pour cet enregistrement précis, sans bloquer la synchronisation des autres enregistrements non conflictuels.

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

Aucune mesure ni calcul spécifique à chaque plateau n'est nécessaire au-delà de la valeur déjà mesurée à l'ingestion ([[RT_05]]) : tous les assets du référentiel [[RT_12]], quelle que soit la combinaison de dispositions ou la variante (`with-measurements`/`no-measurements`), sont livrés avec exactement les **mêmes dimensions en pixels et le même ratio** (vérifié à chaque ingestion, qui échoue sinon : 1653×2833, y compris pour les layouts au suffixe `-portrait`), et un `playArea` qui ne varie que de ~0,5 % d'un gabarit à l'autre. Le même facteur d'échelle s'applique donc identiquement à n'importe quel plateau chargé ; il n'est recalculé que lorsque l'espace disponible change (rotation de l'écran, redimensionnement de fenêtre), jamais par changement de plateau ou de disposition. Le conteneur du plateau désactive tout geste de zoom/pan natif du navigateur ou de l'OS sur cette zone (ex. `touch-action: none`, `user-scalable=no` équivalent) pour que seul le drag-and-drop des tokens ([[RT_03]]) y reste interactif, conformément à [[RG_17]].

---

## EX_06 — Compte utilisateur et synchronisation multi-appareils

Le joueur doit pouvoir associer un compte à ses données pour retrouver ses listes et déploiements sur un autre appareil (ex. bureau puis téléphone).

Satisfait par : [[RG_10]], [[RG_11]], [[RG_18]], [[RG_19]], [[RT_09]], [[RT_10]], [[RT_20]], [[RT_21]].

### RG_10 — Compte optionnel

L'utilisation de l'application sans compte reste possible et fonctionnelle (données locales uniquement) ; la création de compte n'est nécessaire qu'au moment où le joueur souhaite explicitement synchroniser vers un second appareil.

### RG_11 — Résolution de conflit

Lorsque le même déploiement a été modifié hors-ligne sur deux appareils avant resynchronisation, l'application ne doit jamais choisir automatiquement une version au détriment de l'autre. À la détection du conflit — typiquement au retour en ligne après une session hors-ligne, cf. [[EX_05]] — la synchronisation de cet enregistrement est mise en attente et l'application présente explicitement au joueur les deux versions (locale et serveur, avec leur horodatage respectif) ; le joueur choisit celle à conserver, ce choix écrasant l'autre version pour cet enregistrement. Les enregistrements non conflictuels continuent de se synchroniser normalement sans attendre cette décision.

### RG_18 — Point d'accès compte et informations sur l'écran d'accueil (bouton Réglages)

L'écran d'accueil — la bibliothèque des listes d'armée déjà importées ([[RG_01]]) — affiche un bouton « Réglages » (icône engrenage), toujours visible quel que soit le nombre de listes déjà importées. Ce bouton ouvre un écran (ou panneau) Réglages qui regroupe, sans quitter l'application, trois blocs distincts :

1. **Compte**, dont le contenu dépend de l'état de connexion du joueur ([[RG_10]]) :
   - non connecté : les actions « Créer un compte » et « Se connecter », menant aux formulaires de sign up / sign in ;
   - connecté : les informations du compte prévues par [[RG_19]] et une action de déconnexion (retour à un usage local uniquement, sans suppression des données locales).
2. **Informations utilisateur**, détaillées par [[RG_19]].
3. **Mentions des sources tierces** : la liste des attributions requises par les référentiels tiers dont l'application dépend, qu'ils soient générés hors-ligne ([[RT_02]], « Powered by Wahapedia ») ou chargés par le réseau à l'exécution ([[RT_12]], Battlemaster) — conformément aux conditions d'usage de ces sources (voir [CLAUDE.md](../CLAUDE.md)). Chaque mention indique l'adresse de la source et la rend directement ouvrable, plutôt que de l'afficher comme un texte inerte : c'est par cette adresse que le joueur vérifie l'attribution.

Le bloc « Mentions des sources tierces » et la consultation des informations déjà connues du bloc « Compte » restent accessibles hors-ligne ; seules les actions qui nécessitent le réseau (création de compte, connexion, synchronisation) sont soumises à la dégradation gracieuse prévue par [[RG_09]].

### RG_19 — Informations utilisateur affichées

Lorsque le joueur est connecté, le bloc « Compte » de l'écran Réglages ([[RG_18]]) affiche a minima l'identifiant du compte (adresse email) et l'état de synchronisation courant (synchronisé / en attente / hors-ligne, conformément à [[RG_09]]). Le joueur peut s'y déconnecter à tout moment ; la déconnexion ne supprime aucune donnée stockée localement ([[RT_08]]), qui reste utilisable en usage local seul ([[RG_10]]).

### RT_09 — Backend de synchronisation

Un backend nodejs expose une API de synchronisation par différence (delta) des enregistrements créés/modifiés/supprimés depuis la dernière synchronisation réussie, identifiée par un jeton de version côté client.

### RT_10 — Déclenchement de la synchronisation

La synchronisation se déclenche à la reprise du réseau et/ou au retour au premier plan de l'application, jamais de façon bloquante pour l'interaction en cours, conformément à RG_09.

### RT_20 — Génération de la liste de mentions tierces

La liste affichée par le bloc « Mentions des sources tierces » de [[RG_18]] n'est pas codée en dur dans l'écran Réglages : chaque référentiel tiers déclare, quelle que soit sa façon d'être livré — donnée statique versionnée pour [[RT_02]], métadonnées associées au chargement réseau à l'exécution pour [[RT_12]] —, le nom de la source et le texte d'attribution requis par ses conditions d'usage. L'écran Réglages se contente d'énumérer les référentiels effectivement actifs dans le build courant et d'en afficher l'attribution associée, pour qu'un nouveau référentiel (donc une nouvelle source tierce) ajouté ultérieurement apparaisse automatiquement sans modification du code de l'écran.

### RT_21 — Authentification (sign up / sign in)

Les actions « Créer un compte » / « Se connecter » de [[RG_18]] s'appuient sur le même backend de synchronisation que [[RT_09]] (endpoints d'inscription/connexion). Le jeton de session obtenu est persisté localement au même titre que les autres données de configuration légères ([[RT_08]]), pour que la synchronisation ([[RT_10]]) démarre sans ressaisie dès la connexion établie. La détection de connectivité de [[RT_14]] est réutilisée pour désactiver ces deux actions — et afficher un message explicite — lorsque l'application est hors-ligne, sur le même principe que [[RG_13]] pour l'import.

---

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

**Correspondance avec la légende des plateaux.** Les plateaux de [[RT_12]] distinguent trois éléments de terrain dans leur légende. Chaque **socle de ruine** (« Baseplate », emprise grise hachurée cerclée de noir) est une zone obscurcissante. Les **murs de ruine** (« Ruin walls », en vert) sont les murs de l'alinéa suivant. Les **obstacles** (« Obstacles », en orange) ne bloquent pas la vue et ne jouent aucun rôle dans ce calcul : ils sont presque toujours posés sur un socle de ruine, qui obscurcit déjà.

**Murs.** Indépendamment de son statut obscurcissant, une zone de terrain peut porter des **murs** — des tracés qui bloquent la vue de façon inconditionnelle dès qu'une ligne les traverse. Aucune des deux exceptions ci-dessus ne s'applique à un mur : un modèle posté à l'intérieur d'une ruine voit à travers l'emprise de la ruine, mais pas à travers ses murs, et un point situé dans la ruine reste masqué s'il se trouve derrière un de ses murs.

### RG_29 — Coloration de la zone visible à la sélection d'un modèle posé

Sur l'écran de placement ([[RG_03]] étape 3), sélectionner un token déjà posé colore sur le plateau la zone visible depuis ce modèle ([[RG_27]]). Seule la surface visible est colorée : le reste du plateau est laissé tel quel, et c'est l'absence de coloration qui désigne les espaces à l'abri de ce modèle. Désélectionner le token, ou en sélectionner un autre, retire la coloration précédente ; au plus une zone visible est affichée à la fois, celle du token sélectionné, sur le même principe de sélection que [[RG_20]]. Un modèle encore dans le bandeau ([[RG_15]]) ou en réserve ([[RG_25]]) n'a pas de position et n'a donc pas de zone visible.

**Mise à jour.** La zone est recalculée à la fin de tout geste qui déplace ou fait pivoter le token sélectionné ([[RG_04]], [[RG_20]]) — la forme de son socle et son orientation changeant ce qu'il voit. Pendant le glisser du token sélectionné, la coloration est masquée plutôt que laissée à son ancienne position, pour ne jamais afficher une zone qui ne correspond plus à la position du token. Les gestes portant sur d'autres tokens ne la modifient pas, les modèles n'étant pas des obstacles ([[RG_27]]).

**Plateau sans terrain décrit.** Si la géométrie du terrain du plateau affiché n'est pas encore disponible ([[RT_37]]), aucune zone n'est colorée et un message indique que la zone visible n'est pas disponible pour ce plateau : colorer le plateau entier ferait croire à tort qu'aucun obstacle ne s'y trouve.

### RT_37 — Référentiel des zones de terrain par plateau

**Constat préalable.** Le référentiel de plateaux ([[RT_12]]) ne fournit que des images : aucune source structurée (gdmissions.app/Battlemaster) ne publie la géométrie des éléments de terrain qui y sont visibles, ni leurs propriétés de jeu (obscurcissant, mur). Sans cette donnée, [[RG_28]] est incalculable.

**Décision (précédemment « saisie manuelle par l'assistant IA ») : extraction hors-ligne par script, depuis les images des plateaux.** Les images de [[RT_12]] dessinent le terrain dans des couleurs franches, fixées par leur légende ([[RG_28]]) : la géométrie s'en déduit donc par analyse des pixels, sans saisie manuelle. Le script `scripts/ingest-terrain.mjs` lit l'image `no-measurements` de chaque plateau de `boards.json`, en réutilisant le décodeur PNG déjà employé pour mesurer le `playArea` ([[RT_05]]), et produit un fichier unique, `src/assets/referentials/terrain.json`, indexé par identifiant de plateau. Comme les autres scripts d'ingestion ([[RT_02]], [[RT_12]]), il s'exécute hors-ligne, jamais à l'exécution de l'application, et **échoue explicitement** plutôt que de produire un référentiel partiel : couleur de mur absente de la légende (indice d'un changement de format), plateau sans socle ou sans mur, nombre de socles hors d'une plage plausible.

**Extraction.** Dans le rectangle de jeu, un remplissage par diffusion depuis le bord, arrêté par les contours noirs, isole le fond du plateau (grille, zones de déploiement). Chaque région restante, délimitée par un contour noir, est un **socle de ruine** : deux socles qui se touchent restent distincts, leur contour commun les séparant. Chaque composante connexe de pixels verts est un **mur**. Les contours des régions sont tracés puis simplifiés à environ 2 px près ; un mur en forme de cadre est traité comme plein, ce qui ne change rien à la vue qu'il bloque. Les obstacles orange ne sont pas extraits ([[RG_28]]). Une option du script produit, par plateau, une image de contrôle qui superpose les polygones extraits au plateau, pour relire l'extraction.

**Format.** Pour chaque plateau : une liste de **zones** (socles de ruine, toutes obscurcissantes) et une liste de **murs**, chacun décrit par un polygone (`points: [[x, y], …]`) dans le **repère de l'image d'asset** ([[RT_04]]/[[RT_05]]). Les murs sont des polygones et non des segments, car ce sont des barres épaisses sur l'image. Un mur n'est rattaché à aucune zone : il bloque la vue quelle que soit la zone où il se trouve ([[RG_28]]), et ce rattachement ne servirait à aucun calcul. Le fichier porte un bloc `source` qui crédite Battlemaster, dont les images sont la source ; ce bloc n'ajoute pas de mention à l'écran Réglages ([[RT_20]]), Battlemaster y étant déjà crédité par [[RT_12]].

**Plateau absent.** Un plateau absent du fichier a un terrain **non décrit**, ce qui ne veut pas dire qu'il n'a pas de terrain : aucune zone visible n'est alors calculée et le message prévu par [[RG_29]] est affiché. Un plateau sans aucun terrain se décrirait par des listes vides.

### RT_38 — Calcul de la zone visible

**Repère.** Tout le calcul se fait dans le repère en pixels de l'image d'asset ([[RT_04]]), les millimètres étant convertis avec l'échelle de [[RT_05]]. Le socle du modèle sélectionné est le polygone de [[RT_36]] (cercle, ovale approché à moins de 0,01", rectangle de [[RT_28]]), placé à son `x`/`y` et tourné de sa `rotation` ([[RT_22]]). Le résultat est borné au rectangle de jeu (`playArea`, [[RT_05]]).

**Largeur de 1 mm.** Une ligne de 1 mm de large est dégagée si et seulement si sa ligne médiane passe à au moins 0,5 mm de tout obstacle. Chaque obstacle — polygone de zone obscurcissante, polygone de mur ([[RT_37]]) — est donc **dilaté de 0,5 mm**, une fois par plateau au chargement de son terrain, et le reste du calcul raisonne sur des lignes d'épaisseur nulle contre ces obstacles dilatés. La première exception de [[RG_28]] (socle dans la zone) est évaluée sur le contour **non dilaté** de la zone.

**Obstacles retenus.** Les zones obscurcissantes que le socle du modèle sélectionné chevauche sont écartées ([[RG_28]], première exception) ; les murs sont toujours retenus, y compris ceux de ces zones écartées. Aucun socle de modèle n'est un obstacle ([[RG_27]]).

**Zone visible depuis le socle.** Pour un point hors du socle, une ligne dégagée depuis un point intérieur du socle croise le contour du socle, et le tronçon qui en part est lui aussi dégagé : il suffit donc de considérer les points du **contour** du socle. Le contour est échantillonné — ses sommets, plus des points intermédiaires espacés de 2 mm au plus — et, pour chaque point échantillon, on calcule son **polygone de visibilité** contre les obstacles retenus (balayage angulaire classique autour des sommets des obstacles). La zone visible est la **réunion** de ces polygones de visibilité. L'échantillonnage du contour est une approximation acceptée, du même ordre que celle de [[RT_36]] pour les ovales : un point que seule une portion du contour comprise entre deux échantillons verrait serait manqué, écart non jugé bloquant pour un outil de planification.

**Intérieur des zones obscurcissantes.** La seconde exception de [[RG_28]] (un point dans une zone n'est pas masqué par cette zone) se traite dans le même balayage, par la règle d'arrêt de chaque rayon. Un rayon qui touche d'abord un **mur** ou le **bord** du rectangle de jeu s'arrête à ce premier impact. Un rayon qui touche d'abord le contour d'une **zone** Z y entre et s'arrête au **second** impact : la sortie de Z, un mur ou une autre zone. Les points de Z que ce tronçon traverse sont vus en vertu de l'exception ; ceux qui sont au-delà ne le sont pas, puisqu'ils ne sont plus dans Z. Le polygone de visibilité de chaque échantillon reste ainsi étoilé depuis ce point, et la réunion des polygones intègre l'intérieur des zones sans calcul séparé. Pour que ce balayage reste exact, les points où deux contours d'obstacles se croisent (un mur posé à cheval sur le contour d'un socle) s'ajoutent aux sommets autour desquels les rayons sont lancés.

**Déclenchement.** Le calcul est lancé à la sélection d'un token et au relâchement d'un geste de déplacement ou de rotation du token sélectionné ([[RG_29]]), jamais à chaque mouvement du point de contact pendant le geste. Son résultat n'est pas persisté : ce n'est ni un enregistrement de placement ([[RT_04]]) ni une donnée synchronisée ([[RT_09]]).

### RT_39 — Rendu de la zone visible

La zone visible est rendue dans le SVG de l'éditeur de placement ([[RT_03]]), au-dessus de l'image du plateau et **sous** les tokens, pour que les tokens posés dans la zone restent pleinement lisibles. Elle n'a pas besoin d'être réduite à un seul polygone : les polygones de visibilité de [[RT_38]] sont tous dessinés comme les sous-chemins d'un **même chemin** SVG, avec une règle de remplissage `nonzero` et des sous-chemins parcourus dans le même sens (celui du balayage angulaire). Un chemin se remplit d'un seul tenant, avec une seule opacité : les recouvrements entre polygones ne s'additionnent pas, et la réunion apparaît d'une teinte uniforme sans calcul booléen de polygones.

La couleur du voile est un token de [[RT_29]] défini dans les deux thèmes, choisi pour se distinguer de la scène sombre du plateau sans masquer ce que l'image y montre (zones de déploiement, éléments de terrain) ; il se distingue aussi des couleurs d'unité de [[RG_06]], pour que la zone ne se confonde pas avec un token.

---

## Suivi des décisions non tranchées

Les règles techniques suivantes contiennent un choix encore ouvert et doivent être mises à jour dès que la décision est prise :

- **[[RT_12]] — appel direct au client vs. relais serveur non tranché.** Le principe (chargement réseau à l'exécution plutôt que bundling, pour rester à jour de la source, voir [[RT_12]]) est acté, mais le chemin réseau ne l'est pas : appel direct du client vers gdmissions.app (le plus simple, mais expose l'app à une éventuelle absence d'en-têtes CORS côté gdmissions.app, jamais garantis puisque ce site n'expose pas d'API dédiée, et à un risque de rate-limiting si de nombreux joueurs sollicitent la même source), ou relais via un endpoint dédié du backend de synchronisation ([[RT_09]]) qui proxifierait et mettrait en cache les images côté serveur. Le second évite les deux risques mais suppose que le backend soit déployé, ce qui n'est pas le cas aujourd'hui (voir « Suivi des écarts »). À trancher avant implémentation ; un appel direct est la voie la plus simple à essayer en premier tant que le backend n'existe pas.
- **[[RT_05]] — source du calibrage `playArea` non tranchée.** Le passage de [[RT_12]] en chargement réseau retire l'étape d'ingestion hors-ligne qui mesurait ce rectangle par asset. Reste à choisir entre deux constantes fixes par gabarit (standard/`-portrait`), au prix de l'écart de ~0,5 % déjà mentionné par [[RT_05]], ou une détection du cadre côté client à chaque image chargée, plus fidèle mais plus coûteuse et à réaliser dans un contexte navigateur/Capacitor plutôt que Node ; à trancher avant implémentation.
- **[[RT_27]] — mécanisme de cache exact non tranché.** Le principe (cache local des images de plateau une fois chargées, sans purge automatique) est acté, mais le choix entre Cache API et un store IndexedDB dédié aux blobs — et la disponibilité effective de la première sur les cibles visées (navigateur desktop/mobile, WebView Capacitor) — reste à vérifier avant implémentation.

Les décisions suivantes, précédemment ouvertes, sont tranchées : [[RT_16]] (pan/zoom implémenté sans librairie tierce, sur les évènements `Pointer` et une transformation CSS), [[RT_06]]/[[RT_08]] (IndexedDB pour les enregistrements métier, stockage de configuration léger séparé) [[RT_26]] (fichier JSON versionné avec l'application, alimenté entrée par entrée par l'assistant IA du projet) et [[RT_37]] (terrain extrait des images de plateau par un script hors-ligne plutôt que saisi à la main).

## Suivi des écarts entre spécification et implémentation

- **[[RT_09]] — backend de synchronisation non réalisé.** Le contrat d'API est spécifié ([openapi.yml](openapi.yml)) et le **client** est implémenté au complet contre ce contrat : authentification ([[RT_21]]), déclenchement ([[RT_10]]), pull/push delta, détection de conflit ([[RT_15]]) et écran d'arbitrage ([[RG_11]]). Aucun serveur ne l'expose en revanche : tant qu'un backend n'est pas déployé à l'URL configurée, [[EX_06]] reste non satisfaite de bout en bout. Conformément à [[RG_09]] et [[RG_10]], cette absence est non bloquante — l'application fonctionne intégralement en local, l'état affiché étant « Usage local uniquement » ([[RG_19]]) tant qu'aucun compte n'est connecté.
- **[[RG_01]] — un seul format d'import.** Seul le roster JSON de [[RT_13]] est branché derrière [[RT_01]], ce qui satisfait le « à minima un export texte/JSON d'un list-builder tiers » de la règle. L'ajout d'un second format ne demande qu'une entrée supplémentaire dans la table des formats, sans toucher aux écrans.
- **[[RG_03]] étape 3 — aucune zone de déploiement matérialisée.** Choix de périmètre déjà assumé par la règle ; l'implémentation borne simplement les tokens au rectangle du plateau mesuré ([[RT_05]]), sans validation des règles de zone du jeu.
- **[[RT_26]] — 130 des 208 gabarits sont des estimations, pas des mesures.** La couverture des lignes `Use model` est complète (208/208) mais inégale : 78 entrées remontent à une mesure trouvée et citée — directement ou par un châssis partagé (Rhino, Predator, Land Raider, Leman Russ, Chimera, Baneblade, Drop Pod, Stompa, Thunderhawk, Manta, Trukk) — et les 130 autres sont des estimations, préfixées `estimation — ` dans leur `sourceNote`. Écart assumé et non bloquant — un gabarit approché reste exploitable pour planifier un déploiement — mais à résorber entrée par entrée : toute mesure réelle obtenue ultérieurement remplace l'estimation correspondante.
- **[[RT_12]] — chargement réseau à l'exécution pas encore implémenté.** Le référentiel de plateaux vient de passer, dans cette spécification, d'une génération hors-ligne bundlée (`scripts/ingest-boards.mjs`, images copiées dans `src/assets/referentials`, voir [CLAUDE.md](../CLAUDE.md)) à un chargement réseau à l'exécution mis en cache ([[RT_27]]). Le code existant utilise encore l'ancienne approche bundlée à ce jour ; [CLAUDE.md](../CLAUDE.md) (sections Commandes et État courant) documente également encore l'ancien mécanisme et doit être mis à jour en même temps que le code, une fois les décisions ouvertes ci-dessus tranchées.- **[[EX_07]] — socle de règles d'interface écrit, implémentation en cours.** [[RG_24]], [[RT_29]] à [[RT_32]] viennent d'être posées à partir d'un audit de l'application tournant en 375×812 dans les deux thèmes. L'implémentation les suit écran par écran ; tant qu'elle n'est pas achevée, les constats de cet audit restent vrais : 14 usages de `--ion-color-step-*` (non défini par le cadre d'interface dans aucun des deux thèmes, donc toujours rabattu sur un repli clair), `--ion-color-dark` employé comme couleur de texte sur des fonds blancs littéraux, surfaces d'alerte posées sans couleur de texte associée, 17 tailles de police ad hoc dont 12 sous le plancher de [[RT_30]], et une couleur de texte secondaire à 2,6:1 dans les deux thèmes. Contraste mesuré le plus bas : 1:1 sur les noms d'unité du menu de [[RG_16]], qui sont donc invisibles en thème sombre.
- **[[RT_31]] — grossissement du document désactivé globalement.** Le document désactive aujourd'hui le zoom du navigateur sur l'ensemble de l'application, alors que [[RT_19]] ne l'exige que sur le conteneur du plateau de l'écran de placement, où les gestes sont déjà neutralisés par la feuille de style. La restriction dépasse donc son périmètre et prive le joueur du grossissement système partout ailleurs. À résorber en même temps que la reformulation de [[RT_19]].

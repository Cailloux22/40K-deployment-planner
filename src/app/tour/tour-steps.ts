/**
 * RG_66/RT_82 — scénario déclaratif de la visite guidée.
 *
 * Constante TypeScript, indépendante de Shepherd.js : `TourService` la traduit
 * en étapes Shepherd. Le nombre total d'étapes affiché par le compteur
 * (« n / N », RG_63) est la longueur de ce tableau, jamais une valeur écrite à
 * la main.
 */

/** RT_82: écran sur lequel une étape s'affiche. */
export type TourScreen = 'home' | 'import' | 'adversary' | 'boards' | 'placement' | 'settings';

/**
 * RG_66: ce que la visite fait elle-même à l'appui sur « Suivant » de l'étape,
 * avant d'afficher la suivante (colonne « Action de la visite »).
 */
export type TourAction =
  | 'loadExample'
  | 'saveExample'
  | 'createDemoDeployment'
  | 'selectToken'
  | 'selectUnit'
  | 'clearSelection'
  | 'reserveRemaining'
  | 'openConsult'
  | 'closeConsult';

export interface TourStepDef {
  readonly id: string;
  readonly screen: TourScreen;
  /** RT_82: valeur de l'attribut `data-tour` de l'élément mis en évidence. */
  readonly anchor?: string;
  readonly title: string;
  /** Texte de la bulle (HTML statique, aucune donnée du joueur). */
  readonly text: string;
  readonly action?: TourAction;
}

/**
 * RG_63: actions qui changent ce que l'écran montre — l'étape suivante n'offre
 * pas « Précédent », qui ramènerait à un état que la visite a déjà dépassé.
 */
const SCREEN_CHANGING_ACTIONS: ReadonlySet<TourAction> = new Set<TourAction>([
  'loadExample',
  'saveExample',
  'createDemoDeployment',
  'reserveRemaining',
  'openConsult',
  'closeConsult',
]);

export const TOUR_STEPS: readonly TourStepDef[] = [
  // ----- Accueil -----
  {
    id: 'welcome',
    screen: 'home',
    title: 'Bienvenue dans Windfall Planner',
    text:
      '<p>Préparez le déploiement de votre armée sur les plateaux du jeu, socle par socle, ' +
      'et retrouvez vos plans sur tous vos appareils.</p>' +
      '<p>Voulez-vous une visite guidée de l’application ? ' +
      'Elle reste disponible à tout moment dans les Réglages.</p>',
  },
  {
    id: 'home-import',
    screen: 'home',
    anchor: 'home-import',
    title: 'Importer une liste',
    text: '<p>Tout commence par l’import de votre liste d’armée, depuis ce bouton.</p>',
  },

  // ----- Import de liste -----
  {
    id: 'import-picker',
    screen: 'import',
    anchor: 'import-picker',
    title: 'Le fichier attendu',
    text:
      '<p>Exportez votre liste depuis votre list-builder (BattleScribe, NewRecruit…) au format ' +
      '<strong>roster JSON</strong> (fichier <code>.json</code>), puis choisissez-le ici.</p>' +
      '<p>L’import demande une connexion réseau. Pour la visite, une liste d’exemple va être chargée pour vous.</p>',
    action: 'loadExample',
  },
  {
    id: 'import-name',
    screen: 'import',
    anchor: 'import-name',
    title: 'Le nom de la liste',
    text:
      '<p>D’ordinaire repris du fichier, il reste modifiable. Celle-ci s’appelle ' +
      '« Liste d’exemple (visite guidée) » et restera dans votre bibliothèque après la visite.</p>',
  },
  {
    id: 'import-disposition',
    screen: 'import',
    anchor: 'import-disposition',
    title: 'Votre disposition de force',
    text: '<p>Elle est lue dans la liste : l’application ne vous la demandera plus.</p>',
  },
  {
    id: 'import-counts',
    screen: 'import',
    anchor: 'import-counts',
    title: 'Le récapitulatif',
    text: '<p>Le nombre d’unités et de modèles qui vont être enregistrés.</p>',
  },
  {
    id: 'import-bases',
    screen: 'import',
    anchor: 'import-bases',
    title: 'Vérifiez les socles',
    text:
      '<p>Chaque profil de modèle reçoit le socle du référentiel, regroupé par forme et taille avec un compte. ' +
      'Une même unité peut mêler plusieurs socles — ici, le Ranger à l’arquebuse transuranique est sur un ovale.</p>' +
      '<p>Comparez avec vos figurines.</p>',
  },
  {
    id: 'import-unresolved',
    screen: 'import',
    anchor: 'import-unresolved',
    title: 'Les socles à assigner',
    text:
      '<p>Une unité inconnue du référentiel est signalée ici et sur sa ligne : choisissez-lui un socle connu, ' +
      'ou saisissez les dimensions d’un socle sur mesure mesuré sur la figurine.</p>' +
      '<p>La liste ne s’enregistre qu’une fois tous les socles assignés. La liste d’exemple n’en a aucun.</p>',
  },
  {
    id: 'import-color',
    screen: 'import',
    anchor: 'import-color',
    title: 'La couleur de l’unité',
    text: '<p>Chaque unité reçoit une couleur, reprise par ses tokens sur le plateau. Vous pouvez la changer ici.</p>',
  },
  {
    id: 'import-attached',
    screen: 'import',
    anchor: 'import-attached',
    title: 'Vérifiez les meneurs',
    text:
      '<p>Le Tech-Priest Manipulus mène les Kataphron Breachers : ils seront déployés comme une seule unité.</p>' +
      '<p>« Détacher » défait l’association lue dans la liste.</p>',
  },
  {
    id: 'import-attach',
    screen: 'import',
    anchor: 'import-attach',
    title: 'Attacher un personnage',
    text:
      '<p>Un meneur ou un soutien que la liste n’a pas associé peut être attaché ici, ' +
      'parmi les seules unités qu’il peut rejoindre.</p>',
  },
  {
    id: 'import-split',
    screen: 'import',
    anchor: 'import-split',
    title: 'Séparer une unité en deux',
    text:
      '<p>Une unité d’au moins 10 modèles peut être déployée en deux unités distinctes. ' +
      'Vous répartissez ensuite les modèles par glisser-déposer, chaque moitié comptant au moins 5 modèles.</p>' +
      '<p>La visite ne scinde pas l’unité.</p>',
  },
  {
    id: 'import-save',
    screen: 'import',
    anchor: 'import-save',
    title: 'Enregistrer la liste',
    text:
      '<p>La liste n’est enregistrée qu’après cette validation ; « Annuler » n’enregistre rien.</p>' +
      '<p>La visite enregistre la liste d’exemple pour vous.</p>',
    action: 'saveExample',
  },

  // ----- Accueil — bibliothèque -----
  {
    id: 'home-list',
    screen: 'home',
    anchor: 'home-list',
    title: 'Votre bibliothèque',
    text:
      '<p>Vos listes importées, avec leurs déploiements. ' +
      'Touchez une liste pour préparer un déploiement.</p>',
  },
  {
    id: 'home-list-actions',
    screen: 'home',
    anchor: 'home-list-actions',
    title: 'Dupliquer ou supprimer',
    text:
      '<p><strong>Dupliquer</strong> crée une copie indépendante de la liste ; ' +
      '<strong>Supprimer</strong> l’efface avec ses déploiements, après confirmation.</p>' +
      '<p>La visite ne fait ni l’un ni l’autre et ouvre la liste.</p>',
  },

  // ----- Choix de la disposition adverse -----
  {
    id: 'adversary-player',
    screen: 'adversary',
    anchor: 'adversary-player',
    title: 'Votre disposition',
    text: '<p>Au centre, le rappel de votre disposition, lue à l’import.</p>',
  },
  {
    id: 'adversary-dial',
    screen: 'adversary',
    anchor: 'adversary-dial',
    title: 'La disposition adverse',
    text:
      '<p>Choisissez celle de votre adversaire. La couleur de chaque secteur résume l’avancement ' +
      'de vos 3 déploiements correspondants — voir « Que signifient les couleurs ? ».</p>' +
      '<p>La visite choisit la première et prépare pour vous un déploiement d’exemple.</p>',
    action: 'createDemoDeployment',
  },

  // ----- Choix du plateau -----
  {
    id: 'boards-versus',
    screen: 'boards',
    anchor: 'boards-versus',
    title: 'Le couple de dispositions',
    text:
      '<p>Vous contre votre adversaire. « Missions » montre les deux cartes de mission primaire de ce couple.</p>',
  },
  {
    id: 'boards-pager',
    screen: 'boards',
    anchor: 'boards-pager',
    title: 'Trois plateaux',
    text: '<p>Chaque couple de dispositions se joue sur 3 plateaux : glissez horizontalement pour passer de l’un à l’autre.</p>',
  },
  {
    id: 'boards-preview',
    screen: 'boards',
    anchor: 'boards-preview',
    title: 'Le plateau en plein écran',
    text: '<p>Touchez l’aperçu pour l’ouvrir en plein écran avec ses mesures, et zoomer en pinçant.</p>',
  },
  {
    id: 'boards-status',
    screen: 'boards',
    anchor: 'boards-status',
    title: 'Le statut du déploiement',
    text:
      '<p>Rouge : rien de commencé ; orange : déploiement commencé ; vert : terminé.</p>' +
      '<p>Le plateau d’exemple est orange.</p>',
  },
  {
    id: 'boards-actions',
    screen: 'boards',
    anchor: 'boards-actions',
    title: 'Nouveau, Éditer, Consulter',
    text:
      '<p>« Nouveau » repart d’un plateau vide, « Éditer » reprend le déploiement, ' +
      '« Consulter » (au vert) le montre en lecture seule.</p>' +
      '<p>La visite ouvre « Éditer ».</p>',
  },

  // ----- Placement -----
  {
    id: 'placement-board',
    screen: 'placement',
    anchor: 'placement-board',
    title: 'Le plateau',
    text:
      '<p>Un token par figurine, à la taille réelle de son socle et dans la couleur de son unité.</p>' +
      '<p>Le déploiement est enregistré en continu : il n’y a pas de bouton d’enregistrement.</p>',
  },
  {
    id: 'placement-band',
    screen: 'placement',
    anchor: 'placement-band',
    title: 'Le bandeau des unités',
    text:
      '<p>L’unité en cours, les flèches vers l’unité précédente ou suivante, et ses modèles restant à poser : ' +
      'glissez-les un par un sur le plateau.</p>',
  },
  {
    id: 'placement-band-cluster',
    screen: 'placement',
    anchor: 'placement-band',
    title: 'Raccourci : tout poser d’un geste',
    text:
      '<p>Un <strong>double appui</strong> (double clic) sur le bandeau saisit tous les modèles restants : ' +
      'un seul glisser les pose ensemble, en grappe.</p>',
  },
  {
    id: 'placement-reserve',
    screen: 'placement',
    anchor: 'placement-reserve',
    title: 'Mettre une unité en réserve',
    text: '<p>Une unité en réserve compte comme déployée et n’a aucun token sur le plateau.</p>',
  },
  {
    id: 'placement-menu',
    screen: 'placement',
    anchor: 'placement-menu',
    title: 'Le menu des unités',
    text: '<p>Toutes les unités et leur avancement ; touchez-en une pour la placer dans le bandeau.</p>',
  },
  {
    id: 'placement-note',
    screen: 'placement',
    anchor: 'placement-note',
    title: 'Le plan de jeu',
    text: '<p>Une note libre, attachée à ce déploiement.</p>',
  },
  {
    id: 'placement-missions',
    screen: 'placement',
    anchor: 'placement-missions',
    title: 'Les missions',
    text: '<p>Les cartes de mission primaire du couple de dispositions.</p>',
  },
  {
    id: 'placement-ruler',
    screen: 'placement',
    anchor: 'placement-ruler',
    title: 'La règle',
    text: '<p>Mesurez entre deux points en glissant sur le plateau, ou mesurez le déplacement d’un token.</p>',
  },
  {
    id: 'placement-zoom',
    screen: 'placement',
    anchor: 'placement-zoom',
    title: 'Agrandir le plateau',
    text: '<p>Le plateau en ×2, puis ×4, puis retour au plateau entier.</p>',
  },
  {
    id: 'placement-pan',
    screen: 'placement',
    anchor: 'placement-pan',
    title: 'Déplacer la vue',
    text:
      '<p>Le mode « Déplacement » fait glisser la vue agrandie. À la souris, maintenir le ' +
      '<strong>bouton du milieu</strong> déplace aussi la vue.</p>' +
      '<p>La visite sélectionne un token pour la suite.</p>',
    action: 'selectToken',
  },
  {
    id: 'placement-selected',
    screen: 'placement',
    anchor: 'placement-selected',
    title: 'Un token sélectionné',
    text:
      '<p>Touchez un token pour le sélectionner : la zone qu’il voit est colorée. ' +
      'Glissez sa poignée pour le faire pivoter.</p>',
  },
  {
    id: 'placement-range',
    screen: 'placement',
    anchor: 'placement-range',
    title: 'Le cercle de portée',
    text: '<p>Affiche autour du token un cercle à 3, 6, 8, 9 ou 12" du bord de son socle.</p>',
  },
  {
    id: 'placement-trash',
    screen: 'placement',
    anchor: 'placement-trash',
    title: 'Retirer du plateau',
    text:
      '<p>Retire les tokens sélectionnés, qui retournent dans le bandeau.</p>' +
      '<p>La visite sélectionne maintenant toute l’unité de ce token.</p>',
    action: 'selectUnit',
  },
  {
    id: 'placement-unit-shortcut',
    screen: 'placement',
    anchor: 'placement-board',
    title: 'Raccourci : toute l’unité',
    text:
      '<p>Un <strong>double appui</strong> (double clic) sur un token sélectionne toute son unité ; ' +
      'glisser l’un de ses tokens la déplace d’un bloc.</p>',
    action: 'clearSelection',
  },
  {
    id: 'placement-marquee',
    screen: 'placement',
    anchor: 'placement-board',
    title: 'Raccourci : sélection par zone',
    text:
      '<p>Glissez depuis un endroit <strong>sans token</strong> : le rectangle tracé sélectionne tous les tokens qu’il touche. ' +
      'Au clavier, maintenez <strong>Maj</strong> pour les ajouter à la sélection.</p>',
  },
  {
    id: 'placement-coherency',
    screen: 'placement',
    anchor: 'placement-board',
    title: 'La cohésion d’unité',
    text:
      '<p>Un modèle posé trop loin de son unité est refusé. Ce contrôle se désactive dans ' +
      'Réglages › Accessibilité.</p>' +
      '<p>La visite met en réserve la dernière unité pour terminer le déploiement.</p>',
    action: 'reserveRemaining',
  },
  {
    id: 'placement-done',
    screen: 'placement',
    anchor: 'placement-band',
    title: 'Déploiement terminé',
    text: '<p>Plus rien à poser : le déploiement d’exemple est terminé. La visite revient au choix du plateau.</p>',
  },

  // ----- Choix du plateau — consultation et partage -----
  {
    id: 'boards-status-done',
    screen: 'boards',
    anchor: 'boards-status',
    title: 'Le plateau est vert',
    text: '<p>Toutes les unités sont posées ou en réserve : le déploiement est terminé.</p>',
  },
  {
    id: 'boards-consult',
    screen: 'boards',
    anchor: 'boards-consult',
    title: 'Consulter',
    text: '<p>Ouvre le déploiement terminé en plein écran, en lecture seule.</p>',
    action: 'openConsult',
  },
  {
    id: 'viewer',
    screen: 'boards',
    anchor: 'viewer',
    title: 'La prévisualisation',
    text: '<p>Votre déploiement tel qu’il sera sur la table. Pincez pour zoomer ; la croix referme la vue.</p>',
  },
  {
    id: 'viewer-share',
    screen: 'boards',
    anchor: 'viewer-share',
    title: 'Partager',
    text:
      '<p>Envoie une image du déploiement à une autre application (messagerie, réseau…).</p>' +
      '<p>La visite ne partage rien.</p>',
    action: 'closeConsult',
  },

  // ----- Réglages -----
  {
    id: 'settings-account',
    screen: 'settings',
    anchor: 'settings-account',
    title: 'Votre compte',
    text:
      '<p>Le compte est facultatif : l’application fonctionne entièrement sans.</p>' +
      '<p>Créez un compte ou connectez-vous pour <strong>retrouver vos listes et vos déploiements sur tous vos appareils</strong> ' +
      '— téléphone, tablette, ordinateur —, synchronisés dès que le réseau est là. ' +
      'Une modification faite sur deux appareils à la fois vous est présentée : vous choisissez la version à garder.</p>',
  },
  {
    id: 'settings-tour',
    screen: 'settings',
    anchor: 'settings-tour',
    title: 'Relancer la visite',
    text: '<p>La visite guidée se relance d’ici, autant de fois que vous le voulez.</p>',
  },
  {
    id: 'end',
    screen: 'settings',
    title: 'Fin de la visite',
    text:
      '<p>La liste d’exemple et son déploiement restent dans votre bibliothèque : ' +
      'modifiez-les ou supprimez-les librement.</p><p>Bon déploiement !</p>',
  },
];

/** RG_63: « Précédent » n'est offert que sur le même écran, sans action de la visite entre les deux. */
export function offersBack(steps: readonly TourStepDef[], index: number): boolean {
  if (index <= 0) return false;
  const previous = steps[index - 1];
  const current = steps[index];
  return (
    previous.screen === current.screen &&
    !(previous.action && SCREEN_CHANGING_ACTIONS.has(previous.action))
  );
}

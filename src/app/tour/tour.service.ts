import { Injectable, NgZone, inject, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { AlertController, NavController, Platform } from '@ionic/angular/lazy';
import type { StepOptions, Tour } from 'shepherd.js';
import { Subscription, filter } from 'rxjs';

import { LibraryService } from '../data/library.service';
import { LocalStoreService } from '../data/local-store.service';
import { assetPixelsPerMm } from '../deployment/token-geometry';
import { ArmyList } from '../models/domain.models';
import { ReferentialService } from '../referentials/referential.service';
import { demoDeployment } from './tour-demo-deployment';
import { TOUR_STEPS, TourAction, TourScreen, TourStepDef, offersBack } from './tour-steps';

/** RT_83: clé de configuration de l'appareil « visite déjà proposée » (jamais synchronisée). */
export const TOUR_PROPOSED_KEY = 'tour.proposed';

/** RT_82: délai maximal d'attente d'un écran ou d'un élément avant d'afficher la bulle centrée. */
const ANCHOR_TIMEOUT_MS = 5000;

/** RT_82: écrans dont le contenu défile vers l'élément mis en évidence. */
const SCROLLING_SCREENS: ReadonlySet<TourScreen> = new Set<TourScreen>(['home', 'import', 'settings']);

/** RT_82: actions qu'un écran confie à la visite pendant qu'il est affiché. */
export interface ImportTourHooks {
  loadExample(): Promise<void>;
  saveExample(): Promise<ArmyList | undefined>;
}
export interface BoardsTourHooks {
  openConsult(): void;
  closeConsult(): void;
}
export interface PlacementTourHooks {
  selectToken(): void;
  selectUnit(): void;
  clearSelection(): void;
  reserveGroup(groupId: string): void;
}
interface TourHooks {
  import: ImportTourHooks;
  boards: BoardsTourHooks;
  placement: PlacementTourHooks;
}

/** RG_65/RT_85: données créées par la visite en cours. */
interface TourContext {
  listId?: string;
  opponentId?: string;
  boardId?: string;
  pendingGroupId?: string;
}

/**
 * EX_18 — visite guidée (RG_62 à RG_66).
 *
 * RT_82: seul point du code à importer Shepherd.js, chargé à la demande au
 * démarrage d'une visite. Les écrans ne connaissent que leurs ancres
 * `data-tour` et les actions qu'ils confient à la visite (`register`).
 */
@Injectable({ providedIn: 'root' })
export class TourService {
  private readonly store = inject(LocalStoreService);
  private readonly library = inject(LibraryService);
  private readonly referential = inject(ReferentialService);
  private readonly router = inject(Router);
  private readonly nav = inject(NavController);
  private readonly alerts = inject(AlertController);
  private readonly platform = inject(Platform);
  private readonly zone = inject(NgZone);

  /** RT_83: visite en cours — en mémoire seulement, jamais reprise après fermeture (RG_64). */
  readonly active = signal(false);
  /** RG_65: identifiant de la liste d'exemple de la visite en cours, pour les ancres de l'accueil. */
  readonly exampleListId = signal<string | null>(null);

  private readonly hooks: Partial<TourHooks> = {};
  private tour?: Tour;
  private context: TourContext = {};
  private busy = false;
  private confirmAlert?: HTMLIonAlertElement;
  private subscriptions: Subscription[] = [];
  private liveRegion?: HTMLElement;

  /** RT_82: un écran confie ses actions à la visite ; la fonction rendue les retire. */
  register<K extends keyof TourHooks>(screen: K, hooks: TourHooks[K]): () => void {
    this.hooks[screen] = hooks;
    return () => {
      if (this.hooks[screen] === hooks) delete this.hooks[screen];
    };
  }

  /**
   * RG_62/RT_83: à la première ouverture de l'application sur l'appareil, la
   * visite est proposée si la bibliothèque est vide ; sinon, elle est
   * seulement marquée comme proposée, sans interrompre le joueur.
   */
  async proposeOnFirstLaunch(): Promise<void> {
    if (this.store.getConfig<boolean>(TOUR_PROPOSED_KEY)) return;
    await this.library.load();
    if (this.library.lists().length > 0) {
      this.store.setConfig(TOUR_PROPOSED_KEY, true);
      return;
    }
    await this.start();
  }

  /** RG_62: démarre la visite à l'étape 1 (première ouverture ou bouton des Réglages). */
  async start(): Promise<void> {
    if (this.active()) return;
    // RT_83: écrite dès l'étape 1, pour qu'une fermeture brutale ne repropose pas la visite.
    this.store.setConfig(TOUR_PROPOSED_KEY, true);
    this.active.set(true);
    this.context = {};
    this.exampleListId.set(null);

    // RT_82: Shepherd.js n'est chargé qu'au démarrage d'une visite.
    const { default: Shepherd } = await import('shepherd.js');
    // RT_82/RT_83: la surcouche est placée dans `ion-app`, où Ionic ouvre ses
    // fenêtres : la confirmation d'arrêt (ion-alert) passe ainsi au-dessus d'elle.
    const container = document.querySelector<HTMLElement>('ion-app') ?? document.body;
    const tour = new Shepherd.Tour({
      useModalOverlay: true,
      modalContainer: container,
      stepsContainer: container,
      exitOnEsc: true,
      // RT_82: les actions de la visite ne s'exécutent qu'à l'appui sur « Suivant ».
      keyboardNavigation: false,
      confirmCancel: () => this.confirmCancel(),
      defaultStepOptions: {
        canClickTarget: false,
        modalOverlayOpeningPadding: 6,
        modalOverlayOpeningRadius: 8,
        cancelIcon: { enabled: true, label: 'Quitter la visite' },
        classes: 'app-tour-step',
      },
    });
    tour.addSteps(TOUR_STEPS.map((def, index) => this.stepOptions(def, index)));
    tour.on('cancel', () => this.zone.run(() => void this.finish()));
    tour.on('complete', () => this.zone.run(() => void this.finish()));
    this.tour = tour;

    this.listenSystemBack();
    this.ensureLiveRegion();
    await tour.start();
  }

  // -------------------------------------------------------------------------
  // Construction des étapes (RT_82)
  // -------------------------------------------------------------------------

  private stepOptions(def: TourStepDef, index: number): StepOptions {
    const total = TOUR_STEPS.length;
    const isFirst = index === 0;
    const isLast = index === total - 1;
    const buttons: NonNullable<StepOptions['buttons']>[number][] = [];

    if (isFirst) {
      // RG_62: décliner avant d'avoir commencé se fait sans confirmation.
      buttons.push({ text: 'Pas maintenant', classes: 'shepherd-button-secondary', action: () => this.tour?.complete() });
      buttons.push({ text: 'Commencer la visite', action: () => void this.next(def) });
    } else {
      if (offersBack(TOUR_STEPS, index)) {
        buttons.push({ text: 'Précédent', classes: 'shepherd-button-secondary', action: () => void this.tour?.back() });
      }
      buttons.push({
        text: isLast ? 'Terminer' : 'Suivant',
        action: () => (isLast ? this.tour?.complete() : void this.next(def)),
      });
    }

    return {
      id: def.id,
      title: def.title,
      text: def.text,
      attachTo: def.anchor
        ? { element: () => this.findAnchor(def.anchor!) ?? null, on: 'auto' }
        : undefined,
      // RT_82: seuls les écrans à contenu défilant y amènent l'élément ; le plateau
      // du placement et le pager du choix du plateau ont leur propre cadrage.
      scrollTo: SCROLLING_SCREENS.has(def.screen) ? { behavior: 'auto', block: 'center' } : false,
      beforeShowPromise: () => this.zone.run(() => this.prepare(def)),
      buttons,
      when: {
        show: () => this.onShow(index, total),
      },
    };
  }

  /** RG_63: compteur « n / N » dans le pied de la bulle, répété aux lecteurs d'écran. */
  private onShow(index: number, total: number): void {
    const element = this.tour?.getCurrentStep()?.getElement();
    const footer = element?.querySelector('.shepherd-footer');
    if (footer && !footer.querySelector('.app-tour-counter')) {
      const counter = document.createElement('span');
      counter.className = 'app-tour-counter';
      counter.setAttribute('aria-hidden', 'true');
      counter.textContent = `${index + 1} / ${total}`;
      footer.prepend(counter);
    }
    if (this.liveRegion) this.liveRegion.textContent = `Étape ${index + 1} sur ${total}`;
  }

  /**
   * RT_82: avant d'afficher une étape — navigation vers son écran, attente de
   * la fin de l'entrée de la page, puis de son ancre (bulle centrée au-delà
   * du délai plutôt que de bloquer).
   */
  private async prepare(def: TourStepDef): Promise<void> {
    const url = this.urlFor(def.screen);
    if (url && this.router.url !== url) {
      // Retour au choix du plateau depuis le placement : navigation arrière.
      if (def.screen === 'boards' && this.router.url.endsWith('/placement')) await this.nav.navigateBack(url);
      else await this.nav.navigateForward(url);
    }
    await this.waitFor(() => this.singleVisiblePage(), ANCHOR_TIMEOUT_MS);
    if (def.anchor) await this.waitFor(() => this.findAnchor(def.anchor!), ANCHOR_TIMEOUT_MS);
    await nextFrame();
  }

  private urlFor(screen: TourScreen): string | null {
    const { listId, opponentId, boardId } = this.context;
    switch (screen) {
      case 'home':
        return '/home';
      case 'import':
        return '/import';
      case 'settings':
        return '/settings';
      case 'adversary':
        return listId ? `/list/${listId}/adversary` : null;
      case 'boards':
        return listId && opponentId ? `/list/${listId}/adversary/${opponentId}/boards` : null;
      case 'placement':
        return listId && opponentId && boardId
          ? `/list/${listId}/adversary/${opponentId}/board/${boardId}/placement`
          : null;
    }
  }

  /** RG_63: « Suivant » — l'action de l'étape, attendue, puis l'étape suivante. */
  private async next(def: TourStepDef): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (def.action) await this.zone.run(() => this.run(def.action!));
      await this.tour?.next();
    } catch (err) {
      // RG_09: un incident de la visite ne doit jamais bloquer le joueur.
      console.error('Visite guidée interrompue', err);
      this.tour?.complete();
    } finally {
      this.busy = false;
    }
  }

  private async run(action: TourAction): Promise<void> {
    switch (action) {
      case 'loadExample':
        await this.hooks.import?.loadExample();
        return;
      case 'saveExample': {
        const list = await this.hooks.import?.saveExample();
        if (!list) throw new Error('liste d’exemple non enregistrée');
        this.context.listId = list.id;
        this.exampleListId.set(list.id);
        return;
      }
      case 'createDemoDeployment':
        await this.createDemoDeployment();
        return;
      case 'selectToken':
        this.hooks.placement?.selectToken();
        return;
      case 'selectUnit':
        this.hooks.placement?.selectUnit();
        return;
      case 'clearSelection':
        this.hooks.placement?.clearSelection();
        return;
      case 'reserveRemaining':
        if (this.context.pendingGroupId) this.hooks.placement?.reserveGroup(this.context.pendingGroupId);
        return;
      case 'openConsult':
        this.hooks.boards?.openConsult();
        return;
      case 'closeConsult':
        this.hooks.boards?.closeConsult();
        return;
    }
  }

  /**
   * RG_65/RT_84/RT_85: déploiement d'exemple pour (liste d'exemple, première
   * disposition adverse, premier plateau) — toutes les unités posées sauf une.
   */
  private async createDemoDeployment(): Promise<void> {
    const list = this.context.listId ? this.library.list(this.context.listId) : undefined;
    if (!list) throw new Error('liste d’exemple introuvable');
    const [opponent] = await this.referential.allDispositions();
    const [board] = await this.referential.boardsForPair(list.forceDispositionId, opponent.id);
    if (!board) throw new Error('aucun plateau pour ce couple');
    const shapes = new Map((await this.referential.allBaseShapes()).map((shape) => [shape.id, shape]));
    const pixelsPerMm = assetPixelsPerMm(board, await this.referential.boardReferential());
    const demo = demoDeployment({ units: list.units, shapes, board, pixelsPerMm });
    if (!demo) throw new Error('déploiement d’exemple impossible');

    const deployment = await this.library.openDeployment({
      listId: list.id,
      opponentDispositionId: opponent.id,
      boardId: board.id,
      defaultName: this.library.defaultDeploymentName(list.name, `Plateau ${board.index}`),
      reset: false,
    });
    await this.library.saveDeployment({ ...deployment, placements: demo.placements });
    this.context.opponentId = opponent.id;
    this.context.boardId = board.id;
    this.context.pendingGroupId = demo.pendingGroup.id;
  }

  // -------------------------------------------------------------------------
  // Arrêt (RG_64/RT_83)
  // -------------------------------------------------------------------------

  /** RG_64: confirmation d'arrêt ; l'étape 1 se décline sans confirmation (RG_62). */
  private confirmCancel(): Promise<boolean> {
    return this.zone.run(async () => {
      const current = this.tour?.getCurrentStep();
      if (!current || this.tour?.steps.indexOf(current) === 0) return true;
      if (this.confirmAlert) return false;
      const alert = await this.alerts.create({
        header: 'Arrêter la visite ?',
        message:
          'Êtes-vous sûr de vouloir arrêter la visite guidée ? ' +
          'Vous pourrez la relancer à tout moment depuis les Réglages.',
        cssClass: 'app-tour-confirm',
        buttons: [
          { text: 'Continuer la visite', role: 'cancel' },
          { text: 'Arrêter', role: 'destructive' },
        ],
      });
      this.confirmAlert = alert;
      await alert.present();
      const { role } = await alert.onDidDismiss();
      this.confirmAlert = undefined;
      return role === 'destructive';
    });
  }

  /** RG_64/RT_83: fin de visite — terminée ou arrêtée ; rien n'est effacé (RG_65). */
  private async finish(): Promise<void> {
    if (!this.active()) return;
    this.active.set(false);
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    this.subscriptions = [];
    this.tour = undefined;
    this.hooks.boards?.closeConsult();
    if (this.liveRegion) this.liveRegion.textContent = '';
    if (this.router.url !== '/home') await this.nav.navigateRoot('/home');
  }

  /**
   * RG_64/RT_82: le retour système (Android, navigateur) demande l'arrêt au
   * lieu de son effet ordinaire. Retour pendant la confirmation : « Continuer ».
   */
  private listenSystemBack(): void {
    this.subscriptions.push(
      this.platform.backButton.subscribeWithPriority(1000, () => {
        if (this.confirmAlert) void this.confirmAlert.dismiss(null, 'cancel');
        else void this.requestCancel();
      }),
    );
    this.subscriptions.push(
      this.router.events
        .pipe(filter((event): event is NavigationStart => event instanceof NavigationStart))
        .subscribe((event) => {
          if (event.navigationTrigger === 'popstate') setTimeout(() => void this.requestCancel(), 0);
        }),
    );
  }

  /** RG_64: demande d'arrêt ; si le joueur continue, l'étape courante est réaffichée sur son écran. */
  private async requestCancel(): Promise<void> {
    const tour = this.tour;
    const current = tour?.getCurrentStep();
    if (!tour || !current) return;
    await tour.cancel();
    if (this.tour === tour && tour.isActive()) await tour.show(tour.steps.indexOf(current));
  }

  // -------------------------------------------------------------------------
  // Ancres (RT_82)
  // -------------------------------------------------------------------------

  /**
   * RT_82: élément `data-tour` de l'écran affiché — hors des pages Ionic
   * masquées de la pile, rendu, et dans la largeur de l'écran (le pager du
   * choix du plateau garde ses plateaux voisins hors champ).
   */
  findAnchor(anchor: string): HTMLElement | undefined {
    const candidates = document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`);
    for (const element of candidates) {
      if (element.closest('.ion-page-hidden')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right <= 0 || rect.left >= window.innerWidth) continue;
      return element;
    }
    return undefined;
  }

  /** RT_82: la transition entre deux pages Ionic est terminée. */
  private singleVisiblePage(): boolean {
    const pages = document.querySelectorAll('ion-router-outlet > .ion-page:not(.ion-page-hidden)');
    return pages.length === 1 && !pages[0].classList.contains('ion-page-invisible');
  }

  private async waitFor(check: () => unknown, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!check() && Date.now() - start < timeoutMs) {
      await delay(50);
    }
  }

  /** RG_63: région `aria-live` qui énonce le compteur d'étape. */
  private ensureLiveRegion(): void {
    if (this.liveRegion?.isConnected) return;
    const region = document.createElement('div');
    region.className = 'app-tour-live';
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
    this.liveRegion = region;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ModalController } from '@ionic/angular/lazy';

import {
  Board,
  ForceDisposition,
  MissionCard,
  PairMissions,
} from '../models/referential.models';

/** RT_66: largeur CSS à partir de laquelle les colonnes passent côte à côte. */
export const MISSIONS_SIDE_BY_SIDE_QUERY = '(min-width: 720px)';

type MissionTab = 'player' | 'opponent';

/** Une colonne de carte : son onglet, son libellé et la carte (absente = inconnue). */
interface MissionPanel {
  readonly tab: MissionTab;
  readonly label: string;
  readonly card?: MissionCard;
  /** RT_23: disposition à laquelle la carte appartient (couleur, icône). */
  readonly disposition?: ForceDisposition;
}

/**
 * EX_14 — fenêtre « Missions primaires », ouverte par `MissionsService` dans
 * un `ion-modal` plein écran (RG_48/RT_66).
 *
 * - Écran étroit : deux onglets « Ma mission » / « Mission adverse », une
 *   carte à la fois, balayage horizontal au zoom d'ouverture.
 * - Écran d'au moins 720 px : plateau avec mesures | ma mission | mission
 *   adverse côte à côte, chaque colonne zoomable indépendamment.
 * - Couple miroir : une seule carte, sans sélecteur.
 *
 * Lecture seule : rien n'est écrit, aucun statut n'est touché.
 */
@Component({
  selector: 'app-mission-cards',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-header>
      <ion-toolbar>
        <!-- RG_48: croix de fermeture en haut à gauche, comme RT_16. -->
        <ion-buttons slot="start">
          <ion-button (click)="close()" aria-label="Fermer les missions primaires">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>Missions primaires</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content [scrollY]="false">
      <div class="layout">
        @if (sideBySide()) {
          <!-- RG_48: vue côte à côte, dans le sens de lecture du bandeau des
               dispositions : plateau, ma mission, mission adverse. -->
          <div class="columns" [style.--columns]="columnCount()">
            @if (board) {
              <section class="column">
                <header class="column-head neutral">
                  <span class="label">Plateau</span>
                  <span class="name">{{ boardLabel }}</span>
                </header>
                <!-- RG_48: variante avec repères de mesure, sans placements. -->
                <app-pan-zoom class="card-area neutral" [contentWidth]="board.width" [contentHeight]="board.height">
                  <img
                    class="image"
                    [src]="board | boardImage: 'with-measurements' | async"
                    [alt]="'Plateau ' + boardLabel + ', avec repères de mesure'"
                    [style.width.px]="board.width"
                    [style.height.px]="board.height"
                    draggable="false"
                  />
                </app-pan-zoom>
              </section>
            }
            @for (panel of panels(); track panel.tab) {
              <section class="column" [style]="dispositionColors(panel)">
                <header class="column-head">
                  <span class="label">
                    <app-disposition-icon [disposition]="panel.disposition" [size]="16"></app-disposition-icon>
                    {{ panel.label }}
                  </span>
                  <span class="name">{{ panel.card?.name ?? 'Mission inconnue' }}</span>
                </header>
                <ng-container *ngTemplateOutlet="cardArea; context: { $implicit: panel, swipe: false }"></ng-container>
              </section>
            }
          </div>
        } @else {
          @if (missions.mirror) {
            <!-- RG_48: couple miroir — une seule carte, pas de sélecteur. -->
            <header class="mirror-head" [style]="dispositionColors(panels()[0])">
              <span class="name">
                <app-disposition-icon [disposition]="panels()[0].disposition" [size]="18"></app-disposition-icon>
                {{ panels()[0].card?.name ?? 'Mission inconnue' }}
              </span>
              <span class="label">Mission miroir : les deux joueurs jouent cette même carte</span>
            </header>
          } @else {
            <!-- RG_24/RT_66: l'onglet actif est porté par son texte (libellé,
                 nom de la carte, icône) ; la couleur n'est qu'un rappel. -->
            <ion-segment
              class="tabs"
              [value]="tab()"
              (ionChange)="selectTab($any($event.detail.value))"
            >
              @for (panel of panels(); track panel.tab) {
                <ion-segment-button
                  [value]="panel.tab"
                  layout="icon-start"
                  [style]="dispositionColors(panel)"
                >
                  <ion-label>
                    <span class="label">{{ panel.label }}</span>
                    <span class="name">
                      <app-disposition-icon [disposition]="panel.disposition" [size]="14"></app-disposition-icon>
                      {{ panel.card?.name ?? 'Mission inconnue' }}
                    </span>
                  </ion-label>
                </ion-segment-button>
              }
            </ion-segment>
          }
          @if (activePanel(); as panel) {
            <div class="single" [style]="dispositionColors(panel)">
              <ng-container *ngTemplateOutlet="cardArea; context: { $implicit: panel, swipe: !missions.mirror }"></ng-container>
            </div>
          }
        }
      </div>
    </ion-content>

    <ng-template #cardArea let-panel let-swipe="swipe">
      @if (panel.card; as card) {
        <app-pan-zoom
          class="card-area"
          [contentWidth]="card.width"
          [contentHeight]="card.height"
          [swipeAtFit]="swipe"
          (swipe)="onSwipe($event)"
        >
          <img
            class="image"
            [src]="card | missionImage | async"
            [alt]="cardAlt(card)"
            [style.width.px]="card.width"
            [style.height.px]="card.height"
            draggable="false"
          />
        </app-pan-zoom>
      } @else {
        <!-- RG_48: carte absente du référentiel pour ce sens du couple. -->
        <p class="card-area missing">Mission non disponible pour ce couple</p>
      }
    </ng-template>
  `,
  styles: [
    `
      .layout {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--app-surface-stage);
        color: var(--app-text-on-stage);
      }
      /* RT_66: zone entourant la carte, version atténuée de la couleur de sa
         disposition pour ne pas concurrencer la carte elle-même. */
      .single,
      .column {
        --dispo-surround: color-mix(in srgb, var(--dispo-bg, var(--app-surface-stage)) 35%, var(--app-surface-stage));
      }
      .single {
        flex: 1;
        display: flex;
        min-height: 0;
        background: var(--dispo-surround);
      }
      .columns {
        flex: 1;
        display: grid;
        grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
        gap: 2px;
        min-height: 0;
      }
      .column {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--dispo-surround);
      }
      .card-area {
        flex: 1;
      }
      .card-area.neutral {
        background: var(--app-surface-stage);
      }
      .image {
        display: block;
        max-width: none;
        user-select: none;
        -webkit-user-drag: none;
      }
      .missing {
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        text-align: center;
        font-size: var(--app-font-md);
      }
      /* RG_24: en-têtes textuels, sur la couleur de la disposition (RT_29 :
         texte contrôlé par check-contrast.mjs). */
      .column-head,
      .mirror-head {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 12px;
        background: var(--dispo-bg, var(--app-surface-raised));
        color: var(--dispo-on, var(--app-text));
      }
      .column-head.neutral {
        background: var(--app-surface-raised);
        color: var(--app-text);
      }
      .label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: var(--app-font-xs);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .name {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: var(--app-font-sm);
        font-weight: 600;
      }
      .mirror-head .label {
        text-transform: none;
        letter-spacing: 0;
      }
      .tabs {
        --background: var(--app-surface-raised);
        border-radius: 0;
      }
      ion-segment-button {
        --color: var(--app-text);
        --color-checked: var(--dispo-on);
        --background-checked: var(--dispo-bg);
        --indicator-color: var(--dispo-bg);
        --border-radius: 0;
        min-height: 56px;
        text-transform: none;
        letter-spacing: 0;
      }
      ion-segment-button ion-label {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        white-space: normal;
      }
    `,
  ],
})
export class MissionCardsComponent implements OnInit {
  private readonly modals = inject(ModalController);
  private readonly destroyRef = inject(DestroyRef);

  @Input({ required: true }) missions!: PairMissions;
  @Input() player?: ForceDisposition;
  @Input() opponent?: ForceDisposition;
  /** RG_48: plateau de la colonne « Plateau » de la vue côte à côte. */
  @Input() board?: Board;
  @Input() boardLabel = '';

  readonly tab = signal<MissionTab>('player');
  readonly sideBySide = signal(false);

  readonly panels = computed<readonly MissionPanel[]>(() => {
    const player: MissionPanel = {
      tab: 'player',
      label: 'Ma mission',
      card: this.missions.player,
      disposition: this.player,
    };
    // RG_48: dans un miroir, les deux joueurs jouent la même carte.
    if (this.missions.mirror) return [player];
    return [
      player,
      { tab: 'opponent', label: 'Mission adverse', card: this.missions.opponent, disposition: this.opponent },
    ];
  });

  readonly activePanel = computed(
    () => this.panels().find((panel) => panel.tab === this.tab()) ?? this.panels()[0],
  );

  readonly columnCount = computed(() => this.panels().length + (this.board ? 1 : 0));

  ngOnInit(): void {
    // RT_66: la présentation suit la largeur disponible, rotation comprise ;
    // l'onglet actif est conservé d'une présentation à l'autre.
    const query = globalThis.matchMedia?.(MISSIONS_SIDE_BY_SIDE_QUERY);
    if (!query) return;
    this.sideBySide.set(query.matches);
    const listener = (event: MediaQueryListEvent) => this.sideBySide.set(event.matches);
    query.addEventListener?.('change', listener);
    this.destroyRef.onDestroy(() => query.removeEventListener?.('change', listener));
  }

  selectTab(tab: MissionTab | undefined): void {
    if (tab === 'player' || tab === 'opponent') this.tab.set(tab);
  }

  /** RG_48: balayage vers la gauche → mission adverse, vers la droite → la sienne. */
  onSwipe(direction: -1 | 1): void {
    if (this.missions.mirror) return;
    this.tab.set(direction < 0 ? 'opponent' : 'player');
  }

  /** RT_66: fond et texte de la disposition de la carte (tokens RT_29). */
  dispositionColors(panel: MissionPanel | undefined): Record<string, string> {
    const id = panel?.card?.disposition ?? panel?.disposition?.id;
    if (!id) return {};
    return {
      '--dispo-bg': `var(--app-dispo-color-${id})`,
      '--dispo-on': `var(--app-dispo-color-${id}-on)`,
    };
  }

  /** RT_66: « Carte de mission primaire {nom} — {disposition} contre {adverse} ». */
  cardAlt(card: MissionCard): string {
    return `Carte de mission primaire ${card.name} — ${this.label(card.disposition)} contre ${this.label(card.opponent)}`;
  }

  close(): Promise<boolean> {
    return this.modals.dismiss();
  }

  private label(id: string): string {
    return [this.player, this.opponent].find((d) => d?.id === id)?.label ?? id;
  }
}

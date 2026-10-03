import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActionSheetController } from '@ionic/angular/lazy';

import { resolveGroupShape } from '../../deployment/token-geometry';
import {
  SPLIT_MIN_HALF_MODELS,
  SplitHalf,
  UnitSplitDraft,
  halfModelCount,
  halfName,
  moveModel,
  otherHalf,
  splitErrors,
  swapModels,
} from '../../import/unit-split';
import { ArmyUnit, UnitModelGroup } from '../../models/domain.models';
import { BaseShape } from '../../models/referential.models';

interface SplitModel {
  readonly key: string;
  readonly groupId: string;
  readonly shape?: BaseShape;
  readonly label: string;
}

interface HalfView {
  readonly index: SplitHalf;
  readonly name: string;
  readonly color: string;
  readonly count: number;
  readonly error: boolean;
  readonly models: readonly SplitModel[];
}

/** Geste en cours sur une pastille (RT_51). */
interface DragState {
  readonly pointerId: number;
  readonly element: HTMLElement;
  readonly from: SplitHalf;
  readonly groupId: string;
  readonly startX: number;
  readonly startY: number;
  moved: boolean;
}

/** RT_51: distance, en pixels CSS, au-delà de laquelle un appui devient un glisser. */
const DRAG_THRESHOLD = 6;

/**
 * RG_40/RT_51 — répartition des modèles d'une unité scindée entre ses deux
 * moitiés, sur le récapitulatif d'import.
 *
 * Une pastille par modèle, à la forme de son socle. Le glisser-déposer repose
 * sur les évènements Pointer (l'API HTML de glisser-déposer ne réagit pas au
 * toucher) ; un appui sans glisser ouvre les mêmes actions, pour le joueur qui
 * ne peut pas ou ne veut pas faire le geste.
 */
@Component({
  selector: 'app-unit-split-editor',
  templateUrl: 'unit-split-editor.component.html',
  styleUrls: ['unit-split-editor.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnitSplitEditorComponent {
  private readonly actionSheets = inject(ActionSheetController);

  private readonly unitState = signal<ArmyUnit | null>(null);
  private readonly splitState = signal<UnitSplitDraft | null>(null);
  private readonly shapesState = signal<ReadonlyMap<string, BaseShape>>(new Map());
  private readonly colorsState = signal<readonly [string, string]>(['', '']);

  @Input({ required: true }) set unit(value: ArmyUnit) {
    this.unitState.set(value);
  }
  @Input({ required: true }) set split(value: UnitSplitDraft) {
    this.splitState.set(value);
  }
  @Input() set shapes(value: ReadonlyMap<string, BaseShape>) {
    this.shapesState.set(value);
  }
  /** RG_06/RT_52: couleur de chaque moitié. */
  @Input({ required: true }) set colors(value: readonly [string, string]) {
    this.colorsState.set(value);
  }

  @Output() readonly splitChange = new EventEmitter<UnitSplitDraft>();

  /** RT_51: moitié survolée pendant un glisser, mise en évidence. */
  readonly hoverHalf = signal<SplitHalf | null>(null);
  private drag: DragState | null = null;
  /** Un glisser terminé ne doit pas aussi déclencher le clic de la pastille. */
  private suppressClick = false;

  readonly halves = computed<readonly HalfView[]>(() => {
    const unit = this.unitState();
    const split = this.splitState();
    if (!unit || !split) return [];
    const shapes = this.shapesState();
    const colors = this.colorsState();
    return ([0, 1] as const).map((index) => {
      const count = halfModelCount(split, index);
      return {
        index,
        name: halfName(unit.name, index),
        color: colors[index],
        count,
        error: count < SPLIT_MIN_HALF_MODELS,
        // Les pastilles d'un même groupe sont adjacentes (RT_51).
        models: unit.modelGroups.flatMap((group) => {
          const shape = resolveGroupShape(group, shapes);
          const label = `${group.name}${shape ? `, ${shape.label}` : ''}`;
          return Array.from({ length: split.halves[index][group.id] ?? 0 }, (_, n) => ({
            key: `${group.id}-${n}`,
            groupId: group.id,
            shape,
            label,
          }));
        }),
      };
    });
  });

  /** RG_40: message d'erreur des moitiés sous le minimum, en toutes lettres. */
  readonly errors = computed(() => {
    const unit = this.unitState();
    const split = this.splitState();
    if (!unit || !split) return [];
    return splitErrors(split).map(
      (error) =>
        `${halfName(unit.name, error.half)} : ${error.count} modèle${error.count > 1 ? 's' : ''}, ` +
        `il en faut au moins ${SPLIT_MIN_HALF_MODELS}.`,
    );
  });

  // RT_51: geste de glisser-déposer, sur les évènements Pointer.

  onPointerDown(event: PointerEvent, from: SplitHalf, groupId: string): void {
    if (event.button !== 0 || this.drag) return;
    // Un glisser précédent n'est pas toujours suivi d'un clic (relâché sur un
    // autre élément) : le drapeau ne doit valoir que pour l'appui en cours.
    this.suppressClick = false;
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture?.(event.pointerId);
    this.drag = {
      pointerId: event.pointerId,
      element,
      from,
      groupId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    // RT_51: la pastille suit le doigt, la moitié survolée est mise en évidence.
    drag.element.classList.add('dragging');
    drag.element.style.transform = `translate(${dx}px, ${dy}px)`;
    this.hoverHalf.set(this.dropTarget(event, drag)?.half ?? null);
  }

  onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      this.suppressClick = true;
      const target = this.dropTarget(event, drag);
      // RT_51: un dépôt dans la moitié d'origine ou hors des deux moitiés ne
      // fait rien — la pastille revient à sa place.
      if (target && target.half !== drag.from) {
        this.emit(
          target.groupId
            ? swapModels(this.splitState()!, drag.groupId, target.groupId, drag.from)
            : moveModel(this.splitState()!, drag.groupId, drag.from),
        );
      }
    }
    this.endDrag();
  }

  onPointerCancel(): void {
    this.endDrag();
  }

  private endDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    drag.element.classList.remove('dragging');
    drag.element.style.transform = '';
    this.drag = null;
    this.hoverHalf.set(null);
  }

  /**
   * RT_51: cible sous le pointeur — une pastille de l'autre moitié (échange)
   * ou la zone d'une moitié (passage). La pastille déplacée, qui suit le
   * pointeur, est écartée de la recherche.
   */
  private dropTarget(event: PointerEvent, drag: DragState): { half: SplitHalf; groupId?: string } | null {
    const stack = document.elementsFromPoint?.(event.clientX, event.clientY) ?? [];
    for (const element of stack) {
      if (drag.element === element || drag.element.contains(element)) continue;
      const zone = element.closest<HTMLElement>('[data-split-half]');
      if (!zone) continue;
      const half: SplitHalf = zone.dataset['splitHalf'] === '1' ? 1 : 0;
      return { half, groupId: zone.dataset['splitGroup'] };
    }
    return null;
  }

  /**
   * RT_51: alternative sans geste — un appui sur la pastille propose de la
   * faire passer dans l'autre moitié ou de l'échanger avec un profil de
   * l'autre moitié. Ces actions restent disponibles même quand elles font
   * passer une moitié sous le minimum (RG_40).
   */
  async onModelClick(from: SplitHalf, groupId: string): Promise<void> {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const unit = this.unitState();
    const split = this.splitState();
    if (!unit || !split) return;
    const to = otherHalf(from);
    const others = unit.modelGroups.filter(
      (group: UnitModelGroup) => group.id !== groupId && (split.halves[to][group.id] ?? 0) > 0,
    );
    const sheet = await this.actionSheets.create({
      header: unit.modelGroups.find((group) => group.id === groupId)?.name,
      buttons: [
        {
          text: `Passer dans ${halfName(unit.name, to)}`,
          handler: () => this.emit(moveModel(this.splitState()!, groupId, from)),
        },
        ...others.map((group) => ({
          text: `Échanger avec « ${group.name} »`,
          handler: () => this.emit(swapModels(this.splitState()!, groupId, group.id, from)),
        })),
        { text: 'Annuler', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private emit(split: UnitSplitDraft): void {
    if (split === this.splitState()) return;
    this.splitState.set(split);
    this.splitChange.emit(split);
  }
}

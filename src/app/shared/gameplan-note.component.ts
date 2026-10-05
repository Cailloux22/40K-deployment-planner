import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { ModalController } from '@ionic/angular/lazy';

import { GAMEPLAN_NOTE_MAX_LENGTH } from '../deployment/gameplan-note';

/** RG_45: rôle de fermeture qui enregistre la note (« Valider »). */
export const GAMEPLAN_NOTE_CONFIRM_ROLE = 'confirm';

/**
 * RT_61: état partagé avec la garde `canDismiss` de la modale, qui doit
 * savoir si le texte a été modifié sans accéder à l'instance du composant.
 */
export interface GameplanNoteEditState {
  changed: boolean;
}

/**
 * EX_13 — contenu de la fenêtre « Plan de jeu », ouverte par
 * `GameplanNoteService` dans un `ion-modal`.
 *
 * - `readonly = false` (RG_45/RT_61) : champ multiligne pré-rempli, actions
 *   « Annuler » et « Valider ». La confirmation d'abandon est portée par la
 *   garde `canDismiss` de la modale, posée par le service.
 * - `readonly = true` (RG_46/RT_62) : texte seul, sélectionnable, aucune
 *   zone éditable, une unique action « Fermer ».
 */
@Component({
  selector: 'app-gameplan-note',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-header>
      <ion-toolbar>
        @if (!readonly) {
          <ion-buttons slot="start">
            <ion-button (click)="cancel()">Annuler</ion-button>
          </ion-buttons>
        }
        <ion-title>Plan de jeu</ion-title>
        <ion-buttons slot="end">
          @if (readonly) {
            <ion-button (click)="cancel()">Fermer</ion-button>
          } @else {
            <ion-button strong="true" (click)="confirm()">Valider</ion-button>
          }
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (readonly) {
        <!-- RT_62: interpolation de texte, jamais de HTML — la note peut venir
             d'un autre appareil par la synchronisation (RT_09). -->
        <p class="note-text">{{ note }}</p>
      } @else {
        <!-- RT_61: hauteur automatique, longueur bornée avec compteur. -->
        <ion-textarea
          class="note-input"
          label="Note de plan de jeu"
          labelPlacement="stacked"
          placeholder="Objectifs, rôle des unités, entrée des réserves…"
          autocapitalize="sentences"
          [autoGrow]="true"
          [autofocus]="true"
          [counter]="true"
          [maxlength]="maxLength"
          [value]="draft"
          (ionInput)="onInput($event.detail.value)"
        ></ion-textarea>
      }
    </ion-content>
  `,
  styles: [
    `
      .note-text {
        margin: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        user-select: text;
        -webkit-user-select: text;
        font-size: var(--app-font-md);
        line-height: 1.5;
      }
      .note-input {
        --padding-start: 0;
        --padding-end: 0;
        min-height: 12rem;
      }
    `,
  ],
})
export class GameplanNoteComponent {
  private readonly modals = inject(ModalController);

  @Input() readonly = false;

  /** Note courante du déploiement, reçue à l'ouverture. */
  @Input() set note(value: string) {
    this.initial = value ?? '';
    this.draft = this.initial;
  }
  get note(): string {
    return this.initial;
  }

  readonly maxLength = GAMEPLAN_NOTE_MAX_LENGTH;

  /** RT_61: renseigné par `GameplanNoteService.edit`. */
  @Input() editState?: GameplanNoteEditState;

  /** Texte en cours de saisie (RG_45). */
  draft = '';
  private initial = '';

  /** RT_61: un abandon n'est confirmé que si le texte a été modifié. */
  onInput(value: string | null | undefined): void {
    this.draft = value ?? '';
    if (this.editState) this.editState.changed = this.draft !== this.initial;
  }

  cancel(): void {
    void this.modals.dismiss(undefined, 'cancel');
  }

  /** RG_45: « Valider » ferme sans confirmation et rend le texte saisi. */
  confirm(): void {
    void this.modals.dismiss(this.draft, GAMEPLAN_NOTE_CONFIRM_ROLE);
  }
}

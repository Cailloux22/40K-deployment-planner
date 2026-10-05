import { Injectable, inject } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular/lazy';

import {
  GAMEPLAN_NOTE_CONFIRM_ROLE,
  GameplanNoteComponent,
  GameplanNoteEditState,
} from './gameplan-note.component';

/**
 * EX_13 — ouverture de la fenêtre « Plan de jeu », en édition depuis l'écran
 * de placement (RG_45/RT_61) ou en lecture seule depuis le visualiseur
 * « Consulter » (RG_46/RT_62).
 */
@Injectable({ providedIn: 'root' })
export class GameplanNoteService {
  private readonly modals = inject(ModalController);
  private readonly alerts = inject(AlertController);

  /**
   * RG_45: rend le texte validé, ou `undefined` si le joueur a abandonné.
   * L'écriture elle-même relève de l'appelant (RT_60).
   */
  async edit(note: string): Promise<string | undefined> {
    const editState: GameplanNoteEditState = { changed: false };
    const modal = await this.modals.create({
      component: GameplanNoteComponent,
      componentProps: { note, readonly: false, editState },
      // RT_61: toute fermeture autre que « Valider » — « Annuler », bouton
      // retour matériel, appui hors de la fenêtre — passe par cette garde,
      // qui ne demande confirmation que si le texte a été modifié.
      canDismiss: async (_data?: unknown, role?: string) =>
        role === GAMEPLAN_NOTE_CONFIRM_ROLE || !editState.changed || this.confirmDiscard(),
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<string>();
    return role === GAMEPLAN_NOTE_CONFIRM_ROLE ? (data ?? '') : undefined;
  }

  /** RG_46: lecture seule — aucune confirmation à la fermeture (RT_62). */
  async view(note: string): Promise<void> {
    const modal = await this.modals.create({
      component: GameplanNoteComponent,
      componentProps: { note, readonly: true },
    });
    await modal.present();
    await modal.onWillDismiss();
  }

  /** RG_45: abandon d'un texte modifié, confirmé comme RG_08. */
  private async confirmDiscard(): Promise<boolean> {
    const alert = await this.alerts.create({
      header: 'Abandonner les modifications ?',
      message: 'Le texte saisi ne sera pas enregistré dans la note de plan de jeu.',
      buttons: [
        { text: 'Continuer la saisie', role: 'cancel' },
        { text: 'Abandonner', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'destructive';
  }
}

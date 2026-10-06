import { Injectable, inject } from '@angular/core';
import { ModalController } from '@ionic/angular/lazy';

import { Board, PairMissions } from '../models/referential.models';
import { ReferentialService } from '../referentials/referential.service';
import { MissionCardsComponent } from './mission-cards.component';

/** RT_66: ce que chaque point d'accès transmet à la fenêtre. */
export interface MissionsRequest {
  readonly playerDispositionId: string;
  readonly opponentDispositionId: string;
  /** RG_48: plateau de la colonne « Plateau » de la vue côte à côte. */
  readonly board?: Board;
  /** RG_14: identification du plateau, dans le sens de lecture du bandeau. */
  readonly boardLabel?: string;
}

/**
 * EX_14 — ouverture de la fenêtre « Missions primaires » depuis le choix du
 * plateau, l'écran de placement et le visualiseur « Consulter » (RG_48/RT_66).
 */
@Injectable({ providedIn: 'root' })
export class MissionsService {
  private readonly modals = inject(ModalController);
  private readonly referential = inject(ReferentialService);

  /** RG_48: les deux cartes du couple ordonné (RT_64). */
  missionsForPair(playerDispositionId: string, opponentDispositionId: string): Promise<PairMissions> {
    return this.referential.missionsForPair(playerDispositionId, opponentDispositionId);
  }

  /**
   * RG_48: le bouton n'est masqué que si AUCUNE des deux cartes n'est connue ;
   * une seule carte manquante s'affiche « Mission non disponible pour ce couple ».
   */
  async available(playerDispositionId: string, opponentDispositionId: string): Promise<boolean> {
    try {
      const missions = await this.missionsForPair(playerDispositionId, opponentDispositionId);
      return Boolean(missions.player || missions.opponent);
    } catch {
      // RG_09: un référentiel illisible masque le bouton sans gêner l'écran.
      return false;
    }
  }

  /** RG_48: lecture seule — la fenêtre ne rend rien et n'écrit rien. */
  async open(request: MissionsRequest): Promise<void> {
    const [missions, player, opponent] = await Promise.all([
      this.missionsForPair(request.playerDispositionId, request.opponentDispositionId),
      this.referential.disposition(request.playerDispositionId),
      this.referential.disposition(request.opponentDispositionId),
    ]);
    const modal = await this.modals.create({
      component: MissionCardsComponent,
      componentProps: {
        missions,
        player,
        opponent,
        board: request.board,
        boardLabel: request.boardLabel ?? '',
      },
      cssClass: 'missions-modal',
    });
    await modal.present();
    await modal.onWillDismiss();
  }
}

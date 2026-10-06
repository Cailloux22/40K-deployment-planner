import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { BaseTokenComponent } from './base-token.component';
import { BoardImagePipe } from './board-image.pipe';
import { BoardViewerComponent } from './board-viewer.component';
import { ConflictResolutionComponent } from './conflict-resolution.component';
import { DispositionIconComponent } from './disposition-icon.component';
import { GameplanNoteComponent } from './gameplan-note.component';
import { InstallInviteComponent } from './install-invite.component';
import { MissionCardsComponent } from './mission-cards.component';
import { MissionImagePipe } from './mission-image.pipe';
import { PanZoomComponent } from './pan-zoom.component';

/**
 * Composants transverses aux écrans : icône de disposition (RT_23), token de
 * socle (RT_05/RG_06), visualiseur plein écran (RT_16), arbitrage de
 * conflit (RG_11), image de plateau réseau/cache (RT_12/RT_27) et invitation
 * à installer l'application (RG_41), fenêtre « Plan de jeu » (EX_13), surface
 * de pan/zoom (RT_16) et fenêtre « Missions primaires » avec l'image de carte
 * réseau/cache (EX_14, RT_65/RT_66).
 */
@NgModule({
  declarations: [
    BaseTokenComponent,
    BoardImagePipe,
    BoardViewerComponent,
    ConflictResolutionComponent,
    DispositionIconComponent,
    GameplanNoteComponent,
    InstallInviteComponent,
    MissionCardsComponent,
    MissionImagePipe,
    PanZoomComponent,
  ],
  imports: [CommonModule, FormsModule, IonicModule],
  exports: [
    CommonModule,
    FormsModule,
    IonicModule,
    BaseTokenComponent,
    BoardImagePipe,
    BoardViewerComponent,
    ConflictResolutionComponent,
    DispositionIconComponent,
    GameplanNoteComponent,
    InstallInviteComponent,
    MissionCardsComponent,
    MissionImagePipe,
    PanZoomComponent,
  ],
})
export class SharedModule {}

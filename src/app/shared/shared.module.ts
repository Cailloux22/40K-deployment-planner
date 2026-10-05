import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { BaseTokenComponent } from './base-token.component';
import { BoardImagePipe } from './board-image.pipe';
import { BoardViewerComponent } from './board-viewer.component';
import { ConflictResolutionComponent } from './conflict-resolution.component';
import { DispositionIconComponent } from './disposition-icon.component';
import { InstallInviteComponent } from './install-invite.component';

/**
 * Composants transverses aux écrans : icône de disposition (RT_23), token de
 * socle (RT_05/RG_06), visualiseur plein écran (RT_16), arbitrage de
 * conflit (RG_11), image de plateau réseau/cache (RT_12/RT_27) et invitation
 * à installer l'application (RG_41).
 */
@NgModule({
  declarations: [
    BaseTokenComponent,
    BoardImagePipe,
    BoardViewerComponent,
    ConflictResolutionComponent,
    DispositionIconComponent,
    InstallInviteComponent,
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
    InstallInviteComponent,
  ],
})
export class SharedModule {}

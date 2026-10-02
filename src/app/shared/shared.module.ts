import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { BaseTokenComponent } from './base-token.component';
import { BoardImagePipe } from './board-image.pipe';
import { BoardViewerComponent } from './board-viewer.component';
import { ConflictResolutionComponent } from './conflict-resolution.component';
import { DispositionIconComponent } from './disposition-icon.component';

/**
 * Composants transverses aux écrans : icône de disposition (RT_23), token de
 * socle (RT_05/RG_06), visualiseur plein écran (RT_16), arbitrage de
 * conflit (RG_11) et image de plateau réseau/cache (RT_12/RT_27).
 */
@NgModule({
  declarations: [
    BaseTokenComponent,
    BoardImagePipe,
    BoardViewerComponent,
    ConflictResolutionComponent,
    DispositionIconComponent,
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
  ],
})
export class SharedModule {}

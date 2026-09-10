import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { BaseTokenComponent } from './base-token.component';
import { BoardViewerComponent } from './board-viewer.component';
import { ConflictResolutionComponent } from './conflict-resolution.component';
import { DispositionIconComponent } from './disposition-icon.component';

/**
 * Composants transverses aux écrans : icône de disposition (RT_23), token de
 * socle (RT_05/RG_06), visualiseur plein écran (RT_16) et arbitrage de
 * conflit (RG_11).
 */
@NgModule({
  declarations: [
    BaseTokenComponent,
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
    BoardViewerComponent,
    ConflictResolutionComponent,
    DispositionIconComponent,
  ],
})
export class SharedModule {}

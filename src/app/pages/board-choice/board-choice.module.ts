import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../shared/shared.module';
import { BoardChoicePage } from './board-choice.page';

const routes: Routes = [{ path: '', component: BoardChoicePage }];

/** Écran 4 — Choix du plateau (RG_03 étape 2, RG_14). */
@NgModule({
  imports: [SharedModule, RouterModule.forChild(routes)],
  declarations: [BoardChoicePage],
})
export class BoardChoicePageModule {}

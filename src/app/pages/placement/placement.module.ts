import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../shared/shared.module';
import { PlacementPage } from './placement.page';

const routes: Routes = [{ path: '', component: PlacementPage }];

/** Écran 6 — Écran de placement (RG_03 étape 3, RG_15/RG_16/RG_17/RG_20). */
@NgModule({
  imports: [SharedModule, RouterModule.forChild(routes)],
  declarations: [PlacementPage],
})
export class PlacementPageModule {}

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../shared/shared.module';
import { AdversaryPage } from './adversary.page';

const routes: Routes = [{ path: '', component: AdversaryPage }];

/** Écran 3 — Choix de la disposition adverse (RG_03 étape 1, RG_12). */
@NgModule({
  imports: [SharedModule, RouterModule.forChild(routes)],
  declarations: [AdversaryPage],
})
export class AdversaryPageModule {}

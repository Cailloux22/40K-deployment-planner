import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../shared/shared.module';
import { SettingsPage } from './settings.page';

const routes: Routes = [{ path: '', component: SettingsPage }];

/** Écran 9 — Réglages / crédits (EX_06, RG_18, RG_19, RT_20, RT_21). */
@NgModule({
  imports: [SharedModule, RouterModule.forChild(routes)],
  declarations: [SettingsPage],
})
export class SettingsPageModule {}

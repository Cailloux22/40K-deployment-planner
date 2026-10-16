import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../shared/shared.module';
import { AccountManagementComponent } from './account-management.component';
import { SettingsPage } from './settings.page';

const routes: Routes = [
  { path: '', component: SettingsPage },
  // RG_57/RT_77: sous-menu « Accessibilité », chargé en différé.
  {
    path: 'accessibility',
    loadChildren: () => import('./accessibility/accessibility.module').then((m) => m.AccessibilityPageModule),
  },
];

/** Écran 9 — Réglages / crédits (EX_06, RG_18, RG_19, RG_50, RG_52, RG_57, RT_20, RT_21). */
@NgModule({
  imports: [SharedModule, RouterModule.forChild(routes)],
  declarations: [SettingsPage, AccountManagementComponent],
})
export class SettingsPageModule {}

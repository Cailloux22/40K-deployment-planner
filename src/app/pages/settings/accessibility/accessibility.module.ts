import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../../shared/shared.module';
import { AccessibilityPage } from './accessibility.page';

const routes: Routes = [{ path: '', component: AccessibilityPage }];

/** Sous-menu « Accessibilité » des Réglages (EX_16, RG_57, RG_58, RT_77). */
@NgModule({
  imports: [SharedModule, RouterModule.forChild(routes)],
  declarations: [AccessibilityPage],
})
export class AccessibilityPageModule {}

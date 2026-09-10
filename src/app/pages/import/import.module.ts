import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../shared/shared.module';
import { ImportPage } from './import.page';

const routes: Routes = [{ path: '', component: ImportPage }];

/** Écran 2 — Import de liste (EX_01, RG_22). */
@NgModule({
  imports: [SharedModule, RouterModule.forChild(routes)],
  declarations: [ImportPage],
})
export class ImportPageModule {}

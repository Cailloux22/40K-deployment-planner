import { NgModule } from '@angular/core';

import { SharedModule } from '../shared/shared.module';
import { HomePage } from './home.page';
import { HomePageRoutingModule } from './home-routing.module';

/** Écran 1 — Accueil / bibliothèque des listes (EX_04, RG_18, RG_21). */
@NgModule({
  imports: [SharedModule, HomePageRoutingModule],
  declarations: [HomePage],
})
export class HomePageModule {}

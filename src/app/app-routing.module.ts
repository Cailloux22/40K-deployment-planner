import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

/**
 * Plan de navigation (cf. `specification/sitemap.md`).
 *
 * RG_03: le parcours de déploiement est ordonné — la structure des routes
 * matérialise cet ordre. L'écran de placement n'est atteignable qu'avec une
 * liste, une disposition adverse et un plateau déjà choisis ; chaque écran
 * vérifie en outre la validité de ses paramètres au chargement.
 */
const routes: Routes = [
  {
    // Écran 1 — Accueil / bibliothèque des listes (EX_04, RG_18, RG_21).
    path: 'home',
    loadChildren: () => import('./home/home.module').then((m) => m.HomePageModule),
  },
  {
    // Écran 2 — Import de liste (EX_01, RG_22).
    path: 'import',
    loadChildren: () => import('./pages/import/import.module').then((m) => m.ImportPageModule),
  },
  {
    // Écran 3 — Choix de la disposition adverse (RG_03 étape 1, RG_12).
    path: 'list/:listId/adversary',
    loadChildren: () =>
      import('./pages/adversary/adversary.module').then((m) => m.AdversaryPageModule),
  },
  {
    // Écran 4 — Choix du plateau (RG_03 étape 2, RG_14).
    path: 'list/:listId/adversary/:opponentId/boards',
    loadChildren: () =>
      import('./pages/board-choice/board-choice.module').then((m) => m.BoardChoicePageModule),
  },
  {
    // Écran 6 — Placement des unités (RG_03 étape 3, RG_15 à RG_17, RG_20).
    path: 'list/:listId/adversary/:opponentId/board/:boardId/placement',
    loadChildren: () =>
      import('./pages/placement/placement.module').then((m) => m.PlacementPageModule),
  },
  {
    // Écran 9 — Réglages / crédits (EX_06, RG_18, RG_19, RT_20).
    path: 'settings',
    loadChildren: () =>
      import('./pages/settings/settings.module').then((m) => m.SettingsPageModule),
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'home',
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}

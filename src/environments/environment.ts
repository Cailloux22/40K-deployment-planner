// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  // RT_71: racine absolue du serveur de synchronisation (RT_09) en
  // développement — le serveur local du dépôt `Windfall-Planner-api`. Seul
  // endroit où cette adresse figure. RG_10: le compte étant optionnel, aucune
  // requête n'y part tant que le joueur ne s'est pas connecté.
  syncApiBaseUrl: 'http://localhost:3000/v1' as string | null,
};

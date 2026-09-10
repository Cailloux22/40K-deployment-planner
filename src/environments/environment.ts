// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  // RT_09/RT_21: racine du backend de synchronisation (cf.
  // `specification/openapi.yml`, `servers: /v1`). RG_10: le compte etant
  // optionnel, aucune requete ne partira vers cette URL tant que le joueur
  // ne demande pas explicitement a synchroniser.
  syncApiBaseUrl: "/v1",
};

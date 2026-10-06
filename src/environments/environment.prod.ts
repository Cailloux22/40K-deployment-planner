export const environment = {
  production: true,
  // RT_71: racine absolue du serveur de synchronisation (RT_09) de production,
  // auto-hébergé derrière nginx en HTTPS. Seul endroit où cette adresse figure.
  // RG_10: le compte étant optionnel, aucune requête n'y part tant que le
  // joueur ne s'est pas connecté.
  syncApiBaseUrl: 'https://api.windfallplanner.pokepuller.fr/v1' as string | null,
};

export const environment = {
  production: true,
  // RT_71: l'adresse de production n'est pas tranchée (spec.md, « Suivi des
  // décisions non tranchées »). Tant qu'elle ne l'est pas, `null` : le bloc
  // Compte des Réglages indique que la synchronisation n'est pas disponible
  // dans cette version, et aucune requête ne part (RG_10).
  syncApiBaseUrl: null as string | null,
};

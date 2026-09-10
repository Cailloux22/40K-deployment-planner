/**
 * RG_06 — couleur par unité.
 *
 * Chaque unité importée reçoit automatiquement une couleur distincte ; le
 * joueur peut la réassigner ensuite. Tous les tokens d'une même unité
 * partagent cette couleur pour rester identifiables sur un plateau chargé.
 */

/**
 * Palette de départ : teintes espacées et saturations/luminosités choisies
 * pour rester distinguables les unes des autres sur les images de plateau
 * (dominantes grises et beiges) — cf. RT_05 pour la taille des tokens.
 */
export const UNIT_COLOR_PALETTE: readonly string[] = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#008080',
  '#f032e6',
  '#9a6324',
  '#800000',
  '#808000',
  '#000075',
  '#2f4f4f',
  '#ff4500',
  '#1e90ff',
  '#b8860b',
  '#c71585',
];

/**
 * Couleur automatique de la n-ième unité d'une liste. Au-delà de la palette,
 * on décale la teinte par l'angle d'or pour continuer à produire des couleurs
 * distinctes plutôt que de recycler les premières à l'identique.
 */
export function autoUnitColor(index: number): string {
  if (index < UNIT_COLOR_PALETTE.length) return UNIT_COLOR_PALETTE[index];
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 65% 45%)`;
}

/** Couleurs proposées au joueur pour une réassignation manuelle (RG_06). */
export function selectableUnitColors(): readonly string[] {
  return UNIT_COLOR_PALETTE;
}

/**
 * Choisit une couleur de texte lisible sur un fond de token donné, pour les
 * libellés superposés aux tokens (bandeau RT_17, menu RG_16).
 */
export function contrastingTextColor(background: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(background.trim());
  if (!hex) return '#ffffff';
  const value = parseInt(hex[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  // Luminance relative approchée (coefficients ITU-R BT.601).
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff';
}

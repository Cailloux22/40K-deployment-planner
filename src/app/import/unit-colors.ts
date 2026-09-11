/**
 * RG_06 — couleur par unité.
 *
 * Chaque unité importée reçoit automatiquement une couleur distincte ; le
 * joueur peut la réassigner ensuite. Tous les tokens d'une même unité
 * partagent cette couleur pour rester identifiables sur un plateau chargé.
 */

export interface UnitColorChoice {
  readonly value: string;
  /** RG_06: libellé lisible, jamais la notation technique. */
  readonly label: string;
}

/**
 * Palette de départ : teintes espacées et saturations/luminosités choisies
 * pour rester distinguables les unes des autres sur les images de plateau
 * (dominantes grises et beiges) — cf. RT_05 pour la taille des tokens.
 *
 * RG_06: chaque entrée porte son libellé français, seul affiché au joueur.
 */
export const UNIT_COLOR_PALETTE: readonly UnitColorChoice[] = [
  { value: '#e6194b', label: 'Rouge' },
  { value: '#3cb44b', label: 'Vert' },
  { value: '#4363d8', label: 'Bleu' },
  { value: '#f58231', label: 'Orange' },
  { value: '#911eb4', label: 'Violet' },
  { value: '#008080', label: 'Sarcelle' },
  { value: '#f032e6', label: 'Magenta' },
  { value: '#9a6324', label: 'Brun' },
  { value: '#800000', label: 'Bordeaux' },
  { value: '#808000', label: 'Olive' },
  { value: '#000075', label: 'Marine' },
  { value: '#2f4f4f', label: 'Ardoise' },
  { value: '#ff4500', label: 'Orange vif' },
  { value: '#1e90ff', label: 'Bleu ciel' },
  { value: '#b8860b', label: 'Or' },
  { value: '#c71585', label: 'Framboise' },
];

/**
 * RT_32 — couleur de repli d'une unité dont la couleur n'est pas résolue.
 *
 * Remplace le `#888888` répété en quatre points : à 2,5:1 face au texte
 * calculé, il ne tenait aucun seuil. La valeur retenue donne 4,92:1 au libellé
 * superposé et 4,39:1 face au fond de page sombre — au-dessus du seuil de 3:1
 * applicable à un élément non textuel porteur d'information.
 */
export const UNIT_COLOR_FALLBACK = '#7a7a80';

/**
 * Couleur automatique de la n-ième unité d'une liste. Au-delà de la palette,
 * on décale la teinte par l'angle d'or pour continuer à produire des couleurs
 * distinctes plutôt que de recycler les premières à l'identique.
 */
export function autoUnitColor(index: number): string {
  if (index < UNIT_COLOR_PALETTE.length) return UNIT_COLOR_PALETTE[index].value;
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 65% 45%)`;
}

/** Couleurs proposées au joueur pour une réassignation manuelle (RG_06). */
export function selectableUnitColors(): readonly UnitColorChoice[] {
  return UNIT_COLOR_PALETTE;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

/**
 * RT_32 — interprétation d'une notation de couleur.
 *
 * Accepte toutes les notations que l'application produit réellement, `hsl()`
 * compris : c'est celle d'`autoUnitColor` au-delà de la 16e unité, et l'ancien
 * code la rejetait silencieusement.
 */
export function parseColor(color: string): Rgb {
  const text = color.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((d) => d + d)
            .join('')
        : hex[1];
    const value = parseInt(digits, 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }

  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i.exec(text);
  if (hsl) {
    return hslToRgb(Number(hsl[1]) % 360, Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  }

  // RT_32: une notation non interprétable est une erreur de programmation.
  // Retomber silencieusement sur une couleur par défaut produirait exactement
  // le défaut que cette règle existe pour empêcher — un texte blanc sur un
  // fond clair, sans que rien ne le signale.
  throw new Error(`Notation de couleur non reconnue : ${color}`);
}

/**
 * RT_32 — luminance relative au sens des règles d'accessibilité du web.
 *
 * Les composantes sont ramenées à [0, 1] puis **linéarisées individuellement**
 * avant d'être pondérées. Une moyenne pondérée appliquée aux composantes non
 * linéarisées (luminance vidéo BT.601, ce que faisait le code précédent) n'est
 * pas cette grandeur et ne prédit pas le contraste perçu.
 */
export function relativeLuminance(color: string | Rgb): number {
  const { r, g, b } = typeof color === 'string' ? parseColor(color) : color;
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** RT_32 — rapport de contraste entre deux couleurs. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/**
 * RT_32 — les deux seules candidates, et le NOIR PUR volontairement.
 *
 * Ce n'est pas un détail esthétique. Avec un noir adouci (#1a1a1a), il existe
 * une bande de luminances autour de 0,20 où NI le foncé NI le clair n'atteint
 * 4,5:1 : le pire cas possible y plafonne à 4,17:1, et plusieurs couleurs
 * d'unité y tombent. Avec du noir pur, le pire cas possible, tous fonds
 * confondus, remonte à 4,61:1 — la conformité AA du libellé devient une
 * garantie arithmétique valable pour n'importe quelle couleur, et non une
 * propriété à revérifier à chaque retouche de la palette.
 */
const TEXT_ON_TOKEN_DARK = '#000000';
const TEXT_ON_TOKEN_LIGHT = '#ffffff';

/**
 * RT_32 — couleur de texte lisible sur un fond de token donné, pour les
 * libellés superposés aux tokens (bandeau RT_17, menu RG_16).
 *
 * Aucun seuil de luminance : on retient celle des deux candidates dont le
 * rapport de contraste **réellement calculé** est le plus élevé. Un seuil
 * arbitraire produit inévitablement une frange de couleurs pour lesquelles il
 * choisit la moins lisible des deux.
 */
export function contrastingTextColor(background: string): string {
  const bg = parseColor(background);
  return contrastRatio(TEXT_ON_TOKEN_DARK, bg) >= contrastRatio(TEXT_ON_TOKEN_LIGHT, bg)
    ? TEXT_ON_TOKEN_DARK
    : TEXT_ON_TOKEN_LIGHT;
}

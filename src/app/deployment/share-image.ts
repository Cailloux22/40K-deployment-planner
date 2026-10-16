/**
 * EX_15 — logique pure de l'image partagée d'un déploiement terminé
 * (RG_56/RT_74) : texte des bandeaux, géométrie de la composition et nom de
 * fichier. Le dessin lui-même est fait par `DeploymentShareService`.
 */

/** Ce qui identifie le déploiement partagé, fourni par l'écran appelant. */
export interface DeploymentShareInfo {
  readonly listName: string;
  /** RT_23: libellés des dispositions, joueur d'abord (ordre de RG_14). */
  readonly playerDispositionLabel: string;
  readonly opponentDispositionLabel: string;
  /** RT_12: rang du plateau dans le couple, 1 à 3. */
  readonly boardIndex: number;
}

/** RT_74: géométrie de l'image, en pixels de l'asset du plateau. */
export interface ShareImageLayout {
  readonly width: number;
  readonly height: number;
  readonly headerHeight: number;
  readonly footerHeight: number;
  readonly headerFontSize: number;
  readonly footerFontSize: number;
  readonly padding: number;
}

/** RT_74: export JPG uniquement (RG_56), qualité 0,9. */
export const SHARE_IMAGE_TYPE = 'image/jpeg';
export const SHARE_IMAGE_QUALITY = 0.9;

/** RT_74: fond opaque des bandeaux et texte posé dessus (scène sombre, RT_29). */
export const SHARE_BANNER_BACKGROUND = '#11131a';
export const SHARE_BANNER_TEXT = '#f2f2f3';

const FILE_NAME_MAX = 100;

/** RG_56/RT_74: lettre du layout, dérivée de l'index du plateau (1 → A, 2 → B, 3 → C). */
export function layoutLetter(boardIndex: number): string {
  return String.fromCharCode(64 + boardIndex);
}

/**
 * RG_56: en-tête « {disposition joueur} vs {disposition adverse} — Layout {lettre} ».
 * Un couple miroir répète le même nom.
 */
export function shareHeaderText(info: DeploymentShareInfo): string {
  return (
    `${info.playerDispositionLabel} vs ${info.opponentDispositionLabel}` +
    ` — Layout ${layoutLetter(info.boardIndex)}`
  );
}

/**
 * RG_56: lignes du pied — nom de la liste, puis une ligne par mention de
 * source (RT_20), jamais écrites en dur ici : une mention requise ne doit pas
 * être tronquée par sa voisine.
 */
export function shareFooterLines(info: DeploymentShareInfo, attributions: readonly string[]): string[] {
  return [info.listName.trim(), ...attributions].filter((line) => line !== '');
}

/**
 * RT_74: le canvas a les dimensions du rectangle de jeu rogné comme dans
 * l'éditeur de placement (`playArea`, RT_19), à l'échelle native de l'asset,
 * agrandi d'un bandeau au-dessus (en-tête) et au-dessous (pied) ; tailles de
 * texte proportionnelles à sa largeur.
 */
export function shareImageLayout(
  board: { readonly width: number; readonly height: number },
  footerLineCount: number,
): ShareImageLayout {
  const headerFontSize = Math.round(board.width * 0.038);
  const footerFontSize = Math.round(board.width * 0.022);
  const padding = Math.round(board.width * 0.025);
  const headerHeight = headerFontSize + 2 * padding;
  const footerHeight =
    footerLineCount > 0 ? Math.round(footerLineCount * footerFontSize * 1.4) + 2 * padding : 0;
  return {
    width: board.width,
    height: headerHeight + board.height + footerHeight,
    headerHeight,
    footerHeight,
    headerFontSize,
    footerFontSize,
    padding,
  };
}

/** RT_74: texte tronqué avec « … » s'il dépasse la largeur donnée. */
export function truncateToWidth(text: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  const ellipsis = '…';
  let end = text.length;
  while (end > 0 && measure(text.slice(0, end).trimEnd() + ellipsis) > maxWidth) end--;
  return end > 0 ? text.slice(0, end).trimEnd() + ellipsis : ellipsis;
}

/** RT_74: minuscules ASCII sans accent, autres caractères remplacés par `-`. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * RT_74: `windfall-{liste}-{disposition joueur}-vs-{disposition adverse}-layout-{lettre}.jpg`,
 * borné à 100 caractères avant l'extension.
 */
export function shareFileName(info: DeploymentShareInfo): string {
  const parts = [
    'windfall',
    slugify(info.listName),
    slugify(info.playerDispositionLabel),
    'vs',
    slugify(info.opponentDispositionLabel),
    'layout',
    layoutLetter(info.boardIndex).toLowerCase(),
  ].filter((part) => part !== '');
  const base = parts.join('-').slice(0, FILE_NAME_MAX).replace(/-+$/, '');
  return `${base}.jpg`;
}

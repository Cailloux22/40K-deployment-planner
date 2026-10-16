import {
  DeploymentShareInfo,
  layoutLetter,
  shareFileName,
  shareFooterLines,
  shareHeaderText,
  shareImageLayout,
  slugify,
  truncateToWidth,
} from './share-image';

const info: DeploymentShareInfo = {
  listName: 'Élite de Fenris',
  playerDispositionLabel: 'Take and Hold',
  opponentDispositionLabel: 'Purge the Foe',
  boardIndex: 2,
};

describe('share-image (RG_56/RT_74)', () => {
  it('dérive la lettre du layout de l’index du plateau', () => {
    expect([1, 2, 3].map(layoutLetter)).toEqual(['A', 'B', 'C']);
  });

  it('compose l’en-tête dispositions + Layout + lettre, joueur d’abord', () => {
    expect(shareHeaderText(info)).toBe('Take and Hold vs Purge the Foe — Layout B');
  });

  it('répète le nom pour un couple miroir', () => {
    const mirror = { ...info, opponentDispositionLabel: 'Take and Hold', boardIndex: 1 };
    expect(shareHeaderText(mirror)).toBe('Take and Hold vs Take and Hold — Layout A');
  });

  it('met le nom de liste puis les mentions de source en pied', () => {
    expect(shareFooterLines(info, ['Powered by Wahapedia', 'Battlemaster'])).toEqual([
      'Élite de Fenris',
      'Powered by Wahapedia',
      'Battlemaster',
    ]);
    expect(shareFooterLines({ ...info, listName: '  ' }, [])).toEqual([]);
  });

  it('agrandit le canvas des deux bandeaux sans toucher au plateau', () => {
    const layout = shareImageLayout({ width: 1653, height: 2833 }, 2);
    expect(layout.width).toBe(1653);
    expect(layout.height).toBe(layout.headerHeight + 2833 + layout.footerHeight);
    expect(layout.headerFontSize).toBeGreaterThan(layout.footerFontSize);
    expect(shareImageLayout({ width: 1653, height: 2833 }, 0).footerHeight).toBe(0);
  });

  it('tronque un texte trop long avec une ellipse', () => {
    const measure = (text: string) => text.length;
    expect(truncateToWidth('court', 10, measure)).toBe('court');
    expect(truncateToWidth('un texte bien trop long', 10, measure)).toBe('un texte…');
  });

  it('produit un nom de fichier ASCII en .jpg', () => {
    expect(slugify('Élite de Fenris !')).toBe('elite-de-fenris');
    expect(shareFileName(info)).toBe('windfall-elite-de-fenris-take-and-hold-vs-purge-the-foe-layout-b.jpg');
  });

  it('borne le nom de fichier à 100 caractères avant l’extension', () => {
    const name = shareFileName({ ...info, listName: 'x'.repeat(300) });
    expect(name.endsWith('.jpg')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(104);
  });
});

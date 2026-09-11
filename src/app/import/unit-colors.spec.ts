import {
  UNIT_COLOR_FALLBACK,
  UNIT_COLOR_PALETTE,
  autoUnitColor,
  contrastRatio,
  contrastingTextColor,
  parseColor,
  relativeLuminance,
  selectableUnitColors,
} from './unit-colors';

/** Seuil AA pour un texte de taille courante (WCAG 1.4.3). */
const AA = 4.5;

describe('relativeLuminance — RT_32 (luminance relative, pas BT.601)', () => {
  it('donne les valeurs de référence des règles d’accessibilité', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
    // Valeur de référence du gris moyen : c'est la LINÉARISATION qui la
    // produit. La moyenne pondérée non linéarisée du code précédent donnait
    // ≈ 0,502 — soit plus du double.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
  });

  it('n’est pas une moyenne pondérée des composantes brutes', () => {
    const brut = (0.299 * 128 + 0.587 * 128 + 0.114 * 128) / 255;
    expect(Math.abs(relativeLuminance('#808080') - brut)).toBeGreaterThan(0.25);
  });
});

describe('parseColor — RT_32 (notations réellement produites)', () => {
  it('interprète les deux longueurs de notation hexadécimale', () => {
    expect(parseColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(parseColor('#aabbcc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(parseColor('  #AABBCC  ')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it('interprète rgb() et hsl()', () => {
    expect(parseColor('rgb(1 2 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3 });

    // hsl() est la notation d'autoUnitColor au-delà de la palette : la rejeter
    // était la cause du texte systématiquement blanc dès la 17e unité.
    const rouge = parseColor('hsl(0 100% 50%)');
    expect(rouge.r).toBeCloseTo(255, 6);
    expect(rouge.g).toBeCloseTo(0, 6);
    expect(rouge.b).toBeCloseTo(0, 6);

    const gris = parseColor('hsl(210 0% 50%)');
    expect(gris.r).toBeCloseTo(127.5, 6);
    expect(gris.g).toBeCloseTo(127.5, 6);
  });

  it('signale une notation non reconnue plutôt que de retomber sur du blanc', () => {
    // RT_32: le repli silencieux produisait exactement le défaut que la règle
    // existe pour empêcher — un texte blanc sur un fond clair, sans alerte.
    expect(() => parseColor('rebeccapurple')).toThrow();
    expect(() => parseColor('')).toThrow();
    expect(() => parseColor('#12345')).toThrow();
  });
});

describe('contrastingTextColor — RT_32', () => {
  it('retient toujours la meilleure des deux couleurs candidates', () => {
    const fonds = [
      ...UNIT_COLOR_PALETTE.map((c) => c.value),
      UNIT_COLOR_FALLBACK,
      '#ffffff',
      '#000000',
      '#7f7f7f',
    ];
    for (const fond of fonds) {
      const choisie = contrastingTextColor(fond);
      const autre = choisie === '#ffffff' ? '#000000' : '#ffffff';
      expect(contrastRatio(choisie, fond)).toBeGreaterThanOrEqual(contrastRatio(autre, fond));
    }
  });

  it('reste conforme AA sur toute la palette et sur le repli', () => {
    for (const { value, label } of UNIT_COLOR_PALETTE) {
      const ratio = contrastRatio(contrastingTextColor(value), value);
      expect(ratio, `${label} (${value})`).toBeGreaterThanOrEqual(AA);
    }
    expect(contrastRatio(contrastingTextColor(UNIT_COLOR_FALLBACK), UNIT_COLOR_FALLBACK)).toBeGreaterThanOrEqual(AA);
  });

  it('reste conforme AA au-delà de la palette, où les couleurs sont en hsl()', () => {
    // Test de non-régression du défaut principal : l'ancienne implémentation
    // renvoyait du blanc pour TOUTE notation non hexadécimale, donc dès i = 16.
    for (let i = 0; i < 60; i += 1) {
      const couleur = autoUnitColor(i);
      const ratio = contrastRatio(contrastingTextColor(couleur), couleur);
      expect(ratio, `unité ${i} (${couleur})`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('garantit AA sur N’IMPORTE quel fond, pas seulement sur la palette', () => {
    // Avec du noir pur comme candidate foncée, le pire cas arithmétique sur
    // l'ensemble des fonds possibles vaut 4,61:1. On balaie la famille des gris,
    // qui contient précisément ce pire cas (croisement des deux candidates).
    for (let v = 0; v <= 255; v += 1) {
      const fond = '#' + v.toString(16).padStart(2, '0').repeat(3);
      expect(contrastRatio(contrastingTextColor(fond), fond), fond).toBeGreaterThanOrEqual(AA);
    }
  });

  it('choisit du texte foncé sur un fond clair et inversement', () => {
    expect(contrastingTextColor('#ffffff')).toBe('#000000');
    expect(contrastingTextColor('#000075')).toBe('#ffffff');
  });
});

describe('palette — RG_06', () => {
  it('propose 16 couleurs désignées par un libellé lisible, jamais par leur notation', () => {
    const choix = selectableUnitColors();
    expect(choix).toHaveLength(16);
    for (const { value, label } of choix) {
      expect(label.trim()).not.toBe('');
      expect(label).not.toContain('#');
      expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('n’a ni valeur ni libellé en double', () => {
    const choix = selectableUnitColors();
    expect(new Set(choix.map((c) => c.value)).size).toBe(choix.length);
    expect(new Set(choix.map((c) => c.label)).size).toBe(choix.length);
  });

  it('attribue une couleur distincte et déterministe à chaque unité de la palette', () => {
    const couleurs = Array.from({ length: UNIT_COLOR_PALETTE.length }, (_, i) => autoUnitColor(i));
    expect(new Set(couleurs).size).toBe(couleurs.length);
    expect(autoUnitColor(3)).toBe(autoUnitColor(3));
  });

  it('continue à produire des couleurs distinctes au-delà de la palette', () => {
    const couleurs = Array.from({ length: 40 }, (_, i) => autoUnitColor(i));
    expect(new Set(couleurs).size).toBe(couleurs.length);
  });
});

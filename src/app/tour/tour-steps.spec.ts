import { readFileSync } from 'node:fs';

import { TOUR_STEPS, TourScreen, offersBack } from './tour-steps';

/** RT_82: gabarits où chaque écran pose ses ancres `data-tour`. */
const TEMPLATES: Readonly<Record<TourScreen, readonly string[]>> = {
  home: ['src/app/home/home.page.html'],
  import: ['src/app/pages/import/import.page.html'],
  adversary: ['src/app/pages/adversary/adversary.page.html'],
  boards: ['src/app/pages/board-choice/board-choice.page.html', 'src/app/shared/board-viewer.component.ts'],
  placement: ['src/app/pages/placement/placement.page.html'],
  settings: ['src/app/pages/settings/settings.page.html'],
};

describe('TOUR_STEPS — RG_66/RT_82', () => {
  it('compte 46 étapes, le N du compteur « n / N » (RG_63)', () => {
    expect(TOUR_STEPS).toHaveLength(46);
  });

  it('donne à chaque étape un identifiant unique', () => {
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(TOUR_STEPS.length);
  });

  it('suit l’ordre des écrans du scénario', () => {
    const screens = TOUR_STEPS.map((step) => step.screen).filter(
      (screen, index, all) => index === 0 || all[index - 1] !== screen,
    );
    expect(screens).toEqual(['home', 'import', 'home', 'adversary', 'boards', 'placement', 'boards', 'settings']);
  });

  it('trouve chaque ancre dans le gabarit de son écran', () => {
    for (const step of TOUR_STEPS) {
      if (!step.anchor) continue;
      const sources = TEMPLATES[step.screen].map((path) => readFileSync(path, 'utf8')).join('\n');
      const declared = sources.includes(`data-tour="${step.anchor}"`) || sources.includes(`'${step.anchor}'`);
      expect(declared, `${step.id} → ${step.anchor}`).toBe(true);
    }
  });

  it('n’offre « Précédent » ni sur la première étape d’un écran, ni après une action qui change l’écran (RG_63)', () => {
    expect(offersBack(TOUR_STEPS, 0)).toBe(false);
    TOUR_STEPS.forEach((step, index) => {
      if (index > 0 && TOUR_STEPS[index - 1].screen !== step.screen) {
        expect(offersBack(TOUR_STEPS, index), step.id).toBe(false);
      }
    });
    const index = (id: string) => TOUR_STEPS.findIndex((step) => step.id === id);
    // Le récapitulatif remplace le choix du fichier.
    expect(offersBack(TOUR_STEPS, index('import-name'))).toBe(false);
    expect(offersBack(TOUR_STEPS, index('import-disposition'))).toBe(true);
    // La vue « Consulter » ouverte par la visite.
    expect(offersBack(TOUR_STEPS, index('viewer'))).toBe(false);
  });

  it('montre les actions destructrices ou sortantes sans les exécuter (RG_66)', () => {
    const actions = TOUR_STEPS.map((step) => step.action).filter(Boolean);
    expect(actions).toEqual([
      'loadExample',
      'saveExample',
      'createDemoDeployment',
      'selectToken',
      'selectUnit',
      'clearSelection',
      'reserveRemaining',
      'openConsult',
      'closeConsult',
    ]);
  });
});

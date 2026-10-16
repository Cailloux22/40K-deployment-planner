// EX_15 — partage d'un déploiement terminé en image JPG (RG_56/RT_74/RT_75).
const RECO_LIST = 'cypress/fixtures/lists/reconnaissance.json';
const DB_NAME = 'windfall-planner';

/**
 * Affiche le plateau n°2 du pager et attend la fin du défilement doux : pendant
 * celui-ci, le suivi du défilement (RG_14) repasse brièvement par le plateau 1.
 */
function showBoard2(): void {
  cy.get('button.tab[aria-label^="Plateau 2"]').click();
  cy.get('.pager').should(($pager) => {
    expect($pager[0].scrollLeft).to.be.closeTo($pager[0].clientWidth, 2);
  });
  cy.get('button.tab[aria-label^="Plateau 2"]').should('have.attr', 'aria-selected', 'true');
}

const shareButton = () => cy.get('button[aria-label="Partager le déploiement en image"]');

/**
 * RG_25: déploiement « fait » sans poser les modèles un à un — toutes les
 * unités en réserve, sauf les modèles de la première unité, posés en ligne
 * pour que l'image contienne des tokens.
 */
function seedFinishedDeployment(): void {
  cy.window().then(
    (win) =>
      new Cypress.Promise<void>((resolve, reject) => {
        const open = win.indexedDB.open(DB_NAME);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['lists', 'deployments'], 'readwrite');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          const lists = tx.objectStore('lists').getAll();
          lists.onsuccess = () => {
            type Unit = {
              id: string;
              modelGroups: { id: string; count: number }[];
            };
            const units = lists.result[0].units as Unit[];
            const [first, ...others] = units;
            const placements = first.modelGroups.flatMap((group) =>
              Array.from({ length: group.count }, (_, rank) => ({
                idUnite: first.id,
                idModele: `${group.id}#${rank}`,
                x: 400 + rank * 60,
                y: 1500,
                rotation: 0,
              })),
            );
            const deployments = tx.objectStore('deployments').getAll();
            deployments.onsuccess = () => {
              for (const deployment of deployments.result) {
                tx.objectStore('deployments').put({
                  ...deployment,
                  placements,
                  reservedUnitIds: others.map((unit) => unit.id),
                });
              }
            };
          };
        };
      }),
  );
}

describe('Partage d’un déploiement en image', () => {
  beforeEach(() => {
    cy.visitFresh('/import');
    cy.get('input[type="file"]').selectFile(RECO_LIST, { force: true });
    cy.contains('.disposition h2', 'Reconnaissance').should('be.visible');
    cy.contains('ion-footer ion-button', 'Enregistrer la liste').click();
    cy.location('pathname').should('eq', '/home');
    cy.contains('.list-card', 'reco').click();
    cy.get('path.sector[aria-label^="Purge the Foe"]').click();
    showBoard2();
    cy.contains('ion-button', 'Nouveau').click();
    cy.location('pathname').should('match', /\/placement$/);
    cy.get('button[aria-label="Revenir au choix du plateau"]').click();
    cy.location('pathname').should('match', /\/boards$/);
    seedFinishedDeployment();
    cy.reload();
    showBoard2();
  });

  it('n’offre pas le partage sur le plateau seul', () => {
    cy.get('button.preview').filter(':visible').first().click();
    cy.get('app-board-viewer .viewer').should('be.visible');
    cy.get('button[aria-label^="Partage"]').should('not.exist');
  });

  it('partage une image JPG nommée d’après le déploiement, sans choix de format', () => {
    cy.window().then((win) => {
      // RT_75: Web Share API simulée — on capture le fichier transmis.
      Object.defineProperty(win.navigator, 'canShare', {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(win.navigator, 'share', {
        configurable: true,
        value: cy.stub().as('share').resolves(),
      });
    });

    cy.contains('ion-button', 'Consulter').click();
    cy.get('app-board-viewer .viewer').should('be.visible');
    shareButton().click();
    cy.get('ion-action-sheet').should('not.exist');

    cy.get('@share').should('have.been.calledOnce');
    cy.get('@share').then((stub) => {
      const data = (stub as unknown as sinon.SinonStub).firstCall.args[0] as ShareData;
      const file = data.files![0];
      expect(file.type).to.eq('image/jpeg');
      expect(file.name).to.match(/^windfall-.+-reconnaissance-vs-purge-the-foe-layout-b\.jpg$/);
      expect(data.title).to.eq('Reconnaissance vs Purge the Foe — Layout B');

      // RT_74: rectangle de jeu rogné comme dans l'éditeur (RT_19), à
      // l'échelle native, + en-tête + pied — sans bandeau de titre ni légende.
      return new Cypress.Promise<void>((resolve) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          expect(image.naturalWidth).to.be.within(1100, 1160);
          expect(image.naturalHeight).to.be.within(1600, 2000);
          URL.revokeObjectURL(url);
          resolve();
        };
        image.src = url;
      });
    });
    shareButton().should('exist');
  });

  it('se replie sur un téléchargement quand le partage de fichier est absent', () => {
    cy.window().then((win) => {
      Object.defineProperty(win.navigator, 'canShare', {
        configurable: true,
        value: undefined,
      });
    });
    cy.contains('ion-button', 'Consulter').click();
    shareButton().click();
    // Le message est rendu dans le shadow DOM du toast : on lit sa propriété.
    cy.get('ion-toast').should('have.prop', 'message', 'Image enregistrée dans les téléchargements');
  });
});

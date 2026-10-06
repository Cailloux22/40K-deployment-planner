// EX_14 — missions primaires du couple de dispositions : bouton du choix du
// plateau, de l'écran de placement et du visualiseur « Consulter » (RG_48),
// onglets à l'étroit, vue côte à côte à partir de 720 px (RT_66).
const RECO_LIST = 'cypress/fixtures/lists/reconnaissance.json';
const DB_NAME = '40k-deployment-planner';

// Ionic garde l'écran précédent dans le DOM, masqué : seul le bouton visible compte.
const missionsButton = () => cy.get('button[aria-label="Voir les missions primaires"]').filter(':visible');
const closeMissions = () => cy.get('button[aria-label="Fermer les missions primaires"]').filter(':visible').click();

/** RG_25: toutes les unités en réserve, pour un déploiement « fait » (RG_14). */
function reserveEveryUnit(): void {
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
            const units = (lists.result[0].units as { id: string }[]).map((u) => u.id);
            const deployments = tx.objectStore('deployments').getAll();
            deployments.onsuccess = () => {
              for (const deployment of deployments.result) {
                tx.objectStore('deployments').put({ ...deployment, reservedUnitIds: units });
              }
            };
          };
        };
      }),
  );
}

/** Importe la liste Reconnaissance et ouvre le choix du plateau contre `opponent`. */
function openBoardChoice(opponent: string): void {
  cy.visitFresh('/import');
  cy.get('input[type="file"]').selectFile(RECO_LIST, { force: true });
  cy.contains('.disposition h2', 'Reconnaissance').should('be.visible');
  cy.contains('ion-footer ion-button', 'Enregistrer la liste').click();
  cy.location('pathname').should('eq', '/home');
  cy.contains('.list-card', 'reco').click();
  cy.get(`path.sector[aria-label^="${opponent}"]`).click();
  cy.location('pathname').should('match', /\/boards$/);
}

describe('Missions primaires', () => {
  it('à l\'étroit, montre ma mission puis la mission adverse dans deux onglets', () => {
    openBoardChoice('Purge the Foe');

    missionsButton().click();
    cy.contains('ion-modal ion-title', 'Missions primaires').should('be.visible');

    // RG_48: ouverture sur « Ma mission » — Reconnaissance contre Purge the Foe.
    cy.get('ion-modal ion-segment-button').should('have.length', 2);
    cy.get('ion-modal ion-segment-button').eq(0).should('contain', 'Ma mission').and('contain', 'Triangulation');
    cy.get('ion-modal ion-segment-button').eq(1).should('contain', 'Mission adverse').and('contain', 'Consecrate');
    cy.get('ion-modal img[alt^="Carte de mission primaire Triangulation"]').should('be.visible');

    // RG_48: l'autre onglet affiche la carte du jeu adverse.
    cy.get('ion-modal ion-segment-button').eq(1).click();
    cy.get('ion-modal img[alt^="Carte de mission primaire Consecrate"]').should('be.visible');
    cy.get('ion-modal .columns').should('not.exist');

    // RG_48: la fermeture ramène au choix du plateau, intact.
    closeMissions();
    cy.get('ion-modal').should('not.exist');
    cy.location('pathname').should('match', /\/boards$/);
  });

  it('dans un couple miroir, affiche une seule carte sans sélecteur', () => {
    openBoardChoice('Reconnaissance');

    missionsButton().click();
    cy.get('ion-modal ion-segment').should('not.exist');
    cy.contains('ion-modal', 'Gather Intel').should('be.visible');
    cy.contains('ion-modal', 'Mission miroir : les deux joueurs jouent cette même carte').should('be.visible');
  });

  it('sur écran large, affiche plateau, ma mission et mission adverse côte à côte', () => {
    cy.viewport(1024, 768);
    openBoardChoice('Purge the Foe');

    missionsButton().click();
    cy.get('ion-modal .columns .column').should('have.length', 3);
    cy.get('ion-modal .column').eq(0).should('contain', 'Plateau');
    cy.get('ion-modal .column').eq(1).should('contain', 'Ma mission').and('contain', 'Triangulation');
    cy.get('ion-modal .column').eq(2).should('contain', 'Mission adverse').and('contain', 'Consecrate');
    cy.get('ion-modal ion-segment').should('not.exist');
    cy.get('ion-modal img[alt$="avec repères de mesure"]').should('be.visible');
  });

  it('est accessible depuis l\'écran de placement et le visualiseur « Consulter »', () => {
    openBoardChoice('Purge the Foe');
    cy.get('button.tab[aria-label^="Plateau 1"]').click();
    cy.contains('ion-button', 'Nouveau').click();
    cy.location('pathname').should('match', /\/placement$/);

    // RG_48: en-tête de l'écran de placement, à gauche du plan de jeu.
    missionsButton().click();
    cy.contains('ion-modal', 'Triangulation').should('be.visible');
    closeMissions();
    cy.get('ion-modal').should('not.exist');
    cy.location('pathname').should('match', /\/placement$/);

    cy.get('button[aria-label="Revenir au choix du plateau"]').click();
    cy.location('pathname').should('match', /\/boards$/);
    reserveEveryUnit();
    cy.reload();

    // RG_48: le « plateau seul » ne porte pas le bouton, « Consulter » si.
    cy.get('button.preview').first().click();
    cy.get('app-board-viewer .viewer').should('be.visible');
    // Le déploiement n'a pas de note : le coin haut droit n'a que le bouton
    // des missions, et seulement dans « Consulter ».
    cy.get('app-board-viewer .corner-actions ion-button').should('have.length', 0);
    cy.get('button[aria-label="Fermer la vue plein écran"]').filter(':visible').click();
    cy.get('app-board-viewer').should('not.exist');

    cy.contains('ion-button', 'Consulter').click();
    cy.get('app-board-viewer .corner-actions ion-button').should('have.length', 1).click();
    cy.contains('ion-modal', 'Consecrate').should('be.visible');
    closeMissions();
    cy.get('ion-modal').should('not.exist');
    cy.get('app-board-viewer .viewer').should('be.visible');
  });

  // RG_48: recto/verso. Reconnaissance contre Purge the Foe : Triangulation
  // (ma mission) a un verso, Consecrate (mission adverse) n'en a pas.
  it('retourne une carte qui a un verso, et garde sa face tant que la fenêtre est ouverte', () => {
    openBoardChoice('Purge the Foe');
    missionsButton().click();

    cy.contains('ion-modal .face-bar', 'Triangulation').should('contain', 'Recto');
    cy.contains('ion-modal ion-button', 'Voir le verso').click();
    cy.contains('ion-modal .face-bar', 'Verso').should('be.visible');
    cy.get('ion-modal img[alt$="— verso"]').should('be.visible');
    cy.contains('ion-modal ion-button', 'Voir le recto').should('exist');

    // RG_48: pas de bouton pour une carte sans verso.
    cy.get('ion-modal ion-segment-button').eq(1).click();
    cy.get('ion-modal img[alt^="Carte de mission primaire Consecrate"]').should('be.visible');
    cy.get('ion-modal .face-bar').should('not.exist');

    // RG_48: la face est conservée au retour sur l'onglet…
    cy.get('ion-modal ion-segment-button').eq(0).click();
    cy.get('ion-modal img[alt$="— verso"]').should('be.visible');

    // … et la carte repart sur son recto à la réouverture.
    closeMissions();
    cy.get('ion-modal').should('not.exist');
    missionsButton().click();
    cy.contains('ion-modal .face-bar', 'Recto').should('be.visible');
    cy.get('ion-modal img[alt$="— verso"]').should('not.exist');
  });

  it('sur écran large, ne propose le retournement que dans la colonne de la carte qui a un verso', () => {
    cy.viewport(1024, 768);
    openBoardChoice('Purge the Foe');
    missionsButton().click();

    cy.get('ion-modal .column').eq(0).find('.face-controls').should('not.exist');
    cy.get('ion-modal .column').eq(2).find('.face-controls').should('not.exist');
    cy.get('ion-modal .column').eq(1).within(() => {
      cy.contains('.face', 'Recto');
      cy.contains('ion-button', 'Voir le verso').click();
      cy.contains('.face', 'Verso');
      cy.get('img[alt$="— verso"]').should('be.visible');
    });
  });
});

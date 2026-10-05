// EX_13 — note de plan de jeu : édition sur l'écran de placement (RG_45),
// conservation par « Nouveau » (RG_14/RT_60), lecture seule dans « Consulter »
// (RG_46).
const RECO_LIST = 'cypress/fixtures/lists/reconnaissance.json';
const DB_NAME = '40k-deployment-planner';
const NOTE = 'Tour 1 : tenir le centre.\nTour 2 : réserves sur le flanc gauche.';

const noteButton = (label: string) => cy.get(`button[aria-label="${label}"]`);

/** Ouvre l'écran de placement du plateau n°1 de Purge the Foe par « Nouveau ». */
function openPlacementByNew(): void {
  cy.contains('ion-button', 'Nouveau').click();
  cy.location('pathname').should('match', /\/placement$/);
}

/**
 * RG_25: met toutes les unités du déploiement en réserve directement dans
 * IndexedDB, pour obtenir un déploiement « fait » (vert, RG_14) sans poser un
 * à un tous les modèles de la liste.
 */
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

describe('Note de plan de jeu', () => {
  beforeEach(() => {
    cy.visitFresh('/import');
    cy.get('input[type="file"]').selectFile(RECO_LIST, { force: true });
    cy.contains('.disposition h2', 'Reconnaissance').should('be.visible');
    cy.contains('ion-footer ion-button', 'Enregistrer la liste').click();
    cy.location('pathname').should('eq', '/home');
    cy.contains('.list-card', 'reco').click();
    cy.get('path.sector[aria-label^="Purge the Foe"]').click();
    cy.get('button.tab[aria-label^="Plateau 1"]').click();
    openPlacementByNew();
  });

  it('rédige, abandonne puis valide la note, et la conserve après « Nouveau »', () => {
    // RG_45: sans note, icône contour et nom « Rédiger ».
    noteButton('Rédiger le plan de jeu').click();
    cy.get('ion-modal ion-textarea textarea').should('be.visible').type('Brouillon');

    // RG_45: un abandon de texte modifié est confirmé.
    cy.contains('ion-modal ion-button', 'Annuler').click();
    cy.contains('ion-alert', 'Abandonner les modifications ?').should('be.visible');
    cy.contains('ion-alert button', 'Abandonner').click();
    cy.get('ion-modal').should('not.exist');
    noteButton('Rédiger le plan de jeu').should('exist');

    noteButton('Rédiger le plan de jeu').click();
    cy.get('ion-modal ion-textarea textarea').should('have.value', '').type(NOTE);
    cy.contains('ion-modal ion-button', 'Valider').click();
    cy.get('ion-modal').should('not.exist');

    // RG_45/RG_24: avec note, le nom accessible change.
    noteButton('Modifier le plan de jeu').should('exist');

    // RG_14/RT_60: « Nouveau » conserve la note. Le déploiement ne porte
    // qu'une note, il reste rouge : « Nouveau » ne demande pas confirmation.
    cy.get('button[aria-label="Revenir au choix du plateau"]').click();
    cy.location('pathname').should('match', /\/boards$/);
    openPlacementByNew();
    noteButton('Modifier le plan de jeu').click();
    cy.get('ion-modal ion-textarea textarea').should('have.value', NOTE);
    // Fermeture sans modification : aucune confirmation.
    cy.contains('ion-modal ion-button', 'Annuler').click();
    cy.get('ion-alert').should('not.exist');
    cy.get('ion-modal').should('not.exist');
  });

  it('affiche la note en lecture seule dans « Consulter »', () => {
    noteButton('Rédiger le plan de jeu').click();
    cy.get('ion-modal ion-textarea textarea').type(NOTE);
    cy.contains('ion-modal ion-button', 'Valider').click();
    cy.get('ion-modal').should('not.exist');
    cy.get('button[aria-label="Revenir au choix du plateau"]').click();
    cy.location('pathname').should('match', /\/boards$/);

    reserveEveryUnit();
    // Rechargement : la bibliothèque relit IndexedDB (statut vert, RG_14).
    cy.reload();
    cy.contains('ion-button', 'Consulter').click();

    cy.get('app-board-viewer .viewer').should('be.visible');
    noteButton('Lire le plan de jeu').click();
    cy.get('ion-modal .note-text').should('have.text', NOTE);
    cy.get('ion-modal textarea').should('not.exist');
    cy.contains('ion-modal ion-button', 'Valider').should('not.exist');
    cy.contains('ion-modal ion-button', 'Fermer').click();
    cy.get('ion-modal').should('not.exist');
    cy.get('app-board-viewer .viewer').should('be.visible');
  });
});

// RG_07/RG_12/RG_14/RG_24/EX_04 — un seul déploiement fait sur le plateau 1
// de Reconnaissance ne doit compter qu'une fois : sur le cadran des
// dispositions adverses (« 1/3 ») comme sur la carte de la liste à l'accueil
// (« 1 déploiement sauvegardé »).
//
// Non-régression du bug signalé avec la liste « Ligue du café 2 » (Take and
// Hold) : après un déploiement terminé sur le plateau 1 de Reconnaissance, un
// appui sur l'icône disquette de l'écran de placement (« Enregistrer sous un
// nouveau nom ») créait une copie du même triplet, invisible au choix du
// plateau mais comptée : le cadran affichait 2/3 et l'accueil « 2 déploiements
// sauvegardés ». RG_07: le bouton est retiré, la sauvegarde étant continue.
const LIST = 'cypress/fixtures/lists/ligue-du-cafe-2.json';
const LIST_NAME = 'Ligue du café 2';
const DB_NAME = 'windfall-planner';

interface StoredDeployment {
  id: string;
  opponentDispositionId: string;
  boardId: string;
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

/** Les déploiements enregistrés dans IndexedDB (RT_08). */
function storedDeployments(): Cypress.Chainable<StoredDeployment[]> {
  return cy.window().then(
    (win) =>
      new Cypress.Promise<StoredDeployment[]>((resolve, reject) => {
        const open = win.indexedDB.open(DB_NAME);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('deployments').objectStore('deployments').getAll();
          request.onsuccess = () => {
            db.close();
            resolve(request.result as StoredDeployment[]);
          };
          request.onerror = () => reject(request.error);
        };
      }),
  );
}

describe('Compte des déploiements', () => {
  it('ne compte qu\'une fois un déploiement fait sur le plateau 1 de Reconnaissance', () => {
    // Import de la liste (Take and Hold).
    cy.visitFresh('/import');
    cy.get('input[type="file"]').selectFile(LIST, { force: true });
    cy.contains('.disposition h2', 'Take and Hold').should('be.visible');
    cy.contains('ion-footer ion-button', 'Enregistrer la liste').click();
    cy.location('pathname').should('eq', '/home');

    // Reconnaissance → plateau 1 → « Nouveau ».
    cy.contains('.list-card', LIST_NAME).click();
    cy.get('path.sector[aria-label^="Reconnaissance"]').click();
    cy.location('pathname').should('match', /\/boards$/);
    cy.get('button.tab[aria-label^="Plateau 1"]').click();
    cy.contains('ion-button', 'Nouveau').click();
    cy.location('pathname').should('match', /\/placement$/);
    cy.contains('.band-unit small', 'à placer').should('be.visible');

    // Déploiement terminé (RG_14) : toutes les unités en réserve (RG_25).
    reserveEveryUnit();
    cy.reload();
    cy.contains('.band-unit small', 'en réserve').should('be.visible');

    // RG_07: aucun bouton d'enregistrement dans l'en-tête — rien ne permet
    // de dupliquer le déploiement du triplet.
    cy.get('button[aria-label="Revenir au choix du plateau"]').filter(':visible').should('exist');
    cy.get('button[aria-label="Enregistrer sous un nouveau nom"]').should('not.exist');

    // Retour au cadran des dispositions adverses.
    cy.get('button[aria-label="Revenir au choix du plateau"]').filter(':visible').click();
    cy.location('pathname').should('match', /\/boards$/);
    cy.get('button[aria-label="Revenir au choix de la disposition adverse"]').filter(':visible').click();
    cy.location('pathname').should('match', /\/adversary$/);

    // RG_07: un seul déploiement stocké pour le triplet.
    storedDeployments().then((deployments) => {
      expect(deployments.map((d) => `${d.opponentDispositionId} / ${d.boardId}`)).to.deep.equal([
        'reconnaissance / reconnaissance__take-and-hold__1',
      ]);
    });

    // RG_24: un seul plateau fait sur Reconnaissance → « 1/3 ».
    cy.get('path.sector[aria-label^="Reconnaissance"]')
      .invoke('attr', 'aria-label')
      .should('match', /\(1\/3\)$/);

    // EX_04: un seul déploiement sauvegardé pour la liste.
    cy.get('button[aria-label="Retour à mes listes"]').filter(':visible').click();
    cy.location('pathname').should('eq', '/home');
    cy.contains('.list-card', LIST_NAME)
      .find('.deployments')
      .should('contain.text', '1 déploiement sauvegardé');
  });
});

/// <reference types="cypress" />

// Nom de la base IndexedDB de l'application (src/app/data/local-store.service.ts).
const DB_NAME = 'windfall-planner';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /**
       * Ouvre une route de l'application avec un stockage local vierge.
       * L'isolation de Cypress vide localStorage/cookies mais pas IndexedDB,
       * où vivent les listes et déploiements (RT_08) : on la supprime avant
       * le chargement de l'application.
       */
      visitFresh(path?: string, options?: { tour?: boolean }): Chainable<void>;
    }
  }
}

Cypress.Commands.add('visitFresh', (path = '/', options: { tour?: boolean } = {}) => {
  cy.visit(path, {
    onBeforeLoad(win) {
      win.indexedDB.deleteDatabase(DB_NAME);
      // RG_62: la visite guidée s'ouvre d'elle-même sur un stockage vierge ; elle
      // est marquée comme déjà proposée, sauf pour les tests qui la parcourent.
      if (!options.tour) win.localStorage.setItem('wfp.tour.proposed', 'true');
    },
  });
  // Ionic re-rend la page pendant sa transition d'entrée : on attend qu'elle
  // soit visible et hydratée pour ne pas agir sur un élément sur le point
  // d'être détaché du DOM.
  cy.get('ion-router-outlet > .ion-page:not(.ion-page-invisible)').should('be.visible');
  cy.get('ion-app').should('have.class', 'hydrated');
});

export {};

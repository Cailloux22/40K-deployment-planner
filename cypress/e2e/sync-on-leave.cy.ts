// RT_10 — la sortie de l'écran de placement déclenche une synchronisation,
// par le bouton retour de l'écran comme par le retour du navigateur.
const RECO_LIST = 'cypress/fixtures/lists/reconnaissance.json';
const USER = { id: 'cypress-user', email: 'cypress@example.test' };
const EMPTY_PULL = {
  lists: [],
  deployments: [],
  deletedListIds: [],
  deletedDeploymentIds: [],
  nextToken: 'rev-1',
  hasMore: false,
};

describe('Synchronisation à la sortie de l’écran de placement', () => {
  let pulls = 0;

  beforeEach(() => {
    pulls = 0;
    // Serveur de synchronisation simulé : delta vide, poussée sans effet.
    cy.intercept('GET', '**/v1/sync/changes*', (req) => {
      pulls++;
      req.reply(EMPTY_PULL);
    }).as('pull');
    cy.intercept('POST', '**/v1/sync/changes', { accepted: [], conflicts: [], rejected: [] });

    cy.visitFresh('/import');
    cy.get('input[type="file"]').selectFile(RECO_LIST, { force: true });
    cy.contains('.disposition h2', 'Reconnaissance').should('be.visible');
    cy.contains('ion-footer ion-button', 'Enregistrer la liste').click();
    cy.location('pathname').should('eq', '/home');

    // Appareil déjà rattaché au compte (RG_51) : pas de choix de première
    // connexion, la passe va directement au pull puis à la poussée.
    cy.window().then((win) => {
      win.localStorage.setItem('wfp.auth.session', JSON.stringify({ deviceToken: 'cypress-token', user: USER }));
      win.localStorage.setItem('wfp.sync.accountId', JSON.stringify(USER.id));
    });
    cy.reload();
    cy.get('ion-app').should('have.class', 'hydrated');
    cy.wait('@pull');

    cy.contains('.list-card', 'reco').click();
    cy.get('path.sector[aria-label^="Purge the Foe"]').click();
    cy.get('button.tab[aria-label^="Plateau 1"]').click();
    cy.contains('ion-button', 'Nouveau').click();
    cy.location('pathname').should('match', /\/placement$/);
    cy.get('button[aria-label="Revenir au choix du plateau"]').should('be.visible');
  });

  it('par le bouton retour de l’écran', () => {
    cy.then(() => {
      const before = pulls;
      cy.get('button[aria-label="Revenir au choix du plateau"]').click();
      cy.location('pathname').should('match', /\/boards$/);
      cy.wrap(null).should(() => expect(pulls).to.be.greaterThan(before));
    });
  });

  it('par le retour du navigateur', () => {
    cy.then(() => {
      const before = pulls;
      cy.go('back');
      cy.location('pathname').should('not.match', /\/placement$/);
      cy.wrap(null).should(() => expect(pulls).to.be.greaterThan(before));
    });
  });
});

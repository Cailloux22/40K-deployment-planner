describe('Accueil', () => {
  beforeEach(() => {
    cy.visitFresh('/');
  });

  it('redirige vers /home et affiche la bibliothèque vide', () => {
    cy.location('pathname').should('eq', '/home');
    cy.contains('ion-title', 'Mes listes').should('be.visible');
    cy.contains('h2', 'Aucune liste importée').should('be.visible');
  });

  // RG_18: les Réglages sont accessibles même sans liste importée.
  it('ouvre les Réglages depuis l’accueil', () => {
    cy.get('button[aria-label="Réglages"]').click();
    cy.location('pathname').should('eq', '/settings');
    cy.contains('ion-title', 'Réglages').should('be.visible');
  });
});

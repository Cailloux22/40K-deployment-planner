// RG_57/RG_58 — bouton « Accessibilité » des Réglages, sous-menu d'options,
// et désactivation du contrôle de cohésion d'unité (RG_26) au placement.
const RECO_LIST = 'cypress/fixtures/lists/reconnaissance.json';

const tokens = () => cy.get('.board-surface .token');
const bandModels = () => cy.get('.band .models button.model');
const content = () => cy.get('app-placement > ion-content').first();
const toggle = () => cy.get('ion-toggle[data-testid="coherency-check-toggle"]');

/** RT_34: glisse le premier modèle du bandeau à `fraction` de la largeur du plateau. */
function dropFirstModel(fraction: number): void {
  cy.get('.board-area')
    .filter(':visible')
    .then(($area) => {
      const rect = $area[0].getBoundingClientRect();
      const x = rect.left + rect.width * fraction;
      const y = rect.top + rect.height / 2;
      bandModels().first().trigger('pointerdown', { pointerId: 1, button: 0, isPrimary: true, force: true });
      content()
        .trigger('pointermove', { pointerId: 1, clientX: x, clientY: y, force: true })
        .trigger('pointerup', { pointerId: 1, clientX: x, clientY: y, force: true });
    });
}

/** Importe la liste de référence et ouvre un nouveau déploiement. */
function openPlacement(): void {
  cy.visit('/import');
  cy.get('ion-router-outlet > .ion-page:not(.ion-page-hidden)').should('have.length', 1);
  cy.get('input[type="file"]').selectFile(RECO_LIST, { force: true });
  cy.contains('.disposition h2', 'Reconnaissance').should('be.visible');
  cy.contains('ion-footer ion-button', 'Enregistrer la liste').click();
  cy.location('pathname').should('eq', '/home');
  cy.contains('.list-card', 'reco').click();
  cy.get('path.sector[aria-label^="Purge the Foe"]').click();
  cy.get('button.tab[aria-label^="Plateau 1"]').click();
  cy.contains('ion-button', 'Nouveau').click();
  cy.location('pathname').should('match', /\/placement$/);
  cy.get('ion-router-outlet > .ion-page:not(.ion-page-hidden)').should('have.length', 1);
}

describe('Accessibilité', () => {
  it('ouvre le sous-menu depuis les Réglages, option désactivée par défaut et conservée', () => {
    cy.visitFresh('/settings');
    cy.get('[data-testid="accessibility-link"]').click();
    cy.location('pathname').should('eq', '/settings/accessibility');
    cy.get('ion-router-outlet > .ion-page:not(.ion-page-hidden)').should('have.length', 1);

    // RG_58: désactivée par défaut — le contrôle de RG_26 s'applique.
    toggle().should('have.prop', 'checked', false);
    toggle().click();
    toggle().should('have.prop', 'checked', true);

    // RG_57: conservée d'une ouverture de l'application à l'autre.
    cy.reload();
    toggle().should('have.prop', 'checked', true);
    cy.get('button[aria-label="Retour aux réglages"]').click();
    cy.location('pathname').should('eq', '/settings');
  });

  it('refuse par défaut un dépôt qui romprait la cohésion', () => {
    cy.visitFresh('/home');
    openPlacement();
    dropFirstModel(0.2);
    tokens().should('have.length', 1);
    // RG_26: le second modèle, posé loin du premier, est refusé.
    dropFirstModel(0.8);
    tokens().should('have.length', 1);
  });

  it('pose un modèle hors cohésion une fois le contrôle désactivé', () => {
    cy.visitFresh('/settings/accessibility');
    toggle().click();
    toggle().should('have.prop', 'checked', true);

    openPlacement();
    dropFirstModel(0.2);
    tokens().should('have.length', 1);
    // RG_58: aucun refus pour cohésion.
    dropFirstModel(0.8);
    tokens().should('have.length', 2);
  });
});

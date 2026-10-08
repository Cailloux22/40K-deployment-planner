// RG_55/RT_73 — retrait des tokens sélectionnés par un bouton unique à icône
// de poubelle, dans l'angle haut-droit de la zone du plateau, affiché tant
// qu'au moins un token posé est sélectionné.
const RECO_LIST = 'cypress/fixtures/lists/reconnaissance.json';

const removeButton = () => cy.get('.selection-tools button').filter(':visible');
const tokens = () => cy.get('.board-surface .token');
const bandModels = () => cy.get('.band .models button.model');
const content = () => cy.get('app-placement > ion-content').first();

/** Centre de la zone du plateau, décalé de `dx` px, en coordonnées d'écran. */
const boardPoint = (dx: number) =>
  cy
    .get('.board-area')
    .filter(':visible')
    .then(($area) => {
      const rect = $area[0].getBoundingClientRect();
      return { x: rect.left + rect.width / 2 + dx, y: rect.top + rect.height / 2, rect };
    });

/** RT_34: glisse le premier modèle du bandeau jusqu'au centre du plateau décalé de `dx`. */
function dropFirstModel(dx: number): void {
  boardPoint(dx).then(({ x, y }) => {
    bandModels().first().trigger('pointerdown', { pointerId: 1, button: 0, isPrimary: true, force: true });
    content()
      .trigger('pointermove', { pointerId: 1, clientX: x, clientY: y, force: true })
      .trigger('pointerup', { pointerId: 1, clientX: x, clientY: y, force: true });
  });
}

describe('Retrait de la sélection', () => {
  beforeEach(() => {
    cy.visitFresh('/import');
    cy.get('input[type="file"]').selectFile(RECO_LIST, { force: true });
    cy.contains('.disposition h2', 'Reconnaissance').should('be.visible');
    cy.contains('ion-footer ion-button', 'Enregistrer la liste').click();
    cy.location('pathname').should('eq', '/home');
    cy.contains('.list-card', 'reco').click();
    cy.get('path.sector[aria-label^="Purge the Foe"]').click();
    cy.get('button.tab[aria-label^="Plateau 1"]').click();
    cy.contains('ion-button', 'Nouveau').click();
    cy.location('pathname').should('match', /\/placement$/);
    // Ionic: la page précédente reste à l'écran pendant la transition d'entrée.
    cy.get('ion-router-outlet > .ion-page:not(.ion-page-hidden)').should('have.length', 1);
  });

  it('n’apparaît qu’avec une sélection et retire un token seul', () => {
    // RG_55: aucune sélection, aucun bouton — et plus de barre d'actions.
    cy.get('.selection-tools button').should('not.exist');
    cy.get('.token-actions').should('not.exist');

    dropFirstModel(0);
    tokens().should('have.length', 1);

    // Le token déposé est sélectionné : le bouton apparaît.
    removeButton()
      .should('have.attr', 'aria-label', 'Retirer le modèle sélectionné')
      .then(($button) => {
        const area = Cypress.$('.board-area:visible')[0].getBoundingClientRect();
        const button = $button[0].getBoundingClientRect();
        // RT_73: angle haut-droit de la zone du plateau.
        expect(button.right).to.be.closeTo(area.right - 8, 2);
        expect(button.top).to.be.closeTo(area.top + 8, 2);
      });

    removeButton().click();
    // RG_55: le token quitte le plateau, la sélection est vide.
    tokens().should('have.length', 0);
    cy.get('.selection-tools button').should('not.exist');
  });

  it('retire d’un appui tous les tokens sélectionnés', () => {
    dropFirstModel(0);
    // RT_41: deux appuis sur le bandeau à moins de 300 ms forment un double appui.
    cy.wait(350);
    dropFirstModel(40);
    tokens().should('have.length', 2);

    // RG_30: rectangle de sélection tracé depuis le fond du plateau.
    boardPoint(0).then(({ rect }) => {
      const start = { clientX: rect.left + 4, clientY: rect.top + 60 };
      const end = { clientX: rect.left + rect.width / 2 + 60, clientY: rect.top + rect.height / 2 + 20 };
      cy.get('.board-surface svg')
        .filter(':visible')
        .first()
        .trigger('pointerdown', { pointerId: 2, button: 0, isPrimary: true, force: true, ...start });
      content()
        .trigger('pointermove', { pointerId: 2, force: true, ...end })
        .trigger('pointerup', { pointerId: 2, force: true, ...end });
    });
    cy.get('.board-surface .token.selected').should('have.length', 2);
    cy.get('.selection-status').should('contain.text', '2 modèles sélectionnés');
    removeButton().should('have.attr', 'aria-label', 'Retirer les 2 modèles sélectionnés').click();

    tokens().should('have.length', 0);
    cy.get('.selection-tools button').should('not.exist');
    cy.get('.selection-status').should('not.exist');
  });
});

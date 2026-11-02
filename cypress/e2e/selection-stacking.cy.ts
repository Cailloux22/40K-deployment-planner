// RG_59/RT_79 — le token sélectionné est rendu au-dessus des autres tokens,
// et la poignée de rotation au-dessus de tous les tokens.
const RECO_LIST = 'cypress/fixtures/lists/reconnaissance.json';

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
      return { x: rect.left + rect.width / 2 + dx, y: rect.top + rect.height / 2 };
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

/** Élément rendu au centre de `el`, comme le verrait un appui à cet endroit. */
function topmostAtCenter(el: Element): Element | null {
  const rect = el.getBoundingClientRect();
  return el.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

describe('Token sélectionné au premier plan', () => {
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

  it('passe le token sélectionné et sa poignée devant les autres tokens', () => {
    // Deux socles qui se chevauchent : le second posé est sélectionné.
    dropFirstModel(0);
    // RT_41: deux appuis sur le bandeau à moins de 300 ms forment un double appui.
    cy.wait(350);
    dropFirstModel(4);
    tokens().should('have.length', 2);

    // Sélectionner le premier, recouvert par le second.
    cy.get('.board-surface .token:not(.selected)').then(($first) => {
      const rect = $first[0].getBoundingClientRect();
      const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      cy.wrap($first).trigger('pointerdown', { pointerId: 2, button: 0, isPrimary: true, force: true, ...point });
      content().trigger('pointerup', { pointerId: 2, force: true, ...point });

      // RG_59: il est maintenant le dernier token rendu, donc au-dessus.
      tokens().last().should('have.class', 'selected').and(($last) => expect($last[0]).to.equal($first[0]));
      cy.get('.board-surface .token.selected').should(($selected) => {
        expect(topmostAtCenter($selected[0])).to.equal($selected[0]);
      });
    });

    // RT_79: la poignée est rendue après tous les tokens et rien ne la recouvre.
    cy.get('.board-surface .rotate-handle')
      .filter(':visible')
      .should(($handle) => {
        const handle = $handle[0];
        Cypress.$('.board-surface .token').each((_, token) => {
          expect(token.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING).to.not.equal(0);
        });
        expect(topmostAtCenter(handle)).to.equal(handle);
      });
  });
});

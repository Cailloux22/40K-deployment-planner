// EX_10 — agrandissement du plateau sur l'écran de placement : cycle
// ×1 → ×2 → ×4 → ×1 (RG_38/RT_47) et mode « Déplacement » activé à chaque
// entrée dans un niveau agrandi, désactivé au retour au zoom de base (RG_39/RT_48).
const RECO_LIST = 'cypress/fixtures/lists/reconnaissance.json';

const zoomButton = () => cy.get('button.zoom-toggle').filter(':visible');
const panButton = () => cy.get('button[aria-label^="Déplacement de la vue"]').filter(':visible');
const surfaceWidth = () =>
  cy
    .get('.board-surface')
    .filter(':visible')
    .then(($surface) => $surface[0].getBoundingClientRect().width);

describe('Agrandissement du plateau', () => {
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
  });

  it('parcourt ×1 → ×2 → ×4 → ×1 et lie le mode « Déplacement » au niveau', () => {
    // Zoom de base : mode désactivé, bouton à main indisponible.
    zoomButton().should('have.attr', 'aria-label', 'Agrandir le plateau ×2').and('have.attr', 'aria-pressed', 'false');
    panButton().should('be.disabled').and('have.attr', 'aria-pressed', 'false');
    surfaceWidth().then((base) => {
      // RG_38: ×2 — RG_39: le mode s'active de lui-même.
      zoomButton().click();
      zoomButton().should('have.attr', 'aria-label', 'Agrandir le plateau ×4').and('contain.text', '×2');
      panButton().should('not.be.disabled').and('have.attr', 'aria-pressed', 'true');
      surfaceWidth().should((width) => expect(width).to.be.closeTo(base * 2, 1));

      // RG_39: le joueur peut le désactiver à ×2…
      panButton().click();
      panButton().should('have.attr', 'aria-pressed', 'false');

      // …et l'entrée dans ×4 le réactive.
      zoomButton().click();
      zoomButton().should('have.attr', 'aria-label', 'Revenir à la taille d’origine').and('contain.text', '×4');
      panButton().should('have.attr', 'aria-pressed', 'true');
      surfaceWidth().should((width) => expect(width).to.be.closeTo(base * 4, 1));

      // RG_38: retour direct au zoom de base, mode désactivé, cadrage de RG_17.
      zoomButton().click();
      zoomButton().should('have.attr', 'aria-label', 'Agrandir le plateau ×2').and('not.contain.text', '×');
      panButton().should('be.disabled').and('have.attr', 'aria-pressed', 'false');
      surfaceWidth().should((width) => expect(width).to.be.closeTo(base, 1));
      cy.get('.board-surface').filter(':visible').should('have.attr', 'style').and('contain', 'translate(0px, 0px)');
    });
  });
});

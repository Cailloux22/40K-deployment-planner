// RG_60/RG_61 — bouton « Portée » et cercle de portée autour d'un token.
const RECO_LIST = 'cypress/fixtures/lists/reconnaissance.json';

const tokens = () => cy.get('.board-surface .token');
const bandModels = () => cy.get('.band .models button.model');
const content = () => cy.get('app-placement > ion-content').first();
const rangeButton = () => cy.get('button.range-toggle');
const ring = () => cy.get('.board-surface .range-ring .range-ring-line');

/** Centre de la zone du plateau, décalé de (`dx`, `dy`) px, en coordonnées d'écran. */
const boardPoint = (dx: number, dy = 0) =>
  cy
    .get('.board-area')
    .filter(':visible')
    .then(($area) => {
      const rect = $area[0].getBoundingClientRect();
      return { x: rect.left + rect.width / 2 + dx, y: rect.top + rect.height / 2 + dy };
    });

/** RT_34: glisse le premier modèle du bandeau sur le plateau ; il est alors sélectionné. */
function dropFirstModel(dx: number): void {
  boardPoint(dx).then(({ x, y }) => {
    bandModels().first().trigger('pointerdown', { pointerId: 1, button: 0, isPrimary: true, force: true });
    content()
      .trigger('pointermove', { pointerId: 1, clientX: x, clientY: y, force: true })
      .trigger('pointerup', { pointerId: 1, clientX: x, clientY: y, force: true });
  });
}

/** RG_29: un appui simple sur le fond du plateau désélectionne tout. */
function tapBackground(): void {
  boardPoint(0, -150).then(({ x, y }) => {
    const point = { clientX: x, clientY: y };
    cy.get('svg.tokens').trigger('pointerdown', { pointerId: 3, button: 0, isPrimary: true, force: true, ...point });
    content().trigger('pointerup', { pointerId: 3, force: true, ...point });
  });
}

/** Sélectionne un token posé par un appui simple. */
function tapToken($token: JQuery<Element>): void {
  const rect = $token[0].getBoundingClientRect();
  const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  cy.wrap($token).trigger('pointerdown', { pointerId: 2, button: 0, isPrimary: true, force: true, ...point });
  content().trigger('pointerup', { pointerId: 2, force: true, ...point });
}

describe('Cercle de portée autour d’un token', () => {
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

  it('affiche le bouton pour un seul token, pose un cercle de 6" et le retire', () => {
    // RG_60: aucun token sélectionné, pas de bouton.
    rangeButton().should('not.exist');
    dropFirstModel(0);
    tokens().should('have.length', 1);

    // RG_60: immédiatement à droite du bouton à main, inactif.
    rangeButton()
      .should('have.attr', 'aria-pressed', 'false')
      .and('have.attr', 'aria-label', 'Afficher un cercle de portée')
      .then(($range) => {
        const hand = Cypress.$('.board-tools button:has(ion-icon[name="hand-left-outline"])')[0];
        expect(hand.getBoundingClientRect().right).to.be.lessThan($range[0].getBoundingClientRect().left);
      });

    // RG_60: cinq rayons, dans l'ordre croissant, sous le bouton.
    rangeButton().click();
    rangeButton().should('have.attr', 'aria-expanded', 'true');
    cy.get('.range-radii button').then(($radii) => {
      expect([...$radii].map((b) => b.textContent?.trim())).to.deep.equal(['3"', '6"', '8"', '9"', '12"']);
      const button = Cypress.$('button.range-toggle')[0].getBoundingClientRect();
      expect($radii[0].getBoundingClientRect().top).to.be.greaterThan(button.bottom);
    });

    // RG_60: un rayon pose le cercle, replie la colonne, active le bouton.
    cy.contains('.range-radii button', '6"').click();
    cy.get('.range-radii').should('not.exist');
    rangeButton()
      .should('have.class', 'active')
      .and('have.attr', 'aria-pressed', 'true')
      .and('have.attr', 'aria-label', 'Masquer le cercle de portée de 6"');

    // RG_61: contour à 6" du bord du socle, quelle que soit sa forme, non
    // rempli, sans geste — mesuré sur les boîtes du repère local (avant rotation).
    ring().should('have.length', 1);
    cy.get('.board-surface .token').then(($token) => {
      const token = ($token[0] as unknown as SVGGraphicsElement).getBBox();
      ring().should(($ring) => {
        const box = ($ring[0] as unknown as SVGGraphicsElement).getBBox();
        const offset = (box.width - token.width) / 2;
        expect((box.height - token.height) / 2).to.be.closeTo(offset, 0.5);
        // ≈ 1,007 px d'asset par mm (RT_05).
        expect(offset / (6 * 25.4)).to.be.within(0.98, 1.03);
        expect(getComputedStyle($ring[0]).fill).to.equal('none');
        expect(getComputedStyle($ring[0]).pointerEvents).to.equal('none');
      });
    });

    // RG_61: le cercle reste affiché sans sélection, et le bouton reste actif.
    tapBackground();
    cy.get('.board-surface .token.selected').should('not.exist');
    ring().should('have.length', 1);
    rangeButton().should('have.class', 'active');

    // RG_60: un appui à l'état actif efface le cercle ; sans sélection, le bouton disparaît.
    rangeButton().click();
    ring().should('not.exist');
    rangeButton().should('not.exist');
  });

  it('garde un seul cercle : le bouton reste actif sur un autre token', () => {
    dropFirstModel(-60);
    rangeButton().click();
    cy.contains('.range-radii button', '3"').click();
    // RT_41: deux appuis sur le bandeau à moins de 300 ms forment un double appui.
    cy.wait(350);
    dropFirstModel(60);
    tokens().should('have.length', 2);

    // Le second token, sélectionné, n'a pas de cercle : le bouton reste actif.
    cy.get('.board-surface .token.selected').should('have.length', 1);
    rangeButton().should('have.attr', 'aria-pressed', 'true');
    ring().should('have.length', 1);

    // Un appui efface l'unique cercle, quel que soit le token sélectionné.
    rangeButton().click();
    ring().should('not.exist');
    rangeButton().should('have.attr', 'aria-pressed', 'false');

    // Un appui hors de la colonne la replie sans créer de cercle.
    rangeButton().click();
    cy.get('.range-radii').should('exist');
    cy.get('.board-surface .token:not(.selected)').then(($other) => tapToken($other));
    cy.get('.range-radii').should('not.exist');
    ring().should('not.exist');
  });
});

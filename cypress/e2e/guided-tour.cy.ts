/**
 * EX_18 — visite guidée (RG_62 à RG_66).
 *
 * La visite s'ouvre d'elle-même sur un stockage vierge (RG_62) : ces tests
 * passent `{ tour: true }` à `visitFresh`, qui la laisse sinon marquée comme
 * déjà proposée.
 */

const TOTAL = 46;
const STEP = '.shepherd-element:not([hidden])';

function counter(n: number): void {
  cy.get(`${STEP} .app-tour-counter`, { timeout: 15000 }).should('have.text', `${n} / ${TOTAL}`);
}

function press(label: string): void {
  cy.contains(`${STEP} .shepherd-button`, label).click();
}

function alertButton(label: string): void {
  cy.contains('ion-alert button', label).click();
}

describe('Visite guidée — EX_18', () => {
  it('est proposée à la première ouverture et se décline sans confirmation (RG_62)', () => {
    cy.visitFresh('/home', { tour: true });
    counter(1);
    cy.get(STEP).should('contain.text', 'Bienvenue dans Windfall Planner');
    press('Pas maintenant');
    cy.get(STEP).should('not.exist');
    cy.get('ion-alert').should('not.exist');
    cy.window().its('localStorage').invoke('getItem', 'wfp.tour.proposed').should('eq', 'true');

    // RG_62: elle n'est plus jamais affichée d'elle-même sur cet appareil.
    cy.reload();
    cy.get('ion-app').should('have.class', 'hydrated');
    cy.wait(1500);
    cy.get(STEP).should('not.exist');
  });

  it('s’arrête à tout moment après confirmation (RG_64)', () => {
    cy.visitFresh('/home', { tour: true });
    counter(1);
    press('Commencer la visite');
    counter(2);
    press('Suivant');
    counter(3);
    cy.location('pathname').should('eq', '/import');

    // « Continuer la visite » laisse la visite à l'étape où elle était.
    cy.get(`${STEP} .shepherd-cancel-icon`).click();
    cy.get('ion-alert').should('contain.text', 'Arrêter la visite ?');
    alertButton('Continuer la visite');
    cy.get('ion-alert').should('not.exist');
    counter(3);

    // « Arrêter » ramène à l'accueil.
    cy.get(`${STEP} .shepherd-cancel-icon`).click();
    alertButton('Arrêter');
    cy.get(STEP).should('not.exist');
    cy.location('pathname').should('eq', '/home');
  });

  it('parcourt les 46 étapes et laisse la liste d’exemple dans la bibliothèque (RG_65/RG_66)', () => {
    cy.visitFresh('/home', { tour: true });
    counter(1);
    press('Commencer la visite');
    for (let n = 2; n < TOTAL; n += 1) {
      counter(n);
      press('Suivant');
    }
    counter(TOTAL);
    cy.location('pathname').should('eq', '/settings');
    press('Terminer');

    cy.get(STEP).should('not.exist');
    cy.location('pathname').should('eq', '/home');
    cy.contains('.list-card', 'Liste d’exemple (visite guidée)')
      .invoke('text')
      .should('match', /1 déploiement\s+sauvegardé/);
  });

  it('se relance depuis le bloc « Aide » des Réglages (RG_62/RT_86)', () => {
    cy.visitFresh('/settings');
    cy.get('[data-testid="source-code"]').should('contain.text', 'AGPL-3.0');
    cy.get('[data-testid="tour-link"]').click();
    cy.location('pathname').should('eq', '/home');
    counter(1);
  });

  it('propose « Buy us a coffee » juste sous « Visite guidée » (RG_68/RT_88)', () => {
    cy.visitFresh('/settings');
    cy.get('[data-testid="tour-link"]').next().should('have.attr', 'data-testid', 'donation');
    cy.get('[data-testid="donation"]')
      .should('contain.text', 'Buy us a coffee')
      .find('a')
      .should('have.attr', 'href', 'https://paypal.me/Popiipops')
      .and('have.attr', 'target', '_blank')
      .and('have.attr', 'rel', 'noopener noreferrer');
  });
});

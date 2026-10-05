import { GAMEPLAN_NOTE_MAX_LENGTH, hasGameplanNote, normalizeGameplanNote } from './gameplan-note';

describe('normalizeGameplanNote (RT_60)', () => {
  it('normalise une note absente en chaîne vide', () => {
    expect(normalizeGameplanNote(undefined)).toBe('');
    expect(normalizeGameplanNote(null)).toBe('');
  });

  it('tient pour vide une note faite de blancs seuls (RG_45)', () => {
    expect(normalizeGameplanNote('   \n\t \n')).toBe('');
  });

  it('conserve le texte tel que saisi, retours à la ligne et blancs de bord compris', () => {
    const note = '  Tour 1 : tenir le centre.\n\nTour 2 : réserves à gauche.  ';
    expect(normalizeGameplanNote(note)).toBe(note);
  });

  it('borne la longueur à la limite de saisie', () => {
    const tooLong = 'a'.repeat(GAMEPLAN_NOTE_MAX_LENGTH + 10);
    expect(normalizeGameplanNote(tooLong)).toHaveLength(GAMEPLAN_NOTE_MAX_LENGTH);
    const exact = 'b'.repeat(GAMEPLAN_NOTE_MAX_LENGTH);
    expect(normalizeGameplanNote(exact)).toBe(exact);
  });
});

describe('hasGameplanNote (RG_45/RG_46)', () => {
  it('distingue une note rédigée d’une note vide ou blanche', () => {
    expect(hasGameplanNote('Plan')).toBe(true);
    expect(hasGameplanNote('')).toBe(false);
    expect(hasGameplanNote('  ')).toBe(false);
    expect(hasGameplanNote(undefined)).toBe(false);
  });
});

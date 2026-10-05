/**
 * EX_13 — note de plan de jeu attachée à un déploiement.
 *
 * Logique pure, partagée par la fenêtre d'édition (RT_61), l'écriture en
 * bibliothèque (RT_60) et la consultation (RT_62).
 */

/**
 * RG_45/RT_60: longueur maximale de la note, en unités de code UTF-16 — la
 * mesure de l'attribut `maxlength` du champ de saisie.
 */
export const GAMEPLAN_NOTE_MAX_LENGTH = 4000;

/**
 * RT_60: forme enregistrée d'une note.
 * - absente (enregistrement antérieur à EX_13, client antérieur) → `""` ;
 * - blancs seuls → `""` (RG_45: une telle note est tenue pour vide) ;
 * - sinon le texte tel que saisi, blancs de début et de fin compris, tronqué
 *   à la longueur maximale pour qu'aucun chemin d'écriture ne la contourne.
 */
export function normalizeGameplanNote(note: string | null | undefined): string {
  if (typeof note !== 'string' || note.trim() === '') return '';
  return note.length > GAMEPLAN_NOTE_MAX_LENGTH ? note.slice(0, GAMEPLAN_NOTE_MAX_LENGTH) : note;
}

/** RG_45/RG_46: le déploiement porte-t-il une note ? */
export function hasGameplanNote(note: string | null | undefined): boolean {
  return normalizeGameplanNote(note) !== '';
}

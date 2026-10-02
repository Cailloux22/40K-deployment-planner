import { ArmyUnit, UnitAttachment } from '../models/domain.models';
import {
  attachUnit,
  attachmentBlocker,
  componentLabel,
  deploymentGroups,
  detachUnit,
  groupIdByUnit,
  remapAttachments,
  validAttachments,
} from './attachments';

function unit(id: string, count = 1, attachment?: UnitAttachment): ArmyUnit {
  return {
    id,
    name: `Unité ${id}`,
    modelCount: count,
    modelGroups: [{ id: `${id}_g0`, name: id, count, baseShapeId: 'round-32' }],
    color: '#e6194b',
    ...(attachment ? { attachment } : {}),
  };
}

const leads = (bodyguardUnitId: string): UnitAttachment => ({ bodyguardUnitId, role: 'leader' });
const supports = (bodyguardUnitId: string): UnitAttachment => ({ bodyguardUnitId, role: 'support' });

describe('attachmentBlocker — RG_36 (contraintes structurelles)', () => {
  const units = [unit('c'), unit('b', 5), unit('s', 1, supports('b')), unit('x', 3)];

  it('permet un attachement simple', () => {
    expect(attachmentBlocker(units, 'c', 'b')).toBeNull();
  });

  it('ne contrôle pas le nombre de meneurs ou de soutiens', () => {
    const twoLeaders = attachUnit(units, 'c', 'b', 'leader');
    expect(attachmentBlocker(twoLeaders, 'x', 'b')).toBeNull();
  });

  it('refuse une unité attachée à elle-même', () => {
    expect(attachmentBlocker(units, 'b', 'b')).not.toBeNull();
  });

  it('refuse un personnage déjà attaché à une autre unité', () => {
    expect(attachmentBlocker(units, 's', 'x')).toContain('déjà attachée');
  });

  it('refuse les chaînes d’attachements, dans les deux sens', () => {
    // L'unité escortée est elle-même attachée.
    expect(attachmentBlocker(units, 'c', 's')).toContain('elle-même attachée');
    // Le personnage escorte déjà quelqu'un.
    expect(attachmentBlocker(units, 'b', 'x')).toContain('déjà un personnage attaché');
  });
});

describe('validAttachments — RT_45 (lecture tolérante)', () => {
  it('ignore un attachement vers une unité absente', () => {
    expect(validAttachments([unit('c', 1, leads('gone'))]).size).toBe(0);
  });

  it('ignore un attachement à soi-même et une chaîne', () => {
    const units = [unit('a', 1, leads('a')), unit('b', 1, leads('c')), unit('c', 1, leads('d')), unit('d', 2)];
    // b → c est une chaîne (c est elle-même attachée), c → d escorte déjà b.
    expect([...validAttachments(units).keys()]).toEqual([]);
  });

  it('ignore un rôle inconnu', () => {
    const odd = { bodyguardUnitId: 'b', role: 'escort' } as unknown as UnitAttachment;
    expect(validAttachments([unit('c', 1, odd), unit('b', 2)]).size).toBe(0);
  });
});

describe('deploymentGroups — RT_46', () => {
  it('donne un groupe par unité pour une liste sans attachement', () => {
    const groups = deploymentGroups([unit('a'), unit('b', 3)]);
    expect(groups.map((g) => g.id)).toEqual(['a', 'b']);
    expect(groups[1].name).toBe('Unité b');
    expect(groups[1].modelCount).toBe(3);
  });

  it('réunit meneurs, soutiens et unité escortée, dans cet ordre (RG_37)', () => {
    const units = [unit('s', 1, supports('b')), unit('a'), unit('b', 5), unit('l', 1, leads('b'))];
    const groups = deploymentGroups(units);
    // L'ordre de la liste est suivi à la première apparition d'une composante.
    expect(groups.map((g) => g.id)).toEqual(['b', 'a']);
    expect(groups[0].units.map((u) => u.id)).toEqual(['l', 's', 'b']);
    expect(groups[0].name).toBe('Unité l + Unité s + Unité b');
    expect(groups[0].modelCount).toBe(7);
    expect(componentLabel(groups[0], units[3])).toBe('Unité l (meneur)');
    expect(componentLabel(groups[0], units[2])).toBe('Unité b');
    expect(groupIdByUnit(groups).get('s')).toBe('b');
  });
});

describe('attachUnit / detachUnit / remapAttachments — RG_36, RG_21', () => {
  it('attache puis détache un personnage', () => {
    const attached = attachUnit([unit('c'), unit('b', 3)], 'c', 'b', 'support');
    expect(attached[0].attachment).toEqual(supports('b'));
    const detached = detachUnit(attached, 'c');
    expect('attachment' in detached[0]).toBe(false);
  });

  it('n’attache rien quand une contrainte est violée', () => {
    const units = [unit('c'), unit('b', 3)];
    expect(attachUnit(units, 'c', 'c', 'leader')).toEqual(units);
  });

  it('convertit les attachements vers les identifiants de la copie', () => {
    const remapped = remapAttachments(
      [unit('c2', 1, leads('b')), unit('b2', 3)],
      new Map([
        ['c', 'c2'],
        ['b', 'b2'],
      ]),
    );
    expect(remapped[0].attachment).toEqual(leads('b2'));
  });
});

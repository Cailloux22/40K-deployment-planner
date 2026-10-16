import { TestBed } from '@angular/core/testing';

import {
  ACCESSIBILITY_KEY,
  AccessibilityService,
  DEFAULT_ACCESSIBILITY_OPTIONS,
  readAccessibilityOptions,
} from './accessibility.service';
import { LocalStoreService } from './local-store.service';

describe('readAccessibilityOptions (RT_77)', () => {
  it('rend les valeurs par défaut pour une clé absente ou illisible', () => {
    expect(readAccessibilityOptions(null)).toEqual(DEFAULT_ACCESSIBILITY_OPTIONS);
    expect(readAccessibilityOptions('oui')).toEqual(DEFAULT_ACCESSIBILITY_OPTIONS);
    expect(readAccessibilityOptions(42)).toEqual(DEFAULT_ACCESSIBILITY_OPTIONS);
  });

  it('ignore une option inconnue et complète une option manquante ou mal typée', () => {
    expect(readAccessibilityOptions({ future: true })).toEqual({ coherencyCheckDisabled: false });
    expect(readAccessibilityOptions({ coherencyCheckDisabled: 'true' })).toEqual({ coherencyCheckDisabled: false });
    expect(readAccessibilityOptions({ coherencyCheckDisabled: true, future: 1 })).toEqual({
      coherencyCheckDisabled: true,
    });
  });
});

describe('AccessibilityService (RT_77 / RG_57 / RG_58)', () => {
  let config: Map<string, unknown>;

  const create = () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LocalStoreService,
          useValue: {
            getConfig: (key: string) => config.get(key) ?? null,
            setConfig: (key: string, value: unknown) => config.set(key, value),
          },
        },
      ],
    });
    return TestBed.inject(AccessibilityService);
  };

  beforeEach(() => {
    config = new Map();
  });

  it('applique le contrôle de cohésion par défaut', () => {
    expect(create().coherencyCheckDisabled()).toBe(false);
  });

  it('relit l’option conservée sur l’appareil', () => {
    config.set(ACCESSIBILITY_KEY, { coherencyCheckDisabled: true });
    expect(create().coherencyCheckDisabled()).toBe(true);
  });

  it('applique un changement aussitôt et le conserve', () => {
    const service = create();
    service.set('coherencyCheckDisabled', true);
    expect(service.coherencyCheckDisabled()).toBe(true);
    expect(config.get(ACCESSIBILITY_KEY)).toEqual({ coherencyCheckDisabled: true });
  });
});

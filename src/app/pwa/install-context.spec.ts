import { isPlacementUrl } from './app-update.service';
import { InstallEnvironment, installMode, isAppleMobile } from './install-context';

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

function env(overrides: Partial<InstallEnvironment>): InstallEnvironment {
  return {
    native: false,
    standalone: false,
    userAgent: ANDROID_CHROME,
    maxTouchPoints: 5,
    promptAvailable: false,
    ...overrides,
  };
}

describe('RT_55 — mode d\'invitation à l\'installation (RG_41)', () => {
  it('aucune invitation dans l\'application empaquetée, même avec une demande capturée', () => {
    expect(installMode(env({ native: true, promptAvailable: true }))).toBe('none');
  });

  it('application lancée depuis l\'écran d\'accueil : installée', () => {
    expect(installMode(env({ standalone: true, userAgent: IPHONE_SAFARI }))).toBe('installed');
  });

  it('iPhone et iPad : marche à suivre « Partager »', () => {
    expect(installMode(env({ userAgent: IPHONE_SAFARI }))).toBe('ios-instructions');
    expect(installMode(env({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 5 }))).toBe(
      'ios-instructions',
    );
  });

  it('un Mac sans écran tactile n\'est pas pris pour un iPad', () => {
    expect(isAppleMobile(IPAD_DESKTOP_MODE, 0)).toBe(false);
    expect(installMode(env({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 0 }))).toBe('none');
  });

  it('demande du navigateur capturée : bouton d\'installation', () => {
    expect(installMode(env({ promptAvailable: true }))).toBe('prompt');
  });

  it('navigateur sans installation possible : aucune invitation', () => {
    expect(installMode(env({}))).toBe('none');
  });
});

describe('RT_57 — écran de placement, où l\'annonce de mise à jour attend', () => {
  it('reconnaît la route de placement, et seulement elle', () => {
    expect(isPlacementUrl('/list/l1/adversary/o1/board/b1/placement')).toBe(true);
    expect(isPlacementUrl('/list/l1/adversary/o1/board/b1/placement?x=1')).toBe(true);
    expect(isPlacementUrl('/list/l1/adversary/o1/boards')).toBe(false);
    expect(isPlacementUrl('/home')).toBe(false);
  });
});

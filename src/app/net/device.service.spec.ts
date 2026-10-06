import { deviceName, devicePlatform } from './device.service';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36';

describe('RT_67 — identité de l’appareil', () => {
  it('déclare la plateforme : application Android, iPhone/iPad, ou web', () => {
    expect(devicePlatform('android', ANDROID_WEBVIEW, 5)).toBe('android');
    expect(devicePlatform('web', SAFARI_IPHONE, 5)).toBe('ios');
    expect(devicePlatform('web', CHROME_WINDOWS, 0)).toBe('web');
  });

  it('nomme l’appareil par navigateur et système, ou par modèle pour l’application', () => {
    expect(deviceName('web', false, CHROME_WINDOWS)).toBe('Chrome — Windows');
    expect(deviceName('ios', false, SAFARI_IPHONE)).toBe('Safari — iPhone');
    expect(deviceName('android', true, ANDROID_WEBVIEW)).toBe('Application Android — Pixel 8');
  });

  it('ne dépasse jamais 80 caractères (RT_69)', () => {
    const ua = `Mozilla/5.0 (Linux; Android 14; ${'X'.repeat(120)} Build/A) Chrome/140`;
    expect(deviceName('android', true, ua).length).toBeLessThanOrEqual(80);
  });
});

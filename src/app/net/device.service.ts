import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { LocalStoreService } from '../data/local-store.service';
import { Device, DeviceLabel, DevicePlatform } from '../models/sync.models';
import { isAppleMobile } from '../pwa/install-context';
import { uuid } from './sync-protocol';

const DEVICE_ID_KEY = 'device.id';
/** RT_69: le libellé d'appareil compte au plus 80 caractères. */
const NAME_MAX = 80;

/** RT_67: plateforme déclarée — application empaquetée, ou version web (iPhone/iPad à part). */
export function devicePlatform(native: string, userAgent: string, maxTouchPoints: number): DevicePlatform {
  if (native === 'android') return 'android';
  if (native === 'ios' || isAppleMobile(userAgent, maxTouchPoints)) return 'ios';
  return 'web';
}

/** RT_67: libellé lisible, ex. « Chrome — Windows » ou « Application Android — Pixel 8 ». */
export function deviceName(platform: DevicePlatform, packaged: boolean, userAgent: string): string {
  const androidModel = /Android [\d.]+; (?:[a-z]{2}[-_][a-z]{2}; )?([^;)]+?)(?: Build\/[^;)]*)?[;)]/i
    .exec(userAgent)?.[1]
    ?.trim();
  const model = androidModel && androidModel !== 'K' ? androidModel : undefined;

  if (packaged) {
    const name = platform === 'ios' ? 'Application iOS' : 'Application Android';
    return (model ? `${name} — ${model}` : name).slice(0, NAME_MAX);
  }

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /SamsungBrowser\//.test(userAgent)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(userAgent)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(userAgent)
            ? 'Chrome'
            : /Safari\//.test(userAgent)
              ? 'Safari'
              : 'Navigateur';
  const os = /iPad/.test(userAgent)
    ? 'iPad'
    : /iPhone|iPod/.test(userAgent)
      ? 'iPhone'
      : /Android/.test(userAgent)
        ? (model ?? 'Android')
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Macintosh/.test(userAgent)
            ? platform === 'ios'
              ? 'iPad'
              : 'macOS'
            : /CrOS/.test(userAgent)
              ? 'ChromeOS'
              : /Linux/.test(userAgent)
                ? 'Linux'
                : 'appareil inconnu';
  return `${browser} — ${os}`.slice(0, NAME_MAX);
}

/**
 * RT_67 — identité de cette installation de l'application.
 *
 * L'identifiant est généré à la première ouverture et conservé dans la
 * configuration légère (RT_08) ; le libellé et la plateforme sont recalculés
 * à chaque connexion. Le serveur rattache ce libellé à chaque écriture pour
 * l'afficher dans les conflits (RG_54).
 */
@Injectable({ providedIn: 'root' })
export class DeviceService {
  private readonly store = inject(LocalStoreService);

  readonly id: string = this.ensureId();

  private ensureId(): string {
    const existing = this.store.getConfig<string>(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = uuid();
    this.store.setConfig(DEVICE_ID_KEY, id);
    return id;
  }

  describe(): Device {
    const nav = globalThis.navigator;
    const userAgent = nav?.userAgent ?? '';
    const native = Capacitor.getPlatform();
    const platform = devicePlatform(native, userAgent, nav?.maxTouchPoints ?? 0);
    return { id: this.id, name: deviceName(platform, native !== 'web', userAgent), platform };
  }

  /** RG_54: « Cet appareil », ou le nom de l'appareil auteur de la version. */
  label(device: DeviceLabel | undefined): string {
    if (!device) return 'appareil inconnu';
    return device.id === this.id ? 'cet appareil' : device.name;
  }
}

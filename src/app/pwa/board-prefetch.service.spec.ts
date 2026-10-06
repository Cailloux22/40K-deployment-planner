import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ConnectivityService } from '../net/connectivity.service';
import { ReferentialService } from '../referentials/referential.service';
import { BoardPrefetchService } from './board-prefetch.service';
import { InstallService } from './install.service';

const PATHS = [
  'assets/b/no/1.png',
  'assets/b/with/1.png',
  'assets/b/no/2.png',
  'assets/b/with/2.png',
  // RT_65: une carte de mission, parcourue après les plateaux.
  'assets/m/purge-the-foe/meatgrinder.png',
];

const referential = {
  variants: ['no-measurements', 'with-measurements'],
  boards: [
    { assets: { 'no-measurements': PATHS[0], 'with-measurements': PATHS[1] } },
    { assets: { 'no-measurements': PATHS[2], 'with-measurements': PATHS[3] } },
  ],
};

const missions = { missions: [{ asset: PATHS[4] }] };

describe('BoardPrefetchService (RT_56 / RG_42 / RT_65)', () => {
  let online: ReturnType<typeof signal<boolean>>;
  let reconnections: ReturnType<typeof signal<number>>;
  let cached: Set<string>;
  let downloaded: string[];
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: BoardPrefetchService;

  const cachedPath = (url: string) => PATHS.find((path) => url.endsWith(path));

  beforeEach(() => {
    online = signal(true);
    reconnections = signal(0);
    cached = new Set();
    downloaded = [];
    // Service worker simulé (RT_54) : sert son cache, sinon télécharge et
    // range l'image ; hors-ligne, une image absente rend 504.
    fetchMock = vi.fn(async (url: string) => {
      const path = cachedPath(url)!;
      if (cached.has(path)) return new Response('png', { status: 200 });
      if (!online()) return new Response('', { status: 504 });
      downloaded.push(path);
      cached.add(path);
      return new Response('png', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', {
      match: vi.fn(async (url: string) => {
        const path = cachedPath(url);
        return path && cached.has(path) ? new Response() : undefined;
      }),
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: {}, addEventListener: vi.fn() },
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: ConnectivityService, useValue: { online, reconnections } },
        {
          provide: ReferentialService,
          useValue: {
            boardReferential: async () => referential,
            missionReferential: async () => missions,
          },
        },
        { provide: InstallService, useValue: { webApp: true } },
      ],
    });
    service = TestBed.inject(BoardPrefetchService);
  });

  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    delete (navigator as { connection?: unknown }).connection;
    vi.unstubAllGlobals();
  });

  it('télécharge une à une les images absentes du cache, cartes après plateaux, puis se déclare prêt', async () => {
    cached.add(PATHS[0]);

    await service.start();

    expect(downloaded).toEqual([PATHS[1], PATHS[2], PATHS[3], PATHS[4]]);
    expect(service.present()).toBe(5);
    expect(service.total()).toBe(5);
    expect(service.status()).toBe('ready');
  });

  it('hors-ligne, compte le cache sans rien télécharger et se met en pause', async () => {
    cached.add(PATHS[1]);
    online.set(false);

    await service.start();

    expect(downloaded).toEqual([]);
    expect(service.present()).toBe(1);
    expect(service.status()).toBe('paused');
  });

  it('reprend au retour en ligne après une pause', async () => {
    online.set(false);
    await service.start();
    expect(service.status()).toBe('paused');

    online.set(true);
    reconnections.update((n) => n + 1);
    TestBed.tick();
    await vi.waitFor(() => expect(service.status()).toBe('ready'));
    expect(downloaded).toHaveLength(5);
  });

  it('une image en échec est sautée et laisse le téléchargement incomplet', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 500 }));

    await service.start();

    expect(downloaded).toEqual([PATHS[1], PATHS[2], PATHS[3], PATHS[4]]);
    expect(service.present()).toBe(4);
    expect(service.status()).toBe('incomplete');
  });

  it('en économie de données, attend l\'action des Réglages', async () => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true },
    });

    cached.add(PATHS[2]);

    await service.start();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.present()).toBe(1);
    expect(service.status()).toBe('awaiting-consent');

    await service.downloadNow();
    expect(downloaded).toEqual([PATHS[0], PATHS[1], PATHS[3], PATHS[4]]);
    expect(service.status()).toBe('ready');
  });

  it('sans service worker (APK, build de développement), ne fait rien', async () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;

    await service.start();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.status()).toBe('unsupported');
  });
});

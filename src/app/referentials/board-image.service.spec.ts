import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { LocalStoreService, STORE_BOARD_IMAGES } from '../data/local-store.service';
import { Board } from '../models/referential.models';
import { ConnectivityService } from '../net/connectivity.service';
import {
  BoardImageService,
  CachedBoardImage,
  pngDimensions,
  unavailableBoardImage,
} from './board-image.service';

const board = {
  id: 'take-and-hold__take-and-hold__1',
  sourceFileName: 'take-and-hold-mirror-1.png',
  width: 1653,
  height: 2833,
  assets: {
    'no-measurements': 'assets/referentials/boards/no-measurements/take-and-hold-mirror-1.png',
    'with-measurements': 'assets/referentials/boards/with-measurements/take-and-hold-mirror-1.png',
  },
  remoteAssets: {
    'no-measurements': 'https://gdmissions.app/assets/11th/layouts/no-measurements/take-and-hold-mirror-1.png',
    'with-measurements': 'https://gdmissions.app/assets/11th/layouts/with-measurements/take-and-hold-mirror-1.png',
  },
} as unknown as Board;

/** En-tête PNG minimal (signature + IHDR) aux dimensions données. */
function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function pngResponse(width = 1653, height = 2833): Response {
  return new Response(pngHeader(width, height), { status: 200, headers: { 'Content-Type': 'image/png' } });
}

describe('BoardImageService (RT_12 / RT_27 / RG_23)', () => {
  let online: ReturnType<typeof signal<boolean>>;
  let cache: Map<string, CachedBoardImage>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: BoardImageService;

  beforeEach(() => {
    online = signal(true);
    cache = new Map();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    let objectUrls = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++objectUrls}`);

    TestBed.configureTestingModule({
      providers: [
        { provide: ConnectivityService, useValue: { online } },
        {
          provide: LocalStoreService,
          useValue: {
            get: vi.fn(async (_store: string, id: string) => cache.get(id)),
            put: vi.fn(async (store: string, value: CachedBoardImage) => {
              expect(store).toBe(STORE_BOARD_IMAGES);
              cache.set(value.id, value);
            }),
          },
        },
      ],
    });
    service = TestBed.inject(BoardImageService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('en ligne, appelle directement gdmissions.app et met l\'image en cache', async () => {
    fetchMock.mockResolvedValue(pngResponse());

    const url = await service.imageUrl(board, 'with-measurements');

    expect(url).toMatch(/^blob:/);
    expect(fetchMock).toHaveBeenCalledWith(
      board.remoteAssets['with-measurements'],
      expect.objectContaining({ cache: 'no-cache' }),
    );
    expect(cache.get('with-measurements/take-and-hold-mirror-1.png')?.sourceUrl).toBe(
      board.remoteAssets['with-measurements'],
    );
  });

  it('n\'interroge la source qu\'une fois par image et par session', async () => {
    fetchMock.mockImplementation(async () => pngResponse());

    const first = await service.imageUrl(board, 'no-measurements');
    const second = await service.imageUrl(board, 'no-measurements');

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hors-ligne, sert la dernière version en cache sans appel réseau', async () => {
    online.set(false);
    cache.set('no-measurements/take-and-hold-mirror-1.png', {
      id: 'no-measurements/take-and-hold-mirror-1.png',
      blob: new Blob([pngHeader(1653, 2833)]),
      sourceUrl: board.remoteAssets['no-measurements'],
      fetchedAt: '2026-10-01T00:00:00.000Z',
    });

    expect(await service.imageUrl(board, 'no-measurements')).toMatch(/^blob:/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hors-ligne et sans cache, sert la version embarquée', async () => {
    online.set(false);

    expect(await service.imageUrl(board, 'no-measurements')).toBe(board.assets['no-measurements']);
  });

  it('écarte une image distante aux dimensions différentes (RT_05/RT_19)', async () => {
    fetchMock.mockResolvedValue(pngResponse(2000, 2833));

    expect(await service.imageUrl(board, 'no-measurements')).toBe(board.assets['no-measurements']);
    expect(cache.size).toBe(0);
  });

  describe('dans le navigateur, sous service worker (RG_42 / RT_54)', () => {
    let cachedAssets: Set<string>;

    beforeEach(() => {
      cachedAssets = new Set();
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { controller: {} },
      });
      // Service worker simulé : hors-ligne, sert son cache ou rend 504.
      fetchMock.mockImplementation(async (url: string) =>
        [...cachedAssets].some((path) => url.endsWith(path))
          ? new Response('png', { status: 200 })
          : new Response('', { status: 504 }),
      );
      online.set(false);
    });

    afterEach(() => {
      delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    });

    it('hors-ligne, sert l\'image embarquée déjà rangée par le service worker', async () => {
      cachedAssets.add(board.assets['no-measurements']);

      expect(await service.imageUrl(board, 'no-measurements')).toBe(board.assets['no-measurements']);
    });

    it('hors-ligne, remplace un plateau jamais téléchargé par le message, sans le retenir', async () => {
      const playBoard = {
        ...board,
        playArea: { left: 100, top: 200, width: 1400, height: 1900 },
      } as Board;

      const url = await service.imageUrl(playBoard, 'no-measurements');
      expect(url).toBe(unavailableBoardImage(playBoard));
      // Chargée comme image, une source SVG est lue en XML strict.
      const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1));
      const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
      expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
      expect(svg).toContain('Plateau non disponible');

      // Une fois l'image téléchargée, le même plateau se résout normalement.
      await Promise.resolve();
      cachedAssets.add(board.assets['no-measurements']);
      expect(await service.imageUrl(playBoard, 'no-measurements')).toBe(
        board.assets['no-measurements'],
      );
    });
  });

  it('se rabat sur l\'embarqué quand la source répond en erreur ou échoue', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await service.imageUrl(board, 'no-measurements')).toBe(board.assets['no-measurements']);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await service.imageUrl(board, 'with-measurements')).toBe(board.assets['with-measurements']);
  });
});

describe('pngDimensions', () => {
  it('lit les dimensions de l\'en-tête IHDR', () => {
    expect(pngDimensions(pngHeader(1653, 2833))).toEqual({ width: 1653, height: 2833 });
  });

  it('refuse un contenu qui n\'est pas un PNG', () => {
    expect(pngDimensions(new TextEncoder().encode('<html>pas une image</html>'))).toBeNull();
  });
});

import { CLUSTER_GAP_INCHES, ClusterMember, clusterLayout } from './cluster';
import { CoherencyBase, baseGap, isCoherent } from './unit-coherency';

const MM = 1 / 25.4;

const round = (id: string, mm: number): ClusterMember => ({ id, shape: 'round', width: mm * MM, length: mm * MM });
const oval = (id: string, w: number, l: number): ClusterMember => ({ id, shape: 'oval', width: w * MM, length: l * MM });

function bases(members: readonly ClusterMember[]): CoherencyBase[] {
  const layout = clusterLayout(members);
  return members.map((member) => ({ ...member, ...layout.get(member.id)!, rotation: 0 }));
}

describe('cluster (RG_32, RT_41)', () => {
  it('centres a single base on the origin', () => {
    expect(clusterLayout([round('a', 32)]).get('a')).toEqual({ x: 0, y: 0 });
  });

  it('lays out a 10-model unit without overlap and in coherency', () => {
    const placed = bases(Array.from({ length: 10 }, (_, i) => round(`m${i}`, 32)));
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(baseGap(placed[i], placed[j])).toBeGreaterThan(CLUSTER_GAP_INCHES / 4);
      }
    }
    expect(isCoherent(placed)).toBe(true);
  });

  it('keeps 20 bases of 32 mm within the 9" span', () => {
    const placed = bases(Array.from({ length: 20 }, (_, i) => round(`m${i}`, 32)));
    expect(isCoherent(placed)).toBe(true);
  });

  it('puts the largest base in the middle and handles ovals', () => {
    const members = [round('s0', 25), oval('big', 60, 35), ...Array.from({ length: 8 }, (_, i) => round(`s${i + 1}`, 25))];
    const placed = bases(members);
    expect(isCoherent(placed)).toBe(true);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(baseGap(placed[i], placed[j])).toBeGreaterThan(0);
      }
    }
    const big = placed.find((base) => base.id === 'big')!;
    const others = placed.filter((base) => base.id !== 'big');
    const distanceOf = (base: CoherencyBase) => Math.hypot(base.x, base.y);
    expect(others.every((base) => distanceOf(base) >= distanceOf(big))).toBe(true);
  });

  it('centres the group on its bounding box', () => {
    const placed = bases([round('a', 32), round('b', 32)]);
    expect(placed[0].x + placed[1].x).toBeCloseTo(0, 6);
    expect(placed[0].y + placed[1].y).toBeCloseTo(0, 6);
  });
});

describe('cluster performance (RT_41)', () => {
  it('lays out 20 ovals and keeps them coherent and apart', () => {
    const members = Array.from({ length: 20 }, (_, i) => oval(`o${i}`, 75, 42));
    const started = performance.now();
    const placed = bases(members);
    expect(performance.now() - started).toBeLessThan(200);
    expect(isCoherent(placed)).toBe(true);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(baseGap(placed[i], placed[j])).toBeGreaterThan(0);
      }
    }
  });
});

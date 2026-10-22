import { describe, expect, it } from 'vitest';
import { clampZoom, formatZoom, nextZoom } from './zoom';

describe('nextZoom', () => {
  it.each([
    [1, 'in', 1.1],
    [1.1, 'in', 1.25],
    [1.25, 'in', 1.5],
    [2.5, 'in', 3],
    [1, 'out', 0.9],
    [0.6, 'out', 0.5],
  ] as const)('%s zoomed %s -> %s', (current, direction, expected) => {
    expect(nextZoom(current, direction)).toBe(expected);
  });

  it('stops at the largest and smallest level', () => {
    expect(nextZoom(3, 'in')).toBe(3);
    expect(nextZoom(0.5, 'out')).toBe(0.5);
  });

  it('snaps an off-grid value to the next level in the requested direction', () => {
    expect(nextZoom(1.05, 'in')).toBe(1.1);
    expect(nextZoom(1.05, 'out')).toBe(1);
    expect(nextZoom(1.2, 'out')).toBe(1.1);
  });

  it('does not treat a level as greater than itself because of float noise', () => {
    expect(nextZoom(1.1 + 1e-9, 'in')).toBe(1.25);
    expect(nextZoom(1.25 - 1e-9, 'out')).toBe(1.1);
  });
});

describe('clampZoom', () => {
  it.each([
    [1, 1],
    [0.1, 0.5],
    [10, 3],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [Number.NEGATIVE_INFINITY, 1],
  ])('%s -> %s', (value, expected) => {
    expect(clampZoom(value)).toBe(expected);
  });
});

describe('formatZoom', () => {
  it.each([
    [1, '100%'],
    [1.25, '125%'],
    [0.9, '90%'],
    [1.1, '110%'],
    [3, '300%'],
  ])('%s -> %s', (zoom, expected) => {
    expect(formatZoom(zoom)).toBe(expected);
  });
});

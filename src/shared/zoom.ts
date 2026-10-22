/** Zoom steps offered by the toolbar and keyboard shortcuts (1 = 100%). */
export const ZOOM_LEVELS: readonly number[] = [
  0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
];
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
export const DEFAULT_ZOOM = 1;

// Levels such as 1.1 are not exactly representable, so compare with a tolerance.
const EPSILON = 1e-6;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/** The next level strictly above (`in`) or below (`out`) the current zoom. */
export function nextZoom(current: number, direction: 'in' | 'out'): number {
  const zoom = clampZoom(current);
  if (direction === 'in') {
    return ZOOM_LEVELS.find((level) => level > zoom + EPSILON) ?? MAX_ZOOM;
  }
  return ZOOM_LEVELS.findLast((level) => level < zoom - EPSILON) ?? MIN_ZOOM;
}

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

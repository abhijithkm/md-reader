import type { MdReaderApi } from '../shared/ipc';

/** The preload bridge. Throws a clear error if the page runs without the preload script. */
export function getBridge(): MdReaderApi {
  const bridge = window.mdReader;
  if (bridge === undefined) {
    throw new Error('The MD Reader bridge is not available. Was the preload script loaded?');
  }
  return bridge;
}

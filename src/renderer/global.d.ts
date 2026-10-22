import type { MdReaderApi } from '../shared/ipc';

declare global {
  interface Window {
    /** Injected by the preload script; absent if the page is opened outside Electron. */
    mdReader?: MdReaderApi;
  }
}

export {};

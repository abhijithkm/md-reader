import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../../shared/updates';
import { useUpdates } from './useUpdates';

function createBridge(initial: UpdateState = { status: 'idle' }) {
  let listener: ((state: UpdateState) => void) | undefined;
  const unsubscribed = vi.fn();
  const bridge = {
    getAppInfo: vi.fn(() =>
      Promise.resolve({
        name: 'MD Reader',
        version: '1.1.0',
        platform: 'win32',
        installsUpdates: true,
      }),
    ),
    getUpdateState: vi.fn((): Promise<UpdateState> => Promise.resolve(initial)),
    checkForUpdates: vi.fn((): Promise<UpdateState> => Promise.resolve({ status: 'current' })),
    restartToUpdate: vi.fn(() => Promise.resolve()),
    onUpdateState: vi.fn((callback: (state: UpdateState) => void) => {
      listener = callback;
      return () => {
        listener = undefined;
        unsubscribed();
      };
    }),
  };
  return {
    bridge,
    unsubscribed,
    push(state: UpdateState) {
      act(() => {
        listener?.(state);
      });
    },
  };
}

/**
 * Long enough for rejected requests to have been handled, which waiting for one promise is not: a
 * handler that ran after the check would otherwise go unseen.
 */
async function settled(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

describe('useUpdates', () => {
  it('knows nothing until the main process has answered', async () => {
    const { bridge } = createBridge();
    bridge.getUpdateState.mockReturnValue(new Promise(() => undefined));
    bridge.getAppInfo.mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useUpdates(bridge));
    await act(async () => {
      await Promise.resolve();
    });

    expect(bridge.getUpdateState).toHaveBeenCalledOnce();
    expect(bridge.getAppInfo).toHaveBeenCalledOnce();
    expect(result.current.state).toBeUndefined();
    expect(result.current.version).toBeUndefined();
    expect(result.current.installsUpdates).toBeUndefined();
  });

  it('reports the current state, the version of the app and whether this copy installs updates', async () => {
    const { bridge } = createBridge({ status: 'ready', version: '1.2.0' });

    const { result } = renderHook(() => useUpdates(bridge));

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'ready', version: '1.2.0' });
    });
    expect(result.current.version).toBe('1.1.0');
    expect(result.current.installsUpdates).toBe(true);
  });

  it('knows when this copy only reports updates, as the portable executable does', async () => {
    const { bridge } = createBridge();
    bridge.getAppInfo.mockResolvedValue({
      name: 'MD Reader',
      version: '1.1.0',
      platform: 'win32',
      installsUpdates: false,
    });

    const { result } = renderHook(() => useUpdates(bridge));

    await waitFor(() => {
      expect(result.current.installsUpdates).toBe(false);
    });
  });

  it('learns about the app while the state is still on its way', async () => {
    const { bridge } = createBridge();
    bridge.getUpdateState.mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useUpdates(bridge));

    await waitFor(() => {
      expect(result.current.version).toBe('1.1.0');
    });
    expect(result.current.state).toBeUndefined();
  });

  it('follows the changes the main process pushes', async () => {
    const { bridge, push } = createBridge();
    const { result } = renderHook(() => useUpdates(bridge));
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'idle' });
    });

    push({ status: 'downloading', version: '1.2.0', percent: 40 });

    expect(result.current.state).toEqual({ status: 'downloading', version: '1.2.0', percent: 40 });
  });

  it('does not let a late answer overwrite a newer state that was pushed meanwhile', async () => {
    const { bridge, push } = createBridge();
    let answer: (state: UpdateState) => void = () => undefined;
    bridge.getUpdateState.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { result } = renderHook(() => useUpdates(bridge));

    push({ status: 'ready', version: '1.2.0' });
    await act(async () => {
      answer({ status: 'idle' });
      await Promise.resolve();
    });

    expect(result.current.state).toEqual({ status: 'ready', version: '1.2.0' });
  });

  describe('checking', () => {
    it('asks the main process and shows the result', async () => {
      const { bridge } = createBridge();
      const { result } = renderHook(() => useUpdates(bridge));
      await waitFor(() => {
        expect(result.current.state).toBeDefined();
      });

      act(() => {
        result.current.checkNow();
      });

      await waitFor(() => {
        expect(result.current.state).toEqual({ status: 'current' });
      });
      expect(bridge.checkForUpdates).toHaveBeenCalledOnce();
    });

    it('shows an error when the check cannot even be asked for', async () => {
      const { bridge } = createBridge();
      bridge.checkForUpdates.mockRejectedValue(new Error('no bridge'));
      const { result } = renderHook(() => useUpdates(bridge));
      await waitFor(() => {
        expect(result.current.state).toBeDefined();
      });

      act(() => {
        result.current.checkNow();
      });

      await waitFor(() => {
        expect(result.current.state).toEqual({ status: 'error' });
      });
    });
  });

  describe('restarting', () => {
    it('asks the main process to restart into the update', async () => {
      const { bridge } = createBridge({ status: 'ready', version: '1.2.0' });
      const { result } = renderHook(() => useUpdates(bridge));

      act(() => {
        result.current.restartNow();
      });

      expect(bridge.restartToUpdate).toHaveBeenCalledOnce();
    });

    it('does not fail the page when the request fails', async () => {
      const { bridge } = createBridge({ status: 'ready', version: '1.2.0' });
      bridge.restartToUpdate.mockRejectedValue(new Error('gone'));
      const { result } = renderHook(() => useUpdates(bridge));
      await waitFor(() => {
        expect(result.current.state).toEqual({ status: 'ready', version: '1.2.0' });
      });

      act(() => {
        result.current.restartNow();
      });
      await settled();

      expect(bridge.restartToUpdate).toHaveBeenCalledOnce();
      expect(result.current.state).toEqual({ status: 'ready', version: '1.2.0' });
    });
  });

  it('stays without a state when the main process cannot answer', async () => {
    const { bridge } = createBridge();
    bridge.getUpdateState.mockRejectedValue(new Error('unavailable'));
    bridge.getAppInfo.mockRejectedValue(new Error('unavailable'));

    const { result } = renderHook(() => useUpdates(bridge));
    await settled();

    expect(bridge.getUpdateState).toHaveBeenCalledOnce();
    expect(bridge.getAppInfo).toHaveBeenCalledOnce();
    expect(result.current.state).toBeUndefined();
    expect(result.current.version).toBeUndefined();
    expect(result.current.installsUpdates).toBeUndefined();
  });

  it('stops listening when the page goes away', () => {
    const { bridge, unsubscribed } = createBridge();
    const { unmount } = renderHook(() => useUpdates(bridge));

    unmount();

    expect(unsubscribed).toHaveBeenCalledOnce();
  });
});

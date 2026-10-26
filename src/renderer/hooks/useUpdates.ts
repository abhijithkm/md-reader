import { useCallback, useEffect, useState } from 'react';
import type { MdReaderApi } from '../../shared/ipc';
import type { UpdateState } from '../../shared/updates';

export interface UpdatesController {
  /** Undefined until the main process has answered. */
  state: UpdateState | undefined;
  /** The version of the running app, once known. */
  version: string | undefined;
  /** Whether this copy installs updates itself (the portable executable does not), once known. */
  installsUpdates: boolean | undefined;
  /** Looks for a newer version now and shows the result. */
  checkNow: () => void;
  /** Restarts into a downloaded update. */
  restartNow: () => void;
}

/**
 * What updating is doing, as the main process reports it. The page only shows this and asks for
 * two things: a check now and a restart into a downloaded update. Which version, from where and
 * when are decided in the main process.
 */
export function useUpdates(
  bridge: Pick<
    MdReaderApi,
    'getAppInfo' | 'getUpdateState' | 'checkForUpdates' | 'restartToUpdate' | 'onUpdateState'
  >,
): UpdatesController {
  const [state, setState] = useState<UpdateState | undefined>(undefined);
  const [version, setVersion] = useState<string | undefined>(undefined);
  const [installsUpdates, setInstallsUpdates] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let pushed = false;

    // Listen first, so that nothing pushed while the first answer is on its way is lost.
    const unsubscribe = bridge.onUpdateState((next) => {
      pushed = true;
      setState(next);
    });
    bridge.getUpdateState().then(
      (current) => {
        // A state pushed meanwhile is newer than this answer.
        if (!cancelled && !pushed) setState(current);
      },
      () => undefined,
    );
    bridge.getAppInfo().then(
      (info) => {
        if (cancelled) return;
        setVersion(info.version);
        setInstallsUpdates(info.installsUpdates);
      },
      () => undefined,
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  const checkNow = useCallback((): void => {
    bridge.checkForUpdates().then(setState, () => {
      setState({ status: 'error' });
    });
  }, [bridge]);

  const restartNow = useCallback((): void => {
    bridge.restartToUpdate().catch(() => undefined);
  }, [bridge]);

  return { state, version, installsUpdates, checkNow, restartNow };
}

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

export interface AppTarget {
  executable: string;
  /** Arguments that must precede the user's (the app entry point in development). */
  baseArgs: string[];
  kind: 'development' | 'packaged';
}

/**
 * The packaged executable when MDREADER_EXE is set, otherwise the development
 * build (`npm run build`) run through the installed Electron.
 */
export function resolveAppTarget(): AppTarget {
  const packaged = process.env['MDREADER_EXE'];
  if (packaged !== undefined) {
    // A workflow step that found no path leaves the variable empty. Starting the development build
    // then would test the wrong app, and pass.
    if (packaged === '') {
      throw new Error(
        'MDREADER_EXE is set but empty. Leave it unset to test the development build.',
      );
    }
    if (!existsSync(packaged)) throw new Error(`MDREADER_EXE does not exist: ${packaged}`);
    return { executable: packaged, baseArgs: [], kind: 'packaged' };
  }

  const root = process.cwd();
  const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const entry = path.join(root, 'out', 'main', 'index.js');
  if (!existsSync(electron)) {
    throw new Error(
      'Electron is not downloaded yet. Run "npx install-electron" (or "npm run dev" once), ' +
        'or set MDREADER_EXE to test the packaged app.',
    );
  }
  if (!existsSync(entry)) {
    throw new Error('The app is not built. Run "npm run build" first, or set MDREADER_EXE.');
  }
  // Pass the project folder, not the entry script: Electron reads the app name
  // and version from the package.json it finds there.
  return { executable: electron, baseArgs: [root], kind: 'development' };
}

export interface LaunchOptions {
  /** Profile folder; also scopes the single-instance lock, so it identifies "the running app". */
  userDataDir: string;
  /** Files passed on the command line. */
  files?: string[];
  extraArgs?: string[];
  env?: Record<string, string>;
}

export interface RunningApp {
  page: Page;
  child: ChildProcess;
  /** Resolves with the exit code when the process ends. */
  exited: Promise<number | null>;
  /** Everything the app wrote to stdout and stderr so far. */
  output(): string;
  /** Closes the window the way a user would (Ctrl+W) and waits for the process to end. */
  close(): Promise<void>;
  /** Ends the process immediately. */
  kill(): Promise<void>;
}

/** The app is running but never opened its debugging port, so there is nothing to drive. */
class DebuggerUnavailableError extends Error {}

/**
 * The port is picked by asking the OS for a free one and releasing it again, so it can be taken
 * by another process before the app binds it. Starting over with a new port covers that rare
 * race; an app that exits or fails any other way is reported at once.
 */
const START_ATTEMPTS = 3;
const DEBUGGER_TIMEOUT_MS = 15_000;

function cleanEnvironment(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  // The app looks for updates on the internet unless told not to. A test never lets it, except
  // when it asks for a feed on this computer (see e2e/updates.e2e.test.ts).
  const env: NodeJS.ProcessEnv = { ...process.env, MDREADER_UPDATES: 'off', ...extra };
  // This variable would make Electron behave like plain Node.js.
  delete env['ELECTRON_RUN_AS_NODE'];
  return env;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        resolve(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
  });
}

async function waitForDebugger(
  port: number,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`The app exited early with code ${child.exitCode}.`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new DebuggerUnavailableError(
    `The app did not open its debugging port within ${timeoutMs} ms.`,
  );
}

export async function launchApp(options: LaunchOptions): Promise<RunningApp> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await launchOnce(options);
    } catch (error) {
      if (!(error instanceof DebuggerUnavailableError) || attempt === START_ATTEMPTS) throw error;
      console.warn(`[e2e] start attempt ${attempt} of ${START_ATTEMPTS} failed, trying again:`);
      console.warn(error.message);
    }
  }
}

async function launchOnce(options: LaunchOptions): Promise<RunningApp> {
  const target = resolveAppTarget();
  const port = await freePort();
  const args = [
    ...target.baseArgs,
    ...(options.files ?? []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${options.userDataDir}`,
    ...(options.extraArgs ?? []),
  ];

  const child = spawn(target.executable, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cleanEnvironment(options.env),
  });
  const chunks: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      resolve(code);
    });
  });

  let browser: Browser | undefined;
  try {
    await waitForDebugger(port, child, DEBUGGER_TIMEOUT_MS);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 30_000 }));
    await page.waitForLoadState('domcontentloaded');

    const connected = browser;
    const kill = async (): Promise<void> => {
      await connected.close().catch(() => undefined);
      if (child.exitCode === null) child.kill();
      await exited;
    };

    return {
      page,
      child,
      exited,
      output: () => chunks.join(''),
      kill,
      close: async () => {
        await page.keyboard.press('Control+w').catch(() => undefined);
        const winner = await Promise.race([
          exited,
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10_000)),
        ]);
        if (winner === 'timeout') await kill();
        else await connected.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    if (child.exitCode === null) {
      child.kill();
      // Let go of the profile folder before a new attempt uses it.
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    const reason = error instanceof Error ? error.message : String(error);
    const message = `${reason}\n--- app output ---\n${chunks.join('')}`;
    throw error instanceof DebuggerUnavailableError
      ? new DebuggerUnavailableError(message, { cause: error })
      : new Error(message, { cause: error });
  }
}

/**
 * Starts the app a second time, the way Windows does when the user opens
 * another file. The new process hands its arguments to the running instance
 * (matched by `userDataDir`) and exits; resolves with its exit code.
 */
export async function launchSecondInstance(
  options: Pick<LaunchOptions, 'userDataDir' | 'files' | 'env'>,
): Promise<number | null> {
  const target = resolveAppTarget();
  const child = spawn(
    target.executable,
    [...target.baseArgs, ...(options.files ?? []), `--user-data-dir=${options.userDataDir}`],
    { stdio: 'ignore', env: cleanEnvironment(options.env) },
  );
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      resolve(code);
    });
  });
  const result = await Promise.race([
    exited,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20_000)),
  ]);
  if (result === 'timeout') {
    child.kill();
    throw new Error('The second instance did not exit; it should hand over to the running app.');
  }
  return result;
}

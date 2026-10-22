import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMarkdownFileName } from '../shared/markdown-files';

export interface LaunchContext {
  /** Directory relative paths are resolved against. */
  cwd: string;
  isPackaged: boolean;
}

/**
 * Picks the document a launch (first start or second instance) asked to open.
 *
 * The argument list looks like `[exe, ...args]` when packaged and
 * `[electron, appPath, ...args]` in development. Switches added by Chromium or
 * the user are skipped. A Markdown file wins over other arguments; if only
 * other files were passed the first is returned so the caller can explain why
 * it cannot be opened.
 */
export function findLaunchFile(
  argv: readonly string[],
  context: LaunchContext,
): string | undefined {
  const candidates = positionalArguments(argv, context.isPackaged).flatMap((argument) =>
    toAbsolutePath(argument, context.cwd),
  );
  return candidates.find((candidate) => isMarkdownFileName(candidate)) ?? candidates[0];
}

function positionalArguments(argv: readonly string[], isPackaged: boolean): string[] {
  const positional: string[] = [];
  let optionsEnded = false;

  for (const argument of argv.slice(isPackaged ? 1 : 2)) {
    if (argument === '') continue;
    if (!optionsEnded && argument === '--') {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && argument.startsWith('-')) continue;
    positional.push(argument);
  }
  return positional;
}

function toAbsolutePath(argument: string, cwd: string): string[] {
  if (/^file:/i.test(argument)) {
    try {
      return [path.normalize(fileURLToPath(argument))];
    } catch {
      return [];
    }
  }
  return [path.resolve(cwd, argument)];
}

import { formatBytes, formatCount, formatReadingTime } from '../format';

export interface StatusBarProps {
  name?: string;
  path?: string;
  sizeBytes?: number;
  stats?: { words: number; readingMinutes: number; lines: number };
  /** Locale for number formatting; the system locale when omitted. */
  locale?: string;
}

function counted(value: number, noun: string, locale: string | undefined): string {
  return `${formatCount(value, locale)} ${value === 1 ? noun : `${noun}s`}`;
}

export function StatusBar({ name, path, sizeBytes, stats, locale }: StatusBarProps) {
  if (name === undefined) {
    return (
      <footer className="statusbar">
        <span className="statusbar-item">No document open</span>
      </footer>
    );
  }

  return (
    <footer className="statusbar">
      <span className="statusbar-item statusbar-name" title={path}>
        {name}
      </span>
      {sizeBytes !== undefined && (
        <span className="statusbar-item">{formatBytes(sizeBytes, locale)}</span>
      )}
      {stats !== undefined && (
        <>
          <span className="statusbar-item">{counted(stats.words, 'word', locale)}</span>
          {stats.readingMinutes > 0 && (
            <span className="statusbar-item">{formatReadingTime(stats.readingMinutes)}</span>
          )}
          <span className="statusbar-item">{counted(stats.lines, 'line', locale)}</span>
        </>
      )}
    </footer>
  );
}

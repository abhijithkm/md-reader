export function formatCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** File size for the status bar: "812 bytes", "3.4 KB", "1.2 MB". */
export function formatBytes(bytes: number, locale?: string): string {
  if (bytes < 1024) return `${formatCount(bytes, locale)} ${bytes === 1 ? 'byte' : 'bytes'}`;

  const oneDecimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (bytes < 1024 * 1024) return `${oneDecimal.format(bytes / 1024)} KB`;
  return `${oneDecimal.format(bytes / (1024 * 1024))} MB`;
}

export function formatReadingTime(minutes: number): string {
  return `${minutes} min read`;
}

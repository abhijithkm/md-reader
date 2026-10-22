export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const;

/**
 * True when the name (or full path) ends in a Markdown extension. A bare
 * extension such as ".md" is a hidden file called "md", not a Markdown file.
 */
export function isMarkdownFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => {
    if (!lower.endsWith(extension)) return false;
    const before = lower.charAt(lower.length - extension.length - 1);
    return before !== '' && before !== '/' && before !== '\\';
  });
}

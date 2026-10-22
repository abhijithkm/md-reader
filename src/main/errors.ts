/** The Node.js error code (`ENOENT`, `EACCES` ...) of a failed file system call, if it has one. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' ? error.code : undefined;
  }
  return undefined;
}

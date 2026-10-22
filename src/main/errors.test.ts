import { describe, expect, it } from 'vitest';
import { errorCode } from './errors';

describe('errorCode', () => {
  it('reads the code of a Node.js system error', () => {
    expect(errorCode(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe('ENOENT');
  });

  it.each([
    undefined,
    null,
    'ENOENT',
    42,
    new Error('no code'),
    { code: 42 },
    { code: undefined },
    {},
  ])('has no code for %j', (value) => {
    expect(errorCode(value)).toBeUndefined();
  });
});

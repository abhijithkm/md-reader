import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './csp';

function parse(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name, values);
  }
  return directives;
}

describe('buildContentSecurityPolicy', () => {
  describe('in production', () => {
    const policy = parse(buildContentSecurityPolicy({ development: false }));

    it('denies everything that is not explicitly allowed', () => {
      expect(policy.get('default-src')).toEqual(["'none'"]);
    });

    it('runs scripts only from the app bundle', () => {
      expect(policy.get('script-src')).toEqual(["'self'"]);
    });

    it('loads styles and fonts only from the app bundle', () => {
      expect(policy.get('style-src')).toEqual(["'self'"]);
      expect(policy.get('font-src')).toEqual(["'self'"]);
    });

    it('loads images from the bundle, data URIs, https and local document images but never plain http', () => {
      expect(policy.get('img-src')).toEqual(["'self'", 'data:', 'https:', 'mdreader-local:']);
    });

    it.each(['connect-src', 'object-src', 'media-src', 'frame-src', 'worker-src', 'manifest-src'])(
      'blocks %s entirely',
      (directive) => {
        expect(policy.get(directive)).toEqual(["'none'"]);
      },
    );

    it('forbids a <base> element and form submission', () => {
      expect(policy.get('base-uri')).toEqual(["'none'"]);
      expect(policy.get('form-action')).toEqual(["'none'"]);
    });

    it('never permits eval, inline code or wildcards', () => {
      const everything = [...policy.values()].flat();
      expect(everything).not.toContain("'unsafe-eval'");
      expect(everything).not.toContain("'unsafe-inline'");
      expect(everything).not.toContain('*');
    });
  });

  describe('in development', () => {
    const policy = parse(buildContentSecurityPolicy({ development: true }));

    it('lets the dev server inject its inline preamble and styles', () => {
      expect(policy.get('script-src')).toEqual(["'self'", "'unsafe-inline'"]);
      expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    });

    it('allows hot reload to reach localhost only', () => {
      expect(policy.get('connect-src')).toEqual([
        "'self'",
        'ws://localhost:*',
        'http://localhost:*',
      ]);
    });

    it('still never permits eval or a bare wildcard', () => {
      const everything = [...policy.values()].flat();
      expect(everything).not.toContain("'unsafe-eval'");
      expect(everything).not.toContain('*');
    });

    it('keeps the production restrictions for plugins, frames and forms', () => {
      for (const directive of ['object-src', 'frame-src', 'base-uri', 'form-action']) {
        expect(policy.get(directive)).toEqual(["'none'"]);
      }
    });
  });
});

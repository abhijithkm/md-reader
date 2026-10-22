import type { LanguageFn } from 'highlight.js';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import dos from 'highlight.js/lib/languages/dos';
import http from 'highlight.js/lib/languages/http';
import nginx from 'highlight.js/lib/languages/nginx';
import powershell from 'highlight.js/lib/languages/powershell';
import { common } from 'lowlight';

/**
 * Languages available for fenced code blocks: highlight.js' common set (web,
 * systems and scripting languages, JSON, YAML, SQL, diff ...) plus a few that
 * are frequent in Windows documentation.
 */
export const highlightLanguages: Record<string, LanguageFn> = {
  ...common,
  dockerfile,
  dos,
  http,
  nginx,
  powershell,
};

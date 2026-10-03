import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * A lint-shaped test over the SOURCE.
 *
 * A boundary kept by good intentions decays at the first convenient import, so the
 * layering is asserted here rather than documented and hoped for.
 *
 * TRAP this deliberately avoids: a matcher that requires `import` and `from` on the
 * same LINE is blind to multi-line import blocks, and its absence-checks then pass
 * vacuously no matter what anyone imports. Every check below works on the whole file
 * text, and `findsSomething` proves the scanner is not silently matching nothing.
 */
const SRC = resolve(import.meta.dirname, '../..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).map((f) => ({ path: relative(SRC, f), text: readFileSync(f, 'utf8') }));
const inDir = (prefix: string) => FILES.filter((f) => f.path.startsWith(prefix));

/** `chrome.` as an expression, ignoring the word inside comments and strings. */
function namesChromeApi(text: string): boolean {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  return /(^|[^\w.'"`])chrome\s*\.\s*[a-zA-Z]/.test(withoutComments);
}

describe('the scanner itself', () => {
  it('finds files at all — otherwise every check below passes vacuously', () => {
    expect(FILES.length).toBeGreaterThan(15);
    expect(inDir('core/').length).toBeGreaterThan(3);
    expect(inDir('features/').length).toBeGreaterThan(3);
  });

  it('detects chrome usage where it is known to exist', () => {
    // Verifies the matcher by pointing it at a file that MUST match. Without this, a
    // broken matcher would make every "must not use chrome" assertion meaningless.
    const client = FILES.find((f) => f.path === 'app/client.ts');
    expect(client).toBeDefined();
    expect(namesChromeApi(client?.text ?? '')).toBe(true);
  });

  it('does not match the word chrome inside a comment', () => {
    expect(namesChromeApi('// talks to chrome.storage one day\nconst a = 1;')).toBe(false);
  });
});

describe('domain/ is the bottom of the stack', () => {
  it('imports nothing at all', () => {
    for (const file of inDir('domain/')) {
      const imports = [...file.text.matchAll(/^\s*import\s[\s\S]*?from\s+'([^']+)'/gm)]
        .map((m) => m[1]);
      // A type-only import from a sibling domain file is still the domain; anything
      // else would make the vocabulary depend on a layer above it.
      const foreign = imports.filter((i) => !i?.startsWith('./'));
      expect(foreign, `${file.path} imports ${foreign.join(', ')}`).toEqual([]);
    }
  });
});

describe('core/ is pure', () => {
  it('never names a chrome API', () => {
    // This is what lets every core test run in Node with no mocks at all.
    for (const file of inDir('core/')) {
      if (file.path.includes('__tests__')) continue;
      expect(namesChromeApi(file.text), `${file.path} names chrome.*`).toBe(false);
    }
  });

  it('never imports from engine, features, ui or surfaces', () => {
    for (const file of inDir('core/')) {
      expect(file.text, file.path).not.toMatch(/from '@\/(engine|features|ui|surfaces|app)/);
    }
  });
});

describe('the UI layer has exactly one chrome seam', () => {
  it('only app/client.ts names a chrome API', () => {
    const offenders = [...inDir('features/'), ...inDir('ui/'), ...inDir('surfaces/'), ...inDir('app/')]
      .filter((f) => f.path !== 'app/client.ts')
      .filter((f) => namesChromeApi(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('presenters in features/ do not import the client or the wired hook', () => {
    // If a presenter reaches for data, it is fused and cannot be rendered anywhere else.
    for (const file of inDir('features/')) {
      expect(file.text, file.path).not.toMatch(/from '@\/app\//);
    }
  });
});

describe('hosts import through barrels', () => {
  it('surfaces never deep-import past a feature barrel', () => {
    for (const file of inDir('surfaces/')) {
      const deep = [...file.text.matchAll(/from '@\/features\/([^']+)'/g)]
        .map((m) => m[1] ?? '')
        .filter((spec) => spec.includes('/'));
      expect(deep, `${file.path} deep-imports ${deep.join(', ')}`).toEqual([]);
    }
  });
});

describe('engine/ owns chrome, and nothing above it does', () => {
  it('never imports from features, ui or surfaces', () => {
    for (const file of inDir('engine/')) {
      expect(file.text, file.path).not.toMatch(/from '@\/(features|ui|surfaces)/);
    }
  });
});

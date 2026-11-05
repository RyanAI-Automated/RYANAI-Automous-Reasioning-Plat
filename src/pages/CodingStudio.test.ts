import { describe, expect, it } from 'vitest';
import { diffFiles, languageFromPath } from './CodingStudio';

describe('RyanAI Studio helpers', () => {
  it('maps common coding file extensions to their language labels', () => {
    expect(languageFromPath('src/App.tsx')).toBe('TypeScript React');
    expect(languageFromPath('tools/main.py')).toBe('Python');
    expect(languageFromPath('schema.sql')).toBe('SQL');
    expect(languageFromPath('README.unknown')).toBe('Text');
  });

  it('extracts only files present on the added side of a unified diff', () => {
    const diff = [
      'diff --git a/src/App.tsx b/src/App.tsx',
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      '@@ -1 +1 @@',
      '+export const app = true;',
      'diff --git a/src/old.ts b/src/new.ts',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
      '@@ -1 +1 @@',
      '+export const next = true;',
    ].join('\n');

    expect(diffFiles(diff)).toEqual(['src/App.tsx', 'src/new.ts']);
  });

  it('does not invent a file tree from a plain text buffer', () => {
    expect(diffFiles('export const app = true;')).toEqual([]);
  });
});

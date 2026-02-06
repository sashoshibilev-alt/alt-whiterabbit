import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Guardrail test: Ensure production pages never import mock data
 *
 * This test prevents regressions where mock data gets imported into
 * production code paths. Mocks should only exist in:
 * - src/test/fixtures/**
 * - *.stories.tsx files
 * - *.test.* files
 */
describe('Production pages must not import mock data', () => {
  const pagesDir = join(__dirname, '../pages');

  it('should not import from fixtures or mock modules', () => {
    const pageFiles = readdirSync(pagesDir).filter(f =>
      f.endsWith('.tsx') || f.endsWith('.ts')
    );

    const violations: string[] = [];

    for (const file of pageFiles) {
      const filePath = join(pagesDir, file);
      const content = readFileSync(filePath, 'utf-8');

      // Check for imports from fixtures or mock modules
      const mockImportPatterns = [
        /from\s+['"].*\/fixtures\//,
        /from\s+['"].*\/mock/i,
        /import\s+.*\s+from\s+['"].*fixtures/,
        /import\s+.*\s+from\s+['"].*mock/i,
      ];

      for (const pattern of mockImportPatterns) {
        if (pattern.test(content)) {
          violations.push(`${file}: Contains mock/fixture import`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Production pages must not import mock data:\n${violations.join('\n')}\n\n` +
        `Mocks are only allowed in:\n` +
        `- src/test/fixtures/** (for tests)\n` +
        `- *.stories.tsx (for Storybook)\n` +
        `- *.test.* (for tests)`
      );
    }

    expect(violations).toEqual([]);
  });
});

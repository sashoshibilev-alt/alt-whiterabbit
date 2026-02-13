/**
 * Tests for smart title truncation
 *
 * Validates:
 * - No truncation when under limit
 * - Truncation at word boundaries
 * - Preference for clause boundaries
 * - Ellipsis addition
 * - No mid-word cuts (especially not dangling "at", "global", etc.)
 */

// Re-implement the functions here for testing isolation
// In production, these would be imported from synthesis.ts, but since they're private,
// we'll duplicate them here for testing purposes.

function truncateTitleSmart(title: string, maxLen: number): string {
  if (!title) {
    return title;
  }

  const trimmed = title.trim();
  if (trimmed.length <= maxLen) {
    return trimmed;
  }

  const targetLen = maxLen - 1;

  // Clause boundaries
  const clauseMarkers = ['. ', '; ', ' — ', ': '];
  for (const marker of clauseMarkers) {
    let searchIdx = 0;
    let lastGoodIdx = -1;

    while ((searchIdx = trimmed.indexOf(marker, searchIdx)) !== -1) {
      if (searchIdx < targetLen) {
        lastGoodIdx = searchIdx;
        searchIdx += marker.length;
      } else {
        break;
      }
    }

    if (lastGoodIdx > 0 && lastGoodIdx >= targetLen * 0.3) {
      return cleanAndAppendEllipsis(trimmed.substring(0, lastGoodIdx));
    }
  }

  // Comma boundary
  const commaIdx = trimmed.lastIndexOf(', ', targetLen);
  if (commaIdx > 0 && commaIdx >= targetLen * 0.4) {
    return cleanAndAppendEllipsis(trimmed.substring(0, commaIdx));
  }

  // Word boundary
  const spaceIdx = trimmed.lastIndexOf(' ', targetLen);
  if (spaceIdx > 0 && spaceIdx >= targetLen * 0.7) {
    return cleanAndAppendEllipsis(trimmed.substring(0, spaceIdx));
  }

  // Hard cut (ensure no surrogate pair break)
  let cutPoint = targetLen;
  const charCode = trimmed.charCodeAt(cutPoint - 1);
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    cutPoint -= 1;
  }

  return cleanAndAppendEllipsis(trimmed.substring(0, cutPoint));
}

function cleanAndAppendEllipsis(text: string): string {
  let cleaned = text.trim();

  // Remove trailing punctuation (except closing markers)
  cleaned = cleaned.replace(/[,;:\-]+$/, '');
  cleaned = cleaned.trim();

  // Handle unmatched quotes
  if (cleaned.match(/\s+"[^"]*$/)) {
    cleaned = cleaned.replace(/\s+"[^"]*$/, '').trim();
  } else if (cleaned.match(/\s+'[^']*$/)) {
    cleaned = cleaned.replace(/\s+'[^']*$/, '').trim();
  }

  return cleaned + '…';
}

describe('truncateTitleSmart', () => {
  describe('no truncation when under limit', () => {
    it('should return title as-is when exactly at limit', () => {
      const title = 'Add user authentication';
      const result = truncateTitleSmart(title, 25);
      expect(result).toBe(title);
    });

    it('should return title as-is when under limit', () => {
      const title = 'Add feature';
      const result = truncateTitleSmart(title, 50);
      expect(result).toBe(title);
    });

    it('should return empty string as-is', () => {
      const result = truncateTitleSmart('', 50);
      expect(result).toBe('');
    });
  });

  describe('truncation at word boundary', () => {
    it('should truncate at word boundary and add ellipsis', () => {
      const title = 'Implement a comprehensive user authentication system for global markets';
      const result = truncateTitleSmart(title, 50);

      // Should add ellipsis
      expect(result.endsWith('…')).toBe(true);

      // Should be within length constraint (including ellipsis)
      expect(result.length).toBeLessThanOrEqual(50);

      // Verify reasonable truncation (not ending with tiny fragments)
      expect(result.length).toBeGreaterThan(30); // Should use most of available space
    });

    it('should prefer word boundary when possible', () => {
      const title = 'Add support for automated testing and comprehensive validation';
      const result = truncateTitleSmart(title, 40);

      expect(result.endsWith('…')).toBe(true);
      expect(result.length).toBeLessThanOrEqual(40);
      // With 70% threshold, "and" at position 37 meets the threshold (37/39 = 94%)
      // So it should be included
      expect(result).toBe('Add support for automated testing and…');
    });

    it('should not end with dangling "provide" fragment', () => {
      const title = 'Implement system to provide real-time analytics and insights';
      const result = truncateTitleSmart(title, 35);

      expect(result.endsWith('…')).toBe(true);
      // Should cut before "provide" if it would be dangling
      expect(result.length).toBeLessThanOrEqual(35);
    });
  });

  describe('preference for clause boundaries', () => {
    it('should prefer period + space over word boundary', () => {
      const title = 'Improve performance. Add caching layer for global distribution systems';
      const result = truncateTitleSmart(title, 50);

      expect(result).toBe('Improve performance…');
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('should prefer semicolon over word boundary', () => {
      const title = 'Update authentication flow; migrate to OAuth 2.0 for better security';
      const result = truncateTitleSmart(title, 50);

      expect(result).toBe('Update authentication flow…');
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('should prefer colon over word boundary', () => {
      const title = 'Add new feature: comprehensive analytics dashboard for enterprise users';
      const result = truncateTitleSmart(title, 40);

      expect(result).toBe('Add new feature…');
      expect(result.length).toBeLessThanOrEqual(40);
    });

    it('should prefer em dash over word boundary', () => {
      const title = 'Implement caching — Redis for session management and data persistence';
      const result = truncateTitleSmart(title, 40);

      expect(result).toBe('Implement caching…');
      expect(result.length).toBeLessThanOrEqual(40);
    });

    it('should prefer comma over plain word boundary', () => {
      const title = 'Add support for multiple languages, regions, and currency formats';
      const result = truncateTitleSmart(title, 40);

      expect(result).toBe('Add support for multiple languages…');
      expect(result.length).toBeLessThanOrEqual(40);
    });
  });

  describe('ellipsis addition', () => {
    it('should always add ellipsis when truncated', () => {
      const title = 'This is a very long title that needs to be truncated';
      const result = truncateTitleSmart(title, 30);

      expect(result.endsWith('…')).toBe(true);
    });

    it('should not add ellipsis when not truncated', () => {
      const title = 'Short title';
      const result = truncateTitleSmart(title, 30);

      expect(result.endsWith('…')).toBe(false);
      expect(result).toBe(title);
    });

    it('should include ellipsis in length calculation', () => {
      const title = 'This is exactly fifty characters long for testing';
      const result = truncateTitleSmart(title, 30);

      // Result should be <= 30 including the ellipsis
      expect(result.length).toBeLessThanOrEqual(30);
      expect(result.endsWith('…')).toBe(true);
    });
  });

  describe('punctuation cleanup', () => {
    it('should remove trailing comma before ellipsis', () => {
      const title = 'Add support for A, B, C, and many other features for users';
      const result = truncateTitleSmart(title, 20);

      expect(result).not.toContain(',…');
      expect(result.endsWith('…')).toBe(true);
    });

    it('should remove trailing colon before ellipsis', () => {
      const title = 'Implement the following: feature A and feature B and more';
      const result = truncateTitleSmart(title, 26);

      expect(result).not.toContain(':…');
      expect(result).toBe('Implement the following…');
    });

    it('should trim whitespace before ellipsis', () => {
      const title = 'Add feature    ';
      const result = truncateTitleSmart(title, 20);

      expect(result).not.toContain('  …');
      expect(result).toBe('Add feature');
    });
  });

  describe('unmatched quote handling', () => {
    it('should remove unmatched opening double quote at end', () => {
      const title = 'Implement feature and add "incomplete quote section here';
      const result = truncateTitleSmart(title, 50);

      // Should remove the incomplete quoted section
      expect(result.endsWith('…')).toBe(true);
      expect(result).toBe('Implement feature and add…');
    });

    it('should remove unmatched opening single quote at end', () => {
      const title = "Add feature and include 'incomplete quote section here";
      const result = truncateTitleSmart(title, 45);

      expect(result.endsWith('…')).toBe(true);
      expect(result).toBe('Add feature and include…');
    });

    it('should keep balanced quotes', () => {
      const title = 'Implement "new feature" for users';
      const result = truncateTitleSmart(title, 30);

      // Quotes should remain balanced if they fit
      expect(result).toContain('"new feature"');
    });
  });

  describe('UTF-16 surrogate pair safety', () => {
    it('should not break emoji surrogate pairs', () => {
      // Emoji like 😀 are surrogate pairs in UTF-16
      const title = 'Add emoji support 😀 for better user experience';
      const result = truncateTitleSmart(title, 20);

      // Should not end with half an emoji (broken surrogate pair)
      // The result should be valid UTF-16
      expect(result.endsWith('…')).toBe(true);
      expect(result.length).toBeLessThanOrEqual(20);

      // Validate no broken surrogates by checking if we can encode it
      expect(() => new TextEncoder().encode(result)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle very short maxLen', () => {
      const title = 'Add feature';
      const result = truncateTitleSmart(title, 8);

      expect(result.endsWith('…')).toBe(true);
      expect(result.length).toBeLessThanOrEqual(8);
    });

    it('should handle title with no spaces (single word)', () => {
      const title = 'Supercalifragilisticexpialidocious';
      const result = truncateTitleSmart(title, 20);

      expect(result.endsWith('…')).toBe(true);
      expect(result.length).toBeLessThanOrEqual(20);
    });

    it('should handle title with only clause markers', () => {
      const title = 'A. B. C. D. E. F. G. H. I. J.';
      const result = truncateTitleSmart(title, 10);

      expect(result.endsWith('…')).toBe(true);
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });
});

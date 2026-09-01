import { describe, expect, it } from 'vitest';
import {
  assertCurrentRevision,
  nextRevision,
  StaleRevisionError,
} from '@/lib/proof/revisions';

describe('assertCurrentRevision', () => {
  it('passes when the base revision is exactly current', () => {
    expect(() => assertCurrentRevision(42, 42)).not.toThrow();
  });

  it('throws a StaleRevisionError when the world moved on', () => {
    try {
      assertCurrentRevision(42, 43);
      expect.unreachable('should have thrown');
    } catch (cause) {
      expect(cause).toBeInstanceOf(StaleRevisionError);
      const error = cause as StaleRevisionError;
      expect(error.baseRevision).toBe(42);
      expect(error.currentRevision).toBe(43);
      expect(error.message).toContain('revision');
    }
  });

  it('refuses a base revision ahead of the world too', () => {
    expect(() => assertCurrentRevision(44, 43)).toThrow(StaleRevisionError);
  });
});

describe('nextRevision', () => {
  it('advances by exactly one', () => {
    expect(nextRevision(0)).toBe(1);
    expect(nextRevision(41)).toBe(42);
  });
});

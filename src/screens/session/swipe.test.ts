import { describe, expect, it } from 'vitest';
import { resolveSwipe, SWIPE_THRESHOLD } from './swipe';

describe('resolveSwipe', () => {
  it('ignores drags shorter than the threshold', () => {
    expect(resolveSwipe(SWIPE_THRESHOLD - 1, 0)).toBeNull();
    expect(resolveSwipe(-(SWIPE_THRESHOLD - 1), 0)).toBeNull();
    expect(resolveSwipe(0, 0)).toBeNull();
  });

  it('turns the page at the threshold', () => {
    expect(resolveSwipe(-SWIPE_THRESHOLD, 0)).toBe('next');
    expect(resolveSwipe(SWIPE_THRESHOLD, 0)).toBe('prev');
    expect(resolveSwipe(-200, 10)).toBe('next');
    expect(resolveSwipe(200, -10)).toBe('prev');
  });

  it('leaves vertical scrolling alone', () => {
    expect(resolveSwipe(-80, 200)).toBeNull();
    expect(resolveSwipe(80, -200)).toBeNull();
    // Equal travel in both axes is a scroll, not a swipe.
    expect(resolveSwipe(-100, 100)).toBeNull();
  });

  it('accepts a custom threshold', () => {
    expect(resolveSwipe(-30, 0, 20)).toBe('next');
    expect(resolveSwipe(-30, 0, 100)).toBeNull();
  });

  it('is defensive about junk input', () => {
    expect(resolveSwipe(Number.NaN, 0)).toBeNull();
    expect(resolveSwipe(0, Number.NaN)).toBeNull();
  });
});

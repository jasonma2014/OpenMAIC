import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

describe('DEFAULT_BRAND (single-brand build)', () => {
  it('uses the school product name', () => {
    expect(DEFAULT_BRAND.productName).toBe('明课');
    expect(DEFAULT_BRAND.shortName).toBe('明课');
    expect(DEFAULT_BRAND.markSrc).toBe('/mingke-mark.svg');
    expect(DEFAULT_BRAND.themeColor).toBe('#722ed1');
  });

  it('keeps the name in text beside the mark', () => {
    expect(DEFAULT_BRAND.logoHasWordmark).toBe(false);
    expect(DEFAULT_BRAND.logoSrc).toBe('/logo-horizontal.png');
  });
});

'use client';

import { useBrand } from '@/lib/brand/brand-context';
import { cn } from '@/lib/utils';

const SIZES = {
  hero: { mark: 'size-12 md:size-14', text: 'text-3xl md:text-4xl' },
  header: { mark: 'size-6', text: 'text-[15px]' },
  rail: { mark: 'size-5', text: 'text-sm' },
} as const;

/** Geometric mark plus the product name. The name is text, so it is not baked into the image. */
export function BrandLockup({
  size = 'header',
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const brand = useBrand();
  const metrics = SIZES[size];
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <img src={brand.markSrc} alt={brand.productName} className={cn('shrink-0', metrics.mark)} />
      <span
        aria-hidden="true"
        className={cn('font-semibold tracking-tight', metrics.text)}
        style={{ color: brand.themeColor }}
      >
        {brand.productName}
      </span>
    </span>
  );
}

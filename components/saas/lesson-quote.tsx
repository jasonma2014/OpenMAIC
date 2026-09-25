'use client';

import { useEffect, useState } from 'react';

import { useI18n } from '@/lib/hooks/use-i18n';
import { formatBalanceYuan } from '@/lib/saas/session-state';

interface LessonQuoteBody {
  retailMilliYuan: number;
  balanceMilliYuan: number;
  sufficient: boolean;
}

export function LessonQuote({ onSufficient }: { onSufficient: (ok: boolean) => void }) {
  const { t } = useI18n();
  const [quote, setQuote] = useState<LessonQuoteBody | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    onSufficient(false);
    fetch('/api/saas/quote', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('quote failed');
        return (await response.json()) as LessonQuoteBody;
      })
      .then((body) => {
        if (cancelled) return;
        if (
          typeof body.retailMilliYuan !== 'number' ||
          typeof body.balanceMilliYuan !== 'number' ||
          typeof body.sufficient !== 'boolean'
        ) {
          throw new Error('quote malformed');
        }
        setQuote(body);
        onSufficient(body.sufficient);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onSufficient(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onSufficient]);

  if (failed) return <p className="px-4 pb-2 text-xs text-destructive">{t('saas.quoteFailed')}</p>;
  if (!quote)
    return <p className="px-4 pb-2 text-xs text-muted-foreground">{t('common.loading')}</p>;
  return (
    <p
      className={`px-4 pb-2 text-xs ${quote.sufficient ? 'text-muted-foreground' : 'text-destructive'}`}
    >
      {t(quote.sufficient ? 'saas.quote' : 'saas.quoteShort', {
        price: formatBalanceYuan(quote.retailMilliYuan),
        balance: formatBalanceYuan(quote.balanceMilliYuan),
      })}
    </p>
  );
}

'use client';

import Link from 'next/link';

import { useI18n } from '@/lib/hooks/use-i18n';

export default function JoinPage() {
  const { t } = useI18n();
  return (
    <main className="min-h-[100dvh] flex items-center justify-center px-4">
      <div className="max-w-sm space-y-3 text-sm">
        <h1 className="text-xl font-semibold">{t('saas.joinTitle')}</h1>
        <p className="text-muted-foreground">{t('saas.joinHint')}</p>
        <Link href="/" className="text-primary">
          {t('saas.loginTitle')}
        </Link>
      </div>
    </main>
  );
}

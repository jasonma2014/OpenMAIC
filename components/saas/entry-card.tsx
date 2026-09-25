'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';

export function SaasEntryCard({ loading, student }: { loading: boolean; student: boolean }) {
  const { t } = useI18n();
  if (loading) {
    return <p className="py-16 text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  return (
    <div className="w-full rounded-2xl border bg-background/80 p-6 shadow-sm">
      <p className="text-sm text-muted-foreground">
        {student ? t('saas.studentHome') : t('saas.signedOutHome')}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {student ? null : (
          <>
            <Button asChild>
              <Link href="/login">{t('saas.loginTitle')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/register">{t('saas.registerTitle')}</Link>
            </Button>
          </>
        )}
        <Button asChild variant={student ? 'default' : 'ghost'}>
          <Link href="/join">{t('saas.joinTitle')}</Link>
        </Button>
      </div>
    </div>
  );
}

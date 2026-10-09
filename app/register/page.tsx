'use client';

import { useState } from 'react';
import Link from 'next/link';

import { AccountForm } from '@/components/saas/account-form';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';

export default function RegisterPage() {
  const { t } = useI18n();
  const [kind, setKind] = useState<'teacher' | 'student' | null>(null);
  if (kind === 'teacher') return <AccountForm mode="register-teacher" />;
  if (kind === 'student') return <AccountForm mode="register-student" />;
  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border bg-background p-6 shadow-sm">
        <h1 className="text-xl font-semibold">{t('saas.registerTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('saas.registerChoose')}</p>
        <Button className="w-full" onClick={() => setKind('teacher')}>
          {t('saas.register-teacherTitle')}
        </Button>
        <Button className="w-full" variant="outline" onClick={() => setKind('student')}>
          {t('saas.register-studentTitle')}
        </Button>
        <Link href="/login" className="block text-sm text-muted-foreground">
          {t('saas.loginTitle')}
        </Link>
      </div>
    </main>
  );
}

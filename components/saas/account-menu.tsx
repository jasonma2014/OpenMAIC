'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useI18n } from '@/lib/hooks/use-i18n';
import { formatBalanceYuan } from '@/lib/saas/session-state';
import { signOutSaas, useSaasSession } from '@/lib/saas/use-saas-session';

export function SaasAccountMenu() {
  const { t } = useI18n();
  const router = useRouter();
  const session = useSaasSession();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  if (session.status === 'off') return null;
  if (session.status === 'loading') {
    return (
      <>
        <span className="px-2 text-xs text-muted-foreground">{t('common.loading')}</span>
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
      </>
    );
  }
  if (session.status === 'signed-out') {
    return (
      <>
        <Link href="/login" className="px-3 text-sm font-medium text-primary">
          {t('saas.loginTitle')}
        </Link>
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
      </>
    );
  }
  const { account } = session;
  return (
    <div className="flex items-center gap-2 border-r border-gray-200 px-2 text-xs dark:border-gray-700">
      {(account.orgs?.length ?? 0) > 1 ? (
        <select
          aria-label={t('saas.switchSchool')}
          className="max-w-36 rounded border bg-background p-1 font-medium"
          value={account.orgId ?? ''}
          disabled={switching}
          onChange={async (event) => {
            setSwitching(true);
            setError('');
            try {
              const response = await fetch('/api/saas/school', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'switch', orgId: event.target.value }),
              });
              const body = await response.json();
              if (!response.ok) throw new Error(body.error || t('saas.failed'));
              // Reload clears in-memory document and asset state from the old school.
              window.location.assign('/');
            } catch (err) {
              setError(err instanceof Error ? err.message : t('saas.failed'));
              setSwitching(false);
            }
          }}
        >
          {account.orgs?.map((org) => (
            <option key={org.orgId} value={org.orgId}>
              {org.orgName}
            </option>
          ))}
        </select>
      ) : (
        <span className="max-w-28 truncate font-medium">{account.orgName}</span>
      )}
      {error ? (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      ) : null}
      <span className="text-muted-foreground">
        {account.role
          ? t(`saas.role.${account.role}`)
          : t(`saas.kind.${account.kind ?? 'teacher'}`)}
      </span>
      <span className="tabular-nums text-muted-foreground">
        ¥{formatBalanceYuan(account.balanceMilliYuan)}
      </span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          void signOutSaas().then(() => router.push('/login'));
        }}
      >
        {t('saas.signOut')}
      </button>
    </div>
  );
}

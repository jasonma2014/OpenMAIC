'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useI18n } from '@/lib/hooks/use-i18n';
import { formatBalanceYuan } from '@/lib/saas/session-state';
import { signOutSaas, useSaasSession } from '@/lib/saas/use-saas-session';

export function SaasAccountMenu() {
  const { t } = useI18n();
  const router = useRouter();
  const session = useSaasSession();
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
      <span className="max-w-28 truncate font-medium">{account.orgName}</span>
      <span className="text-muted-foreground">{t(`saas.role.${account.role}`)}</span>
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

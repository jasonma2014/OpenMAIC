'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlipayTopup } from './alipay-topup';
import { Button } from '@/components/ui/button';
import { formatBalanceYuan } from '@/lib/saas/session-state';
import { refreshSaasSession } from '@/lib/saas/use-saas-session';

interface Wallet {
  balanceMilliYuan: number;
  trialTopupEnabled: boolean;
  alipayEnabled: boolean;
  alipaySandbox: boolean;
  paymentOrders: Array<{
    orderId: string;
    requestId: string;
    amountMilliYuan: number;
    status: 'pending' | 'paid';
    sandbox: boolean;
    createdAt: number;
  }>;
  entries: Array<{ id: string; kind: string; amountMilliYuan: number; createdAt: number }>;
}

export function SchoolWallet({ orgId }: { orgId: string }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [amount, setAmount] = useState(10_000);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch('/api/saas/school', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'wallet' }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || '读取钱包失败');
    setWallet(body);
  }, []);
  useEffect(() => {
    void load().catch((err) => setError(err.message));
  }, [load, orgId]);
  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="学校钱包">
      <h2 className="font-medium">
        学校钱包{wallet ? ` · ¥${formatBalanceYuan(wallet.balanceMilliYuan)}` : ''}
      </h2>
      {wallet?.alipayEnabled ? (
        <AlipayTopup
          key={orgId}
          sandbox={wallet.alipaySandbox}
          orders={wallet.paymentOrders}
          onRefresh={async () => {
            await load();
            await refreshSaasSession();
          }}
        />
      ) : (
        <p className="text-muted-foreground">支付宝支付尚未开通，待完成商户配置后启用。</p>
      )}
      {wallet?.trialTopupEnabled ? (
        <div className="space-y-2">
          <p className="text-muted-foreground">试用充值：添加测试额度，不发生真实付款。</p>
          <div className="flex gap-2">
            <select
              aria-label="测试充值金额"
              disabled={pending}
              className="rounded-md border bg-background px-2"
              value={amount}
              onChange={(event) => {
                setAmount(Number(event.target.value));
                requestId.current = null;
              }}
            >
              {[10_000, 50_000, 100_000].map((value) => (
                <option key={value} value={value}>
                  ¥{formatBalanceYuan(value)}
                </option>
              ))}
            </select>
            <Button
              disabled={pending}
              onClick={async () => {
                if (pending) return;
                setPending(true);
                setError('');
                requestId.current ??= crypto.randomUUID();
                try {
                  const response = await fetch('/api/saas/school', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      action: 'top-up',
                      requestId: requestId.current,
                      amountMilliYuan: amount,
                    }),
                  });
                  const body = await response.json();
                  if (!response.ok) throw new Error(body.error || '充值失败');
                  setWallet(body);
                  requestId.current = null;
                  await refreshSaasSession();
                } catch (err) {
                  setError(err instanceof Error ? err.message : '充值失败');
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? '正在充值…' : '添加测试额度'}
            </Button>
          </div>
        </div>
      ) : null}
      {wallet?.entries.length ? (
        <details>
          <summary>最近收支记录</summary>
          <ul className="mt-2 space-y-1">
            {wallet.entries.map((entry) => (
              <li key={entry.id}>
                {new Date(entry.createdAt).toLocaleString()} ·{' '}
                {entry.kind === 'alipay_sandbox_topup'
                  ? '支付宝沙箱充值'
                  : entry.kind === 'alipay_topup'
                    ? '支付宝充值'
                    : entry.kind === 'trial_topup'
                      ? '测试充值'
                      : entry.kind === 'signup_grant'
                        ? '试用赠送'
                        : '生成/上课消费'}{' '}
                ·{' '}
                {['alipay_sandbox_topup', 'alipay_topup', 'trial_topup', 'signup_grant'].includes(
                  entry.kind,
                )
                  ? '+'
                  : '-'}
                ¥{formatBalanceYuan(entry.amountMilliYuan)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

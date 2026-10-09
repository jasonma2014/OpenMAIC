'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatBalanceYuan } from '@/lib/saas/session-state';
interface PaymentOrder {
  orderId: string;
  requestId: string;
  amountMilliYuan: number;
  status: 'pending' | 'paid';
  sandbox: boolean;
  createdAt: number;
}
export function AlipayTopup({
  sandbox,
  orders,
  onRefresh,
}: {
  sandbox: boolean;
  orders: PaymentOrder[];
  onRefresh: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(10_000);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState<{ url: string; orderId: string } | null>(null);
  const requestId = useRef<string | null>(null);
  async function create(value = amount, retryId?: string) {
    setPending(true);
    setError('');
    requestId.current = retryId ?? requestId.current ?? crypto.randomUUID();
    try {
      const response = await fetch('/api/saas/payments/alipay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountMilliYuan: value, requestId: requestId.current }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '创建支付订单失败');
      setCheckout(body.paymentUrl ? { url: body.paymentUrl, orderId: body.orderId } : null);
      requestId.current = null;
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建支付订单失败');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-2">
      <p>
        {sandbox
          ? '支付宝沙箱：仅供联调，不发生真实付款。'
          : '支付宝充值：付款到账后自动增加学校余额。'}
      </p>
      <div className="flex gap-2">
        <select
          aria-label="支付宝充值金额"
          className="rounded-md border bg-background px-2"
          disabled={pending}
          value={amount}
          onChange={(event) => {
            setAmount(Number(event.target.value));
            requestId.current = null;
            setCheckout(null);
          }}
        >
          {[10_000, 50_000, 100_000].map((value) => (
            <option value={value} key={value}>
              ¥{formatBalanceYuan(value)}
            </option>
          ))}
        </select>
        <Button disabled={pending} onClick={() => void create()}>
          {pending ? '正在创建订单…' : '支付宝充值'}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void onRefresh().catch((err) => setError(err.message))}
        >
          刷新到账状态
        </Button>
      </div>
      {checkout && (
        <p>
          <a className="underline" href={checkout.url} target="_blank" rel="noopener noreferrer">
            前往支付宝收银台
          </a>
          <span className="text-muted-foreground"> · 支付后返回此处刷新到账状态</span>
        </p>
      )}
      {orders.length > 0 && (
        <details open>
          <summary>最近充值订单</summary>
          <ul className="space-y-1">
            {orders.map((order) => (
              <li key={order.orderId}>
                {new Date(order.createdAt).toLocaleString()} · ¥
                {formatBalanceYuan(order.amountMilliYuan)} · {order.sandbox ? '沙箱 · ' : ''}
                {order.status === 'paid' ? '已到账' : '未收到付款通知'}
                {order.status === 'pending' && order.sandbox === sandbox && (
                  <Button
                    variant="link"
                    disabled={pending}
                    onClick={() => void create(order.amountMilliYuan, order.requestId)}
                  >
                    继续支付
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

import { randomUUID } from 'node:crypto';
import { AlipaySdk } from 'alipay-sdk';
import { SaasInputError, SaasConflictError, type SaasDb } from './accounts';
import { requireWalletAdmin } from './wallet';
import { SchoolError } from './school';

export interface AlipayConfig {
  appId: string;
  sellerId: string;
  privateKey: string;
  alipayPublicKey: string;
  origin: string;
  sandbox: boolean;
}
interface Order {
  id: string;
  org_id: string;
  amount_milli_yuan: string;
  status: 'pending' | 'paid';
  app_id: string;
  seller_id: string;
  sandbox: boolean;
  trade_no: string | null;
}
function sdk(config: AlipayConfig) {
  return new AlipaySdk({
    appId: config.appId,
    privateKey: config.privateKey,
    alipayPublicKey: config.alipayPublicKey,
    keyType: 'PKCS8',
    signType: 'RSA2',
    gateway: config.sandbox
      ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
      : 'https://openapi.alipay.com/gateway.do',
  });
}
export async function readAlipayOrder(
  db: SaasDb,
  actor: { orgId: string; userId: string },
  orderId: string,
) {
  await requireWalletAdmin(db, actor.orgId, actor.userId);
  const { rows } = await db.query<Order>(
    'SELECT * FROM saas_payment_orders WHERE id=$1 AND org_id=$2',
    [orderId, actor.orgId],
  );
  if (!rows[0]) throw new SchoolError('forbidden');
  return {
    orderId: rows[0].id,
    status: rows[0].status,
    amountMilliYuan: Number(rows[0].amount_milli_yuan),
  };
}
export async function createAlipayOrder(
  db: SaasDb,
  input: { orgId: string; userId: string; requestId: unknown; amountMilliYuan: unknown },
  config: AlipayConfig,
) {
  await requireWalletAdmin(db, input.orgId, input.userId);
  if (![10_000, 50_000, 100_000].includes(input.amountMilliYuan as number))
    throw new SaasInputError('请选择 10、50 或 100 元');
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.requestId))
    throw new SaasInputError('充值请求编号无效');
  const order = await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO saas_payment_orders (id,org_id,user_id,request_id,amount_milli_yuan,app_id,seller_id,sandbox)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (org_id,request_id) DO NOTHING`,
      [
        randomUUID().replaceAll('-', ''),
        input.orgId,
        input.userId,
        input.requestId,
        input.amountMilliYuan,
        config.appId,
        config.sellerId,
        config.sandbox,
      ],
    );
    const { rows } = await tx.query<Order>(
      'SELECT * FROM saas_payment_orders WHERE org_id=$1 AND request_id=$2',
      [input.orgId, input.requestId],
    );
    const row = rows[0];
    if (
      Number(row.amount_milli_yuan) !== input.amountMilliYuan ||
      row.app_id !== config.appId ||
      row.seller_id !== config.sellerId ||
      row.sandbox !== config.sandbox
    )
      throw new SaasConflictError('同一充值请求不能更改金额或收款配置');
    return row;
  });
  const paymentUrl =
    order.status === 'paid'
      ? null
      : sdk(config).pageExecute('alipay.trade.page.pay', 'GET', {
          notifyUrl: `${config.origin}/api/saas/payments/alipay/notify`,
          returnUrl: `${config.origin}/`,
          bizContent: {
            out_trade_no: order.id,
            product_code: 'FAST_INSTANT_TRADE_PAY',
            total_amount: (Number(order.amount_milli_yuan) / 1000).toFixed(2),
            subject: '明课学校钱包充值',
            timeout_express: '30m',
          },
        });
  return { orderId: order.id, status: order.status, paymentUrl, sandbox: config.sandbox };
}

/** Never accepts the browser return URL as evidence of payment. */
export async function receiveAlipayNotification(
  db: SaasDb,
  data: Record<string, string>,
  config: AlipayConfig,
) {
  if (data.sign_type !== 'RSA2' || !data.sign || !sdk(config).checkNotifySignV2(data))
    throw new SaasInputError('支付通知签名无效');
  if (data.app_id !== config.appId || data.seller_id !== config.sellerId)
    throw new SaasInputError('支付通知收款方不匹配');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(data.total_amount ?? ''))
    throw new SaasInputError('支付金额无效');
  const [yuan, fraction = ''] = data.total_amount.split('.');
  const amount = Number(yuan) * 1000 + Number(fraction.padEnd(2, '0')) * 10;
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<Order>(
      'SELECT * FROM saas_payment_orders WHERE id=$1 FOR UPDATE',
      [data.out_trade_no],
    );
    const order = rows[0];
    if (
      !order ||
      Number(order.amount_milli_yuan) !== amount ||
      order.app_id !== data.app_id ||
      order.seller_id !== data.seller_id ||
      order.sandbox !== config.sandbox
    )
      throw new SaasInputError('支付订单不匹配');
    if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(data.trade_status)) return;
    if (!data.trade_no || data.trade_no.length > 128) throw new SaasInputError('缺少支付宝交易号');
    if (order.status === 'paid') {
      if (order.trade_no !== data.trade_no) throw new SaasConflictError('支付宝交易号不匹配');
      return;
    }
    await tx.query(
      "UPDATE saas_payment_orders SET status='paid',trade_no=$2,paid_at=now() WHERE id=$1",
      [order.id, data.trade_no],
    );
    await tx.query(
      'UPDATE saas_wallets SET balance_milli_yuan=balance_milli_yuan+$2 WHERE org_id=$1',
      [order.org_id, amount],
    );
    await tx.query(
      'INSERT INTO saas_ledger (id,org_id,kind,cost_milli_yuan,retail_milli_yuan) VALUES ($1,$2,$4,0,$3)',
      [order.id, order.org_id, amount, order.sandbox ? 'alipay_sandbox_topup' : 'alipay_topup'],
    );
  });
}

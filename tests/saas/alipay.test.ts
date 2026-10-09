import { generateKeyPairSync, createSign } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ensureSaasSchema, registerOrgAdmin, type SaasDb } from '@/lib/saas/accounts';
import { readWallet } from '@/lib/saas/wallet';
import {
  createAlipayOrder,
  receiveAlipayNotification,
  readAlipayOrder,
  type AlipayConfig,
} from '@/lib/saas/alipay';
const database = new PGlite();
const adapt = (connection: Pick<PGlite, 'query'>): SaasDb => ({
  query: async <T>(sql: string, params?: readonly unknown[]) =>
    connection.query<T>(sql, params ? [...params] : []),
  transaction: (fn) =>
    connection === database ? database.transaction((tx) => fn(adapt(tx))) : fn(adapt(connection)),
});
const db = adapt(database);
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
let configured = true;
const config: AlipayConfig = {
  appId: '2026000000000001',
  sellerId: '2088000000000001',
  privateKey: keys.privateKey,
  alipayPublicKey: keys.publicKey,
  origin: 'https://school.example',
  sandbox: true,
};
let actor: { orgId: string; userId: string };
beforeAll(async () => {
  await ensureSaasSchema(db);
  actor = (
    await registerOrgAdmin(
      db,
      { email: 'alipay@school.test', password: 'test-password', orgName: '支付学校' },
      0,
    )
  ).principal;
});
afterAll(() => database.close());
it('creates a reusable unpaid checkout without crediting the wallet', async () => {
  const input = { ...actor, requestId: 'checkout-001', amountMilliYuan: 10_000 };
  const order = await createAlipayOrder(db, input, config);
  const repeated = await createAlipayOrder(db, input, config);
  expect(repeated.orderId).toBe(order.orderId);
  const url = new URL(order.paymentUrl!);
  expect(url.hostname).toBe('openapi-sandbox.dl.alipaydev.com');
  expect(url.searchParams.get('method')).toBe('alipay.trade.page.pay');
  expect(JSON.parse(url.searchParams.get('biz_content')!)).toMatchObject({
    total_amount: '10.00',
    out_trade_no: order.orderId,
  });
  expect((await readAlipayOrder(db, actor, order.orderId)).status).toBe('pending');
  expect((await readWallet(db, actor.orgId, actor.userId)).balanceMilliYuan).toBe(0);
  await expect(
    createAlipayOrder(db, { ...input, amountMilliYuan: 50_000 }, config),
  ).rejects.toThrow();
});
function notification(orderId: string, overrides: Record<string, string> = {}) {
  const data: Record<string, string> = {
    app_id: config.appId,
    seller_id: config.sellerId,
    out_trade_no: orderId,
    trade_no: `ali-${orderId}`,
    total_amount: '50.00',
    trade_status: 'TRADE_SUCCESS',
    sign_type: 'RSA2',
    ...overrides,
  };
  const content = Object.keys(data)
    .filter((k) => k !== 'sign_type')
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('&');
  data.sign = createSign('RSA-SHA256').update(content).sign(keys.privateKey, 'base64');
  return data;
}
it('credits exactly once only after an authentic matching successful payment', async () => {
  const order = await createAlipayOrder(
    db,
    { ...actor, requestId: 'checkout-002', amountMilliYuan: 50_000 },
    config,
  );
  for (const invalid of [
    { ...notification(order.orderId), total_amount: '100.00' },
    notification(order.orderId, { app_id: 'wrong-app' }),
    notification(order.orderId, { seller_id: 'wrong-seller' }),
    notification(order.orderId, { total_amount: '49.99' }),
  ])
    await expect(receiveAlipayNotification(db, invalid, config)).rejects.toThrow();
  await receiveAlipayNotification(
    db,
    notification(order.orderId, { trade_status: 'WAIT_BUYER_PAY' }),
    config,
  );
  expect((await readWallet(db, actor.orgId, actor.userId)).balanceMilliYuan).toBe(0);
  await Promise.all(
    [1, 2, 3].map(() => receiveAlipayNotification(db, notification(order.orderId), config)),
  );
  expect((await readAlipayOrder(db, actor, order.orderId)).status).toBe('paid');
  const wallet = await readWallet(db, actor.orgId, actor.userId);
  expect(wallet.balanceMilliYuan).toBe(50_000);
  expect(wallet.entries.filter((e) => e.kind === 'alipay_sandbox_topup')).toHaveLength(1);
  await receiveAlipayNotification(
    db,
    notification(order.orderId, { trade_status: 'TRADE_FINISHED' }),
    config,
  );
  expect((await readWallet(db, actor.orgId, actor.userId)).balanceMilliYuan).toBe(50_000);
});

vi.mock('@/lib/saas/db', () => ({ openSaasDb: async () => db }));
vi.mock('@/lib/saas/alipay-config', () => ({ alipayConfig: () => (configured ? config : null) }));
vi.mock('@/lib/saas/principal', () => ({ saasPrincipalFromHeaders: async () => actor }));
it('accepts form encoded signed callbacks and exposes order status through the HTTP API', async () => {
  const { POST, GET } = await import('@/app/api/saas/payments/alipay/route');
  const notify = await import('@/app/api/saas/payments/alipay/notify/route');
  const created = await POST(
    new Request('https://school.example/api/saas/payments/alipay', {
      method: 'POST',
      body: JSON.stringify({ requestId: 'checkout-route', amountMilliYuan: 50_000 }),
    }),
  );
  expect(created.status).toBe(201);
  const { orderId } = await created.json();
  const send = (data: Record<string, string>) =>
    notify.POST(
      new Request('https://school.example/api/saas/payments/alipay/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(data),
      }),
    );
  const forged = await send({ ...notification(orderId), sign: 'bad' });
  expect(forged.status).toBe(400);
  expect(await forged.text()).toBe('failure');
  expect(await (await send(notification(orderId))).text()).toBe('success');
  const status = await GET(
    new Request(`https://school.example/api/saas/payments/alipay?orderId=${orderId}`),
  );
  expect(await status.json()).toMatchObject({ status: 'paid' });
});
it('restores recent pending payments in the school wallet and rejects outsiders', async () => {
  const wallet = await readWallet(db, actor.orgId, actor.userId);
  expect(wallet.alipayEnabled).toBe(true);
  expect(wallet.alipaySandbox).toBe(true);
  expect(wallet.paymentOrders).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        requestId: 'checkout-001',
        status: 'pending',
        amountMilliYuan: 10_000,
      }),
    ]),
  );
  await expect(
    createAlipayOrder(
      db,
      { ...actor, userId: 'outsider', requestId: 'not-authorized', amountMilliYuan: 10_000 },
      config,
    ),
  ).rejects.toThrow();
  const order = wallet.paymentOrders[0];
  await expect(
    readAlipayOrder(db, { ...actor, orgId: 'other-school' }, order.orderId),
  ).rejects.toThrow();
});

it('disables the public checkout when merchant details are missing', async () => {
  const { POST } = await import('@/app/api/saas/payments/alipay/route');
  configured = false;
  try {
    const response = await POST(
      new Request('https://school.example/api/saas/payments/alipay', {
        method: 'POST',
        body: JSON.stringify({ requestId: 'unconfigured-order', amountMilliYuan: 10_000 }),
      }),
    );
    expect(response.status).toBe(503);
  } finally {
    configured = true;
  }
});
it('rejects reused provider transaction IDs without partially crediting another order', async () => {
  const first = await createAlipayOrder(
    db,
    { ...actor, requestId: 'transaction-first', amountMilliYuan: 50_000 },
    config,
  );
  const second = await createAlipayOrder(
    db,
    { ...actor, requestId: 'transaction-second', amountMilliYuan: 50_000 },
    config,
  );
  await receiveAlipayNotification(
    db,
    notification(first.orderId, {
      trade_no: 'one-provider-transaction',
      passback_params: '明课+%2F',
    }),
    config,
  );
  const before = (await readWallet(db, actor.orgId, actor.userId)).balanceMilliYuan;
  await expect(
    receiveAlipayNotification(
      db,
      notification(second.orderId, { trade_no: 'one-provider-transaction' }),
      config,
    ),
  ).rejects.toThrow();
  expect((await readWallet(db, actor.orgId, actor.userId)).balanceMilliYuan).toBe(before);
  expect((await readAlipayOrder(db, actor, second.orderId)).status).toBe('pending');
});

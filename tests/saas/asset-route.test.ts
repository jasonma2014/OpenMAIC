import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgAssetStore, ensureAssetSchema } from '@openmaic/storage/asset/pg';
import { PgAssetByteStore } from '@openmaic/storage/asset/pg-bytes';
import { handlePersistenceRequest } from '@/app/api/persistence/[...path]/route';

const state = vi.hoisted(() => ({ orgId: 'school-a', provider: {} }));
vi.mock('@/lib/saas/principal', () => ({
  saasPrincipalFromHeaders: async () => ({
    userId: 'teacher-a',
    orgId: state.orgId,
    role: 'teacher',
  }),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => state.provider,
}));
const database = new PGlite();
let assets: PgAssetStore;
beforeAll(async () => {
  vi.stubEnv('OPENMAIC_SAAS_ENABLED', 'true');
  vi.stubEnv('DATABASE_URL', 'postgres://test');
  await ensureAssetSchema(database);
  assets = new PgAssetStore(database, {
    byteStore: new PgAssetByteStore(database),
    withTransaction: (fn) => database.transaction(fn),
  });
  state.provider = { pool: database, assetStore: assets, runtimeStore: {} };
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await database.close();
});

it('serves generated assets to their school and refuses another school', async () => {
  const id = await assets.put(
    { key: 'school-a' },
    new Blob(['narration'], { type: 'audio/mpeg' }),
    { contentType: 'audio/mpeg' },
  );
  const request = () =>
    handlePersistenceRequest(new Request(`http://localhost/api/persistence/assets/${id}/content`));
  expect((await request()).status).toBe(200);
  expect(await (await request()).text()).toBe('narration');
  state.orgId = 'school-b';
  expect((await request()).status).toBe(404);
});

it('allocates uploaded images to the signed-in school too', async () => {
  state.orgId = 'school-a';
  const form = new FormData();
  form.append('meta', new Blob(['{}'], { type: 'application/json' }), 'meta');
  form.append('bytes', new Blob(['image'], { type: 'image/png' }), 'bytes');
  const response = await handlePersistenceRequest(
    new Request('http://localhost/api/persistence/assets', { method: 'POST', body: form }),
  );
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(await assets.resolve({ key: 'school-a' }, body.id)).not.toBeNull();
  expect(await assets.resolve({ key: 'school-b' }, body.id)).toBeNull();
});

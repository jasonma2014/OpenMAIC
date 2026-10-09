/**
 * Unit-test environment bootstrap.
 *
 * The suite runs hermetic by default: `.env.local` is NOT loaded.
 *
 * It used to be loaded unconditionally ("so API keys are available"), which made
 * every test see whatever the developer happened to have configured locally.
 * That cannot make a test pass — CI has no `.env.local` at all, so any test that
 * needed it would already be red there — it can only invent failures that exist
 * on one machine and nowhere else.
 *
 * To opt back in — a smoke test that needs a real endpoint, or reproducing
 * something against live credentials — set TEST_LOAD_LOCAL_ENV=1:
 *
 *   TEST_LOAD_LOCAL_ENV=1 npx vitest run <suite>
 *
 * Variables exported in the shell are untouched either way — this only governs
 * whether the file is read.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Node exposes `localStorage` as a getter that returns nothing unless the
 * process was started with `--localstorage-file`. In a jsdom test that getter
 * is `window.localStorage`, so `clear` / `setItem` throw. Install a memory
 * store only when the page is present and the built-in store cannot be used.
 */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key) {
      return data.has(key) ? (data.get(key) ?? null) : null;
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

function storageWorks(storage: unknown): storage is Storage {
  return (
    typeof storage === 'object' &&
    storage !== null &&
    typeof (storage as Storage).clear === 'function' &&
    typeof (storage as Storage).getItem === 'function' &&
    typeof (storage as Storage).setItem === 'function'
  );
}

if (typeof window !== 'undefined' && !storageWorks(window.localStorage)) {
  const storage = memoryStorage();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: storage,
  });
}

if (process.env.TEST_LOAD_LOCAL_ENV === '1') {
  const envPath = resolve(__dirname, '..', '.env.local');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local not found, skip
  }
}

// Legacy package/route regression suites still exercise their historical
// anonymous adapters. This test-only override keeps those fixtures explicit;
// production ignores OPENMAIC_SAAS_ENABLED and always requires school login.
// School suites set the flag true; school-only.test.ts checks the REAL export.
import { vi } from 'vitest';
vi.mock('@/lib/config/feature-flags', async (original) => ({
  ...(await original<typeof import('@/lib/config/feature-flags')>()),
  isSaasEnabled: () => ['true', '1'].includes(process.env.OPENMAIC_SAAS_ENABLED ?? ''),
}));

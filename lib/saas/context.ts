import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ orgId: string }>();

/** Bind the rest of this request's async work to an organization wallet. */
export function enterSaasOrg(orgId: string): void {
  storage.enterWith({ orgId });
}

/**
 * Keep the organization on work that Next schedules after the response,
 * such as `after()` classroom jobs and chat streams.
 */
export function runWithSaasOrg<T>(orgId: string | undefined, fn: () => T): T {
  if (!orgId) return fn();
  return storage.run({ orgId }, fn);
}

export function currentSaasOrgId(): string | undefined {
  return storage.getStore()?.orgId;
}

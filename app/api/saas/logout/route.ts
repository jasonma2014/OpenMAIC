import { logoutCurrentSession } from '@/lib/saas/http';

export const runtime = 'nodejs';

export async function POST() {
  return logoutCurrentSession();
}

import { currentSession } from '@/lib/saas/http';

export const runtime = 'nodejs';

export async function GET() {
  return currentSession();
}

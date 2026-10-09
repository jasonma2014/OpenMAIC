import { currentSession, schoolActionFromBody } from '@/lib/saas/http';

export const runtime = 'nodejs';

export async function GET() {
  return currentSession();
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return schoolActionFromBody(body);
}

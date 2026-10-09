import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SchoolDesk, type SchoolView } from '@/components/saas/school-desk';
import { SaasAccountMenu } from '@/components/saas/account-menu';
const sections = ['classes', 'members', 'wallet', 'settings'] as const;
export default async function SchoolPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.some((value) => value === section)) notFound();
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6 dark:bg-slate-950 sm:px-8">
      <header className="mx-auto mb-8 flex max-w-5xl flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-xl font-semibold tracking-tight">
          明课<span className="ml-3 text-sm font-normal text-muted-foreground">学校工作台</span>
        </Link>
        <SaasAccountMenu />
      </header>
      <div className="mx-auto max-w-5xl">
        <SchoolDesk view={section as SchoolView} />
      </div>
    </main>
  );
}

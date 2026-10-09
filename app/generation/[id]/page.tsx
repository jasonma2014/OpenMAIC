import { SchoolGenerationProgress } from '@/components/saas/school-generation-progress';

export default async function GenerationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SchoolGenerationProgress stageId={id} />;
}

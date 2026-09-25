import type { SettingsSection } from '@/lib/types/settings';

/** Customers never see provider keys. Language and skills stay available. */
const CUSTOMER_SECTIONS = new Set<SettingsSection>(['general', 'skills']);

export function visibleSettingsSection(
  section: SettingsSection,
  platformManaged: boolean,
): SettingsSection {
  if (!platformManaged || CUSTOMER_SECTIONS.has(section)) return section;
  return 'general';
}

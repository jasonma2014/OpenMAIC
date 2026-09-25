'use client';

import { createContext, useContext, type ReactNode } from 'react';

const SaasModeContext = createContext(false);

export function SaasModeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <SaasModeContext.Provider value={enabled}>{children}</SaasModeContext.Provider>;
}

export function useSaasMode(): boolean {
  return useContext(SaasModeContext);
}

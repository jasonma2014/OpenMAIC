import { isSaasEnabled } from '@/lib/config/feature-flags';
import {
  enabledServerTTSProviderIds,
  getServerPDFProviders,
  resolveServerASRProviderId,
  resolveServerImageProviderId,
  resolveServerVideoProviderId,
} from '@/lib/server/provider-config';

/** SaaS uses the operator's image provider. A customer selection is ignored. */
export function imageProviderForRequest(
  clientProviderId: string | null | undefined,
): string | undefined {
  const serverId = resolveServerImageProviderId();
  if (isSaasEnabled()) return serverId;
  const clientId = clientProviderId?.trim();
  return clientId || serverId;
}

/** SaaS uses the operator's video provider. Video stays off when none is configured. */
export function videoProviderForRequest(
  clientProviderId: string | null | undefined,
): string | undefined {
  const serverId = resolveServerVideoProviderId();
  if (isSaasEnabled()) return serverId;
  const clientId = clientProviderId?.trim();
  return clientId || serverId;
}

/** SaaS narration uses the operator's TTS provider. */
export function ttsProviderForRequest(clientProviderId: string | undefined): string | undefined {
  if (!isSaasEnabled()) return clientProviderId;
  return enabledServerTTSProviderIds()[0];
}

/** SaaS speech-to-text uses the operator's ASR backend when one is configured. */
export function asrProviderForRequest(
  clientProviderId: string | null | undefined,
): string | undefined {
  const serverId = resolveServerASRProviderId();
  if (isSaasEnabled()) return serverId;
  const clientId = clientProviderId?.trim();
  return clientId || serverId;
}

/** Drop customer extractor credentials. SaaS parsing uses the platform PDF backend. */
export function documentExtractConfigForRequest<
  T extends {
    providerId?: string;
    apiKey?: string;
    baseUrl?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
  },
>(config: T): T {
  if (!isSaasEnabled()) return config;
  return {
    ...config,
    providerId: pdfProviderForRequest(config.providerId),
    apiKey: undefined,
    baseUrl: undefined,
    accessKeyId: undefined,
    accessKeySecret: undefined,
  };
}

/** SaaS document parsing uses the operator PDF backend, otherwise local unpdf. */
export function pdfProviderForRequest(clientProviderId: string | null | undefined): string {
  if (isSaasEnabled()) {
    const serverIds = Object.keys(getServerPDFProviders());
    if (serverIds.length > 0) return serverIds[0];
    return 'unpdf';
  }
  const clientId = clientProviderId?.trim();
  return clientId || 'unpdf';
}

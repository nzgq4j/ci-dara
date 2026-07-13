// AI providers — ported from the DARA WordPress plugin Providers/*.
// Each returns the completion text plus token usage.
import { decryptSecret } from '@/utils/dara/crypto';

export interface AIResult {
  text: string;
  tokenIn: number;
  tokenOut: number;
}

export interface CompanyAI {
  aiKeyMode: string; // 'platform' | 'byok'
  activeProvider: string; // 'anthropic' | 'openai' | 'google'
  activeModel: string;
  anthropicKeyEnc: string | null;
  openaiKeyEnc: string | null;
  googleKeyEnc: string | null;
}

export interface ResolvedAI {
  provider: string;
  model: string;
  apiKey: string;
}

// Platform-supplied keys + central provider/model (from dara_platform_settings,
// resolved by utils/dara/platform-ai.getPlatformAI). Passed in to keep this module
// free of DB access.
export interface PlatformAIConfig {
  activeProvider: string;
  activeModel: string;
  keys: { anthropic: string; openai: string; google: string };
}

/**
 * Resolve the provider, model, and API key for an evaluation.
 *
 * In 'platform' mode the provider, model, and key all come from the central platform
 * configuration (set in the Application Admin console). In 'byok' mode they come from
 * the company's own provider/model selection and stored key. If `platform` is omitted
 * in platform mode, falls back to the company's provider/model + PLATFORM_*_KEY env.
 */
export function resolveCompanyAI(
  company: CompanyAI,
  platform?: PlatformAIConfig
): ResolvedAI {
  if (company.aiKeyMode === 'platform') {
    if (platform) {
      const provider = platform.activeProvider;
      const apiKey = (platform.keys as Record<string, string>)[provider] ?? '';
      return { provider, model: platform.activeModel, apiKey };
    }
    // Legacy fallback (no platform settings provided).
    const provider = company.activeProvider;
    const apiKey =
      provider === 'anthropic'
        ? process.env.PLATFORM_ANTHROPIC_KEY ?? ''
        : provider === 'openai'
          ? process.env.PLATFORM_OPENAI_KEY ?? ''
          : process.env.PLATFORM_GOOGLE_KEY ?? '';
    return { provider, model: company.activeModel, apiKey };
  }

  const provider = company.activeProvider;
  const enc =
    provider === 'anthropic'
      ? company.anthropicKeyEnc
      : provider === 'openai'
        ? company.openaiKeyEnc
        : company.googleKeyEnc;
  return { provider, model: company.activeModel, apiKey: decryptSecret(enc) };
}

// Per-provider output-token ceilings, so a caller's requested max_tokens never exceeds
// what the API accepts (e.g. Google rejects > 8192). Keeps batched runs portable across
// providers without the caller having to know each limit.
function providerMaxOutput(provider: string): number {
  if (provider === 'google') return 8192;
  if (provider === 'openai') return 16384;
  return 64000; // anthropic — effectively uncapped for our requests
}

// Hard ceiling on a single LLM HTTP call. Without it a hung provider connection blocks the
// worker until the 300s function kill, orphaning the job as `running` (which pins the workspace
// poll on). Set just under the 300s function budget: high enough that legitimate long
// generations (a full-RFP requirements shred, a many-finding review) finish, low enough that a
// true hang still aborts with ~60s left for the catch to fail/requeue the job cleanly.
const AI_TIMEOUT_MS = 240_000;

async function aiFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new Error(`AI request timed out after ${Math.round(AI_TIMEOUT_MS / 1000)}s.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Dispatch a completion to the configured provider. */
export async function complete(
  provider: string,
  system: string,
  user: string,
  model: string,
  apiKey: string,
  maxTokens = 4096,
  // Optional sampling temperature. Omit to keep each provider's prior default (Anthropic/OpenAI
  // provider default, Google 0.3). Deterministic paths (the extraction classify pass) pass 0.
  temperature?: number
): Promise<AIResult> {
  if (!apiKey) {
    throw new Error(`No API key configured for provider "${provider}".`);
  }
  const capped = Math.max(256, Math.min(maxTokens, providerMaxOutput(provider)));
  if (provider === 'openai') return openaiComplete(system, user, model, apiKey, capped, temperature);
  if (provider === 'google') return googleComplete(system, user, model, apiKey, capped, temperature);
  return anthropicComplete(system, user, model, apiKey, capped, temperature);
}

async function anthropicComplete(
  system: string,
  user: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature?: number
): Promise<AIResult> {
  const res = await aiFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(temperature === undefined ? {} : { temperature }),
      system,
      messages: [{ role: 'user', content: user }]
    })
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Anthropic HTTP ${res.status}`);
  }
  return {
    text: data?.content?.[0]?.text ?? '',
    tokenIn: Number(data?.usage?.input_tokens ?? 0),
    tokenOut: Number(data?.usage?.output_tokens ?? 0)
  };
}

async function openaiComplete(
  system: string,
  user: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature?: number
): Promise<AIResult> {
  const res = await aiFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(temperature === undefined ? {} : { temperature }),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `OpenAI HTTP ${res.status}`);
  }
  return {
    text: data?.choices?.[0]?.message?.content ?? '',
    tokenIn: Number(data?.usage?.prompt_tokens ?? 0),
    tokenOut: Number(data?.usage?.completion_tokens ?? 0)
  };
}

async function googleComplete(
  system: string,
  user: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature?: number
): Promise<AIResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await aiFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: temperature ?? 0.3, maxOutputTokens: maxTokens }
    })
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Google HTTP ${res.status}`);
  }
  return {
    text: data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    tokenIn: Number(data?.usageMetadata?.promptTokenCount ?? 0),
    tokenOut: Number(data?.usageMetadata?.candidatesTokenCount ?? 0)
  };
}

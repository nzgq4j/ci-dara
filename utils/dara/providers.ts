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

/**
 * Resolve the provider, model, and API key for a company.
 * In 'platform' mode the key comes from a PLATFORM_*_KEY env var; in 'byok'
 * mode it comes from the company's stored key.
 */
export function resolveCompanyAI(company: CompanyAI): ResolvedAI {
  const provider = company.activeProvider;
  let apiKey = '';

  if (company.aiKeyMode === 'platform') {
    apiKey =
      provider === 'anthropic'
        ? process.env.PLATFORM_ANTHROPIC_KEY ?? ''
        : provider === 'openai'
          ? process.env.PLATFORM_OPENAI_KEY ?? ''
          : process.env.PLATFORM_GOOGLE_KEY ?? '';
  } else {
    const enc =
      provider === 'anthropic'
        ? company.anthropicKeyEnc
        : provider === 'openai'
          ? company.openaiKeyEnc
          : company.googleKeyEnc;
    apiKey = decryptSecret(enc);
  }

  return { provider, model: company.activeModel, apiKey };
}

/** Dispatch a completion to the configured provider. */
export async function complete(
  provider: string,
  system: string,
  user: string,
  model: string,
  apiKey: string,
  maxTokens = 4096
): Promise<AIResult> {
  if (!apiKey) {
    throw new Error(`No API key configured for provider "${provider}".`);
  }
  if (provider === 'openai') return openaiComplete(system, user, model, apiKey, maxTokens);
  if (provider === 'google') return googleComplete(system, user, model, apiKey, maxTokens);
  return anthropicComplete(system, user, model, apiKey, maxTokens);
}

async function anthropicComplete(
  system: string,
  user: string,
  model: string,
  apiKey: string,
  maxTokens: number
): Promise<AIResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
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
  maxTokens: number
): Promise<AIResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
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
  maxTokens: number
): Promise<AIResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens }
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

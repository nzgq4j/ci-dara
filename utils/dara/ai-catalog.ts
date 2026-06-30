// Client-safe AI provider + model constants. Kept free of any server-only imports
// (no Prisma/crypto) so client components can import it directly. The server-side
// settings logic in platform-ai.ts re-exports these.

export const AI_PROVIDERS = ['anthropic', 'openai', 'google'] as const;
export type AIProviderName = (typeof AI_PROVIDERS)[number];

// Models offered per provider in the admin model picker. Add entries as needed.
export const MODEL_CATALOG: Record<AIProviderName, { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-4.1', label: 'GPT-4.1' }
  ],
  google: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
  ]
};

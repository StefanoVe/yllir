import type { TranslationKey } from '../i18n';

/** Which assistant answers. Sent with each message as `model` (the server maps it). */
export type ChatModel = 'sonnet' | 'opus' | 'haiku';
/** How much the assistant thinks before it answers. Sent as `effort`. */
export type ChatEffort = 'low' | 'medium' | 'high' | 'max';

export interface ChatChoice {
  model: ChatModel;
  effort: ChatEffort;
}

export const CHAT_MODELS: readonly ChatModel[] = ['sonnet', 'opus', 'haiku'];
export const CHAT_EFFORTS: readonly ChatEffort[] = ['low', 'medium', 'high', 'max'];

export const DEFAULT_CHAT_CHOICE: ChatChoice = { model: 'sonnet', effort: 'medium' };

export const MODEL_TEXT: Record<ChatModel, { label: TranslationKey; description: TranslationKey }> = {
  sonnet: { label: 'chat.model.sonnet', description: 'chat.model.sonnet.desc' },
  opus: { label: 'chat.model.opus', description: 'chat.model.opus.desc' },
  haiku: { label: 'chat.model.haiku', description: 'chat.model.haiku.desc' },
};

export const EFFORT_TEXT: Record<ChatEffort, { label: TranslationKey; description: TranslationKey }> = {
  low: { label: 'chat.effort.low', description: 'chat.effort.low.desc' },
  medium: { label: 'chat.effort.medium', description: 'chat.effort.medium.desc' },
  high: { label: 'chat.effort.high', description: 'chat.effort.high.desc' },
  max: { label: 'chat.effort.max', description: 'chat.effort.max.desc' },
};

const STORAGE_KEY = 'yllir:chat-choice';

export function isChatModel(value: unknown): value is ChatModel {
  return typeof value === 'string' && (CHAT_MODELS as readonly string[]).includes(value);
}

export function isChatEffort(value: unknown): value is ChatEffort {
  return typeof value === 'string' && (CHAT_EFFORTS as readonly string[]).includes(value);
}

/** The saved choice, or the default when nothing valid is saved or storage is blocked. */
export function loadChatChoice(): ChatChoice {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHAT_CHOICE };
    const parsed = JSON.parse(raw) as Partial<ChatChoice> | null;
    return {
      model: isChatModel(parsed?.model) ? parsed.model : DEFAULT_CHAT_CHOICE.model,
      effort: isChatEffort(parsed?.effort) ? parsed.effort : DEFAULT_CHAT_CHOICE.effort,
    };
  } catch {
    return { ...DEFAULT_CHAT_CHOICE };
  }
}

/** Saves the choice for the next visit. When storage is blocked, the choice lasts for this visit only. */
export function saveChatChoice(choice: ChatChoice): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Storage is unavailable: nothing to do, the in-memory choice still applies.
  }
}

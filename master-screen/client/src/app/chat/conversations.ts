import type { Turn } from '@shared/types';

/** Preference key of the conversation shown last (stored per campaign by PrefsService). */
export const CONVERSATION_PREF_KEY = 'chat.conversation';

/** The name shown for a conversation: its title, or the default name when the title is still empty. */
export function displayTitle(title: string | null | undefined, defaultName: string): string {
  const trimmed = (title ?? '').trim();
  return trimmed.length > 0 ? trimmed : defaultName;
}

/**
 * The conversation to show on load: the saved one when it is still in the list, else the
 * server's current one.
 */
export function pickSelectedId(
  conversations: readonly { readonly id: string }[],
  savedId: string | null,
  currentId: string,
): string {
  if (savedId !== null && conversations.some((conversation) => conversation.id === savedId)) return savedId;
  return currentId;
}

/**
 * The campaign's turn after a turn event. The server runs one turn at a time, so a queued turn
 * never replaces the running one: the running turn stays until its own event ends it.
 */
export function nextCampaignTurn(current: Turn | null, event: Turn): Turn {
  if (event.state === 'queued' && current?.state === 'running' && current.id !== event.id) return current;
  return event;
}

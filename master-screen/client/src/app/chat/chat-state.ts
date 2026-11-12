import type { ChatMessage, ChatResponse, Turn, TurnStep } from '@shared/types';
import { mergeSteps } from './chat-steps';

/** A message as shown. An agent reply created from a delta stays `pending` until its final message arrives. */
export interface ViewMessage extends ChatMessage {
  pending?: true;
}

export interface ChatState {
  readonly messages: readonly ViewMessage[];
  readonly turn: Turn | null;
}

export const EMPTY_CHAT_STATE: ChatState = { messages: [], turn: null };

export interface DeltaEvent {
  messageId: string;
  text: string;
}

/**
 * Adds a confirmed message. A message whose id is already shown replaces that copy:
 * the server copy is authoritative, so duplicates from an event and a refetch collapse.
 */
export function addMessage(state: ChatState, message: ChatMessage): ChatState {
  const index = state.messages.findIndex((m) => m.id === message.id);
  const messages =
    index === -1
      ? [...state.messages, { ...message }]
      : state.messages.map((m, i) => (i === index ? { ...message } : m));
  return { ...state, messages };
}

/**
 * Appends streamed agent text to the agent message with that id. When no such message
 * is shown yet, a pending agent bubble is created. Text for a master message is ignored.
 */
export function applyDelta(state: ChatState, delta: DeltaEvent, at: string): ChatState {
  const index = state.messages.findIndex((m) => m.id === delta.messageId);
  if (index === -1) {
    const pending: ViewMessage = { id: delta.messageId, role: 'agent', text: delta.text, at, pending: true };
    return { ...state, messages: [...state.messages, pending] };
  }
  const current = state.messages[index];
  if (current.role !== 'agent') return state;
  const messages = state.messages.map((m, i) => (i === index ? { ...m, text: m.text + delta.text } : m));
  return { ...state, messages };
}

/**
 * Stores the turn from an event. Steps already shown for the same turn id are kept:
 * the merge is by step id, and the newer state of a step wins.
 */
export function setTurn(state: ChatState, turn: Turn): ChatState {
  return { ...state, turn: withSteps(turn, previousSteps(state.turn, turn)) };
}

/** The steps of `turn`, merged with those shown for the same turn. */
function previousSteps(shown: Turn | null, turn: Turn): TurnStep[] {
  const sameTurn = shown !== null && shown.id === turn.id;
  return mergeSteps(sameTurn ? shown.steps : undefined, turn.steps);
}

function withSteps(turn: Turn, steps: TurnStep[]): Turn {
  const copy: Turn = { ...turn };
  if (steps.length > 0) copy.steps = steps;
  else delete copy.steps;
  return copy;
}

export function isActiveTurn(turn: Turn | null): turn is Turn {
  return turn !== null && (turn.state === 'queued' || turn.state === 'running');
}

export function isFailedTurn(turn: Turn | null): turn is Turn {
  return turn !== null && turn.state === 'error';
}

/**
 * Replaces the shown history with what the server returned, keeping any message this
 * screen already has that the response does not list yet (an event that raced the refetch).
 */
export function mergeFetched(state: ChatState, fetched: ChatResponse): ChatState {
  const serverIds = new Set(fetched.messages.map((m) => m.id));
  const extra = state.messages.filter((m) => !serverIds.has(m.id));
  const turn = fetched.turn
    ? withSteps(fetched.turn, previousSteps(state.turn, fetched.turn))
    : isActiveTurn(state.turn) ? state.turn : null;
  return {
    messages: [...fetched.messages.map((m) => ({ ...m })), ...extra],
    turn,
  };
}

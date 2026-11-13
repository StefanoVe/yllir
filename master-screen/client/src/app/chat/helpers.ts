import type { Turn, TurnStep } from '@shared/types';
import type { TranslationKey } from '../i18n';

/**
 * The helper assistants that work right now in a turn: the steps of kind `agent` that are still
 * running, in order. Only a running turn has helpers at work: a queued or finished turn gives [].
 * Sub-steps of a helper count only when they are helpers themselves (kind `agent`).
 */
export function runningHelpers(turn: Turn | null): TurnStep[] {
  if (turn?.state !== 'running') return [];
  return (turn.steps ?? []).filter((step) => step.kind === 'agent' && step.state === 'running');
}

/** The plural key of the "N assistants working" text: `.one` for exactly one, `.other` otherwise. */
export function helpersCountKey(count: number): TranslationKey {
  return count === 1 ? 'helpers.working.one' : 'helpers.working.other';
}

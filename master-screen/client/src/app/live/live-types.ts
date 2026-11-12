import type { Board } from '@shared/types';

/** A failed live call: `error` is plain language, `board` is set on a 409 for the board save. */
export interface LiveFailure {
  error: string;
  status: number;
  board?: Board;
}

export function isLiveFailure(value: unknown): value is LiveFailure {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LiveFailure>;
  return typeof candidate.error === 'string' && typeof candidate.status === 'number';
}

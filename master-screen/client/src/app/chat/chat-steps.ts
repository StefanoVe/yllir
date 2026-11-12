import type { StepKind, TurnStep } from '@shared/types';

/** An image step still running after this long gets the hint that images can take a while. */
export const SLOW_IMAGE_MS = 20_000;
/** Child steps are indented up to this depth; deeper ones share the last indent. */
const MAX_DEPTH = 2;

/** Names of the lucide icons used for each kind of step. */
export type StepIconName =
  | 'FileText'
  | 'Search'
  | 'PencilLine'
  | 'Sparkles'
  | 'Image'
  | 'ListChecks'
  | 'Save'
  | 'Users'
  | 'Music'
  | 'ExternalLink'
  | 'Circle';

const STEP_ICONS: Record<StepKind, StepIconName> = {
  read: 'FileText',
  search: 'Search',
  write: 'PencilLine',
  skill: 'Sparkles',
  image: 'Image',
  check: 'ListChecks',
  save: 'Save',
  agent: 'Users',
  music: 'Music',
  open: 'ExternalLink',
  other: 'Circle',
};

export function stepIcon(kind: StepKind): StepIconName {
  return STEP_ICONS[kind] ?? 'Circle';
}

/** Compact duration: "12 s" under a minute, then "1 min 05 s". Negative or invalid input reads as 0 s. */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} s`;
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
}

/** Time a step has taken: up to its end, or up to `nowMs` while it runs. */
export function stepElapsedMs(step: TurnStep, nowMs: number): number {
  const start = Date.parse(step.at);
  const end = step.endedAt ? Date.parse(step.endedAt) : nowMs;
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

export function isSlowImage(step: TurnStep, nowMs: number): boolean {
  return step.kind === 'image' && step.state === 'running' && stepElapsedMs(step, nowMs) > SLOW_IMAGE_MS;
}

export interface StepRow {
  step: TurnStep;
  depth: number;
}

/**
 * Orders steps so that each child follows its parent, indented one level more.
 * A parent that is not in the list makes its child a top-level row; a cycle cannot hang.
 */
export function nestSteps(steps: readonly TurnStep[]): StepRow[] {
  const ids = new Set(steps.map((s) => s.id));
  const children = new Map<string, TurnStep[]>();
  const roots: TurnStep[] = [];
  for (const step of steps) {
    if (step.parentId && step.parentId !== step.id && ids.has(step.parentId)) {
      const list = children.get(step.parentId) ?? [];
      list.push(step);
      children.set(step.parentId, list);
    } else {
      roots.push(step);
    }
  }
  const rows: StepRow[] = [];
  const seen = new Set<string>();
  const visit = (step: TurnStep, depth: number): void => {
    if (seen.has(step.id)) return;
    seen.add(step.id);
    rows.push({ step, depth });
    for (const child of children.get(step.id) ?? []) visit(child, Math.min(depth + 1, MAX_DEPTH));
  };
  for (const root of roots) visit(root, 0);
  for (const step of steps) if (!seen.has(step.id)) visit(step, 0);
  return rows;
}

const STATE_RANK: Record<TurnStep['state'], number> = { running: 0, done: 1, failed: 1 };

/**
 * Merges the steps already shown with a fresh list for the same turn. Matching steps by id,
 * the newer state wins (a step never goes back from done to running). Shown order is kept;
 * steps only in the fresh list are appended.
 */
export function mergeSteps(previous: readonly TurnStep[] = [], incoming: readonly TurnStep[] = []): TurnStep[] {
  const fresh = new Map(incoming.map((s) => [s.id, s] as const));
  const merged: TurnStep[] = [];
  const used = new Set<string>();
  for (const old of previous) {
    if (used.has(old.id)) continue;
    used.add(old.id);
    const next = fresh.get(old.id);
    merged.push(next && STATE_RANK[next.state] >= STATE_RANK[old.state] ? next : old);
  }
  for (const step of incoming) {
    if (used.has(step.id)) continue;
    used.add(step.id);
    merged.push(step);
  }
  return merged;
}

const STEPS_KEY = 'yllir:chat-steps';

/** Whether the details list is open. Collapsed by default; a storage failure keeps the default. */
export function loadStepsExpanded(): boolean {
  try {
    return globalThis.localStorage?.getItem(STEPS_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveStepsExpanded(expanded: boolean): void {
  try {
    globalThis.localStorage?.setItem(STEPS_KEY, expanded ? '1' : '0');
  } catch {
    // Private window or blocked storage: the choice lasts only for this visit.
  }
}

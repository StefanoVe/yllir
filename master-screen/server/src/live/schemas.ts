// Request bodies of the live session routes, validated with zod before any framework
// call. Text is stored as sent: only the emptiness check looks at it, never a trim.
// Owner: live engineer.
import { z } from 'zod';

/** Campaign-relative path: no leading slash, no `..`, no NUL, no backslash, no drive letter. */
export function isCampaignRef(value: string): boolean {
  if (value.length === 0 || value.length > 500) return false;
  if (value.includes('\0') || value.includes('\\')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((part) => part !== '' && part !== '..');
}

export const campaignRef = z.string().refine(isCampaignRef, { message: 'not a campaign-relative path' });

/** Ids chosen by the client or the framework: letters, digits, `_ . : -`. */
export const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
export const idField = z.string().regex(ID_PATTERN, { message: 'bad id' });

const text = (max: number) => z.string().min(1).max(max);
/** Non-empty after trimming, but stored exactly as written. */
const nonBlank = (max: number) => text(max).refine((s) => s.trim() !== '', { message: 'empty text' });
const shortName = nonBlank(80);
const bound = (min: number, max: number) => z.number().min(min).max(max);
const stat = bound(-100000, 100000);
const amount = bound(0, 100000);
const resourceMap = z
  .record(z.string().min(1).max(40), stat)
  .refine((r) => Object.keys(r).length <= 50, { message: 'too many resources' });

export const LOG_KINDS = ['fact', 'decision', 'intention', 'thread'] as const;

export const openBody = z.strictObject({
  title: z.string().max(200).optional(),
  sessionRef: campaignRef.optional(),
});

export const logAddBody = z.strictObject({
  kind: z.enum(LOG_KINDS),
  text: nonBlank(4000),
  scene: campaignRef.optional(),
  subjects: z.array(z.string().min(1).max(100)).max(50).optional(),
});

export const logPatchBody = z
  .strictObject({
    text: nonBlank(4000).optional(),
    kind: z.enum(LOG_KINDS).optional(),
    scene: campaignRef.optional(),
    subjects: z.array(z.string().min(1).max(100)).max(50).optional(),
    resolved: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'nothing to change' });

const combatId = idField;

/** The CombatOp union of shared/src/types.ts, discriminated on `op`. */
export const combatOpBody = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('start') }),
  z.strictObject({
    op: z.literal('add'),
    name: shortName,
    side: z.enum(['pc', 'ally', 'enemy']),
    initiative: stat.nullable().optional(),
    hp: amount.optional(),
    hpMax: amount.optional(),
    ac: bound(0, 1000).optional(),
    sheet: campaignRef.optional(),
    hidden: z.boolean().optional(),
    resources: resourceMap.optional(),
    notes: text(2000).optional(),
  }),
  z.strictObject({ op: z.literal('remove'), id: combatId }),
  z.strictObject({ op: z.literal('initiative'), id: combatId, value: stat }),
  z.strictObject({ op: z.literal('damage'), id: combatId, amount }),
  z.strictObject({ op: z.literal('heal'), id: combatId, amount }),
  z.strictObject({
    op: z.literal('condition-add'),
    id: combatId,
    condition: shortName,
    duration: text(40).optional(),
    rounds: bound(0, 999).optional(),
    note: text(500).optional(),
  }),
  z.strictObject({ op: z.literal('condition-remove'), id: combatId, condition: shortName }),
  z.strictObject({
    op: z.literal('resource'),
    id: combatId,
    resource: text(40),
    delta: stat.optional(),
    value: stat.optional(),
  }),
  z.strictObject({ op: z.literal('note'), id: combatId, text: nonBlank(2000) }),
  z.strictObject({ op: z.literal('reveal'), id: combatId }),
  z.strictObject({ op: z.literal('next') }),
  z.strictObject({ op: z.literal('end') }),
]);

/** Entry ids as the log library makes them (for example "e-0007"). */
export const ENTRY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

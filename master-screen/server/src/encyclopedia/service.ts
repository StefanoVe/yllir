// The encyclopedia use cases behind the routes: status, and the build through the framework CLI.
// Owner: master-screen server.
import { z } from 'zod';
import type {
  EncyclopediaChanges,
  EncyclopediaKind,
  EncyclopediaReport,
  EncyclopediaSettings,
  EncyclopediaStatus,
} from '../../../shared/src/types.js';
import { readCampaignSummary } from '../campaign.js';
import { campaignLanguage } from '../chat/text.js';
import { runFrameworkCli, TIMED_OUT_CODE } from '../cli.js';
import type { Ctx } from '../context.js';
import { runExclusiveJob, JOB_BUSY_TEXT } from '../jobs.js';
import { plainSentence } from '../plain.js';
import { ENCYCLOPEDIA_TEXTS, type EncyclopediaTexts } from './texts.js';
import { resolveSiteRoot } from './site.js';

export const ENCYCLOPEDIA_CLI = 'skills/library/encyclopedia/scripts/encyclopedia.mjs';
export const SITE_PREVIEW_URL = '/enc/';

export function encyclopediaTexts(ctx: Ctx): EncyclopediaTexts {
  return ENCYCLOPEDIA_TEXTS[campaignLanguage(ctx.campaignRoot)];
}

export function busyText(ctx: Ctx): string {
  return JOB_BUSY_TEXT[campaignLanguage(ctx.campaignRoot)];
}

export async function encyclopediaEnabled(ctx: Ctx): Promise<boolean> {
  return (await readCampaignSummary(ctx)).modules.encyclopedia;
}

const KINDS = ['place', 'character', 'creature', 'item', 'faction', 'event'] as const;
const listModes = ['full', 'discovered'] as const;

/** The settings as the framework prints them (read) and as the screen sends them (write). */
const settingsReadSchema = z.object({
  kinds: z.array(z.enum(KINDS)),
  flavourText: z.boolean(),
  list: z.enum(listModes),
});

/** A save needs at least one kind and no duplicates. */
const settingsWriteSchema = settingsReadSchema
  .extend({ kinds: z.array(z.enum(KINDS)).min(1) })
  .refine((value) => new Set(value.kinds).size === value.kinds.length, { path: ['kinds'] });

const changeItemSchema = z.object({ id: z.string(), title: z.string() });
const changesSchema = z.object({
  built: z.boolean(),
  error: z.unknown().optional(),
  added: z.array(changeItemSchema).optional(),
  changed: z.array(changeItemSchema).optional(),
  removed: z.array(changeItemSchema).optional(),
});

/** The settings the framework reports. Throws when the answer is bad. */
export async function readEncyclopediaSettings(ctx: Ctx): Promise<EncyclopediaSettings> {
  const result = await runFrameworkCli(ctx, ENCYCLOPEDIA_CLI, ['settings', ctx.campaignRoot]);
  const parsed = settingsReadSchema.safeParse(result.json);
  if (result.code !== 0 || !parsed.success) throw new Error('encyclopedia settings failed');
  return { kinds: parsed.data.kinds as EncyclopediaKind[], flavourText: parsed.data.flavourText, list: parsed.data.list };
}

/** What changed since the last build. Never throws: null when there is no build or no answer. */
export async function readEncyclopediaChanges(ctx: Ctx): Promise<EncyclopediaChanges | null> {
  try {
    const result = await runFrameworkCli(ctx, ENCYCLOPEDIA_CLI, ['changes', ctx.campaignRoot]);
    const parsed = changesSchema.safeParse(result.json);
    if (result.code !== 0 || !parsed.success) {
      ctx.log('encyclopedia changes failed: the answer could not be read');
      return null;
    }
    if (!parsed.data.built) return null;
    if (parsed.data.error !== undefined) {
      ctx.log('encyclopedia changes failed: the framework reported an error');
      return null;
    }
    const { added, changed, removed } = parsed.data;
    if (!added || !changed || !removed) return null;
    return { added, changed, removed };
  } catch (err) {
    ctx.log(`encyclopedia changes failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const checkSchema = z.looseObject({
  id: z.string(),
  status: z.enum(['pass', 'fail', 'skipped']),
  message: z.unknown(),
});

const reportSchema = z.looseObject({
  ok: z.boolean(),
  checks: z.array(checkSchema),
  warnings: z.array(z.looseObject({ code: z.unknown().optional(), message: z.unknown() })).optional(),
});

/** A framework report with its messages made safe to show. Null when the shape is wrong. */
export function parseReport(raw: unknown, texts: EncyclopediaTexts): EncyclopediaReport | null {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return null;
  const report = parsed.data;
  const settings = settingsReadSchema.safeParse(report.settings);
  const { settings: _rawSettings, ...rest } = report;
  return {
    ...rest,
    checks: report.checks.map((check) => ({
      ...check,
      message: plainSentence(check.message, texts.checkGeneric),
    })),
    warnings: (report.warnings ?? []).map((warning) => ({
      code: typeof warning.code === 'string' ? warning.code : 'warning',
      message: plainSentence(warning.message, texts.checkGeneric),
    })),
    ...(settings.success ? { settings: settings.data as EncyclopediaSettings } : {}),
  } as unknown as EncyclopediaReport;
}

/** The preview link only exists while a build is there. */
async function withPreview(ctx: Ctx, report: EncyclopediaReport): Promise<EncyclopediaReport> {
  const built = (await resolveSiteRoot(ctx.campaignRoot)) !== null;
  return { ...report, previewUrl: built ? SITE_PREVIEW_URL : null };
}

const statusSchema = z.object({
  built: z.boolean(),
  report: z.unknown().nullable().optional(),
});

/** The status of an enabled module (GET /api/encyclopedia). Throws when the framework cannot answer. */
export async function readEncyclopediaStatus(ctx: Ctx): Promise<EncyclopediaStatus> {
  const texts = encyclopediaTexts(ctx);
  const [result, settings, changes] = await Promise.all([
    runFrameworkCli(ctx, ENCYCLOPEDIA_CLI, ['status', ctx.campaignRoot]),
    readEncyclopediaSettings(ctx),
    readEncyclopediaChanges(ctx),
  ]);
  const parsed = statusSchema.safeParse(result.json);
  if (result.code !== 0 || !parsed.success) throw new Error('encyclopedia status failed');
  const report = parsed.data.report ? parseReport(parsed.data.report, texts) : null;
  return {
    enabled: true,
    built: parsed.data.built,
    report: report ? await withPreview(ctx, report) : null,
    publishing: 'not-configured',
    settings,
    changes,
  };
}

/**
 * Saves the Codex settings (PUT /api/encyclopedia/settings) through the framework CLI. Exit 0 with
 * ok gives the new full status; exit 1 (refused by the framework) gives 409; anything else 500.
 */
export async function saveEncyclopediaSettings(ctx: Ctx, input: unknown): Promise<BuildAnswer> {
  const texts = encyclopediaTexts(ctx);
  const parsed = settingsWriteSchema.safeParse(input);
  if (!parsed.success) return { status: 400, body: { error: texts.badSettings } };
  if (!(await encyclopediaEnabled(ctx))) return { status: 409, body: { error: texts.notEnabled } };
  const outcome = await runExclusiveJob(ctx, () =>
    runFrameworkCli(ctx, ENCYCLOPEDIA_CLI, ['settings', ctx.campaignRoot, '--set', JSON.stringify(parsed.data)]),
  );
  if (outcome.busy) return { status: 409, body: { error: busyText(ctx) } };
  const { code, json } = outcome.value;
  if (code === 1) return { status: 409, body: { error: texts.settingsRefused } };
  const answer = z.object({ ok: z.literal(true) }).safeParse(json);
  if (code === 0 && answer.success) {
    return { status: 200, body: (await readEncyclopediaStatus(ctx)) as unknown as Record<string, unknown> };
  }
  return { status: 500, body: { error: texts.settingsFailed } };
}

export interface BuildAnswer {
  status: number;
  body: Record<string, unknown>;
}

/** The first failed check as one sentence for the master, or the generic build sentence. */
function firstFailure(report: EncyclopediaReport, texts: EncyclopediaTexts): string | null {
  const failed = report.checks.find((check) => check.status === 'fail');
  return failed ? `${texts.checkFailed}${failed.message}` : null;
}

/**
 * Runs the build (POST /api/encyclopedia/build). Exit 0 gives the report; exit 1 (a check
 * failed) gives 409 with the report and a plain `error`. Busy gives 409 without a run.
 */
export async function buildEncyclopedia(ctx: Ctx): Promise<BuildAnswer> {
  const texts = encyclopediaTexts(ctx);
  if (!(await encyclopediaEnabled(ctx))) return { status: 409, body: { error: texts.notEnabled } };
  const outcome = await runExclusiveJob(ctx, () =>
    runFrameworkCli(ctx, ENCYCLOPEDIA_CLI, ['build', ctx.campaignRoot]),
  );
  if (outcome.busy) return { status: 409, body: { error: busyText(ctx) } };
  const { code, json } = outcome.value;
  if (code === TIMED_OUT_CODE) return { status: 500, body: { error: texts.timedOut } };
  const report = parseReport(json, texts);
  if (code === 0 && report) return { status: 200, body: await withPreview(ctx, report) as unknown as Record<string, unknown> };
  if (code === 1 && report) {
    const error = firstFailure(report, texts) ?? texts.buildFailed;
    return { status: 409, body: { ...(await withPreview(ctx, report)), error } as unknown as Record<string, unknown> };
  }
  if (code === 1) return { status: 409, body: { error: texts.buildFailed } };
  return { status: 500, body: { error: texts.buildFailed } };
}


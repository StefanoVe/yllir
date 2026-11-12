// The encyclopedia use cases behind the routes: status, and the build through the framework CLI.
// Owner: master-screen server.
import { z } from 'zod';
import type { EncyclopediaReport, EncyclopediaStatus } from '../../../shared/src/types.js';
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
  return {
    ...report,
    checks: report.checks.map((check) => ({
      ...check,
      message: plainSentence(check.message, texts.checkGeneric),
    })),
    warnings: (report.warnings ?? []).map((warning) => ({
      code: typeof warning.code === 'string' ? warning.code : 'warning',
      message: plainSentence(warning.message, texts.checkGeneric),
    })),
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
  const result = await runFrameworkCli(ctx, ENCYCLOPEDIA_CLI, ['status', ctx.campaignRoot]);
  const parsed = statusSchema.safeParse(result.json);
  if (result.code !== 0 || !parsed.success) throw new Error('encyclopedia status failed');
  const report = parsed.data.report ? parseReport(parsed.data.report, texts) : null;
  return {
    enabled: true,
    built: parsed.data.built,
    report: report ? await withPreview(ctx, report) : null,
    publishing: 'not-configured',
  };
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


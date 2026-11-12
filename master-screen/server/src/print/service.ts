// The print use cases behind the routes: the card list, state changes and renders (through the
// framework CLI, which writes through the engine), and the sheets PDF. Owner: master-screen server.
import { readCampaignSummary } from '../campaign.js';
import { campaignLanguage } from '../chat/text.js';
import { CLI_TIMEOUT_MS, runFrameworkCli, TIMED_OUT_CODE } from '../cli.js';
import type { Ctx } from '../context.js';
import { JOB_BUSY_TEXT, runExclusiveJob } from '../jobs.js';
import { plainSentence } from '../plain.js';
import type { PrintCard, PrintSheetResult, PrintState, PrintStatus } from '../../../shared/src/types.js';
import { PDF_NAME, listAnswer, sheetAnswer, type ListedCard } from './schemas.js';
import { PRINT_TEXTS, type PrintTexts } from './texts.js';

export const PRINT_CLI = 'skills/library/print/scripts/print.mjs';
const DEFAULT_BASE_URL = 'http://localhost/';

export function printTexts(ctx: Ctx): PrintTexts {
  return PRINT_TEXTS[campaignLanguage(ctx.campaignRoot)];
}

export function busyText(ctx: Ctx): string {
  return JOB_BUSY_TEXT[campaignLanguage(ctx.campaignRoot)];
}

export async function printEnabled(ctx: Ctx): Promise<boolean> {
  return (await readCampaignSummary(ctx)).modules.print;
}

function normaliseCard(card: ListedCard): PrintCard {
  return {
    id: card.id,
    title: card.title,
    path: card.path,
    category: card.category,
    print: (card.print ?? null) as PrintState | null,
    hasImage: card.hasImage,
    personal: card.personal,
  };
}

/**
 * The status as the server shows it. Module off: no framework call at all.
 * Throws when the framework `list` cannot be read.
 */
export async function readPrintStatus(ctx: Ctx): Promise<PrintStatus> {
  const summary = await readCampaignSummary(ctx);
  const encyclopediaEnabled = summary.modules.encyclopedia;
  if (!summary.modules.print) {
    return {
      enabled: false,
      cards: [],
      renderer: 'node',
      format: '5x7',
      cmyk: false,
      baseUrl: DEFAULT_BASE_URL,
      encyclopediaEnabled,
    };
  }
  const result = await runFrameworkCli(ctx, PRINT_CLI, ['list', ctx.campaignRoot]);
  const parsed = listAnswer.safeParse(result.json);
  if (result.code !== 0 || !parsed.success) throw new Error('print list failed');
  const data = parsed.data;
  return {
    enabled: true,
    cards: data.cards.map(normaliseCard),
    renderer: data.renderer === 'photoshop' ? 'photoshop' : 'node',
    format: data.format === 'a4' ? 'a4' : '5x7',
    cmyk: data.cmyk === true,
    baseUrl: typeof data.baseUrl === 'string' && data.baseUrl !== '' ? data.baseUrl : DEFAULT_BASE_URL,
    encyclopediaEnabled,
  };
}

export type CardCommand = { ok: true } | { ok: false; json: unknown };

/** One framework action that changes a card. Failure carries the framework answer for a sentence. */
export async function runCardCommand(ctx: Ctx, args: string[]): Promise<CardCommand> {
  try {
    const result = await runFrameworkCli(ctx, PRINT_CLI, args);
    return result.code === 0 ? { ok: true } : { ok: false, json: result.json };
  } catch {
    return { ok: false, json: null };
  }
}

/**
 * The sentence for a failed framework action: the mapped reason code (`error`), else the
 * framework's `message` or the first `errors[].message` when they are safe, else the fallback.
 */
export function failureSentence(json: unknown, texts: PrintTexts, fallback: string): string {
  const data = (json ?? {}) as { error?: unknown; message?: unknown; errors?: unknown };
  if (typeof data.error === 'string' && Object.prototype.hasOwnProperty.call(texts.reasons, data.error)) {
    return texts.reasons[data.error];
  }
  const first = Array.isArray(data.errors) ? (data.errors[0] as { message?: unknown } | undefined) : undefined;
  return plainSentence(data.message ?? first?.message, fallback);
}

/** The sheets answer as the route sends it. The file name is rebuilt from a validated name. */
export function sheetsAnswer(json: unknown, texts: PrintTexts): PrintSheetResult | null {
  const parsed = sheetAnswer.safeParse(json);
  if (!parsed.success || typeof parsed.data.file !== 'string') return null;
  const name = parsed.data.file.split('/').pop() ?? '';
  if (!PDF_NAME.test(name)) return null;
  return {
    ok: true,
    file: `.campaign/cache/print/${name}`,
    fileUrl: `/api/print/files/${name}`,
    pages: parsed.data.pages ?? 0,
    excluded: (parsed.data.excluded ?? []).map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      reason: plainSentence(item.reason, texts.reasonGeneric),
    })),
    warnings: (parsed.data.warnings ?? []).map((item) => ({
      code: typeof item.code === 'string' ? item.code : 'warning',
      message: plainSentence(item.message, texts.warningGeneric),
    })),
  };
}

export interface JobAnswer {
  status: number;
  body: unknown;
}

/** Runs `sheets` under the job lock. Busy and failure are plain refusals (409). */
export async function generateSheets(ctx: Ctx, args: string[]): Promise<JobAnswer> {
  const texts = printTexts(ctx);
  const outcome = await runExclusiveJob(ctx, () =>
    runFrameworkCli(ctx, PRINT_CLI, ['sheets', ctx.campaignRoot, ...args], { timeoutMs: CLI_TIMEOUT_MS }),
  );
  if (outcome.busy) return { status: 409, body: { error: busyText(ctx) } };
  const { code, json } = outcome.value;
  if (code === TIMED_OUT_CODE) return { status: 409, body: { error: texts.timedOut } };
  const answer = code === 0 ? sheetsAnswer(json, texts) : null;
  if (!answer) return { status: 409, body: { error: failureSentence(json, texts, texts.sheetsFailed) } };
  return { status: 200, body: answer };
}

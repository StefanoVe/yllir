// The atlas status and the redraw. The framework answers what exists and what is pending (the atlas
// CLI `status`), the file on disk answers whether the master site is built, and the redraw runs the
// CLI `render` through the one-job slot. Generation lives in generation.ts. Owner: master-screen server.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { AtlasRenderResult, AtlasStatus } from '../../../shared/src/types.js';
import { campaignLanguage, type Lang } from '../chat/text.js';
import { runFrameworkCli, TIMED_OUT_CODE } from '../cli.js';
import type { Ctx } from '../context.js';
import { JOB_BUSY_TEXT, runExclusiveJob } from '../jobs.js';
import { AtlasGenerationService, type AtlasFrameworkState } from './generation.js';
import { atlasSiteDir, atlasPreviewFile } from './site.js';
import { ATLAS_TEXTS } from './texts.js';

export const ATLAS_CLI = 'skills/library/atlas/scripts/atlas.mjs';
/** How long the framework answer about the atlas is kept while no run is active. */
export const ATLAS_STATUS_CACHE_MS = 10_000;

const statusSchema = z.object({
  exists: z.boolean().optional(),
  pending: z.array(z.unknown()).optional(),
});

/**
 * Reads the atlas state from the framework CLI. Exit 1 means no atlas folder (nothing exists).
 * Throws when the CLI times out or prints something that is not the status.
 */
export async function readFrameworkAtlas(ctx: Ctx): Promise<AtlasFrameworkState> {
  const result = await runFrameworkCli(ctx, ATLAS_CLI, ['status', ctx.campaignRoot]);
  if (result.code === TIMED_OUT_CODE) throw new Error('atlas status timed out');
  if (result.code === 1) return { exists: false, pending: 0 };
  const parsed = statusSchema.safeParse(result.json);
  if (result.code !== 0 || !parsed.success) throw new Error('atlas status could not be read');
  if (parsed.data.exists !== true) return { exists: false, pending: 0 };
  return { exists: true, pending: parsed.data.pending?.length ?? 0 };
}

/** The text of the last assistant message of a conversation, or null. */
function lastAgentText(ctx: Ctx, conversationId: string): string | null {
  const messages = ctx.chat?.store.messages(conversationId) ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'agent') return messages[i].text;
  }
  return null;
}

export interface AtlasRenderAnswer {
  status: number;
  body: AtlasRenderResult;
}

export interface AtlasServiceOptions {
  now?: () => number;
}

export class AtlasService {
  readonly generation: AtlasGenerationService;
  private cache: { at: number; value: AtlasFrameworkState } | null = null;
  private readonly now: () => number;

  constructor(
    private readonly ctx: Ctx,
    opts: AtlasServiceOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.generation = new AtlasGenerationService({
      framework: () => this.framework(true),
      lastAnswer: (conversationId) => lastAgentText(ctx, conversationId),
      chat: () => ctx.chat,
      agent: () => ctx.agentStatus(),
      language: () => campaignLanguage(ctx.campaignRoot),
      onTurn: (listener) => ctx.onTurn(listener),
      notify: () => {
        this.cache = null;
        ctx.bus.publish('conversations', {});
      },
      log: (msg) => ctx.log(msg),
    });
  }

  /** The atlas state. The framework answer is cached for ATLAS_STATUS_CACHE_MS, unless a run is active. Rejects when the framework cannot answer. */
  async status(): Promise<AtlasStatus> {
    const framework = await this.framework(this.generation.running());
    return {
      exists: framework.exists,
      built: fs.existsSync(path.join(atlasSiteDir(this.ctx.campaignRoot), 'index.html')),
      pending: framework.pending,
      generation: this.generation.snapshot(),
      agent: this.ctx.agentStatus(),
    };
  }

  /** Redraws the master site from the existing data. Never involves the assistant. */
  async render(): Promise<AtlasRenderAnswer> {
    const lang: Lang = campaignLanguage(this.ctx.campaignRoot);
    const texts = ATLAS_TEXTS[lang];
    if (this.generation.running()) return { status: 409, body: { ok: false, error: texts.redrawBusy } };
    if (!(await this.framework(true)).exists) return { status: 409, body: { ok: false, error: texts.noAtlas } };
    const outcome = await runExclusiveJob(this.ctx, () =>
      runFrameworkCli(this.ctx, ATLAS_CLI, ['render', this.ctx.campaignRoot]),
    );
    if (outcome.busy) return { status: 409, body: { ok: false, error: JOB_BUSY_TEXT[lang] } };
    if (outcome.value.code === 0) return { status: 200, body: { ok: true } };
    return { status: 200, body: { ok: false, error: texts.redrawFailed } };
  }

  /** The last preview image, or null when there is none. */
  previewPath(): string | null {
    const file = atlasPreviewFile(this.ctx.campaignRoot);
    return fs.existsSync(file) ? file : null;
  }

  private async framework(fresh: boolean): Promise<AtlasFrameworkState> {
    if (!fresh && this.cache !== null && this.now() - this.cache.at < ATLAS_STATUS_CACHE_MS) {
      return this.cache.value;
    }
    const value = await readFrameworkAtlas(this.ctx);
    this.cache = { at: this.now(), value };
    return value;
  }
}

export function createAtlasService(ctx: Ctx, opts: AtlasServiceOptions = {}): AtlasService {
  return new AtlasService(ctx, opts);
}

// Reads the campaign summary (campaign.yaml, through the framework's yaml-lite module)
// and the framework version. Owner: server skeleton.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModuleId, StatusResponse } from '../../shared/src/types.js';
import type { Ctx } from './context.js';
import { loadFrameworkModule } from './engine.js';

export const MODULE_IDS: ModuleId[] = ['music', 'print', 'encyclopedia'];

interface YamlLiteModule {
  parseYamlLite(text: string): { data: unknown; errors: unknown[] };
}

export interface CampaignSummary {
  ok: boolean;
  campaign: StatusResponse['campaign'];
  modules: StatusResponse['modules'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'campaign';
}

function noModules(): StatusResponse['modules'] {
  return { music: false, print: false, encyclopedia: false };
}

/** Never throws: an unreadable or invalid campaign.yaml gives ok false and defaults. */
export async function readCampaignSummary(ctx: Ctx): Promise<CampaignSummary> {
  const folderName = path.basename(ctx.campaignRoot);
  const fallback: CampaignSummary = {
    ok: false,
    campaign: { name: folderName, slug: slugify(folderName), language: 'en' },
    modules: noModules(),
  };
  let raw: string;
  try {
    raw = await fs.readFile(path.join(ctx.campaignRoot, 'campaign.yaml'), 'utf8');
  } catch {
    return fallback;
  }
  try {
    const yaml = await loadFrameworkModule<YamlLiteModule>(ctx, 'yaml-lite');
    const parsed = yaml.parseYamlLite(raw);
    if (parsed.errors.length > 0 || !isRecord(parsed.data)) return fallback;
    const data = parsed.data;
    const campaign = isRecord(data.campaign) ? data.campaign : {};
    const language = isRecord(data.language) ? data.language : {};
    const modulesSection = isRecord(data.modules) ? data.modules : {};
    const name = text(campaign.name) ?? folderName;
    const modules = noModules();
    for (const id of MODULE_IDS) {
      const value = modulesSection[id];
      modules[id] = value === true || value === 'true';
    }
    return {
      ok: true,
      campaign: {
        name,
        slug: text(campaign.slug) ?? slugify(name),
        language: text(language.main) ?? 'en',
      },
      modules,
    };
  } catch {
    return fallback;
  }
}

/** Returns the version from `<framework>/.claude-plugin/plugin.json`, or "unknown". */
export async function readFrameworkVersion(frameworkRoot: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(frameworkRoot, '.claude-plugin', 'plugin.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) && typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

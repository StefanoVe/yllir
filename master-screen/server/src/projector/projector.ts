// The projector: what the second window (/projector) shows to the players. The server keeps
// the last projection in memory and streams it over SSE, so a projector that reconnects gets
// it at once. The server decides what may be projected (resolveSrc): only images the public
// part of a non-master-only document embeds or links, or images the master uploaded to his
// live board. Owner: projector.
import fsp from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import type { Projection } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { imageRefsOf } from '../cockpit-host/refs.js';
import { fileUrl, RASTER_EXTENSIONS } from '../cockpit-host/files.js';
import { partsForView } from '../docs/markdown.js';
import { listCampaignDocuments, loadDocModules, readCampaignConfig, resolveCampaignFile } from '../docs/scan.js';

const RETRY_MS = 3000;
const HEARTBEAT_MS = 15_000;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/** The base the relative sources are read against; any source with another origin is refused. */
const BASE = 'http://x';
const SESSION_SEGMENT = /^[A-Za-z0-9._-]+$/;

function frameOf(projection: Projection): string {
  return `event: projection\ndata: ${JSON.stringify(projection)}\n\n`;
}

class Projector {
  private projection: Projection = { kind: 'blank' };
  private readonly clients = new Set<ServerResponse>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  current(): Projection {
    return this.projection;
  }

  /** Adds an SSE client and sends it the current projection at once. */
  subscribe(res: ServerResponse): void {
    res.writeHead(200, SSE_HEADERS);
    if (!this.send(res, `retry: ${RETRY_MS}\n\n`)) return;
    if (!this.send(res, frameOf(this.projection))) return;
    this.clients.add(res);
    const drop = (): void => this.drop(res);
    res.on('close', drop);
    res.on('error', drop);
    this.ensureHeartbeat();
  }

  /** Stores the projection and sends it to every client. */
  set(projection: Projection): void {
    this.projection = projection;
    const text = frameOf(projection);
    for (const res of [...this.clients]) {
      this.send(res, text);
    }
  }

  /** Ends every SSE stream and clears the heartbeat. */
  close(): void {
    this.stopHeartbeat();
    const open = [...this.clients];
    this.clients.clear();
    for (const res of open) {
      try {
        res.end();
      } catch {
        // already gone
      }
    }
  }

  /** Writes text to one client. A failed write drops that client. */
  private send(res: ServerResponse, text: string): boolean {
    try {
      res.write(text);
      return true;
    } catch {
      this.drop(res);
      return false;
    }
  }

  private drop(res: ServerResponse): void {
    if (this.clients.delete(res) && this.clients.size === 0) this.stopHeartbeat();
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer !== null) return;
    this.heartbeatTimer = setInterval(() => {
      for (const res of [...this.clients]) {
        this.send(res, ': ping\n\n');
      }
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

const projectors = new WeakMap<Ctx, Projector>();

/** The projector of the campaign, created on first use; its streams end at shutdown. */
export function projectorFor(ctx: Ctx): Projector {
  let projector = projectors.get(ctx);
  if (projector === undefined) {
    const created = new Projector();
    projector = created;
    projectors.set(ctx, created);
    ctx.onClose(() => created.close());
  }
  return projector;
}

/** Parses a source into a URL on the base, or null when it has another origin (absolute, data:, //host). */
function parseSource(src: string): URL | null {
  let url: URL;
  try {
    url = new URL(src, BASE);
  } catch {
    return null;
  }
  return url.origin === BASE ? url : null;
}

/** Whether a campaign image is embedded or linked by the public part of a document that is not master-only. */
async function isShownToPlayers(ctx: Ctx, imageRel: string): Promise<boolean> {
  const mods = await loadDocModules(ctx);
  const config = await readCampaignConfig(ctx, mods);
  for (const doc of await listCampaignDocuments(ctx.campaignRoot)) {
    const masterOnly = !config.isPublic(doc.rel);
    if (masterOnly) continue;
    let text: string;
    try {
      text = await fsp.readFile(path.join(ctx.campaignRoot, doc.rel), 'utf8');
    } catch {
      continue;
    }
    const body = mods.frontmatter.parseFrontmatter(text).body;
    const parts = partsForView(body, masterOnly, 'public', mods.publicText.MASTER_MARKER);
    if (parts.some((part) => imageRefsOf(doc.rel, part.source).some((ref) => ref.path === imageRel))) return true;
  }
  return false;
}

async function resolvePublicImage(ctx: Ctx, rawPath: string | null): Promise<string | null> {
  const resolved = await resolveCampaignFile(ctx.campaignRoot, rawPath);
  if (resolved === null) return null;
  if (!RASTER_EXTENSIONS.has(path.posix.extname(resolved.rel).toLowerCase())) return null;
  if (!(await isShownToPlayers(ctx, resolved.rel))) return null;
  return fileUrl(resolved.rel);
}

/** A live-board image: /api/cockpit/sessions/<id>/files/<name>, both segments plain names. */
function resolveSessionImage(pathname: string): string | null {
  const parts = pathname.split('/');
  // ['', 'api', 'cockpit', 'sessions', id, 'files', name]
  if (parts.length !== 7) return null;
  if (parts[1] !== 'api' || parts[2] !== 'cockpit' || parts[3] !== 'sessions' || parts[5] !== 'files') return null;
  const id = decodeSegment(parts[4]);
  const name = decodeSegment(parts[6]);
  if (id === null || name === null) return null;
  for (const segment of [id, name]) {
    if (!SESSION_SEGMENT.test(segment) || segment === '.' || segment === '..') return null;
  }
  if (!RASTER_EXTENSIONS.has(path.posix.extname(name).toLowerCase())) return null;
  return `/api/cockpit/sessions/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`;
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * The security gate of the projector. Returns the normalized URL to project, rebuilt by the
 * server, or null when the source may not be shown to the players.
 */
export async function resolveSrc(ctx: Ctx, src: string): Promise<string | null> {
  const url = parseSource(src);
  if (url === null) return null;
  if (url.pathname === '/api/file') return resolvePublicImage(ctx, url.searchParams.get('path'));
  return resolveSessionImage(url.pathname);
}

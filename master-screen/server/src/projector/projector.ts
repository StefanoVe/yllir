// The projector: what the second window (/projector) shows to the players. The server keeps
// the last projection in memory and streams it over SSE, so a projector that reconnects gets
// it at once. The server decides what may be projected (resolveSrc): any image file of the
// campaign (png, jpg, jpeg, webp, gif, svg, avif, bmp) or any image the master uploaded to his live board.
// The server does not check whether a document shows the image: the master's click is the check.
// It still rebuilds the URL: a same-origin absolute URL is accepted as its relative form, and other
// absolute URLs, data:, protocol-relative sources, '..' and non-image files are refused. A projected fight (kind 'combat') is rebuilt from the server state, never
// from the client, and carries only what the players may read. Owner: projector.
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import type {
  BattleView,
  CombatState,
  Combatant,
  ProjectedCombat,
  ProjectedCombatant,
  ProjectedHealth,
  Projection,
} from '../../../shared/src/types.js';
import type { BattleHost } from '../cockpit-host/battle.js';
import type { Ctx } from '../context.js';
import { fileUrl } from '../cockpit-host/files.js';
import { resolveCampaignFile } from '../docs/scan.js';
import { buildSnapshot, liveRevision } from '../live/snapshot.js';

const RETRY_MS = 3000;
const HEARTBEAT_MS = 15_000;
const LIVE_MS = 1000;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/** The base the relative sources are read against; any source with another origin is refused. */
const BASE = 'http://x';
/** The image files the projector accepts, campaign files and live-board files alike. */
const PROJECTABLE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.bmp']);

function frameOf(projection: Projection): string {
  return `event: projection\ndata: ${JSON.stringify(projection)}\n\n`;
}

/** Health a player can read of an enemy; undefined when its hit points are not known. */
function healthOf(combatant: Combatant): ProjectedHealth | undefined {
  const { hp, hpMax } = combatant;
  if (typeof hp !== 'number' || typeof hpMax !== 'number' || !(hpMax > 0)) return undefined;
  if (combatant.defeated === true || hp <= 0) return 'down';
  if (hp >= hpMax) return 'unhurt';
  if (hp > hpMax / 2) return 'wounded';
  return 'bloodied';
}

/** One row of the order, with only the fields the players may read of that side. */
function projectedOf(combatant: Combatant, current: boolean): ProjectedCombatant {
  const out: ProjectedCombatant = {
    id: combatant.id,
    name: combatant.name,
    side: combatant.side,
    initiative: combatant.initiative,
    current,
  };
  if (combatant.defeated === true) out.defeated = true;
  if (combatant.side === 'enemy') {
    const health = healthOf(combatant);
    if (health !== undefined) out.health = health;
    return out;
  }
  if (typeof combatant.hp === 'number') out.hp = combatant.hp;
  if (typeof combatant.hpMax === 'number') out.hpMax = combatant.hpMax;
  if (typeof combatant.tempHp === 'number' && combatant.tempHp > 0) out.tempHp = combatant.tempHp;
  return out;
}

/**
 * The projected fight from the combat state and the battle view. Pure: nothing is read here.
 * Hidden combatants and unknown ids are left out; enemies never carry numbers, only health.
 * `mapSrc` is the already gated map source (null when the map may not be shown).
 */
export function projectCombat(
  state: CombatState | null,
  battle: BattleView | null,
  mapSrc: string | null,
): ProjectedCombat | null {
  if (state === null || !state.active) return null;
  const byId = new Map(state.combatants.map((combatant) => [combatant.id, combatant] as const));
  const currentId = state.order[state.turn];
  const order: ProjectedCombatant[] = [];
  for (const id of state.order) {
    const combatant = byId.get(id);
    if (combatant === undefined || combatant.hidden === true) continue;
    order.push(projectedOf(combatant, id === currentId));
  }
  const dims = battle?.map ?? null;
  const map: ProjectedCombat['map'] = mapSrc ? { src: mapSrc } : null;
  if (map !== null && dims !== null) {
    if (typeof dims.cols === 'number') map.cols = dims.cols;
    if (typeof dims.rows === 'number') map.rows = dims.rows;
  }
  const positions: Record<string, { x: number; y: number }> = {};
  if (map !== null && battle !== null) {
    for (const entry of order) {
      const at = battle.positions[entry.id];
      if (at !== undefined) positions[entry.id] = { x: at.x, y: at.y };
    }
  }
  return { round: state.round, order, map, positions };
}

class Projector {
  private projection: Projection = { kind: 'blank' };
  private readonly clients = new Set<ServerResponse>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private liveTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  /** Bumped by every commit, so a build that finishes after a newer commit is dropped. */
  private generation = 0;
  /** The live signature the stored combat projection was built from. */
  private signature: string | null = null;
  private readonly ctx: Ctx;
  private readonly battle: BattleHost;

  constructor(ctx: Ctx, battle: BattleHost) {
    this.ctx = ctx;
    this.battle = battle;
  }

  /** The projection to answer now: rebuilt from the server state when the kind is combat. */
  async current(): Promise<Projection> {
    if (this.projection.kind !== 'combat') return this.projection;
    return this.combatProjection(await this.readBattle());
  }

  /** Adds an SSE client and sends it the current projection once it is built. */
  async subscribe(res: ServerResponse): Promise<void> {
    res.writeHead(200, SSE_HEADERS);
    if (!this.send(res, `retry: ${RETRY_MS}\n\n`)) return;
    this.clients.add(res);
    const drop = (): void => this.drop(res);
    res.on('close', drop);
    res.on('error', drop);
    this.ensureHeartbeat();
    const generation = this.generation;
    const projection = await this.current();
    if (!this.clients.has(res)) return;
    // A commit that happened meanwhile was already sent to this client, so its projection wins.
    this.send(res, frameOf(generation === this.generation ? projection : this.projection));
    this.ensureLive();
  }

  /** Stores the projection and sends it to every client. */
  set(projection: Projection): void {
    this.commit(projection, null);
  }

  /** Shows the live fight: rebuilt now, then kept up to date while a projector is connected. */
  async showCombat(): Promise<Projection> {
    const generation = this.generation;
    const view = await this.readBattle();
    const signature = await this.signatureOf(view);
    const projection = await this.combatProjection(view);
    if (generation !== this.generation) return this.projection;
    this.commit(projection, signature);
    return projection;
  }

  /** Ends every SSE stream and clears the timers. */
  close(): void {
    this.stopHeartbeat();
    this.stopLive();
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

  private commit(projection: Projection, signature: string | null): void {
    this.generation += 1;
    this.projection = projection;
    this.signature = signature;
    const text = frameOf(projection);
    for (const res of [...this.clients]) {
      this.send(res, text);
    }
    if (projection.kind === 'combat' && this.clients.size > 0) this.ensureLive();
    else this.stopLive();
  }

  /** One live tick: rebuild and broadcast only when the signature changed. Never overlaps. */
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const generation = this.generation;
      const view = await this.readBattle();
      const signature = await this.signatureOf(view);
      if (generation !== this.generation || signature === this.signature) return;
      const projection = await this.combatProjection(view);
      if (generation !== this.generation) return;
      this.commit(projection, signature);
    } catch {
      // the next tick tries again
    } finally {
      this.ticking = false;
    }
  }

  private async readBattle(): Promise<BattleView | null> {
    try {
      return await this.battle.view();
    } catch {
      return null;
    }
  }

  private async signatureOf(view: BattleView | null): Promise<string> {
    const battle = view === null ? 'none' : JSON.stringify([view.revision, view.positions, view.map ?? null]);
    return `${await liveRevision(this.ctx.campaignRoot)}|${battle}`;
  }

  private async combatProjection(view: BattleView | null): Promise<Projection> {
    let state: CombatState | null = null;
    try {
      const snap = await buildSnapshot(this.ctx);
      state = snap.ok ? snap.snapshot.combat : null;
    } catch {
      state = null;
    }
    const mapSrc = await this.mapSource(view);
    return { kind: 'combat', combat: projectCombat(state, view, mapSrc) };
  }

  /**
   * The battle map through the same gate as any image. The gridless twin comes first (the players'
   * tokens are drawn by cell, so the baked-in grid would fight them); the map itself is the fallback.
   * Null when neither may be shown.
   */
  private async mapSource(view: BattleView | null): Promise<string | null> {
    const candidates = [view?.map?.plain, view?.map?.ref];
    for (const ref of candidates) {
      if (!ref) continue;
      try {
        const src = await resolveSrc(this.ctx, fileUrl(ref));
        if (src !== null) return src;
      } catch {
        // the next candidate
      }
    }
    return null;
  }

  private ensureLive(): void {
    if (this.liveTimer !== null) return;
    if (this.projection.kind !== 'combat' || this.clients.size === 0) return;
    this.liveTimer = setInterval(() => {
      void this.tick();
    }, LIVE_MS);
    this.liveTimer.unref();
  }

  private stopLive(): void {
    if (this.liveTimer !== null) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
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
    if (!this.clients.delete(res) || this.clients.size > 0) return;
    this.stopHeartbeat();
    this.stopLive();
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
export function projectorFor(ctx: Ctx, battle: BattleHost): Projector {
  let projector = projectors.get(ctx);
  if (projector === undefined) {
    const created = new Projector(ctx, battle);
    projector = created;
    projectors.set(ctx, created);
    ctx.onClose(() => created.close());
  }
  return projector;
}

/**
 * Parses a source into a URL on the base, or null when it has another origin (data:, //host, other hosts).
 * A same-origin absolute URL (http or https, the server's own `host`) is accepted as its relative form.
 */
function parseSource(src: string, host?: string): URL | null {
  let url: URL;
  try {
    url = new URL(src, BASE);
  } catch {
    return null;
  }
  if (url.origin === BASE) return url;
  const sameHost = typeof host === 'string' && host !== '' && url.host.toLowerCase() === host.toLowerCase();
  if (!sameHost || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
  return new URL(url.pathname + url.search, BASE);
}

/** A campaign image file, rebuilt as its /api/file URL. Any image of the campaign may be projected. */
async function resolveCampaignImage(ctx: Ctx, rawPath: string | null): Promise<string | null> {
  const resolved = await resolveCampaignFile(ctx.campaignRoot, rawPath);
  if (resolved === null) return null;
  if (!PROJECTABLE_EXTENSIONS.has(path.posix.extname(resolved.rel).toLowerCase())) return null;
  return fileUrl(resolved.rel);
}

/** A live-board image: /api/cockpit/sessions/<id>/files/<name>, both segments plain names, a projectable extension. */
function resolveSessionImage(pathname: string): string | null {
  const parts = pathname.split('/');
  // ['', 'api', 'cockpit', 'sessions', id, 'files', name]
  if (parts.length !== 7) return null;
  if (parts[1] !== 'api' || parts[2] !== 'cockpit' || parts[3] !== 'sessions' || parts[5] !== 'files') return null;
  const id = decodeSegment(parts[4]);
  const name = decodeSegment(parts[6]);
  if (id === null || name === null) return null;
  for (const segment of [id, name]) {
    if (!isPlainSegment(segment)) return null;
  }
  if (!PROJECTABLE_EXTENSIONS.has(path.posix.extname(name).toLowerCase())) return null;
  return `/api/cockpit/sessions/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`;
}

/** A decoded path segment: non-empty, not '.' or '..', and with no slash, backslash or NUL character. */
function isPlainSegment(segment: string): boolean {
  if (segment === '' || segment === '.' || segment === '..') return false;
  return !/[/\\\0]/.test(segment);
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
 * server, or null when the source is not a campaign image or a live-board image. The server
 * does not check whether a document shows the image: the master decides by clicking Project.
 */
export async function resolveSrc(ctx: Ctx, src: string, host?: string): Promise<string | null> {
  const url = parseSource(src, host);
  if (url === null) return null;
  if (url.pathname === '/api/file') return resolveCampaignImage(ctx, url.searchParams.get('path'));
  return resolveSessionImage(url.pathname);
}

// Persistence of the conversations (chats/<id>.json) and of the turn metadata (turns.json)
// in the campaign state folder. Writes are atomic (temp file + rename), serialized, and made
// with mode 0600. A corrupted file is kept as <name>.bak and left out of the store. A legacy
// single chat (chat.json) is migrated once into one conversation. Owner: chat engineer.
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, Conversation } from '../../../shared/src/types.js';

export const MAX_MESSAGES = 500;
/** Titles come from the first master message: whitespace collapsed, cut to this many characters. */
const TITLE_MAX_CHARS = 60;
const CHATS_DIR = 'chats';
const LEGACY_CHAT_FILE = 'chat.json';
const TURNS_FILE = 'turns.json';

/** One finished turn, in the shape the change-history engineer reads from turns.json. */
export interface TurnRecord {
  messageId: string;
  turnId: string;
  fromSha: string;
  toSha: string;
}

/** One conversation as stored in chats/<id>.json. */
interface ConversationFile {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  resumeId?: string;
  messages: ChatMessage[];
}

/** The single chat of earlier versions (chat.json), read only by the migration. */
interface LegacyChatFile {
  version: 1;
  resumeId?: string;
  messages: ChatMessage[];
}

/**
 * A conversation in memory. `seq` orders conversations that share the same updatedAt (newest created first).
 * `persisted` is false for the automatic empty conversation until its first write: nothing is on disk for it yet.
 */
interface Stored {
  data: ConversationFile;
  seq: number;
  persisted: boolean;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    (m.role === 'master' || m.role === 'agent') &&
    typeof m.text === 'string' &&
    typeof m.at === 'string' &&
    (m.turnId === undefined || typeof m.turnId === 'string')
  );
}

function isTurnRecord(value: unknown): value is TurnRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.messageId === 'string' &&
    typeof r.turnId === 'string' &&
    typeof r.fromSha === 'string' &&
    typeof r.toSha === 'string'
  );
}

function isConversationFile(value: unknown): value is ConversationFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.id === 'string' &&
    v.id !== '' &&
    typeof v.title === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    (v.resumeId === undefined || typeof v.resumeId === 'string') &&
    Array.isArray(v.messages) &&
    v.messages.every(isChatMessage)
  );
}

function isLegacyChatFile(value: unknown): value is LegacyChatFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    Array.isArray(v.messages) &&
    v.messages.every(isChatMessage) &&
    (v.resumeId === undefined || typeof v.resumeId === 'string')
  );
}

function isTurnList(value: unknown): value is TurnRecord[] {
  return Array.isArray(value) && value.every(isTurnRecord);
}

/** Reads a JSON file. Missing gives null; unreadable or invalid is kept as .bak and gives null. */
function readStateFile<T>(file: string, valid: (value: unknown) => value is T, log: (msg: string) => void): T | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    log(`could not read ${path.basename(file)}: ${String(err)}`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (valid(parsed)) return parsed;
  try {
    fs.renameSync(file, `${file}.bak`);
    log(`${path.basename(file)} was damaged; it was kept as ${path.basename(file)}.bak`);
  } catch (err) {
    log(`could not keep the damaged ${path.basename(file)}: ${String(err)}`);
  }
  return null;
}

async function writeAtomic(file: string, data: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.promises.writeFile(tmp, data, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.chmod(tmp, 0o600);
    await fs.promises.rename(tmp, file);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

function writeAtomicSync(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Files written before steps existed have no `steps`; a malformed one is dropped, the message is kept. */
function withValidSteps(message: ChatMessage): ChatMessage {
  if (message.steps === undefined || Array.isArray(message.steps)) return message;
  const kept: ChatMessage = { ...message };
  delete kept.steps;
  return kept;
}

/** The title a text gives: whitespace collapsed, cut to 60 characters with "…" when cut. '' when the text is blank. */
function titleFromText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(collapsed);
  if (chars.length <= TITLE_MAX_CHARS) return collapsed;
  return `${chars.slice(0, TITLE_MAX_CHARS).join('')}…`;
}

/** Appends a message, keeps the last MAX_MESSAGES, bumps updatedAt and sets the title from the first master message. */
function applyMessage(data: ConversationFile, message: ChatMessage): void {
  data.messages.push(message);
  if (data.messages.length > MAX_MESSAGES) {
    data.messages.splice(0, data.messages.length - MAX_MESSAGES);
  }
  data.updatedAt = message.at;
  if (data.title === '' && message.role === 'master') {
    data.title = titleFromText(message.text);
  }
}

function summaryOf(data: ConversationFile): Conversation {
  return {
    id: data.id,
    title: data.title,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    messageCount: data.messages.length,
  };
}

function unknownConversation(): Promise<never> {
  return Promise.reject(new Error('Unknown conversation'));
}

export class ChatStore {
  private readonly chatsDir: string;
  private readonly legacyFile: string;
  private readonly turnsFile: string;
  private readonly stored = new Map<string, Stored>();
  private turnList: TurnRecord[];
  private chain: Promise<void> = Promise.resolve();
  private seq = 0;

  /** Loads everything synchronously (the files are small); a damaged file is left out. */
  constructor(
    private readonly stateDir: string,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.chatsDir = path.join(stateDir, CHATS_DIR);
    this.legacyFile = path.join(stateDir, LEGACY_CHAT_FILE);
    this.turnsFile = path.join(stateDir, TURNS_FILE);
    this.loadConversations();
    this.migrateLegacy();
    // Always at least one conversation. It stays in memory until something is written for it,
    // so a server that is only started writes nothing.
    if (this.stored.size === 0) this.addEntry(false);
    this.turnList = readStateFile(this.turnsFile, isTurnList, log) ?? [];
  }

  /** Every conversation, newest updatedAt first. Always at least one. */
  conversations(): Conversation[] {
    return [...this.stored.values()]
      .sort((a, b) => (Date.parse(b.data.updatedAt) || 0) - (Date.parse(a.data.updatedAt) || 0) || b.seq - a.seq)
      .map((entry) => summaryOf(entry.data));
  }

  /** The most recently updated conversation. */
  currentId(): string {
    return this.conversations()[0].id;
  }

  has(id: string): boolean {
    return this.stored.has(id);
  }

  /** A new empty conversation, written at once; it becomes the most recently updated one. */
  async createConversation(): Promise<Conversation> {
    const entry = this.addEntry(true);
    await this.persist(entry);
    return summaryOf(entry.data);
  }

  /**
   * Removes a conversation. Its file is deleted when it had one; the automatic empty conversation
   * (in memory only) is just dropped. When none is left, a fresh in-memory one takes its place.
   * Unknown id: no-op.
   */
  async deleteConversation(id: string): Promise<void> {
    const entry = this.stored.get(id);
    if (!entry) return;
    this.stored.delete(id);
    if (entry.persisted) {
      const file = this.fileOf(id);
      await this.enqueue(() => fs.promises.rm(file, { force: true }));
    }
    if (this.stored.size === 0) this.addEntry(false);
  }

  messages(id: string): ChatMessage[] {
    return this.stored.get(id)?.data.messages.slice() ?? [];
  }

  resumeId(id: string): string | undefined {
    return this.stored.get(id)?.data.resumeId;
  }

  /** Stores the agent session id so the next turn of this conversation resumes the same session. */
  setResumeId(id: string, resume: string): Promise<void> {
    const entry = this.stored.get(id);
    if (!entry) return unknownConversation();
    entry.data.resumeId = resume;
    return this.persist(entry);
  }

  /** Appends a message to a conversation and persists it. */
  addMessage(id: string, message: ChatMessage): Promise<void> {
    const entry = this.stored.get(id);
    if (!entry) return unknownConversation();
    applyMessage(entry.data, message);
    return this.persist(entry);
  }

  /** Every finished turn, from turns.json (global, shared by all conversations). */
  turns(): TurnRecord[] {
    return this.turnList.slice();
  }

  /** Appends one finished turn to turns.json. */
  appendTurn(record: TurnRecord): Promise<void> {
    this.turnList.push({ ...record });
    return this.enqueue(() => this.saveTurns());
  }

  /** Resolves once every write queued so far has finished (or failed). */
  flush(): Promise<void> {
    return this.chain;
  }

  private fileOf(id: string): string {
    return path.join(this.chatsDir, `${id}.json`);
  }

  private addEntry(persisted: boolean): Stored {
    const now = new Date().toISOString();
    const entry: Stored = {
      data: { version: 1, id: randomUUID(), title: '', createdAt: now, updatedAt: now, messages: [] },
      seq: ++this.seq,
      persisted,
    };
    this.stored.set(entry.data.id, entry);
    return entry;
  }

  private loadConversations(): void {
    let names: string[];
    try {
      names = fs.readdirSync(this.chatsDir);
    } catch {
      return; // no folder yet: no conversation
    }
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue;
      const data = readStateFile(path.join(this.chatsDir, name), isConversationFile, this.log);
      if (data === null || this.stored.has(data.id)) continue;
      data.messages = data.messages.slice(-MAX_MESSAGES).map(withValidSteps);
      this.stored.set(data.id, { data, seq: ++this.seq, persisted: true });
    }
  }

  /** Converts chat.json into one conversation, once: only when no conversation exists yet. */
  private migrateLegacy(): void {
    if (this.stored.size > 0 || !fs.existsSync(this.legacyFile)) return;
    const legacy = readStateFile(this.legacyFile, isLegacyChatFile, this.log);
    if (legacy === null) return; // damaged: already kept as chat.json.bak and ignored
    const now = new Date().toISOString();
    const kept = legacy.messages.slice(-MAX_MESSAGES).map(withValidSteps);
    const data: ConversationFile = {
      version: 1,
      id: randomUUID(),
      title: '',
      createdAt: kept[0]?.at ?? now,
      updatedAt: kept.at(-1)?.at ?? now,
      messages: [],
    };
    if (legacy.resumeId !== undefined) data.resumeId = legacy.resumeId;
    for (const message of kept) applyMessage(data, message);
    try {
      writeAtomicSync(this.fileOf(data.id), `${JSON.stringify(data, null, 2)}\n`);
    } catch (err) {
      this.log(`chat.json could not be migrated: ${String(err)}`);
      return;
    }
    this.stored.set(data.id, { data, seq: ++this.seq, persisted: true });
    try {
      fs.renameSync(this.legacyFile, `${this.legacyFile}.migrated`);
    } catch (err) {
      this.log(`chat.json could not be renamed after the migration: ${String(err)}`);
    }
  }

  /** Writes the whole conversation; the first write of an in-memory conversation makes it persisted. */
  private persist(entry: Stored): Promise<void> {
    entry.persisted = true;
    return this.enqueue(() => this.saveEntry(entry));
  }

  private enqueue(write: () => Promise<void>): Promise<void> {
    const next = this.chain.then(write);
    // A failed write must not block the queue; the caller still gets the error.
    this.chain = next.catch((err: unknown) => {
      this.log(`chat state could not be saved: ${String(err)}`);
    });
    return next;
  }

  /** Writes a conversation unless it was deleted after the write was queued. */
  private saveEntry(entry: Stored): Promise<void> {
    if (this.stored.get(entry.data.id) !== entry) return Promise.resolve();
    return writeAtomic(this.fileOf(entry.data.id), `${JSON.stringify(entry.data, null, 2)}\n`);
  }

  private saveTurns(): Promise<void> {
    return writeAtomic(this.turnsFile, `${JSON.stringify(this.turnList, null, 2)}\n`);
  }
}

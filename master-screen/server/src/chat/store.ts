// Persistence of the chat (chat.json) and of the turn metadata (turns.json) in the
// campaign state folder. Writes are atomic (temp file + rename), serialized, and made
// with mode 0600. A corrupted file is kept as <name>.bak and the store starts empty.
// Owner: chat engineer.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from '../../../shared/src/types.js';

export const MAX_MESSAGES = 500;
const CHAT_FILE = 'chat.json';
const TURNS_FILE = 'turns.json';

/** One finished turn, in the shape the change-history engineer reads from turns.json. */
export interface TurnRecord {
  messageId: string;
  turnId: string;
  fromSha: string;
  toSha: string;
}

interface ChatFile {
  version: 1;
  resumeId?: string;
  messages: ChatMessage[];
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

/** Reads a JSON file. Missing gives `fallback`; unreadable or invalid is kept as .bak and gives `fallback`. */
function readStateFile<T>(file: string, fallback: T, valid: (value: unknown) => value is T, log: (msg: string) => void): T {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    log(`could not read ${path.basename(file)}: ${String(err)}`);
    return fallback;
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
  return fallback;
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

/** Files written before steps existed have no `steps`; a malformed one is dropped, the message is kept. */
function withValidSteps(message: ChatMessage): ChatMessage {
  if (message.steps === undefined || Array.isArray(message.steps)) return message;
  const kept: ChatMessage = { ...message };
  delete kept.steps;
  return kept;
}

export class ChatStore {
  private readonly chatFile: string;
  private readonly turnsFile: string;
  private messagesList: ChatMessage[];
  private resume: string | undefined;
  private turnList: TurnRecord[];
  private chain: Promise<void> = Promise.resolve();

  /** Loads both files synchronously (they are small); a damaged file starts empty. */
  constructor(
    private readonly stateDir: string,
    private readonly log: (msg: string) => void = () => {},
  ) {
    this.chatFile = path.join(stateDir, CHAT_FILE);
    this.turnsFile = path.join(stateDir, TURNS_FILE);
    const chat = readStateFile<ChatFile>(
      this.chatFile,
      { version: 1, messages: [] },
      (value): value is ChatFile => {
        if (typeof value !== 'object' || value === null) return false;
        const v = value as Record<string, unknown>;
        return (
          v.version === 1 &&
          Array.isArray(v.messages) &&
          v.messages.every(isChatMessage) &&
          (v.resumeId === undefined || typeof v.resumeId === 'string')
        );
      },
      log,
    );
    this.messagesList = chat.messages.slice(-MAX_MESSAGES).map(withValidSteps);
    this.resume = chat.resumeId;
    this.turnList = readStateFile<TurnRecord[]>(
      this.turnsFile,
      [],
      (value): value is TurnRecord[] => Array.isArray(value) && value.every(isTurnRecord),
      log,
    );
  }

  messages(): ChatMessage[] {
    return this.messagesList.slice();
  }

  turns(): TurnRecord[] {
    return this.turnList.slice();
  }

  resumeId(): string | undefined {
    return this.resume;
  }

  /** Stores the agent session id so the next turn resumes the same conversation. */
  setResumeId(id: string): Promise<void> {
    this.resume = id;
    return this.enqueue(() => this.saveChat());
  }

  /** Appends a message (the list keeps the last MAX_MESSAGES) and persists it. */
  addMessage(message: ChatMessage): Promise<void> {
    this.messagesList.push(message);
    if (this.messagesList.length > MAX_MESSAGES) {
      this.messagesList.splice(0, this.messagesList.length - MAX_MESSAGES);
    }
    return this.enqueue(() => this.saveChat());
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

  private enqueue(write: () => Promise<void>): Promise<void> {
    const next = this.chain.then(write);
    // A failed write must not block the queue; the caller still gets the error.
    this.chain = next.catch((err: unknown) => {
      this.log(`chat state could not be saved: ${String(err)}`);
    });
    return next;
  }

  private saveChat(): Promise<void> {
    const file: ChatFile = { version: 1, messages: this.messagesList };
    if (this.resume !== undefined) file.resumeId = this.resume;
    return writeAtomic(this.chatFile, `${JSON.stringify(file, null, 2)}\n`);
  }

  private saveTurns(): Promise<void> {
    return writeAtomic(this.turnsFile, `${JSON.stringify(this.turnList, null, 2)}\n`);
  }
}

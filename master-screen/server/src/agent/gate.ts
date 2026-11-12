// Permission gate of the agent: a pure function that decides, for one tool call, whether
// it may run. Anything not listed here is denied. Owner: chat engineer.
import fs from 'node:fs';
import path from 'node:path';

export interface GateContext {
  /** Campaign root: the agent's working directory. */
  campaignRoot: string;
  /** Yllir plugin root: the scripts the agent may run live here. */
  frameworkRoot: string;
}

export type GateDecision = { allow: true } | { allow: false; reason: string };

/** Read-only tools and the skill loader. */
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
/** The skill loader and the framework's own sub-agents (reviewers, sheet writers). Sub-agent tool calls pass through this same gate. */
const FRAMEWORK_TOOLS = new Set(['Skill', 'Task', 'Agent']);
/** Writes are checked against the drafts folder. */
const WRITE_TOOLS = new Set(['Write', 'Edit']);
/** In-process tools built by claude-provider; their handlers validate their own input. */
export const MCP_TOOLS = new Set([
  'mcp__yllir__search_docs',
  'mcp__yllir__open_document',
  'mcp__yllir__suggest_music',
]);

/**
 * Characters that are never allowed in a Bash command line, quoted or not: shell
 * separators, redirections, expansions, globbing and braces, and the `..` segment.
 * Newlines and carriage returns are included.
 */
const FORBIDDEN_IN_COMMAND = /[;|&<>$`\n\r()[\]{}*?~]|\.\./;
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const SCRIPT_NAME = /^[A-Za-z0-9_-]+\.mjs$/;

export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') return false;
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) return false;
  return !path.isAbsolute(rel);
}

/**
 * Resolves a path through its existing ancestors, so that a path to a file that does
 * not exist yet still gets its symbolic links resolved.
 */
export function realpathLenient(target: string): string {
  const missing: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return missing.length === 0 ? real : path.join(real, ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/** Write targets: a file strictly inside `<campaign>/.campaign/drafts/`, after symlinks are resolved. */
export function isDraftPath(filePath: unknown, ctx: GateContext): boolean {
  if (typeof filePath !== 'string' || filePath.trim() === '' || filePath.includes('\0')) return false;
  const drafts = path.join(path.resolve(ctx.campaignRoot), '.campaign', 'drafts');
  const target = path.resolve(path.resolve(ctx.campaignRoot), filePath);
  if (!isInside(target, drafts)) return false;
  return isInside(realpathLenient(target), realpathLenient(drafts));
}

/** A script path that is `<root>/scripts/<name>.mjs` or `<root>/skills/**\/scripts/<name>.mjs`. */
function isFrameworkScript(token: string, root: string): boolean {
  if (token === '' || path.normalize(token) !== token) return false;
  const rel = path.relative(root, token);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  const name = parts[parts.length - 1];
  if (!SCRIPT_NAME.test(name)) return false;
  if (parts.length === 2 && parts[0] === 'scripts') return true;
  if (parts[0] === 'skills' && parts.length >= 4 && parts[parts.length - 2] === 'scripts') {
    return parts.slice(1, -2).every((segment) => SEGMENT.test(segment));
  }
  return false;
}

/**
 * Bash allowed only as `node "<script>" <args>` or `node <script> <args>` (the script
 * path unquoted only when it has no space), where <script> is a framework script, and
 * the whole line has none of the forbidden characters.
 */
export function isAllowedCommand(command: unknown, frameworkRoot: string): boolean {
  if (typeof command !== 'string') return false;
  if (FORBIDDEN_IN_COMMAND.test(command)) return false;
  const root = path.resolve(frameworkRoot);
  if (!command.startsWith('node ')) return false;
  const rest = command.slice('node '.length);

  let script: string;
  let args: string;
  if (rest.startsWith('"')) {
    const close = rest.indexOf('"', 1);
    if (close === -1) return false;
    script = rest.slice(1, close);
    args = rest.slice(close + 1);
  } else {
    const space = rest.indexOf(' ');
    script = space === -1 ? rest : rest.slice(0, space);
    args = space === -1 ? '' : rest.slice(space);
    if (script.includes('"') || script.includes("'")) return false;
  }
  if (args !== '' && !args.startsWith(' ')) return false;
  if (script.includes('"') || script.includes("'")) return false;
  return isFrameworkScript(script, root);
}

/** Reads stay inside the campaign and the framework: a path is allowed when it resolves inside one of them. */
export function isReadablePath(value: unknown, ctx: GateContext): boolean {
  if (value === undefined || value === null || value === '') return true; // defaults to the working directory
  if (typeof value !== 'string' || value.includes('\0')) return false;
  const campaign = path.resolve(ctx.campaignRoot);
  const target = path.resolve(campaign, value);
  const real = realpathLenient(target);
  return [ctx.campaignRoot, ctx.frameworkRoot].some((root) => {
    const base = realpathLenient(root);
    return real === base || isInside(real, base);
  });
}

const DENY_DEFAULT = 'This action is not allowed while the assistant works on the campaign.';

export function isAllowed(toolName: string, input: Record<string, unknown>, ctx: GateContext): GateDecision {
  if (FRAMEWORK_TOOLS.has(toolName) || MCP_TOOLS.has(toolName)) return { allow: true };
  if (READ_TOOLS.has(toolName)) {
    const pattern = typeof input.pattern === 'string' ? input.pattern : '';
    const patternOk = toolName !== 'Glob' || !(path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..'));
    if (patternOk && isReadablePath(input.file_path, ctx) && isReadablePath(input.path, ctx)) return { allow: true };
    return { allow: false, reason: 'The assistant can only read the files of the campaign and of Yllir.' };
  }
  if (WRITE_TOOLS.has(toolName)) {
    if (isDraftPath(input.file_path, ctx)) return { allow: true };
    return { allow: false, reason: 'Changes can only be written to the drafts folder of the campaign.' };
  }
  if (toolName === 'Bash') {
    if (isAllowedCommand(input.command, ctx.frameworkRoot)) return { allow: true };
    return {
      allow: false,
      reason: 'Only the Yllir framework scripts can run, written as node "<script>" with plain arguments.',
    };
  }
  if (toolName === 'WebFetch' || toolName === 'WebSearch') {
    return { allow: false, reason: 'Web access is not allowed while the assistant works on the campaign.' };
  }
  return { allow: false, reason: DENY_DEFAULT };
}

/**
 * Minimal typings for the Node built-ins that the unit tests read source files with.
 * The client has no @types/node; these exist only for the grep-based i18n test, which runs under Vitest in Node.
 */
declare module 'node:fs' {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function statSync(path: string): { isDirectory(): boolean };
}
declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

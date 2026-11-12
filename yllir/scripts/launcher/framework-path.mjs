// Keeps <home>/.yllir/framework-path up to date: one line with the framework root,
// read by the shortcuts of the campaign folders. Called at every session start.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Writes the framework root into <home>/.yllir/framework-path. The file is replaced
 * atomically (temp file + rename) and only when its content differs. Never throws.
 * Returns true when the file holds the framework root afterwards, false on failure.
 */
export function writeFrameworkPath(frameworkRoot, home = os.homedir()) {
  try {
    const dir = path.join(home, '.yllir');
    const file = path.join(dir, 'framework-path');
    const content = `${path.resolve(frameworkRoot)}\n`;

    let current = null;
    try {
      current = fs.readFileSync(file, 'utf8');
    } catch {
      current = null;
    }
    if (current === content) return true;

    fs.mkdirSync(dir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, content);
    fs.renameSync(temp, file);
    return true;
  } catch {
    return false;
  }
}

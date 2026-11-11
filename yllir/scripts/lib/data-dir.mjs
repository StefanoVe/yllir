// The folder where Yllir keeps what it installs outside every campaign (third-party
// tools, their Python environments and their node modules). The OS default is used
// unless a usable folder is given. Same rules as the image skill's installer.

import os from 'node:os';
import path from 'node:path';

/** The OS default data folder, per platform. */
export function defaultDataDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'yllir');
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(base, 'yllir');
  }
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && xdg !== '' ? xdg : path.posix.join(home, '.local', 'share');
  return path.posix.join(base, 'yllir');
}

/** The given folder when it is usable, else the OS default. Always absolute. */
export function resolveDataDir(given, opts = {}) {
  if (typeof given === 'string' && given !== '' && !given.includes('${')) return path.resolve(given);
  return path.resolve(defaultDataDir(opts));
}

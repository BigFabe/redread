import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function resolveDataDir(cwd: string, configured?: string): string {
  if (configured) return resolve(cwd, configured);
  let directory = cwd;
  while (true) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.name === 'redread' && pkg.workspaces) return join(directory, 'data');
    }
    const parent = dirname(directory);
    if (parent === directory) return resolve(cwd, '../../data');
    directory = parent;
  }
}

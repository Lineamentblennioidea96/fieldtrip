import { glob } from 'glob';
import * as path from 'path';

const SCHEMA_EXTENSIONS = [
  '**/*.yaml',
  '**/*.yml',
  '**/*.json',
  '**/*.proto',
  '**/*.avsc',
];

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/package.json',
  '**/package-lock.json',
  '**/tsconfig.json',
  '**/tsconfig.*.json',
];

export async function scanDirectory(dir: string): Promise<{ absolutePath: string; relativePath: string }[]> {
  const absoluteDir = path.resolve(dir);
  const files: { absolutePath: string; relativePath: string }[] = [];

  for (const pattern of SCHEMA_EXTENSIONS) {
    const matches = await glob(pattern, {
      cwd: absoluteDir,
      absolute: false,
      ignore: IGNORE_PATTERNS,
      nodir: true,
    });

    for (const match of matches) {
      files.push({
        absolutePath: path.join(absoluteDir, match),
        relativePath: match,
      });
    }
  }

  // Deduplicate (a file could match multiple patterns)
  const seen = new Set<string>();
  return files.filter((f) => {
    if (seen.has(f.absolutePath)) return false;
    seen.add(f.absolutePath);
    return true;
  });
}

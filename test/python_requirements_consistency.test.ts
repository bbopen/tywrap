import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

interface RequirementPin {
  file: string;
  line: number;
  name: string;
  spec: string;
}

function parsePinnedRequirements(filePath: string): RequirementPin[] {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const pins: RequirementPin[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-r ')) {
      continue;
    }

    // Only compare strict pins (package==version), which are what full-suite installs rely on.
    const match = /^([A-Za-z0-9_.-]+)==([^\s;]+)$/.exec(line);
    if (!match) {
      continue;
    }

    const [, name, version] = match;
    pins.push({
      file: filePath,
      line: i + 1,
      name: name.toLowerCase(),
      spec: `==${version}`,
    });
  }

  return pins;
}

describe('python suite requirement pins', () => {
  it('are internally consistent when installing full suite', () => {
    const repoRoot = process.cwd();
    const suiteRequirementsDir = join(repoRoot, 'test', 'python');
    const files = readdirSync(suiteRequirementsDir)
      .filter(fileName => /^requirements-suite-.*\.txt$/.test(fileName))
      .map(fileName => join(suiteRequirementsDir, fileName))
      .sort();

    const byName = new Map<string, RequirementPin[]>();
    for (const filePath of files) {
      for (const pin of parsePinnedRequirements(filePath)) {
        const existing = byName.get(pin.name);
        if (existing) {
          existing.push(pin);
        } else {
          byName.set(pin.name, [pin]);
        }
      }
    }

    const conflicts: string[] = [];
    for (const [name, pins] of byName.entries()) {
      const specs = new Set(pins.map(pin => pin.spec));
      if (specs.size > 1) {
        const details = pins.map(pin => `${pin.spec} @ ${pin.file}:${pin.line}`).join(', ');
        conflicts.push(`${name}: ${details}`);
      }
    }

    if (conflicts.length > 0) {
      throw new Error(
        `Found conflicting pinned requirements across full-suite inputs:\n${conflicts.join('\n')}`
      );
    }
  });
});

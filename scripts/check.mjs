#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSteps, opt } from './lib/jin-steps.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};
const testScript = opt('--test', 'test');
const testArgs = (opt('--files', '') || '').split(',').filter(Boolean);

await runSteps('check', [
  {
    name: 'typecheck', cmd: 'npm', args: ['run', 'typecheck', '--silent'], heavy: true,
    when: () => Boolean(scripts.typecheck),
    errors: /error TS\d+|^\S+\.(vue|ts|tsx)[:(]\d+.*error/i,
  },
  {
    name: 'test', cmd: 'npm', args: ['run', testScript, '--silent', ...(testArgs.length ? ['--', ...testArgs] : [])], heavy: true,
    when: () => Boolean(scripts[testScript]),
    errors: /^\s*(FAIL|✗|×|❌)\s|AssertionError|Error: |^\s*Tests?\s.*failed|\bfailed\b.*\d|exit code [1-9]/i,
  },
], { root });

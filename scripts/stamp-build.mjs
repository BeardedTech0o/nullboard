#!/usr/bin/env node
// Run before every deploy. Rewrites public/sw.js so that
//   - CACHE_NAME is unique to this build (browsers then drop the old cache)
//   - PRECACHE lists every file under public/ the app needs offline
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const root = new URL('../public/', import.meta.url).pathname;
const skip = new Set(['sw.js']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(root)
  .map((f) => '/' + relative(root, f).split('\\').join('/'))
  .filter((f) => !skip.has(f.slice(1)) && f !== '/index.html')
  .sort();

let sha = 'nogit';
try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a repo */ }
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const cacheName = `nullboard-${stamp}-${sha}`;

const swPath = join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = sw.replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = '${cacheName}';`);
sw = sw.replace(/const PRECACHE = \[[\s\S]*?\];/, `const PRECACHE = [\n  '/',\n${files.map((f) => `  '${f}',`).join('\n')}\n];`);
writeFileSync(swPath, sw);
console.log(`Stamped ${cacheName} with ${files.length + 1} precached files`);

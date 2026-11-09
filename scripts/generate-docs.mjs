#!/usr/bin/env node
/**
 * UAI backend documentation generator.
 *
 * Scans the codebase and regenerates every block wrapped in:
 *   <!-- AUTO:START:xxx -->  ...  <!-- AUTO:END:xxx -->
 *
 * Hand-written prose outside those markers is never touched.
 *
 * Usage:
 *   node scripts/generate-docs.mjs          # write docs
 *   node scripts/generate-docs.mjs --check  # exit 1 if docs are stale
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const DOCS = path.join(ROOT, 'docs');
const CHECK = process.argv.includes('--check');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const toPosix = (p) => p.split(path.sep).join('/');
const rel = (p) => toPosix(path.relative(ROOT, p));
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

function walk(dir, ext = '.js') {
  if (!exists(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

function resolveModule(fromFile, spec) {
  if (!spec || !spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
  for (const c of candidates) if (exists(c) && fs.statSync(c).isFile()) return c;
  return null;
}

/** Remove // and block comments while preserving strings/templates. */
function stripComments(code) {
  let out = '';
  let quote = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const n = code[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && n === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      let newlines = 0;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') newlines++;
        i++;
      }
      i++;
      out += '\n'.repeat(newlines) + ' ';
      continue;
    }
    out += c;
  }
  return out;
}

function findClosing(s, openIdx) {
  const open = s[openIdx];
  const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(str, sep = ',') {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (quote) {
      current += c;
      if (c === '\\') { current += str[i + 1] ?? ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; current += c; continue; }
    if ('({['.includes(c)) depth++;
    if (')}]'.includes(c)) depth--;
    if (c === sep && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += c;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** localName -> { source, imported } */
function parseImports(code) {
  const map = new Map();

  const named = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = named.exec(code))) {
    const source = m[2];
    for (const piece of m[1].split(',')) {
      const t = piece.trim();
      if (!t) continue;
      const [imported, localRaw] = t.split(/\s+as\s+/);
      const local = (localRaw || imported).trim();
      map.set(local, { source, imported: imported.trim() });
    }
  }

  const dflt = /import\s+([A-Za-z0-9_$]+)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = dflt.exec(code))) {
    map.set(m[1], { source: m[2], imported: 'default' });
  }

  const ns = /import\s*\*\s*as\s+([A-Za-z0-9_$]+)\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = ns.exec(code))) {
    map.set(m[1], { source: m[2], imported: '*' });
  }

  return map;
}

function humanize(name) {
  return name
    .replace(/^_+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function cell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function snippet(text, max = 48) {
  const s = cell(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/* ------------------------------------------------------------------ */
/* Route parsing                                                       */
/* ------------------------------------------------------------------ */

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];

const MIDDLEWARE_HINT = /^(authMiddleware|optionalAuth|checkPermission|require[A-Za-z]*|validate[A-Za-z]*|handleValidationErrors|upload[A-Za-z]*|multer[A-Za-z]*|errorHandler|rateLimit[A-Za-z]*|.*Limiter|.*Guard|verify[A-Za-z]*|is[A-Za-z]*|attach[A-Za-z]*)$/;

function precedingDoc(code, idx) {
  const before = code.slice(0, idx);
  const end = before.lastIndexOf('*/');
  if (end === -1) return '';
  if (before.slice(end + 2).trim()) return '';
  const start = before.lastIndexOf('/**', end);
  if (start === -1) return '';
  const body = before.slice(start + 3, end);
  const lines = body
    .split('\n')
    .map((l) => l.replace(/^\s*\*?\s?/, '').trim())
    .filter(Boolean);
  return lines[0] ?? '';
}

function describeArg(arg, imports, file) {
  const member = arg.match(/^([A-Za-z0-9_$]+)\s*\.\s*([A-Za-z0-9_$]+)$/);
  const ident = member?.[1] ?? arg.match(/^([A-Za-z0-9_$]+)/)?.[1];
  if (!ident || ident === 'async' || ident === 'function') {
    if (/^(async\s*)?\(/.test(arg) || /^(async\s+)?function/.test(arg)) return { kind: 'inline', name: '<inline handler>' };
    return { kind: 'unknown', name: snippet(arg) };
  }
  const imp = imports.get(ident);
  const target = imp ? resolveModule(file, imp.source) : null;
  const targetRel = target ? rel(target) : imp?.source ?? '';
  const isController = /controllers?\//i.test(targetRel);
  const kind = isController ? 'controller' : MIDDLEWARE_HINT.test(ident) ? 'middleware' : 'handler';
  return { kind, name: member ? `${ident}.${member[2]}` : ident, target: targetRel };
}

function extractPermissions(args) {
  const perms = [];
  for (const arg of args) {
    const re = /(?:checkPermission(?:Any|All)?|requireAuditPermission)\s*\(\s*([^,)]+)/g;
    let m;
    while ((m = re.exec(arg))) {
      const clean = m[1].trim().replace(/^['"`]|['"`]$/g, '');
      if (clean) perms.push(clean);
    }
  }
  return perms;
}

function parseRouterFile(file) {
  const raw = read(file);
  const code = stripComments(raw);
  const imports = parseImports(code);
  const routerVar =
    code.match(/(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:express\.)?Router\s*\(/)?.[1] ?? 'router';

  const globalMiddleware = [];
  const routes = [];
  const mounts = [];

  const callRe = new RegExp(`\\b${routerVar}\\s*\\.\\s*(${HTTP_METHODS.join('|')}|use)\\s*\\(`, 'g');
  let m;
  while ((m = callRe.exec(code))) {
    const method = m[1];
    const open = m.index + m[0].length - 1;
    const close = findClosing(code, open);
    if (close === -1) continue;
    const argsText = code.slice(open + 1, close);
    const args = splitTopLevel(argsText);
    const first = args[0] ?? '';
    const pathMatch = first.match(/^['"`](.*?)['"`]$/);
    const routePath = pathMatch ? pathMatch[1] : null;
    const rest = pathMatch ? args.slice(1) : args;

    if (method === 'use') {
      const ident = rest[0]?.match(/^([A-Za-z0-9_$]+)$/)?.[1];
      const imp = ident ? imports.get(ident) : null;
      const target = imp ? resolveModule(file, imp.source) : null;
      if (routePath && target) {
        mounts.push({ path: routePath, target, name: ident });
      } else if (!routePath && rest[0]) {
        globalMiddleware.push(rest[0]);
      }
      continue;
    }

    if (!pathMatch) continue;

    const chain = [];
    let handler = null;
    for (const arg of rest) {
      const d = describeArg(arg, imports, file);
      if (d.kind === 'controller') handler = d;
      else if (d.kind === 'handler') handler = d;
      else if (d.kind === 'inline') handler = d;
      chain.push(d);
    }

    routes.push({
      file,
      method: method.toUpperCase(),
      path: routePath,
      chain,
      handler,
      permissions: extractPermissions(rest),
      doc: precedingDoc(raw, m.index),
      line: code.slice(0, m.index).split('\n').length,
    });
  }

  return { file, routerVar, globalMiddleware, routes, mounts, imports };
}

function parseServerMounts() {
  const file = path.join(ROOT, 'server.js');
  const raw = read(file);
  const code = stripComments(raw);
  const imports = parseImports(code);
  const mounts = [];

  const re = /app\s*\.\s*(get|post|put|patch|delete|use)\s*\(\s*(['"`])(.*?)\2\s*,\s*([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(code))) {
    const [, method, , mountPath, ident] = m;
    const imp = imports.get(ident);
    const target = imp ? resolveModule(file, imp.source) : null;
    mounts.push({ method: method.toUpperCase(), path: mountPath, ident, target });
  }

  const inline = /app\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(['"`])(.*?)\2\s*,/g;
  while ((m = inline.exec(code))) {
    if (m[3] === '/') {
      mounts.push({ method: m[1].toUpperCase(), path: '/', ident: 'inline', target: null });
    }
  }

  return mounts;
}

function joinPath(prefix, p) {
  const clean = (value) => value.replace(/\/+$/, '').replace(/^\/+/, '');
  const a = clean(prefix || '');
  const b = clean(p || '');
  if (!a && !b) return '/';
  if (!a) return `/${b}`;
  if (!b) return `/${a}`;
  return `/${a}/${b}`;
}

function collectEndpoints() {
  const endpoints = [];
  const visited = new Set();
  const serverMounts = parseServerMounts();

  function visit(file, prefix, inherited, origin) {
    const key = `${file}|${prefix}`;
    if (visited.has(key)) return;
    visited.add(key);

    const parsed = parseRouterFile(file);
    const effective = [...inherited, ...parsed.globalMiddleware];

    for (const r of parsed.routes) {
      const chain = [...effective, ...r.chain.map((c) => c.name)];
      const auth = chain.some((n) => /auth/i.test(n) && !/optional/i.test(n))
        ? 'JWT'
        : chain.some((n) => /optionalAuth/i.test(n))
          ? 'Optional JWT'
          : '—';
      endpoints.push({
        method: r.method,
        path: joinPath(prefix, r.path),
        auth,
        permissions: [...new Set(r.permissions)],
        middleware: [...new Set(chain)],
        handler: r.handler?.name ?? '—',
        handlerFile: r.handler?.target ?? rel(file),
        purpose:
          r.doc ||
          (r.handler && r.handler.name !== '<inline handler>'
            ? humanize(r.handler.name)
            : humanize(r.path.split('/').filter(Boolean).pop() ?? '')),
        routeFile: rel(file),
        line: r.line,
        origin,
      });
    }

    for (const mount of parsed.mounts) {
      visit(mount.target, joinPath(prefix, mount.path), effective, `${origin} → ${mount.name}`);
    }
  }

  for (const mount of serverMounts) {
    if (mount.target) visit(mount.target, mount.path, [], mount.ident);
  }

  endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return endpoints;
}

/* ------------------------------------------------------------------ */
/* Model parsing                                                       */
/* ------------------------------------------------------------------ */

function inferType(value) {
  const v = value.trim();
  const typeField = v.match(/\btype\s*:\s*([^,\n}]+)/);
  let t = typeField ? typeField[1].trim() : '';

  if (!t) {
    if (v.startsWith('[')) t = 'Array';
    else if (v.startsWith('{')) t = 'Object';
    else {
      const short = v.match(/^(String|Number|Boolean|Date|Buffer|Map|mongoose\.Schema\.Types\.Mixed|Schema\.Types\.Mixed)/);
      if (short) t = short[1];
    }
  }

  if (v.startsWith('[')) t = `Array${typeField ? '' : ''}`;
  if (t === '{' || t === '}') t = 'Object';
  return t
    .replace(/mongoose\.Schema\.Types\./g, '')
    .replace(/Schema\.Types\./g, '')
    .replace(/^['"`]|['"`]$/g, '')
    .trim();
}

function parseModelFile(file) {
  const raw = read(file);
  const code = stripComments(raw);

  const modelDecl = code.match(
    /mongoose\s*\.\s*model\s*\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z0-9_$]+)/
  );
  const modelName = modelDecl?.[1] ?? path.basename(file, '.js');
  const schemaVar = modelDecl?.[2];

  let schemaStart = -1;
  if (schemaVar) {
    const re = new RegExp(
      `(?:const|let|var)\\s+${schemaVar}\\s*=\\s*new\\s+(?:mongoose\\.)?Schema\\s*\\(`
    );
    const m = code.match(re);
    if (m) schemaStart = m.index;
  }
  if (schemaStart === -1) {
    schemaStart = code.search(/new\s+(?:mongoose\.)?Schema\s*\(\s*\{/);
  }
  if (schemaStart === -1) return null;

  const braceIdx = code.indexOf('{', schemaStart);
  if (braceIdx === -1) return null;
  const end = findClosing(code, braceIdx);
  if (end === -1) return null;

  const body = code.slice(braceIdx + 1, end);
  const fields = [];

  for (const entry of splitTopLevel(body)) {
    const keyMatch = entry.match(/^([A-Za-z0-9_$]+)\s*:\s*([\s\S]*)$/);
    if (!keyMatch) continue;
    const [, name, value] = keyMatch;
    if (name === 'timestamps' || name === 'versionKey') continue;

    const ref = value.match(/\bref\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? '';
    const required = /\brequired\s*:\s*(true|\[|\(|function|['"])/.test(value)
      ? 'yes'
      : /\brequired\s*:\s*false/.test(value)
        ? 'no'
        : '';
    const def = value.match(/\bdefault\s*:\s*([^,\n}]+)/)?.[1]?.trim() ?? '';
    const enums = value.match(/\benum\s*:\s*\[([^\]]*)\]/)?.[1];
    const hasIndex = /\bindex\s*:\s*true/.test(value);
    const unique = /\bunique\s*:\s*true/.test(value);

    const bits = [];
    if (ref) bits.push(`ref: \`${ref}\``);
    if (required) bits.push(`required: ${required}`);
    if (def && def !== 'undefined') bits.push(`default: ${snippet(def, 34)}`);
    if (enums) bits.push(`enum: ${snippet(enums.split(',').map((s) => s.trim()).join(' | '), 60)}`);
    if (unique) bits.push('unique');
    if (hasIndex) bits.push('index');

    fields.push({ name, type: inferType(value) || '—', notes: bits.join('; ') });
  }

  const after = code.slice(end);
  const optionsMatch = after.match(/^\s*,\s*\{([^}]*)\}/);
  const options = optionsMatch ? optionsMatch[1].replace(/\s+/g, ' ').trim() : '';

  const hooks = [];
  const hookRe = /\.(pre|post)\s*\(\s*['"]([^'"]+)['"]/g;
  let hm;
  while ((hm = hookRe.exec(code))) {
    const before = code.slice(Math.max(0, hm.index - 120), hm.index);
    if (!schemaVar || before.includes(schemaVar)) hooks.push(`${hm[1]}('${hm[2]}')`);
  }

  const indexes = [];
  const idxRe = /\.index\s*\(\s*(\{[^}]*\})/g;
  let im;
  while ((im = idxRe.exec(code))) {
    const before = code.slice(Math.max(0, im.index - 120), im.index);
    if (!schemaVar || before.includes(schemaVar)) indexes.push(im[1].replace(/\s+/g, ' '));
  }

  return {
    file: rel(file),
    model: modelName,
    fields,
    options,
    hooks: [...new Set(hooks)],
    indexes: [...new Set(indexes)],
  };
}

/* ------------------------------------------------------------------ */
/* Controller parsing                                                  */
/* ------------------------------------------------------------------ */

function parseControllerFile(file) {
  const raw = read(file);
  const code = stripComments(raw);
  const imports = parseImports(code);

  const fns = new Set();
  for (const m of code.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) fns.add(m[1]);
  for (const m of code.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) fns.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const piece of m[1].split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) fns.add(name);
    }
  }

  const models = [...imports.entries()]
    .filter(([, imp]) => /models\//i.test(imp.source))
    .map(([local]) => local);

  return { file: rel(file), functions: [...fns].sort(), models: [...new Set(models)] };
}

/* ------------------------------------------------------------------ */
/* Cron parsing                                                        */
/* ------------------------------------------------------------------ */

function parseCronFiles(files) {
  const jobs = [];
  for (const file of files) {
    const raw = read(file);
    const code = stripComments(raw);
    const lines = raw.split('\n');

    for (const m of code.matchAll(/cron\s*\.\s*schedule\s*\(/g)) {
      const open = m.index + m[0].length - 1;
      const close = findClosing(code, open);
      if (close === -1) continue;
      const args = splitTopLevel(code.slice(open + 1, close));
      const expr = (args[0] ?? '').replace(/^['"`]|['"`]$/g, '');
      const line = code.slice(0, m.index).split('\n').length;

      let name = '';
      let j = line - 2;
      const commentLines = [];
      while (j >= 0) {
        const t = lines[j].trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) {
          commentLines.unshift(t);
          j--;
          continue;
        }
        break;
      }
      name =
        commentLines
          .map((l) => l.replace(/^\/\/\s*|^\/\*\*?\s*|^\*\s*|\*\/$/g, '').trim())
          .filter((l) => l && !/^[=\-_*#\s]+$/.test(l))[0] ?? '';
      if (!name) {
        const after = code.slice(close, close + 400);
        const called = after.match(/await\s+([A-Za-z0-9_$]+)\s*\(/)?.[1];
        name = called ? humanize(called) : path.basename(file, '.js');
      }

      jobs.push({ file: rel(file), schedule: expr, line, name, kind: 'node-cron' });
    }
  }
  return jobs;
}

/* ------------------------------------------------------------------ */
/* Redis parsing                                                       */
/* ------------------------------------------------------------------ */

function parseRedisKeys(files) {
  const keys = [];
  for (const file of files) {
    const raw = read(file);
    const lines = raw.split('\n');

    lines.forEach((line, i) => {
      const constMatch = line.match(/([A-Z][A-Z0-9_]*)\s*=\s*['"]([a-zA-Z0-9:_\-{}]+)['"]/);
      if (constMatch && /key|prefix|channel|lock|drop|circuit|paused/i.test(constMatch[1])) {
        keys.push({ file: rel(file), line: i + 1, name: constMatch[1], pattern: constMatch[2] });
      }
      const templ = line.match(/`([^`]*\$\{[^`]*)`/);
      if (
        templ &&
        /^[a-z][a-z0-9_-]*:/i.test(templ[1]) &&
        !/require\(|import |console/.test(line)
      ) {
        keys.push({ file: rel(file), line: i + 1, name: 'dynamic', pattern: snippet(templ[1], 70) });
      }
    });
  }

  const unique = new Map();
  for (const k of keys) {
    const id = `${k.file}|${k.pattern}`;
    if (!unique.has(id)) unique.set(id, k);
  }
  return [...unique.values()];
}

/* ------------------------------------------------------------------ */
/* Markdown rendering                                                  */
/* ------------------------------------------------------------------ */

const MARKER_RE = (id) =>
  new RegExp(`(<!-- AUTO:START:${id} -->)[\\s\\S]*?(<!-- AUTO:END:${id} -->)`);

function writeBlock(id, content) {
  const start = `<!-- AUTO:START:${id} -->`;
  const end = `<!-- AUTO:END:${id} -->`;
  const payload = `${start}\n${content.trim()}\n${end}`;

  const target = path.join(DOCS, BLOCK_FILES[id]);
  if (!exists(target)) return { file: target, changed: false, missing: true };

  const current = read(target);
  const re = MARKER_RE(id);
  if (!re.test(current)) return { file: target, changed: false, missingMarker: true };

  const next = current.replace(re, payload);
  if (next === current) return { file: target, changed: false };
  if (!CHECK) fs.writeFileSync(target, next, 'utf8');
  return { file: target, changed: true };
}

const BLOCK_FILES = {
  api: '01-API-REFERENCE.md',
  models: '02-MODELS.md',
  controllers: '03-CONTROLLERS.md',
  cron: '04-CRON-JOBS.md',
  redis: '05-REDIS.md',
  middleware: '06-MIDDLEWARES-AUTH.md',
};

function renderApi(endpoints) {
  const groups = new Map();
  for (const e of endpoints) {
    const parts = e.path.split('/').filter(Boolean);
    const take = parts[0] === 'api' && parts[1] === 'v1' ? 3 : 2;
    const group = parts.slice(0, take).join('/') || 'root';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(e);
  }

  const lines = [];
  lines.push(`**Total endpoints: ${endpoints.length}** — generated from \`server.js\` mounts and \`routes/**/*.js\`.`);
  lines.push('');

  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [group, items] of sorted) {
    lines.push(`### \`/${group}\``);
    lines.push('');
    lines.push('| Method | Path | Auth | Permission | Middleware | Handler | Purpose |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const e of items) {
      const mw = e.middleware.filter((n) => n !== e.handler).join(', ') || '—';
      const perms = e.permissions.length
        ? e.permissions.map((p) => `\`${p}\``).join('<br>')
        : '—';
      lines.push(
        `| ${e.method} | \`${cell(e.path)}\` | ${e.auth} | ${perms} | ${cell(mw)} | \`${cell(e.handler)}\` | ${cell(e.purpose)} |`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderModels(models) {
  const lines = [];
  lines.push(`**Total models: ${models.length}** — Mongoose schemas discovered under \`models/\`.`);
  lines.push('');

  for (const model of models.sort((a, b) => a.model.localeCompare(b.model))) {
    lines.push(`### \`${model.model}\``);
    lines.push('');
    lines.push(`Source: \`${model.file}\``);
    lines.push('');
    if (model.fields.length === 0) {
      lines.push('_No top-level fields detected (schema may be built dynamically)._');
      lines.push('');
      continue;
    }
    lines.push('| Field | Type | Constraints |');
    lines.push('|---|---|---|');
    for (const f of model.fields) {
      lines.push(`| \`${cell(f.name)}\` | ${cell(f.type)} | ${cell(f.notes) || '—'} |`);
    }
    lines.push('');
    const extras = [];
    if (model.options) extras.push(`Schema options: \`${snippet(model.options, 120)}\``);
    if (model.hooks.length) extras.push(`Hooks: ${model.hooks.map((h) => `\`${h}\``).join(', ')}`);
    if (model.indexes.length) extras.push(`Indexes: ${model.indexes.map((i) => `\`${i}\``).join(', ')}`);
    if (extras.length) {
      lines.push(extras.map((x) => `- ${x}`).join('\n'));
      lines.push('');
    }
  }
  return lines.join('\n');
}

function renderControllers(controllers, endpoints) {
  const usage = new Map();
  for (const e of endpoints) {
    if (!e.handler || e.handler === '—') continue;
    if (!usage.has(e.handler)) usage.set(e.handler, []);
    usage.get(e.handler).push(e);
  }

  const lines = [];
  lines.push(`**Total controller files: ${controllers.length}**`);
  lines.push('');
  lines.push('| Controller file | Exported functions | Models imported | Used by routes |');
  lines.push('|---|---|---|---|');
  for (const c of controllers.sort((a, b) => a.file.localeCompare(b.file))) {
    const routes = [...usage.entries()]
      .filter(([fn]) => c.functions.includes(fn))
      .flatMap(([, eps]) => eps)
      .map((e) => `${e.method} \`${e.path}\``);
    const short = [...new Set(routes)].slice(0, 6).join('<br>');
    const more = new Set(routes).size > 6 ? `<br>+${new Set(routes).size - 6} more` : '';
    lines.push(
      `| \`${cell(c.file)}\` | ${c.functions.map((f) => `\`${f}\``).join(', ') || '—'} | ${c.models.map((m) => `\`${m}\``).join(', ') || '—'} | ${short || '—'}${more} |`
    );
  }
  return lines.join('\n');
}

function renderCron(jobs, queues, workers) {
  const lines = [];
  lines.push('### node-cron schedules');
  lines.push('');
  lines.push('| Schedule | Frequency (human) | Job | File |');
  lines.push('|---|---|---|---|');
  for (const j of jobs.sort((a, b) => a.file.localeCompare(b.file))) {
    lines.push(
      `| \`${cell(j.schedule)}\` | ${cell(cronHuman(j.schedule))} | ${cell(j.name)} | \`${cell(j.file)}\` |`
    );
  }
  lines.push('');
  lines.push('### BullMQ queues');
  lines.push('');
  if (!queues.length) lines.push('_No queues discovered._');
  else {
    lines.push('| Queue | Purpose |');
    lines.push('|---|---|');
    for (const q of queues) lines.push(`| \`${cell(q.name)}\` | ${cell(q.note)} |`);
  }
  lines.push('');
  lines.push('### BullMQ workers');
  lines.push('');
  if (!workers.length) lines.push('_No workers discovered._');
  else {
    lines.push('| Worker | Queue | File |');
    lines.push('|---|---|---|');
    for (const w of workers) {
      lines.push(`| \`${cell(w.name)}\` | \`${cell(w.queue)}\` | \`${cell(w.file)}\` |`);
    }
  }
  return lines.join('\n');
}

function cronHuman(expr) {
  const map = {
    '* * * * *': 'every minute',
    '*/5 * * * *': 'every 5 minutes',
    '0 * * * *': 'hourly, on the hour',
    '0 */2 * * *': 'every 2 hours',
    '0 0,4,8,12,16,20 * * *': 'every 4 hours (00:00, 04:00, 08:00, 12:00, 16:00, 20:00)',
    '0 2 * * *': 'daily at 02:00',
    '0 1 * * *': 'daily at 01:00',
    '5 0 * * *': 'daily at 00:05',
    '10 0 1 * *': 'monthly, 1st at 00:10',
    '58 23 * * *': 'daily at 23:58',
    '0 8 * * *': 'daily at 08:00',
    '0 2 0 * * *': '6-field cron: 02:00:00 daily (node-cron seconds syntax)',
  };
  return map[expr] ?? expr;
}

function renderRedis(entries) {
  const lines = [];
  lines.push('| Key / pattern | Where | File |');
  lines.push('|---|---|---|');
  for (const e of entries.sort((a, b) => a.pattern.localeCompare(b.pattern))) {
    lines.push(`| \`${cell(e.pattern)}\` | \`${cell(e.name)}\` | \`${cell(e.file)}\`:${e.line} |`);
  }
  return lines.join('\n');
}

function renderMiddleware(entries) {
  const lines = [];
  lines.push('| Middleware file | Exports |');
  lines.push('|---|---|');
  for (const m of entries.sort((a, b) => a.file.localeCompare(b.file))) {
    lines.push(`| \`${cell(m.file)}\` | ${m.exports.map((x) => `\`${x}\``).join(', ') || '—'} |`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Scanner helpers for queues / workers                                */
/* ------------------------------------------------------------------ */

function parseQueues() {
  const dir = path.join(ROOT, 'src', 'notification');
  const out = [];
  const seen = new Set();
  const push = (name, note) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, note });
  };

  const enumsFile = path.join(dir, 'constants', 'enums.js');
  const queueMap = new Map();
  if (exists(enumsFile)) {
    const code = stripComments(read(enumsFile));
    const block = code.match(/QUEUE_NAMES\s*=\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    for (const m of block.matchAll(/([A-Z0-9_]+)\s*:\s*['"]([^'"]+)['"]/g)) {
      queueMap.set(m[1], m[2]);
    }
  }

  const queueFile = path.join(dir, 'queues', 'index.js');
  if (exists(queueFile)) {
    const code = stripComments(read(queueFile));
    for (const m of code.matchAll(/new\s+Queue\s*\(\s*(?:QUEUE_NAMES\.([A-Z0-9_]+)|['"]([^'"]+)['"])/g)) {
      const name = m[2] ?? queueMap.get(m[1]) ?? m[1];
      push(name, 'system queue');
    }
  }

  const tierLabels = ['critical', 'high', 'normal', 'low', 'bulk'];
  for (const channel of ['email', 'whatsapp', 'push']) {
    for (const tier of tierLabels) push(`${channel}_${tier}`, 'priority tier queue');
  }

  return out;
}

function parseWorkers() {
  const dir = path.join(ROOT, 'src', 'notification', 'workers');
  const out = [];
  const channelFor = (name) =>
    name.includes('email') ? 'email' : name.includes('whatsapp') ? 'whatsapp' : name.includes('push') ? 'push' : null;

  const enumsFile = path.join(ROOT, 'src', 'notification', 'constants', 'enums.js');
  const queueMap = new Map();
  if (exists(enumsFile)) {
    const block = stripComments(read(enumsFile)).match(/QUEUE_NAMES\s*=\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    for (const m of block.matchAll(/([A-Z0-9_]+)\s*:\s*['"]([^'"]+)['"]/g)) queueMap.set(m[1], m[2]);
  }

  for (const file of walk(dir)) {
    const name = path.basename(file, '.js');
    const code = stripComments(read(file));
    const channel = channelFor(name);
    for (const m of code.matchAll(/new\s+Worker\s*\(\s*([A-Za-z0-9_$.]+)/g)) {
      const ref = m[1];
      let queue;
      if (channel && /tier/i.test(name)) queue = `${channel}_<tier>`;
      else if (ref.startsWith('QUEUE_NAMES.')) queue = queueMap.get(ref.split('.')[1]) ?? ref.split('.')[1];
      else queue = ref.split('.').pop();
      out.push({ name, queue, file: rel(file) });
      break;
    }
  }
  return out;
}

function parseMiddlewareFiles() {
  const dirs = [path.join(ROOT, 'middlewares'), path.join(ROOT, 'src', 'notification', 'middleware')];
  const out = [];
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      const code = stripComments(read(file));
      const exports = new Set();
      for (const m of code.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) exports.add(m[1]);
      for (const m of code.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) exports.add(m[1]);
      for (const m of code.matchAll(/export\s+default\s+([A-Za-z0-9_$]+)/g)) exports.add(`default (${m[1]})`);
      for (const m of code.matchAll(/export\s*\{([^}]+)\}/g)) {
        for (const p of m[1].split(',')) exports.add(p.trim().split(/\s+as\s+/).pop());
      }
      const note = precedingDoc(read(file), 0) || '';
      out.push({ file: rel(file), exports: [...exports].filter(Boolean).sort(), note });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main() {
  if (!exists(DOCS)) fs.mkdirSync(DOCS, { recursive: true });

  const endpoints = collectEndpoints();
  const models = walk(path.join(ROOT, 'models'))
    .map(parseModelFile)
    .filter(Boolean);
  const controllers = walk(path.join(ROOT, 'controllers')).map(parseControllerFile);

  const cronFiles = [
    ...walk(path.join(ROOT, 'cron')),
    ...walk(path.join(ROOT, 'controllers', 'attandance', 'crons')),
    path.join(ROOT, 'controllers', 'attandance', 'attendanceAutoClose.job.js'),
    path.join(ROOT, 'models', 'Attandance', 'Holiydaycron.js'),
    path.join(ROOT, 'src', 'notification', 'scheduler', 'subscriptionReminder.js'),
  ].filter(exists);

  const jobs = parseCronFiles(cronFiles);
  const queues = parseQueues();
  const workers = parseWorkers();

  const redisFiles = walk(path.join(ROOT, 'src', 'notification', 'utils'))
    .concat(walk(path.join(ROOT, 'src', 'notification', 'priority')))
    .concat(walk(path.join(ROOT, 'src', 'notification', 'scheduler')))
    .concat([path.join(ROOT, 'config', 'redis.js')])
    .filter(exists);

  const redisKeys = parseRedisKeys(redisFiles);
  const middleware = parseMiddlewareFiles();

  const results = [
    writeBlock('api', renderApi(endpoints)),
    writeBlock('models', renderModels(models)),
    writeBlock('controllers', renderControllers(controllers, endpoints)),
    writeBlock('cron', renderCron(jobs, queues, workers)),
    writeBlock('redis', renderRedis(redisKeys)),
    writeBlock('middleware', renderMiddleware(middleware)),
  ];

  const problems = results.filter((r) => r.missing || r.missingMarker);
  for (const p of problems) {
    console.warn(`⚠️  ${rel(p.file)} is missing or has no markers.`);
  }

  const changed = results.filter((r) => r.changed);
  if (CHECK) {
    if (changed.length) {
      console.error(`❌ Docs are stale: ${changed.map((r) => rel(r.file)).join(', ')}`);
      process.exit(1);
    }
    console.log('✅ Docs are up to date.');
    return;
  }

  console.log(`✅ Regenerated ${changed.length ? changed.map((r) => rel(r.file)).join(', ') : 'nothing (already current)'}`);
  console.log(`   endpoints=${endpoints.length} models=${models.length} controllers=${controllers.length} cron=${jobs.length} redis=${redisKeys.length}`);
}

main();

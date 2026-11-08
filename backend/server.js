'use strict';
// Training-Log backend
// Same API as before (/api/plans, /api/sessions), plus:
//  - a copy of the data file before every write (BACKUP_DIR, keeps BACKUP_KEEP copies)
//  - atomic writes (tmp file + rename)
//  - never overwrites data it could not read (unreadable file -> 500, nothing written)
//  - refuses writes that would wipe a plan's exercise list
//  - /api/health checks that real data is there (used by the Docker healthcheck)

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT        = process.env.PORT        || 3001;
const DATA_FILE   = process.env.DATA_FILE   || '/data/training-log.json';
const BACKUP_DIR  = process.env.BACKUP_DIR  || path.join(path.dirname(DATA_FILE), 'backups');
const BACKUP_KEEP = parseInt(process.env.BACKUP_KEEP || '60', 10);

function emptyData() {
  return {
    plans: {
      A: { name: 'Oberkörper', exercises: [] },
      B: { name: 'Unterkörper', exercises: [] }
    },
    sessions: []
  };
}

// Returns the data. Only a missing file yields the empty default.
// A file that exists but cannot be parsed throws, so nothing gets written over it.
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return emptyData();
  const raw  = fs.readFileSync(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !data.plans || !Array.isArray(data.sessions)) {
    throw new Error('Data file has unexpected structure');
  }
  return data;
}

function backupCurrent() {
  if (!fs.existsSync(DATA_FILE)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `training-log-${stamp}.json`));
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => /^training-log-.*\.json$/.test(f))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  backupCurrent();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(status === 204 ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const [rawPath, query = ''] = req.url.split('?');
  const url    = rawPath.replace(/\/$/, '');
  const method = req.method;

  if (method === 'GET' && (url === '/health' || url === '/api/health')) {
    try {
      const d = loadData();
      const counts = Object.fromEntries(
        Object.entries(d.plans).map(([k, p]) => [k, (p.exercises || []).length])
      );
      const ok = Object.values(counts).length > 0 && Object.values(counts).every(n => n > 0);
      return send(res, ok ? 200 : 503, { ok, exercises: counts, sessions: d.sessions.length });
    } catch (e) {
      return send(res, 503, { ok: false, error: e.message });
    }
  }

  let data;
  try {
    data = loadData();
  } catch (e) {
    console.error('Cannot read data file:', e.message);
    return send(res, 500, { error: 'Data file unreadable – nothing was changed' });
  }

  if (method === 'GET' && url === '/api/plans') {
    return send(res, 200, data.plans);
  }

  const planMatch = url.match(/^\/api\/plans\/([A-Za-z0-9_-]+)\/exercises$/);
  if (method === 'PUT' && planMatch) {
    const planId = planMatch[1];
    if (!data.plans[planId]) return send(res, 404, { error: 'Unknown plan' });
    const body = await readBody(req);
    if (!Array.isArray(body)) return send(res, 400, { error: 'Array expected' });
    const before = (data.plans[planId].exercises || []).length;
    if (body.length === 0 && before > 1) {
      return send(res, 409, { error: `Refusing to clear plan ${planId} (${before} exercises)` });
    }
    data.plans[planId].exercises = body;
    saveData(data);
    return send(res, 200, data.plans[planId]);
  }

  if (method === 'GET' && url === '/api/sessions') {
    const qs    = new URLSearchParams(query);
    const plan  = qs.get('plan');
    const limit = parseInt(qs.get('limit') || '100', 10);
    let list = data.sessions;
    if (plan) list = list.filter(s => s.plan === plan);
    return send(res, 200, list.slice(-limit));
  }

  if (method === 'POST' && url === '/api/sessions') {
    const body = await readBody(req);
    if (!body.plan || !body.date || !Array.isArray(body.sets)) {
      return send(res, 400, { error: 'plan, date, sets required' });
    }
    const session = {
      id: Date.now(),
      plan: body.plan,
      date: body.date,
      note: body.note || '',
      sets: body.sets
    };
    data.sessions.push(session);
    saveData(data);
    return send(res, 201, session);
  }

  const delMatch = url.match(/^\/api\/sessions\/(\d+)$/);
  if (method === 'DELETE' && delMatch) {
    const id  = parseInt(delMatch[1], 10);
    const idx = data.sessions.findIndex(s => s.id === id);
    if (idx === -1) return send(res, 404, { error: 'Not found' });
    data.sessions.splice(idx, 1);
    saveData(data);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    console.error(e);
    if (!res.headersSent) send(res, 400, { error: e.message });
  });
});

server.listen(PORT, () =>
  console.log(`Training-Log backend on :${PORT}, data: ${DATA_FILE}, backups: ${BACKUP_DIR} (keep ${BACKUP_KEEP})`)
);

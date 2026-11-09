// Backend: serves the static front end, the painting images, and a small JSON API.
// Uses only built-in Node modules (http, fs, path, node:sqlite) - no npm install needed (Node 22.13+).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ART_DIR = path.join(__dirname, 'art');
const db = new DatabaseSync(path.join(__dirname, 'art.db'));

// Columns the form may change. PaintingID (the primary key) is intentionally NOT in this list.
const EDITABLE = {
  ArtistID: 'int', GalleryID: 'int', ShapeID: 'int',
  Title: 'text', ImageFileName: 'text', Description: 'text', Excerpt: 'text',
  YearOfWork: 'int', Width: 'int', Height: 'int', Medium: 'text',
  Cost: 'real', MSRP: 'real', AccessionNumber: 'text', CopyrightText: 'text',
  MuseumLink: 'text', WikiLink: 'text', GoogleLink: 'text', GoogleDescription: 'text'
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml'
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => {
      const type = req.headers['content-type'] || '';
      try {
        if (type.includes('application/json')) resolve(JSON.parse(body || '{}'));
        else resolve(Object.fromEntries(new URLSearchParams(body))); // plain HTML form post
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, baseDir, relPath) {
  const filePath = path.normalize(path.join(baseDir, relPath));
  if (!filePath.startsWith(baseDir)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

// SELECT: every painting (just what the icon list needs)
function getAllPaintings() {
  return db.prepare(`
    SELECT p.PaintingID, p.Title, p.ImageFileName, a.FirstName, a.LastName
    FROM Paintings p LEFT JOIN Artists a ON a.ArtistID = p.ArtistID
    ORDER BY p.Title`).all();
}

// SELECT: one painting with all of its columns
function getPainting(id) {
  return db.prepare('SELECT * FROM Paintings WHERE PaintingID = ?').get(id);
}

// UPDATE: build the query from whitelisted columns only, with bound parameters
function updatePainting(id, data) {
  const sets = [], values = [];
  for (const [col, type] of Object.entries(EDITABLE)) {
    if (!(col in data)) continue;
    let v = data[col];
    if (v === '' || v === null) v = null;
    else if (type === 'int') { v = parseInt(v, 10); if (Number.isNaN(v)) throw new Error(`${col} must be a whole number`); }
    else if (type === 'real') { v = parseFloat(v); if (Number.isNaN(v)) throw new Error(`${col} must be a number`); }
    if ((col === 'Title' || col === 'ImageFileName') && !v) throw new Error(`${col} is required`);
    sets.push(`${col} = ?`); values.push(v);
  }
  if (!sets.length) throw new Error('No editable fields supplied');
  const info = db.prepare(`UPDATE Paintings SET ${sets.join(', ')} WHERE PaintingID = ?`).run(...values, id);
  return info.changes;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);
  try {
    if (p === '/api/paintings' && req.method === 'GET') return sendJson(res, 200, getAllPaintings());

    if (p === '/api/lookups' && req.method === 'GET') {
      return sendJson(res, 200, {
        artists: db.prepare("SELECT ArtistID, COALESCE(FirstName || ' ', '') || LastName AS Name FROM Artists ORDER BY LastName").all(),
        galleries: db.prepare('SELECT GalleryID, GalleryName FROM Galleries ORDER BY GalleryName').all(),
        shapes: db.prepare('SELECT ShapeID, ShapeName FROM Shapes ORDER BY ShapeID').all()
      });
    }

    const m = p.match(/^\/api\/paintings\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (req.method === 'GET') {
        const row = getPainting(id);
        return row ? sendJson(res, 200, row) : sendJson(res, 404, { error: 'Painting not found' });
      }
      if (req.method === 'PUT' || req.method === 'POST') { // form action posts here
        const changes = updatePainting(id, await readBody(req));
        return changes ? sendJson(res, 200, { ok: true, painting: getPainting(id) })
                       : sendJson(res, 404, { error: 'Painting not found' });
      }
    }

    if (p.startsWith('/art/')) return serveFile(res, ART_DIR, p.slice(5));
    return serveFile(res, PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1));
  } catch (err) {
    console.error(err);
    sendJson(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));

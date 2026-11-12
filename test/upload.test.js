// POST /api/upload (docs/upload-and-import.md step 2): guardrails.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-upload-'));
process.env.MUSIC_DIR = root;
process.env.IMPORT_DIR = 'import';
process.env.ENABLE_UPLOAD = 'true';
process.env.UPLOAD_MAX_MB = '0.05';            // 52 KB: the fixtures fit, the big one doesn't
const { app, uploadName } = require('../src/app');
const mp3 = fs.readFileSync(path.join(__dirname, 'fixtures', 'silence.mp3'));
const flac = fs.readFileSync(path.join(__dirname, 'fixtures', 'silence.flac'));
const imp = path.join(root, 'import');

let base, server;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const up = (name, body) => fetch(`${base}/api/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
const leftovers = () => (fs.existsSync(imp) ? fs.readdirSync(imp) : []).filter(f => f.startsWith('.upload-'));

test('uploadName: base name only, no control chars or leading dots', () => {
    assert.equal(uploadName('../../etc/evil.mp3'), 'evil.mp3');
    assert.equal(uploadName('C:\\Users\\k\\song.flac'), 'song.flac');
    assert.equal(uploadName('..hidden.mp3'), 'hidden.mp3');
    assert.equal(uploadName('a\u0000b\nc.mp3'), 'abc.mp3');
    assert.equal(uploadName(''), '');
});

test('GET /api/upload reports it is on', async () => {
    const j = await (await fetch(`${base}/api/upload`)).json();
    assert.equal(j.enabled, true);
    assert.equal(j.importPath, 'import');
});

test('mp3 + flac: saved into the import folder (created on first upload), bytes intact, 0664', async () => {
    assert.equal(fs.existsSync(imp), false);
    let r = await up('01 - Silence.mp3', mp3);
    assert.equal(r.status, 200);
    let j = await r.json();
    assert.equal(j.saved.path, 'import/01 - Silence.mp3');
    assert.deepEqual(fs.readFileSync(path.join(imp, '01 - Silence.mp3')), mp3);
    assert.equal(fs.statSync(path.join(imp, '01 - Silence.mp3')).mode & 0o777, 0o664);
    r = await up('02 - Silence.flac', flac);
    assert.equal(r.status, 200);
    assert.ok(fs.existsSync(path.join(imp, '02 - Silence.flac')));
    assert.deepEqual(leftovers(), []);
});

test('the same name again never overwrites: " (2)", " (3)"', async () => {
    assert.equal((await (await up('01 - Silence.mp3', mp3)).json()).saved.name, '01 - Silence (2).mp3');
    assert.equal((await (await up('01 - Silence.mp3', mp3)).json()).saved.name, '01 - Silence (3).mp3');
});

test('path tricks land in the import folder as a base name', async () => {
    const j = await (await up('../../outside.mp3', mp3)).json();
    assert.equal(j.saved.path, 'import/outside.mp3');
    assert.equal(fs.existsSync(path.join(root, 'outside.mp3')), false);
    assert.equal(fs.existsSync(path.join(path.dirname(root), 'outside.mp3')), false);
});

test('refused: wrong type, not audio inside, too big, empty, no name; nothing left behind', async () => {
    assert.equal((await up('notes.txt', Buffer.from('hello'))).status, 415);
    assert.equal((await up('fake.mp3', Buffer.alloc(4000, 'x'))).status, 415);
    assert.equal((await up('big.mp3', Buffer.concat(Array(15).fill(mp3)))).status, 413);
    assert.equal((await up('empty.mp3', Buffer.alloc(0))).status, 400);
    assert.equal((await fetch(`${base}/api/upload`, { method: 'POST', body: mp3 })).status, 400);
    for (const f of ['notes.txt', 'fake.mp3', 'big.mp3', 'empty.mp3']) assert.equal(fs.existsSync(path.join(imp, f)), false, f);
    assert.deepEqual(leftovers(), []);
});

test('the listing shows uploaded files and hides uploads in progress', async () => {
    fs.writeFileSync(path.join(imp, '.upload-abc123.mp3'), mp3);
    const j = await (await fetch(`${base}/api/files?path=import`)).json();
    const names = j.items.map(i => i.name + (i.extension || ''));   // the listing gives the name without extension
    assert.ok(names.includes('01 - Silence.mp3'));
    assert.ok(!names.some(n => n.startsWith('.upload-')));
});

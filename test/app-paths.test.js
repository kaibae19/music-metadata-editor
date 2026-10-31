// Every route that touches files stays inside MUSIC_DIR (a temp dir here).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-music-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-outside-'));
fs.mkdirSync(path.join(root, 'Artist', 'Album'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'fixtures', 'silence.mp3'), path.join(root, 'Artist', 'Album', '01 - a.mp3'));
fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
process.env.MUSIC_DIR = root;
const { app, getFullPath } = require('../src/app');

let base, server;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const rel = path.relative(root, outside);   // "../mme-outside-xxxx"

test('getFullPath: inside is fine, outside throws', () => {
    assert.equal(getFullPath('Artist/Album'), path.join(root, 'Artist', 'Album'));
    assert.equal(getFullPath('/Artist'), path.join(root, 'Artist'));
    assert.equal(getFullPath(''), root);
    assert.throws(() => getFullPath('../etc'), /outside the music folder/);
    assert.throws(() => getFullPath('Artist/../../etc'), /outside/);
    assert.throws(() => getFullPath(`../${path.basename(root)}2/x`), /outside/);   // the "/music2" prefix trick
});

test('listing outside the music folder: 400', async () => {
    const r = await fetch(`${base}/api/files?path=${encodeURIComponent(rel)}`);
    assert.equal(r.status, 400);
    assert.ok((await fetch(`${base}/api/files?path=Artist`)).ok);
});

test('reading tags outside the music folder: 400', async () => {
    const r = await fetch(`${base}/api/metadata/${encodeURIComponent(`${rel}/secret.txt`)}`);
    assert.equal(r.status, 400);
});

test('rename cannot move a file out, or rename from outside', async () => {
    assert.equal((await post('/api/file/rename', { oldPath: 'Artist/Album/01 - a.mp3', newName: `../../../${path.basename(outside)}/stolen` })).status, 400);
    assert.equal((await post('/api/file/rename', { oldPath: `${rel}/secret.txt`, newName: 'x.txt' })).status, 400);
    assert.equal((await post('/api/directory/rename', { oldPath: 'Artist', newName: '../Escaped' })).status, 400);
    assert.equal((await post('/api/directory/rename', { oldPath: '', newName: 'x' })).status, 400);
    assert.ok(fs.existsSync(path.join(root, 'Artist', 'Album', '01 - a.mp3')));
    assert.ok(fs.existsSync(path.join(outside, 'secret.txt')));
});

test('a normal rename still works', async () => {
    const r = await post('/api/file/rename', { oldPath: 'Artist/Album/01 - a.mp3', newName: '01 - b' });
    assert.equal(r.status, 200);
    assert.ok(fs.existsSync(path.join(root, 'Artist', 'Album', '01 - b.mp3')));
});

test('delete outside the music folder: refused, file still there', async () => {
    const r = await post('/api/file/delete', { filePath: `${rel}/secret.txt` });
    assert.notEqual(r.status, 200);
    assert.ok(fs.existsSync(path.join(outside, 'secret.txt')));
});

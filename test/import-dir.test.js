// The import folder shortcut (docs/upload-and-import.md step 1): IMPORT_DIR stays inside MUSIC_DIR.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-import-'));
process.env.MUSIC_DIR = root;
process.env.IMPORT_DIR = '/Incoming/new/';   // leading/trailing slashes are trimmed
const { app, IMPORT_DIR } = require('../src/app');

let base, server;
test.before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

test('IMPORT_DIR resolves inside the music folder', () => {
    assert.equal(IMPORT_DIR.rel, 'Incoming/new');
    assert.equal(IMPORT_DIR.full, path.join(root, 'Incoming', 'new'));
});

test('/api/import: exists false until the folder is there, then true; never created by a read', async () => {
    let j = await (await fetch(`${base}/api/import`)).json();
    assert.deepEqual(j, { enabled: true, path: 'Incoming/new', exists: false });
    assert.equal(fs.existsSync(path.join(root, 'Incoming')), false);
    fs.mkdirSync(path.join(root, 'Incoming', 'new'), { recursive: true });
    j = await (await fetch(`${base}/api/import`)).json();
    assert.equal(j.exists, true);
    assert.ok((await fetch(`${base}/api/files?path=${encodeURIComponent(j.path)}`)).ok);
});

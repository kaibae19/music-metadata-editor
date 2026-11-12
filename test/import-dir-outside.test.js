// An IMPORT_DIR that would land outside the music folder (or on it) turns the shortcut off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.MUSIC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-import-out-'));
process.env.IMPORT_DIR = '../elsewhere';
const { app, IMPORT_DIR } = require('../src/app');

test('outside the music folder: off', async () => {
    assert.equal(IMPORT_DIR, null);
    const server = app.listen(0); await new Promise(r => server.once('listening', r));
    const j = await (await fetch(`http://127.0.0.1:${server.address().port}/api/import`)).json();
    server.close();
    assert.deepEqual(j, { enabled: false });
});

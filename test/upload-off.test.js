// Upload is off by default.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.MUSIC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-upload-off-'));
delete process.env.ENABLE_UPLOAD;
const { app } = require('../src/app');

test('ENABLE_UPLOAD unset: GET says off, POST is refused, nothing written', async () => {
    const server = app.listen(0); await new Promise(r => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const j = await (await fetch(`${base}/api/upload`)).json();
    const r = await fetch(`${base}/api/upload?name=a.mp3`, { method: 'POST', body: Buffer.from('x') });
    server.close();
    assert.equal(j.enabled, false);
    assert.equal(r.status, 403);
    assert.equal(fs.existsSync(path.join(process.env.MUSIC_DIR, 'import')), false);
});

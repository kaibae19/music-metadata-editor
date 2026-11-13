// Cross-site guard (src/app.js, 2026-11-12): no CSRF from a page the user visits, no DNS rebinding with ALLOWED_HOSTS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-xsite-'));
process.env.MUSIC_DIR = root;
process.env.IMPORT_DIR = 'import';
process.env.ENABLE_UPLOAD = 'true';
process.env.ALLOWED_HOSTS = 'editor.example:8080';   // 127.0.0.1 not listed: loopback must pass anyway
const { app, uploadName } = require('../src/app');
const mp3 = fs.readFileSync(path.join(__dirname, 'fixtures', 'silence.mp3'));
fs.mkdirSync(path.join(root, 'Artist'));
fs.copyFileSync(path.join(__dirname, 'fixtures', 'silence.mp3'), path.join(root, 'Artist', 'keep.mp3'));

let server, port;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); port = server.address().port; });
test.after(() => server.close());

// raw http (fetch won't let us set Host, and real browsers set Origin/Sec-Fetch-Site themselves)
function req(method, url, headers = {}, body) {
    return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
            let data = ''; res.on('data', c => (data += c)); res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        r.on('error', reject);
        if (body) r.write(body);
        r.end();
    });
}
const upload = (name, headers) => req('POST', `/api/upload?name=${encodeURIComponent(name)}`, { 'content-type': 'application/octet-stream', 'content-length': mp3.length, ...headers }, mp3);
const imported = () => (fs.existsSync(path.join(root, 'import')) ? fs.readdirSync(path.join(root, 'import')) : []);

test('a page on another site cannot upload (Origin of another host)', async () => {
    const r = await upload('evil.mp3', { origin: 'http://evil.example' });
    assert.equal(r.status, 403);
    assert.ok(!imported().includes('evil.mp3'));
});

test('a page on another site cannot upload (Sec-Fetch-Site: cross-site / same-site)', async () => {
    assert.equal((await upload('x1.mp3', { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await upload('x2.mp3', { 'sec-fetch-site': 'same-site' })).status, 403);
    assert.deepEqual(imported().filter(f => /^x\d/.test(f)), []);
});

test('text/plain (a "simple" cross-origin request, no preflight) is refused', async () => {
    const r = await req('POST', '/api/upload?name=plain.mp3', { 'content-type': 'text/plain', 'content-length': mp3.length }, mp3);
    assert.equal(r.status, 415);
    assert.ok(!imported().includes('plain.mp3'));
});

test('a garbage Origin is refused', async () => {
    assert.equal((await upload('g.mp3', { origin: 'null' })).status, 403);
});

test('the editor\'s own page can upload (same-origin)', async () => {
    const r = await upload('ok.mp3', { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' });
    assert.equal(r.status, 200, r.body);
    assert.ok(imported().includes('ok.mp3'));
});

test('no browser headers at all (curl, a LAN script) still works', async () => {
    assert.equal((await upload('curl.mp3')).status, 200);
});

test('the guard covers the other changing routes too (delete)', async () => {
    const body = JSON.stringify({ path: 'Artist/keep.mp3' });
    const r = await req('POST', '/api/file/delete', { origin: 'http://evil.example', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, body);
    assert.equal(r.status, 403);
    assert.ok(fs.existsSync(path.join(root, 'Artist', 'keep.mp3')));
});

test('ALLOWED_HOSTS: an unlisted Host (DNS rebinding) cannot even read the library', async () => {
    const r = await req('GET', '/api/files?path=', { host: 'rebind.attacker.example' });
    assert.equal(r.status, 403);
    assert.equal((await req('GET', '/api/files?path=', { host: 'editor.example:8080' })).status, 200);
    assert.equal((await req('GET', '/api/files?path=', { host: 'editor.example:9999' })).status, 403);   // port pinned
    assert.equal((await req('GET', '/api/files?path=')).status, 200);                                   // loopback (health check)
    assert.equal((await req('GET', '/health', { host: 'localhost:3000' })).status, 200);
});

test('uploadName drops invisible direction marks that could disguise the extension', () => {
    assert.equal(uploadName('song‮gpj.mp3'), 'songgpj.mp3');
    assert.equal(uploadName('﻿a​b⁦.flac'), 'ab.flac');
});

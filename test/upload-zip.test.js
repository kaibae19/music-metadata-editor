// POST /api/upload/zip (src/upload-zip.js): the audio inside a zip, into its own folder; hostile zips refused.
// The zips are built here byte by byte (zipOf), so each trick is exact: slip names, links, bombs, encrypted entries.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-zip-'));
process.env.MUSIC_DIR = root;
process.env.IMPORT_DIR = 'import';
process.env.ENABLE_UPLOAD = 'true';
process.env.UPLOAD_MAX_MB = '0.05';           // 52 KB per unpacked file: the fixtures fit, "big" doesn't
process.env.UPLOAD_ZIP_MAX_MB = '1';          // 1 MB zip, 2 MB unpacked in total
delete process.env.ALLOWED_HOSTS;
const { app } = require('../src/app');
const { ZIP_MAX_ENTRIES } = require('../src/upload-zip');
const mp3 = fs.readFileSync(path.join(__dirname, 'fixtures', 'silence.mp3'));
const flac = fs.readFileSync(path.join(__dirname, 'fixtures', 'silence.flac'));
const imp = path.join(root, 'import');

// ---- a minimal zip writer: { name, data, method: 0|8, attrs (unix mode), encrypted, declaredSize } per entry
function zipOf(entries) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const e of entries) {
        const name = Buffer.from(e.name, 'utf8');
        const data = e.data || Buffer.alloc(0);
        const method = e.method ?? 0;
        let body = method === 8 ? zlib.deflateRawSync(data) : data;
        if (e.encrypted) body = Buffer.concat([Buffer.alloc(12, 0x5a), body]);   // traditional encryption: a 12-byte header first
        const crc = zlib.crc32(data);
        const size = e.declaredSize ?? data.length;
        const flags = 0x0800 | (e.encrypted ? 1 : 0);                       // UTF-8 names (+ encrypted)
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
        lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(name.length, 26);
        locals.push(lh, name, body);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8);
        ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(size, 24);
        ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(((e.attrs ?? 0o100644) << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
        centrals.push(ch, name);
        offset += 30 + name.length + body.length;
    }
    const cd = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
}

let base, server;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const up = (name, body, headers = {}) => fetch(`${base}/api/upload/zip?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body });
const ls = (...p) => (fs.existsSync(path.join(imp, ...p)) ? fs.readdirSync(path.join(imp, ...p)).sort() : []);
const hidden = () => ls().filter(f => f.startsWith('.upload-'));
const outsideFiles = () => fs.readdirSync(root).filter(f => f !== 'import');

test('GET /api/upload reports the zip limit', async () => {
    const j = await (await fetch(`${base}/api/upload`)).json();
    assert.equal(j.zipMaxBytes, 1024 * 1024);
});

test('an album zip: audio unpacked into its own folder, shared top folder dropped, junk skipped', async () => {
    const zip = zipOf([
        { name: 'Double Live/', data: Buffer.alloc(0) },
        { name: 'Double Live/01 - Callin Baton Rouge.mp3', data: mp3 },
        { name: 'Double Live/02 - Two Piña Coladas.flac', data: flac, method: 8 },
        { name: 'Double Live/cover.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) },
        { name: '__MACOSX/Double Live/._01 - Callin Baton Rouge.mp3', data: Buffer.from('apple double') },
    ]);
    const r = await up('Garth Brooks - Double Live.zip', zip);
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.folder.path, 'import/Garth Brooks - Double Live');
    assert.deepEqual(j.saved.map(s => s.path).sort(), [
        'import/Garth Brooks - Double Live/01 - Callin Baton Rouge.mp3',
        'import/Garth Brooks - Double Live/02 - Two Piña Coladas.flac']);
    assert.deepEqual(fs.readFileSync(path.join(imp, 'Garth Brooks - Double Live', '01 - Callin Baton Rouge.mp3')), mp3);
    assert.deepEqual(fs.readFileSync(path.join(imp, 'Garth Brooks - Double Live', '02 - Two Piña Coladas.flac')), flac);
    assert.deepEqual(j.skipped.map(s => s.why).sort(), ['macOS metadata', 'not an audio file']);
    assert.equal(fs.statSync(path.join(imp, 'Garth Brooks - Double Live', '01 - Callin Baton Rouge.mp3')).mode & 0o777, 0o664);
    assert.deepEqual(hidden(), []);
});

test('disc folders are kept; the same zip again gets "(2)", never merged', async () => {
    const zip = zipOf([{ name: 'Disc 1/01.mp3', data: mp3 }, { name: 'Disc 2/01.mp3', data: mp3 }]);
    let j = await (await up('Live.zip', zip)).json();
    assert.equal(j.folder.path, 'import/Live');
    assert.deepEqual(ls('Live'), ['Disc 1', 'Disc 2']);
    j = await (await up('Live.zip', zip)).json();
    assert.equal(j.folder.path, 'import/Live (2)');
    assert.deepEqual(ls('Live', 'Disc 1'), ['01.mp3']);
});

test('the same name twice in one folder of the zip: both kept', async () => {
    const j = await (await up('Twice.zip', zipOf([{ name: 'a/01.mp3', data: mp3 }, { name: 'a/01.mp3', data: mp3 }]))).json();
    assert.deepEqual(ls('Twice'), ['01 (2).mp3', '01.mp3']);
    assert.equal(j.saved.length, 2);
});

for (const evil of ['../evil.mp3', '../../evil.mp3', '/tmp/evil.mp3', 'a/../../evil.mp3', 'a\\..\\..\\evil.mp3', 'C:/evil.mp3']) {
    test(`zip slip refused: ${JSON.stringify(evil)}`, async () => {
        const before = ls();
        const r = await up('slip.zip', zipOf([{ name: 'ok.mp3', data: mp3 }, { name: evil, data: mp3 }]));
        assert.ok([400, 415].includes(r.status), `status ${r.status}`);
        assert.deepEqual(ls(), before);                                     // no folder, nothing half-done
        assert.deepEqual(outsideFiles(), []);
        assert.ok(!fs.existsSync('/tmp/evil.mp3') || fs.statSync('/tmp/evil.mp3').mtimeMs < Date.now() - 60000);
    });
}

test('a link inside the zip is never unpacked', async () => {
    const r = await up('links.zip', zipOf([{ name: 'song.mp3', data: mp3 }, { name: 'link.mp3', data: Buffer.from('/etc/passwd'), attrs: 0o120777 }]));
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.deepEqual(ls('links'), ['song.mp3']);
    assert.match(j.skipped[0].why, /link/);
    const only = await up('onlylink.zip', zipOf([{ name: 'link.mp3', data: Buffer.from('/etc/passwd'), attrs: 0o120777 }]));
    assert.equal(only.status, 422);
    assert.deepEqual(ls().filter(f => f.startsWith('onlylink')), []);
});

test('a zip bomb is refused before anything is unpacked', async () => {
    const before = ls();
    const r = await up('bomb.zip', zipOf([{ name: 'bomb.wav', data: Buffer.alloc(3 * 1024 * 1024), method: 8 }]));
    const j = await r.json();
    assert.equal(r.status, 400);
    assert.match(j.error, /zip bomb/);
    assert.deepEqual(ls(), before);
    assert.deepEqual(hidden(), []);
});

test('a header that lies about the size is caught while unpacking', async () => {
    const before = ls();
    const r = await up('liar.zip', zipOf([{ name: 'a.mp3', data: mp3 }, { name: 'b.mp3', data: mp3, declaredSize: 100 }]));
    assert.ok([400, 413, 415].includes(r.status), `status ${r.status}`);   // yauzl may already refuse it while reading the index
    assert.deepEqual(ls(), before);
    assert.deepEqual(hidden(), []);
});

test('per-file and entry-count limits', async () => {
    const big = Buffer.concat([mp3, crypto().randomBytes(60 * 1024)]);   // random: doesn't compress, over 52 KB
    let j = await (await up('sizes.zip', zipOf([{ name: 'ok.mp3', data: mp3 }, { name: 'big.mp3', data: big }]))).json();
    assert.deepEqual(ls('sizes'), ['ok.mp3']);
    assert.match(j.skipped[0].why, /larger than/);
    const many = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({ name: `n${i}.txt` }));
    const r = await up('many.zip', zipOf(many));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /more than/);
});

test('encrypted entries and fake audio are skipped; none usable → 422, no folder', async () => {
    let r = await up('mixed.zip', zipOf([{ name: 'real.mp3', data: mp3 }, { name: 'secret.mp3', data: mp3, encrypted: true }, { name: 'fake.mp3', data: Buffer.from('not audio at all') }]));
    let j = await r.json();
    assert.equal(r.status, 200);
    assert.deepEqual(ls('mixed'), ['real.mp3']);
    assert.deepEqual(j.skipped.map(s => s.why).sort(), ['encrypted', 'not a readable audio file']);
    r = await up('allfake.zip', zipOf([{ name: 'fake.mp3', data: Buffer.from('not audio at all') }]));
    assert.equal(r.status, 422);
    assert.deepEqual(ls().filter(f => f.startsWith('allfake')), []);
    assert.deepEqual(hidden(), []);
});

test('not a zip, wrong name, wrong type, too big, cross-site: refused, nothing left', async () => {
    assert.equal((await up('notzip.zip', Buffer.from('hello, not a zip'))).status, 415);
    assert.equal((await up('album.rar', zipOf([{ name: 'a.mp3', data: mp3 }]))).status, 415);
    assert.equal((await up('plain.zip', zipOf([{ name: 'a.mp3', data: mp3 }]), { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await up('huge.zip', Buffer.alloc(1024 * 1024 + 10))).status, 413);
    assert.equal((await up('xsite.zip', zipOf([{ name: 'a.mp3', data: mp3 }]), { Origin: 'http://evil.example' })).status, 403);
    assert.deepEqual(ls().filter(f => /^(notzip|album|plain|huge|xsite)/.test(f)), []);
    assert.deepEqual(hidden(), []);
});

test('the file list never shows a folder that is still being unpacked', async () => {
    fs.mkdirSync(path.join(imp, '.upload-inprogress'));
    const j = await (await fetch(`${base}/api/files?path=import`)).json();
    assert.ok(!j.items.some(i => i.name.startsWith('.upload-')));
    fs.rmdirSync(path.join(imp, '.upload-inprogress'));
});

function crypto() { return require('node:crypto'); }

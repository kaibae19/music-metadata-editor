// M4A tags through node-taglib-sharp (src/metadata/mp4.js): written for real, read back, nothing else touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseFile } = require('music-metadata');
const MetadataWriter = require('../src/metadata/writer');

const fixture = path.join(__dirname, 'fixtures', 'silence.m4a');
const fresh = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-mp4-')); const f = path.join(d, '01 - x.m4a'); fs.copyFileSync(fixture, f); return f; };
const read = async f => (await parseFile(f)).common;
const w = new MetadataWriter();

test('fixture: an M4A with title/artist/album', async () => {
    const c = await read(fixture);
    assert.equal(c.title, 'Silence'); assert.equal(c.artist, 'Test'); assert.equal(c.album, 'Fixtures');
});

test('all plain fields: written and read back by another reader', async () => {
    const f = fresh();
    const r = await w.writeMetadata(f, { title: 'Around the World', artist: 'Disneyland Paris Chorus', album: 'Best of Disneyland Paris',
        albumartist: 'Various Artists', year: '2021', track: '3/12', genre: 'Soundtrack' });
    assert.deepEqual(r, { success: true, error: null });
    const c = await read(f);
    assert.equal(c.title, 'Around the World');
    assert.equal(c.artist, 'Disneyland Paris Chorus');
    assert.equal(c.album, 'Best of Disneyland Paris');
    assert.equal(c.albumartist, 'Various Artists');
    assert.equal(c.year, 2021);
    assert.deepEqual(c.track, { no: 3, of: 12 });
    assert.deepEqual(c.genre, ['Soundtrack']);
    const m = await parseFile(f);
    assert.equal(m.format.container.startsWith('M4A'), true);    // still a playable M4A container
});

test('only the given fields change; empty string removes', async () => {
    const f = fresh();
    assert.equal((await w.writeMetadata(f, { title: 'New title' })).success, true);
    let c = await read(f);
    assert.equal(c.title, 'New title'); assert.equal(c.artist, 'Test'); assert.equal(c.album, 'Fixtures');
    assert.equal((await w.writeMetadata(f, { album: '' })).success, true);
    c = await read(f);
    assert.equal(c.album, undefined); assert.equal(c.title, 'New title'); assert.equal(c.artist, 'Test');
});

test('unicode survives', async () => {
    const f = fresh();
    assert.equal((await w.writeMetadata(f, { title: 'Ça plane pour moi — 日本語 🎵', artist: 'Plastic Bertrand' })).success, true);
    assert.equal((await read(f)).title, 'Ça plane pour moi — 日本語 🎵');
});

test('bad year or track: refused before touching the file', async () => {
    const f = fresh();
    const before = fs.readFileSync(f);
    assert.equal((await w.writeMetadata(f, { year: 'last summer' })).success, false);
    assert.equal((await w.writeMetadata(f, { track: 'three' })).success, false);
    assert.deepEqual(fs.readFileSync(f), before);
    assert.deepEqual(fs.readdirSync(path.dirname(f)), ['01 - x.m4a']);   // no backup left behind
});

test('not really an M4A: error, file restored, no backup left', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-mp4-bad-'));
    const f = path.join(d, 'fake.m4a'); fs.writeFileSync(f, 'not an mp4');
    const r = await w.writeMetadata(f, { title: 'X' });
    assert.equal(r.success, false);
    assert.equal(fs.readFileSync(f, 'utf8'), 'not an mp4');
    assert.deepEqual(fs.readdirSync(d), ['fake.m4a']);
});

// FLAC tags through metaflac. Needs `metaflac` on PATH (test/Dockerfile has it); skipped otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const flac = require('../src/metadata/flac');
const MetadataWriter = require('../src/metadata/writer');

let have = true;
try { execFileSync('metaflac', ['--version']); } catch { have = false; }
const opts = { skip: have ? false : 'metaflac not installed' };

function copy() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-'));
    const f = path.join(d, 'a.flac');
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'silence.flac'), f);
    return f;
}

test('reads the existing tags (what metaflac-js2 1.0.8 never did)', opts, async () => {
    const t = await flac.readTags(copy());
    assert.deepEqual(t.TITLE, ['Old Title']);
    assert.deepEqual(t.ALBUM, ['Wrong Album']);
    assert.deepEqual(t.DESCRIPTION, ['keep me']);
});

test('writes only the named fields; everything else stays', opts, async () => {
    const f = copy();
    await flac.writeTags(f, { TITLE: 'New Title', MUSICBRAINZ_ALBUMID: 'aaa' });
    const t = await flac.readTags(f);
    assert.deepEqual(t.TITLE, ['New Title']);
    assert.deepEqual(t.MUSICBRAINZ_ALBUMID, ['aaa']);
    assert.deepEqual(t.ALBUM, ['Wrong Album']);
    assert.deepEqual(t.DESCRIPTION, ['keep me']);
});

test('writing again replaces, never duplicates; null removes; arrays repeat a field', opts, async () => {
    const f = copy();
    await flac.writeTags(f, { MUSICBRAINZ_TRACKID: 'r1' });
    await flac.writeTags(f, { MUSICBRAINZ_TRACKID: 'r2', description: null, ARTISTS: ['A', 'B'] });
    const t = await flac.readTags(f);
    assert.deepEqual(t.MUSICBRAINZ_TRACKID, ['r2']);
    assert.equal(t.DESCRIPTION, undefined);
    assert.deepEqual(t.ARTISTS, ['A', 'B']);
});

test('unicode and shell-looking values go through untouched; newlines and bad names are refused', opts, async () => {
    const f = copy();
    const v = "Nothin’ ’bout Love — $(rm -rf /) `x` ; ünï";
    await flac.writeTags(f, { TITLE: v });
    assert.deepEqual((await flac.readTags(f)).TITLE, [v]);
    await assert.rejects(flac.writeTags(f, { TITLE: 'a\nb' }), /newline/);
    await assert.rejects(flac.writeTags(f, { 'A=B': 'x' }), /bad field name/);
});

test('the editor’s plain FLAC save keeps tags it was not asked to change (regression: it used to wipe them)', opts, async () => {
    const f = copy();
    await flac.writeTags(f, { MUSICBRAINZ_ALBUMID: 'keep-this-release', REPLAYGAIN_TRACK_GAIN: '-6.1 dB' });
    const r = await new MetadataWriter().writeFLACMetadata(f, { title: 'Edited', genre: '' });
    assert.equal(r.success, true, r.error);
    const t = await flac.readTags(f);
    assert.deepEqual(t.TITLE, ['Edited']);
    assert.equal(t.GENRE, undefined);
    assert.deepEqual(t.ALBUM, ['Wrong Album']);
    assert.deepEqual(t.MUSICBRAINZ_ALBUMID, ['keep-this-release']);
    assert.deepEqual(t.REPLAYGAIN_TRACK_GAIN, ['-6.1 dB']);
    assert.deepEqual(t.DESCRIPTION, ['keep me']);
});

test('plain FLAC save: null (an empty number field in the form) keeps the track number and date; "" removes', opts, async () => {
    const f = copy();
    await flac.writeTags(f, { DATE: '2020' });
    const r = await new MetadataWriter().writeFLACMetadata(f, { title: 'T', track: null, year: null, genre: '' });
    assert.equal(r.success, true, r.error);
    const t = await flac.readTags(f);
    assert.deepEqual(t.TRACKNUMBER, ['1']);
    assert.deepEqual(t.DATE, ['2020']);
    assert.equal(t.GENRE, undefined);
});

test('a missing metaflac is a clear error, not a crash', async () => {
    const save = process.env.METAFLAC;
    const fresh = require.resolve('../src/metadata/flac');
    delete require.cache[fresh];
    process.env.METAFLAC = '/nonexistent/metaflac';
    try {
        const f2 = require('../src/metadata/flac');
        await assert.rejects(f2.readTags('/x.flac'), /not found \(install the flac package\)/);
    } finally {
        if (save === undefined) delete process.env.METAFLAC; else process.env.METAFLAC = save;
        delete require.cache[fresh];
    }
});

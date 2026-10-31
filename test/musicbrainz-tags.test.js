// MusicBrainz tags on real (tiny) MP3 and FLAC files: write, read back, rewrite, restore. FLAC needs metaflac.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const NodeID3 = require('node-id3');
const { normalizeRelease } = require('../src/musicbrainz/client');
const { buildFields, applyToFile, readMusicBrainzTags } = require('../src/metadata/musicbrainz-tags');
const flac = require('../src/metadata/flac');

const release = normalizeRelease(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mb-release-19682ee1.json'), 'utf8')));
let haveFlac = true; try { execFileSync('metaflac', ['--version']); } catch { haveFlac = false; }
const flacOpts = { skip: haveFlac ? false : 'metaflac not installed' };

function copy(ext) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-'));
    const f = path.join(d, `a${ext}`);
    fs.copyFileSync(path.join(__dirname, 'fixtures', `silence${ext}`), f);
    return f;
}

test('fields for track 3: the IDs Lidarr reads, lower-case type and status, names', () => {
    const f = buildFields(release, 1, 3);
    assert.equal(f.ids.albumId, '19682ee1-cf2a-4c67-aeef-4fa193cd6984');
    assert.equal(f.ids.releaseGroupId, '65ce38f2-19f7-444b-977f-5da5ffc0c33b');
    assert.equal(f.ids.recordingId, release.media[0].tracks[2].recordingId);
    assert.equal(f.ids.releaseTrackId, release.media[0].tracks[2].releaseTrackId);
    assert.deepEqual(f.ids.releaseType, ['ep']);
    assert.equal(f.ids.releaseStatus, 'official');
    assert.deepEqual({ t: f.names.title, n: f.names.track, of: f.names.trackTotal, d: f.names.disc, date: f.names.date }, { t: 'Smokey Joe of the Poconos', n: 3, of: 5, d: 1, date: '2020' });
    assert.equal(buildFields(release, 1, 3, { useNames: false }).names, null);
    assert.throws(() => buildFields(release, 2, 1), /no track 2-1/);
});

for (const ext of ['.mp3', '.flac']) {
    const opts = ext === '.flac' ? flacOpts : {};

    test(`${ext}: write + read back, names on`, opts, async () => {
        const file = copy(ext);
        const r = await applyToFile(file, buildFields(release, 1, 1));
        assert.equal(r.ok, true, JSON.stringify(r));
        const t = await readMusicBrainzTags(file);
        assert.equal(t.albumId, '19682ee1-cf2a-4c67-aeef-4fa193cd6984');
        assert.equal(t.recordingId, '642c466b-3247-4480-bcec-471461ff3c08');
        assert.equal(t.releaseTrackId, '094b09f9-12bd-4fcb-bf91-24852b2b54cc');
        assert.equal(t.releaseGroupId, '65ce38f2-19f7-444b-977f-5da5ffc0c33b');
        assert.equal(t.title, "Everything's Alright Mama");
        assert.equal(t.album, 'Gathering, Vol. 2: The Hunting Ground');
        assert.equal(t.track, 1);
    });

    test(`${ext}: names off keeps your title and album, adds only the IDs`, opts, async () => {
        const file = copy(ext);
        const r = await applyToFile(file, buildFields(release, 1, 2, { useNames: false }));
        assert.equal(r.ok, true, JSON.stringify(r));
        const t = await readMusicBrainzTags(file);
        assert.equal(t.title, 'Old Title');
        assert.equal(t.album, 'Wrong Album');
        assert.equal(t.recordingId, release.media[0].tracks[1].recordingId);
    });

    test(`${ext}: tagging again with another track replaces the IDs, never doubles them`, opts, async () => {
        const file = copy(ext);
        await applyToFile(file, buildFields(release, 1, 1));
        const r = await applyToFile(file, buildFields(release, 1, 4));
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal((await readMusicBrainzTags(file)).recordingId, release.media[0].tracks[3].recordingId);
        if (ext === '.mp3') {
            const t = NodeID3.read(file);
            assert.equal(t.uniqueFileIdentifier.filter(u => u.ownerIdentifier === 'http://musicbrainz.org').length, 1);
            assert.equal(t.userDefinedText.filter(x => x.description === 'MusicBrainz Album Id').length, 1);
        } else {
            assert.equal((await flac.readTags(file)).MUSICBRAINZ_TRACKID.length, 1);
        }
    });

    test(`${ext}: a read-back mismatch restores the file byte for byte`, opts, async () => {
        const file = copy(ext);
        const before = fs.readFileSync(file);
        const fields = buildFields(release, 1, 1);
        const sabotage = async f => { fs.appendFileSync(f, 'junk'); };   // writes nothing useful → read-back fails
        const r = await applyToFile(file, fields, { write: sabotage });
        assert.equal(r.ok, false);
        assert.match(r.error, /restored/);
        assert.ok(r.mismatches.some(m => m.startsWith('albumId')));
        assert.ok(before.equals(fs.readFileSync(file)));
    });
}

test('mp3: other TXXX frames and non-MusicBrainz UFIDs survive', async () => {
    const file = copy('.mp3');
    NodeID3.update({ userDefinedText: [{ description: 'Something Else', value: 'keep' }], uniqueFileIdentifier: [{ ownerIdentifier: 'http://example.org', identifier: Buffer.from('other') }] }, file);
    await applyToFile(file, buildFields(release, 1, 1));
    const t = NodeID3.read(file);
    assert.ok(t.userDefinedText.some(x => x.description === 'Something Else' && x.value === 'keep'));
    assert.ok(t.uniqueFileIdentifier.some(u => u.ownerIdentifier === 'http://example.org' && u.identifier.toString() === 'other'));
});

test('flac: other tags survive (ReplayGain, description)', flacOpts, async () => {
    const file = copy('.flac');
    await flac.writeTags(file, { REPLAYGAIN_TRACK_GAIN: '-6.1 dB' });
    await applyToFile(file, buildFields(release, 1, 1));
    const t = await flac.readTags(file);
    assert.deepEqual(t.REPLAYGAIN_TRACK_GAIN, ['-6.1 dB']);
    assert.deepEqual(t.DESCRIPTION, ['keep me']);
    assert.deepEqual(t.RELEASETYPE, ['ep']);
});

test('unsupported formats say so and leave the file alone', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mme-'));
    const f = path.join(d, 'a.m4a'); fs.writeFileSync(f, 'x');
    const r = await applyToFile(f, buildFields(release, 1, 1));
    assert.equal(r.ok, false);
    assert.match(r.error, /\.m4a isn't supported in MusicBrainz mode yet/);
    assert.equal(fs.readFileSync(f, 'utf8'), 'x');
});

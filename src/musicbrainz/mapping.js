// File: src/musicbrainz/mapping.js
// Pair local files with the tracks of a MusicBrainz release (normalized by client.js).
// Pass 1: disc + track number, unless the titles plainly disagree.
// Pass 2: title similarity (best pairs first).
// Pass 3: duration, only when exactly one remaining track is within the tolerance.
// Every pair says how it was made ("number", "title", "duration") so the UI can show it; the user can override any row.

const TITLE_OK = 0.6;          // similarity to accept a title match
const TITLE_CONFLICT = 0.35;   // below this, a number match with both titles present is treated as wrong
const DURATION_TOL_MS = 3000;

/** "3", "03", "3/12" → 3; also a leading number in the filename ("03 - Name.mp3", "1-03 Name.flac" → disc 1, track 3). */
function parseNumbers(file) {
    const n = v => { const m = String(v ?? '').match(/^\s*(\d+)/); return m ? parseInt(m[1], 10) : null; };
    let track = n(file.track), disc = n(file.disc);
    if (track == null && file.name) {
        const base = file.name.replace(/\.[^.]+$/, '');
        const dt = base.match(/^\s*(\d{1,2})[-.](\d{1,3})\b/);
        if (dt) { disc = disc ?? parseInt(dt[1], 10); track = parseInt(dt[2], 10); }
        else { const t = base.match(/^\s*(\d{1,3})\b/); if (t) track = parseInt(t[1], 10); }
    }
    return { track, disc: disc ?? 1 };
}

function normTitle(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/\.[a-z0-9]{2,4}$/, '')                              // extension, when the title came from a filename
        .replace(/^\s*\d{1,2}[-.]\d{1,3}\s*[-._ ]\s*|^\s*\d{1,3}\s*[-._ ]\s*/, '') // leading "03 - " / "1-03 "
        .replace(/[\(\[][^\)\]]*(feat|ft\.|with|remaster|version|edit|mix)[^\)\]]*[\)\]]/g, '')
        .replace(/\s(feat\.?|ft\.)\s.*$/, '')
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function similarity(a, b) {
    a = normTitle(a); b = normTitle(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const d = levenshtein(a, b);
    return 1 - d / Math.max(a.length, b.length);
}

function levenshtein(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}

/**
 * @param {Array<{path:string,name?:string,title?:string,track?:any,disc?:any,durationMs?:number}>} files
 * @param {object} release  normalized release (client.normalizeRelease)
 * @returns {{pairs: Array<{path, medium, position, by, titleScore}>, unmatchedFiles: string[], unmatchedTracks: Array<{medium, position, title}>}}
 */
function mapTracks(files, release) {
    const tracks = [];
    for (const m of release.media) for (const t of m.tracks) tracks.push({ ...t, medium: m.position });
    const free = new Set(tracks.map((_, i) => i));
    const pairs = [];
    const left = [];
    const take = (f, i, by) => { free.delete(i); pairs.push({ path: f.path, medium: tracks[i].medium, position: tracks[i].position, by, titleScore: round(similarity(f.title || f.name, tracks[i].title)) }); };

    // 1. numbers
    for (const f of files) {
        const { track, disc } = parseNumbers(f);
        const i = tracks.findIndex((t, k) => free.has(k) && t.position === track && t.medium === disc);
        const title = f.title || f.name;
        if (i >= 0 && !(title && similarity(title, tracks[i].title) < TITLE_CONFLICT && files.length > 1)) take(f, i, 'number');
        else left.push(f);
    }
    // 2. titles, best pairs first
    const cand = [];
    for (const f of left) for (const i of free) {
        const s = similarity(f.title || f.name, tracks[i].title);
        if (s >= TITLE_OK) cand.push({ f, i, s });
    }
    cand.sort((a, b) => b.s - a.s);
    const done = new Set();
    for (const { f, i } of cand) if (!done.has(f) && free.has(i)) { done.add(f); take(f, i, 'title'); }
    // 3. duration, unique candidate only
    for (const f of left) {
        if (done.has(f) || !f.durationMs) continue;
        const near = [...free].filter(i => tracks[i].lengthMs && Math.abs(tracks[i].lengthMs - f.durationMs) <= DURATION_TOL_MS);
        if (near.length === 1) { done.add(f); take(f, near[0], 'duration'); }
    }
    const mapped = new Set(pairs.map(p => p.path));
    return {
        pairs: pairs.sort((a, b) => a.medium - b.medium || a.position - b.position),
        unmatchedFiles: files.filter(f => !mapped.has(f.path)).map(f => f.path),
        unmatchedTracks: [...free].map(i => ({ medium: tracks[i].medium, position: tracks[i].position, title: tracks[i].title })),
    };
}

const round = x => Math.round(x * 100) / 100;

module.exports = { mapTracks, parseNumbers, normTitle, similarity };

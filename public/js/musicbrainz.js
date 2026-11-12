// File: public/js/musicbrainz.js
// MusicBrainz mode (docs/musicbrainz-mode.md): look the album up on MusicBrainz, pick the edition, map files to
// tracks, preview, write the IDs Lidarr reads. Works on the Ctrl-selected files, or on every MP3/FLAC/M4A in the folder.
// Everything shown is built with textContent (no HTML from file names or MusicBrainz reaches innerHTML).

(() => {
    const SUPPORTED = ['.mp3', '.flac', '.m4a'];
    const el = (tag, attrs = {}, ...kids) => {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') e.className = v;
            else if (k === 'text') e.textContent = v;
            else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
            else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
        return e;
    };
    const mmss = ms => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '');
    const base = p => p.split('/').pop();
    const api = async (url, body) => {
        const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        return data;
    };
    const FIELD_NAMES = {
        albumId: 'MusicBrainz release', releaseGroupId: 'MusicBrainz release group', artistId: 'MusicBrainz artist',
        albumArtistId: 'MusicBrainz album artist', recordingId: 'MusicBrainz recording', releaseTrackId: 'MusicBrainz release track',
        releaseStatus: 'Release status', releaseCountry: 'Release country', title: 'Title', artist: 'Artist', album: 'Album',
        albumartist: 'Album artist', track: 'Track', disc: 'Disc',
    };

    class MusicBrainzPanel {
        constructor(editor) {
            this.editor = editor;
            this.button = document.getElementById('mbLookupBtn');
            this.button.addEventListener('click', () => this.open());
        }

        /** Ctrl-selected MP3/FLAC/M4A files, else every one of those in the current folder. */
        targetFiles() {
            const isOk = p => SUPPORTED.some(x => p.toLowerCase().endsWith(x));
            const picked = [...this.editor.selectedItems].filter(k => k.startsWith('file:')).map(k => k.slice(5)).filter(isOk);
            if (picked.length) return picked;
            return (this.editor.currentItems || []).filter(i => i.type === 'file' && isOk(i.path)).map(i => i.path);
        }

        /** Why there's nothing to look up: other audio formats here (M4A …) are named, not blamed on the selection. */
        noFilesMessage() {
            const sel = [...this.editor.selectedItems].filter(k => k.startsWith('file:')).map(k => k.slice(5));
            const pool = sel.length ? sel : (this.editor.currentItems || []).filter(i => i.type === 'file').map(i => i.path);
            const other = {};
            for (const p of pool) {
                const ext = (p.match(/\.[^./]+$/) || [''])[0].toLowerCase();
                if (ext && !SUPPORTED.includes(ext)) other[ext] = (other[ext] || 0) + 1;
            }
            const list = Object.entries(other).map(([ext, n]) => `${n} ${ext.slice(1).toUpperCase()} file${n === 1 ? '' : 's'}`);
            if (list.length) return `MusicBrainz mode works on ${(n => n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1])(SUPPORTED.map(x => x.slice(1).toUpperCase()))}; ` +
                `${sel.length ? 'the selection has' : 'this folder has'} ${list.join(', ')} (not supported here yet)`;
            return 'MusicBrainz: no MP3, FLAC or M4A files here (select some, or open an album folder)';
        }

        async open() {
            this.files = this.targetFiles();
            if (!this.files.length) { this.editor.setStatus(this.noFilesMessage(), 'error'); return; }
            this.useNames = true;
            this.dialog = el('dialog', { class: 'mb-dialog', onclose: () => this.dialog.remove() });
            this.body = el('div', { class: 'mb-body' });
            this.dialog.append(
                el('div', { class: 'mb-head' },
                    el('h3', { text: '🎼 Look up on MusicBrainz' }),
                    el('button', { class: 'mb-x', title: 'Close', text: '✕', onclick: () => this.dialog.close() })),
                this.body);
            document.body.append(this.dialog);
            this.dialog.showModal();
            let artist = '', album = '';
            try {
                const m = await api('/api/metadata/' + encodeURIComponent(this.files[0]));
                artist = m.common.albumartist || m.common.artist || '';
                album = m.common.album || '';
            } catch { /* empty search fields are fine */ }
            this.showSearch(artist, album);
        }

        step(title, ...content) {
            this.body.replaceChildren(el('div', { class: 'mb-step', text: title }), ...content);
        }

        busy(text) { this.step(text, el('div', { class: 'mb-busy', text: 'Working…' })); }

        error(e, back) {
            this.step('Something went wrong', el('div', { class: 'mb-warn mb-err', text: e.message }),
                el('div', { class: 'mb-actions' }, el('button', { class: 'btn-secondary', text: '← Back', onclick: back })));
        }

        showSearch(artist, album, results) {
            const a = el('input', { type: 'text', value: artist, placeholder: 'Artist' });
            const b = el('input', { type: 'text', value: album, placeholder: 'Album' });
            const q = el('input', { type: 'text', placeholder: 'or a MusicBrainz release URL / ID, or a search like barcode:…' });
            const go = async () => {
                const raw = q.value.trim();
                if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw)) return this.match(raw, () => this.showSearch(a.value, b.value));
                this.busy('Searching MusicBrainz…');
                try {
                    const r = await api(`/api/mb/search?${new URLSearchParams({ artist: a.value, album: b.value, tracks: this.files.length, query: raw })}`);
                    this.showSearch(a.value, b.value, r.results);
                } catch (e) { this.error(e, () => this.showSearch(a.value, b.value)); }
            };
            for (const i of [a, b, q]) i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
            const list = results ? (results.length
                ? el('div', { class: 'mb-results' }, results.map(r => el('button', {
                    class: 'mb-result' + (r.trackCount === this.files.length ? ' mb-fit' : ''),
                    onclick: () => this.match(r.id, () => this.showSearch(a.value, b.value, results)),
                },
                el('div', { class: 'mb-r1' }, el('strong', { text: r.title }), ' — ', r.artist, r.disambiguation ? el('span', { class: 'mb-muted', text: ` (${r.disambiguation})` }) : null),
                el('div', { class: 'mb-r2 mb-muted', text: [
                    `${r.trackCount} tracks${r.trackCount === this.files.length ? ' ✓' : ''}`,
                    r.formats.join(' + '), r.date, r.country, r.label, [r.type, ...r.secondaryTypes].filter(Boolean).join(' + '), r.status,
                ].filter(Boolean).join(' · ') }))))
                : el('div', { class: 'mb-muted', text: 'Nothing found. Try fewer words, or paste the release URL from musicbrainz.org.' }))
                : null;
            this.step(`Find the edition for ${this.files.length} file(s)`,
                el('div', { class: 'mb-form' }, a, b, q, el('button', { class: 'btn-primary', text: 'Search', onclick: go })),
                list);
            (results ? q : a).focus();
        }

        async match(releaseId, back) {
            this.busy('Reading the files and the release…');
            try {
                this.m = await api('/api/mb/match', { files: this.files, release: releaseId });
                this.back = back;
                this.showMatch();
            } catch (e) { this.error(e, back); }
        }

        showMatch() {
            const { release, files, pairs, warnings } = this.m;
            const tracks = release.media.flatMap(m => m.tracks.map(t => ({ ...t, medium: m.position })));
            const label = t => `${release.discTotal > 1 ? `${t.medium}-` : ''}${t.position}. ${t.title}${t.lengthMs ? ` (${mmss(t.lengthMs)})` : ''}`;
            const byPath = new Map(pairs.map(p => [p.path, p]));
            this.selects = files.map(f => {
                const p = byPath.get(f.path);
                const s = el('select', { 'data-path': f.path, class: p ? '' : 'mb-none' },
                    el('option', { value: '', text: '— leave this file alone —' }),
                    tracks.map(t => el('option', { value: `${t.medium}-${t.position}`, text: label(t), selected: p && p.medium === t.medium && p.position === t.position })));
                s.addEventListener('change', () => { s.className = s.value ? '' : 'mb-none'; dupCheck(); });
                return { f, p, s };
            });
            const dup = el('div', { class: 'mb-warn mb-err', style: 'display:none' });
            const next = el('button', { class: 'btn-primary', text: 'Preview →', onclick: () => this.preview() });
            const dupCheck = () => {
                const v = this.selects.map(x => x.s.value).filter(Boolean);
                const d = v.length !== new Set(v).size;
                dup.style.display = d ? '' : 'none'; dup.textContent = d ? 'Two files point at the same track.' : '';
                next.disabled = d || !v.length;
            };
            const names = el('input', { type: 'checkbox', checked: this.useNames, onchange: e => { this.useNames = e.target.checked; } });
            this.step(`${release.title} — ${release.albumArtist}`,
                el('div', { class: 'mb-muted', text: [`${release.trackCount} tracks`, release.media.map(m => m.format).filter(Boolean).join(' + '), release.date, release.country, release.label, [release.type, ...release.secondaryTypes].filter(Boolean).join(' + '), release.status].filter(Boolean).join(' · ') }),
                el('a', { href: `https://musicbrainz.org/release/${release.id}`, target: '_blank', rel: 'noopener', class: 'mb-link', text: 'Open on musicbrainz.org ↗' }),
                warnings.map(w => el('div', { class: 'mb-warn', text: w })),
                el('table', { class: 'mb-table' },
                    el('thead', {}, el('tr', {}, el('th', { text: 'File' }), el('th', { text: 'Track on this edition' }), el('th', { text: 'Matched by' }))),
                    el('tbody', {}, this.selects.map(({ f, p, s }) => el('tr', {},
                        el('td', { title: f.path, text: base(f.path) }), el('td', {}, s),
                        el('td', { class: 'mb-muted', text: p ? p.by : '—' }))))),
                dup,
                el('label', { class: 'mb-check' }, names, ' Use MusicBrainz names (title, artist, album, track and disc numbers, date)'),
                el('div', { class: 'mb-actions' },
                    el('button', { class: 'btn-secondary', text: '← Other edition', onclick: this.back }), next));
            dupCheck();
        }

        mapping() {
            return this.selects.filter(x => x.s.value).map(x => { const [medium, position] = x.s.value.split('-').map(Number); return { path: x.f.path, medium, position }; });
        }

        async preview() {
            this.busy('Comparing…');
            try {
                const r = await api('/api/mb/preview', { release: this.m.release.id, mapping: this.mapping(), useNames: this.useNames });
                const total = r.files.reduce((n, f) => n + f.changes.length, 0);
                const skipped = this.selects.length - r.files.length;
                this.step(`Preview: ${total} change(s) in ${r.files.filter(f => f.changes.length).length} of ${r.files.length} file(s)${skipped ? `, ${skipped} left alone` : ''}`,
                    r.warnings.map(w => el('div', { class: 'mb-warn', text: w })),
                    el('div', { class: 'mb-preview' }, r.files.map(f => el('details', { open: r.files.length <= 3 },
                        el('summary', {}, base(f.path), el('span', { class: 'mb-muted', text: ` → track ${f.position}${f.medium > 1 ? ` (disc ${f.medium})` : ''} · ${f.changes.length ? `${f.changes.length} change(s)` : 'already right'}` })),
                        f.changes.length ? el('table', { class: 'mb-table mb-diff' }, el('tbody', {}, f.changes.map(c => el('tr', {},
                            el('td', { text: FIELD_NAMES[c.field] || c.field }),
                            el('td', { class: 'mb-from', text: c.from ?? '—' }),
                            el('td', { class: 'mb-to', text: c.to ?? '—' }))))) : null))),
                    el('div', { class: 'mb-actions' },
                        el('button', { class: 'btn-secondary', text: '← Back', onclick: () => this.showMatch() }),
                        el('button', { class: 'btn-primary', text: total ? `Write tags to ${r.files.length} file(s)` : 'Nothing to write', disabled: !total, onclick: () => this.apply() })));
            } catch (e) { this.error(e, () => this.showMatch()); }
        }

        async apply() {
            this.busy('Writing and checking each file…');
            try {
                const r = await api('/api/mb/apply', { release: this.m.release.id, mapping: this.mapping(), useNames: this.useNames });
                const bad = r.results.filter(x => !x.ok);
                this.step(bad.length ? `${bad.length} of ${r.results.length} file(s) failed (those were restored)` : `Done: ${r.results.length} file(s) tagged and checked`,
                    el('ul', { class: 'mb-done' }, r.results.map(x => el('li', { class: x.ok ? 'mb-ok' : 'mb-bad' },
                        `${x.ok ? '✓' : '✗'} ${base(x.path)}`, x.ok ? null : el('div', { class: 'mb-muted', text: [x.error, ...(x.mismatches || [])].join(' · ') })))),
                    el('div', { class: 'mb-muted', text: 'Lidarr picks the edition from these IDs once the artist is in its library.' }),
                    el('div', { class: 'mb-actions' }, el('button', { class: 'btn-primary', text: 'Close', onclick: () => this.dialog.close() })));
                this.editor.setStatus(bad.length ? `MusicBrainz: ${bad.length} file(s) failed` : `MusicBrainz: ${r.results.length} file(s) tagged`, bad.length ? 'error' : 'success');
                this.editor.clearSelection();
                this.editor.loadFiles(this.editor.currentPath);
            } catch (e) { this.error(e, () => this.showMatch()); }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (window.metadataEditor) new MusicBrainzPanel(window.metadataEditor);
    });
})();

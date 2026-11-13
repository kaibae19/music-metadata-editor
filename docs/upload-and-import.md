# Upload and import folder (design)

Status: **steps 1–3 built**: the folder filter, the 📥 Import shortcut (`IMPORT_DIR`) and `POST /api/upload` (2026-11-11), and the upload screen (2026-11-12; `public/js/upload.js`). Upload stays off by default. The README documents these settings (its Settings section). Step 4 (Lidarr hand-off) is design; the `LIDARR_*` settings below don't exist yet.

## Why

The editor's job is to get music files into a state Lidarr can import. Today, getting a new file *to* the editor is the
slow part, especially when the editor runs on a server: copy the file to the server, move it into the music folder with
the right owner, find it in the editor, tag it, save it, then go to Lidarr, open Unmapped Files and rescan.

This design adds two optional pieces:

1. **Upload:** drag files onto the editor in the browser; they're saved into an **import folder** and opened there,
   ready for MusicBrainz lookup and save.
2. **Hand to Lidarr (optional):** after saving, ask Lidarr to import that folder, so a file for an artist Lidarr already
   has goes straight into the library.

Both are **off by default**. Without them the editor works exactly as now: it browses the music folder on disk, and any
way of putting files there (a share, `scp`, a download client) keeps working. Both together are fine too.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `IMPORT_DIR` | `import` | Import folder, **relative to `MUSIC_DIR`** (so it's always inside the music folder and the editor can browse it). Created on first upload. Empty = off (no 📥 Import button). |
| `ENABLE_UPLOAD` | `false` | Show the upload area and accept `POST /api/upload`. |
| `UPLOAD_MAX_MB` | `500` | Per-file size limit. |
| `LIDARR_URL` | unset | e.g. `http://lidarr:8686`. Unset = the editor never talks to Lidarr. |
| `LIDARR_API_KEY` | unset | Lidarr → Settings → General → API Key. Read from the environment (or a Docker secret file), never shown in the UI or logged. |
| `LIDARR_IMPORT_PATH` | `/import` | The same import folder **as Lidarr's container sees it** (see "Lidarr setup"). |

## Upload

- **UI (built 2026-11-12, `public/js/upload.js`):** with `ENABLE_UPLOAD=true`, a "⬆️ Upload" button after 📥 Import
  and a drop area over the file list (files, or whole folders: walked up to 4 levels, flattened into the import folder).
  The browser skips what the server would refuse anyway (not an audio extension, a `.zip` with an "unzip it first" hint,
  over `UPLOAD_MAX_MB`, empty) before sending anything. Files go one at a time (XHR, for upload progress) with one
  progress bar and "Uploading 3 of 12: name (45%)". Then a summary panel (stays until closed) names what was skipped or
  refused and why, and says when a name already existed ("… (2)", nothing overwritten); the import folder opens with
  the new files selected, ready for 🎼 MusicBrainz. Tested headless (Chromium, Playwright): picker, synthetic drop,
  duplicate name, mixed bag; 20 checks.
- **Endpoint (built 2026-11-11):** one file per request, the raw bytes as the body (no multipart parser, no new
  dependency): `POST /api/upload?name=<original file name>` → `200 { saved: { name, path, size, container } }`, or
  `400` (no name / empty), `403` (upload off / no import folder), `413` (too big), `415` (not an audio type, or the
  bytes don't parse as audio). `GET /api/upload` → `{ enabled, maxBytes, extensions, importPath }` for the UI.
  The UI sends several files as several requests.
- **Guardrails** (the editor has no login; anyone who can reach it can upload while the setting is on):
  - only the audio extensions the editor lists (`.mp3 .flac .m4a .aac .ogg .wav`), checked by extension *and* by
    parsing the file (`music-metadata`), so a renamed non-audio file is rejected;
  - `UPLOAD_MAX_MB` per file; streamed to a hidden temp file (`.upload-…`, not shown in the listing) inside
    `IMPORT_DIR`, then linked/renamed into place (no half files; nothing left behind on any refusal);
  - the stored name is the original's base name only, with path separators and control characters removed; it goes
    through the same `getFullPath()` check as every other path (must stay inside `MUSIC_DIR`);
  - **never overwrite:** an existing name gets ` (2)`, ` (3)`, …;
  - files are written with the process's user and a `0664` mode, so the *arr containers (usually the same PUID/PGID)
    can move them;
  - put the editor behind your reverse proxy's auth if it's reachable beyond your home network.

## The import folder on disk (works without upload)

`IMPORT_DIR` is just a folder inside the music folder. Anything that puts files there (a network share, a download
client, `scp`) shows up in the editor the next time you open it; the **folder filter** (type to narrow the list,
`/` to focus, Esc to clear) helps find them. A "📥 Import" shortcut next to the breadcrumb jumps to it.

## Lidarr setup

Mount the import folder into Lidarr's container as a **second, separate path**, for example in Lidarr's compose file:

```yaml
    volumes:
      - /path/to/music:/music          # your library (Lidarr's root folder, as now)
      - /path/to/music/import:/import  # the editor's import folder
```

Do **not** add `/import` as a Lidarr *root folder*: a root folder is where your library lives, so Lidarr would treat
files there as already in the library (and could create new artists there). Then either:

- **By hand:** Lidarr → Wanted → **Manual Import** → `/import` → review → Import; or
- **From the editor** (optional, `LIDARR_URL` + `LIDARR_API_KEY` set): after a save in the import folder, a
  "Hand to Lidarr" button (or an "after save" checkbox) sends Lidarr's `DownloadedAlbumsScan` command for
  `LIDARR_IMPORT_PATH`. Lidarr imports what it can match (artist already in Lidarr + good tags, which MusicBrainz mode
  provides) and moves it into the artist's folder; what it can't match stays in `/import` and shows in Lidarr's
  Activity → Queue / Manual Import. The editor shows Lidarr's answer (command id + status), nothing more.

With Lidarr unset, nothing changes: the editor never contacts it (the 2026-10-31 rule "helps Lidarr, doesn't depend on
it" still holds; this is an opt-in convenience).

## To build (order)

1. Server: `IMPORT_DIR` + "📥 Import" shortcut (no upload yet) — cheap, useful on its own.
2. Server: `POST /api/upload` with the guardrails above + tests (path tricks, overwrite, non-audio, size).
3. UI: upload button + drop area, progress, open the import folder with the new files selected.
4. Optional Lidarr hand-off (`LIDARR_*`), with a "test connection" in the settings or status bar.
5. README: the settings table and the security note (done 2026-11-12); the Lidarr compose snippet when step 4 is built.

## Open

- Should a successful Lidarr import clean up anything left behind (empty folders in `/import`)? Lidarr moves files;
  folders may stay.
- Sonarr/Radarr are out of scope here (the editor is music-only); a separate media drop box is an idea in the
  author's homelab notes.

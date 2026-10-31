# MusicBrainz mode (design)

Status: **design, not built** (2026-10-31). Branch `musicbrainz-mode`.

## Why

The editor exists to get music files into a state where Lidarr can import them. Lidarr matches files to albums using
MusicBrainz IDs in the tags; without them it falls back to fuzzy matching on names, track counts and durations, and an
album with a slightly wrong title or a missing track can be rejected outright.

MusicBrainz mode looks the album up on MusicBrainz, lets you pick the exact edition, and writes the IDs Lidarr reads.
It **helps Lidarr, it doesn't replace or depend on it**: the editor never talks to Lidarr. Adding the artist and
importing stay Lidarr's job. Plain tag editing stays the default and works exactly as before.

## What Lidarr reads (checked against Lidarr's source and a live import preview)

Lidarr (`develop`, `MediaFiles/AudioTag.cs` and `MediaFiles/TrackImport/Identification/`) reads Picard-style
MusicBrainz tags:

| Field | ID3 (MP3) | Vorbis comment (FLAC) | MP4 freeform (M4A) |
|---|---|---|---|
| Release ("album id") | `TXXX:MusicBrainz Album Id` | `MUSICBRAINZ_ALBUMID` | `----:com.apple.iTunes:MusicBrainz Album Id` |
| Release group | `TXXX:MusicBrainz Release Group Id` | `MUSICBRAINZ_RELEASEGROUPID` | `… MusicBrainz Release Group Id` |
| Track artist | `TXXX:MusicBrainz Artist Id` | `MUSICBRAINZ_ARTISTID` | `… MusicBrainz Artist Id` |
| Album artist | `TXXX:MusicBrainz Album Artist Id` | `MUSICBRAINZ_ALBUMARTISTID` | `… MusicBrainz Album Artist Id` |
| Recording | `UFID:http://musicbrainz.org` | `MUSICBRAINZ_TRACKID` | `… MusicBrainz Track Id` |
| Release track | `TXXX:MusicBrainz Release Track Id` | `MUSICBRAINZ_RELEASETRACKID` | `… MusicBrainz Release Track Id` |
| Release type / status / country | `TXXX:MusicBrainz Album Type` / `… Album Status` / `… Album Release Country` | `RELEASETYPE` / `RELEASESTATUS` / `RELEASECOUNTRY` | `… MusicBrainz Album Type` / `… Album Status` / `… Album Release Country` |

(The MP3 names were confirmed on files Lidarr itself tagged; FLAC and M4A names follow TagLib/Picard and get confirmed
by a read-back test before those formats ship.)

How the IDs are used:
- **If every track in the folder carries the same release ID**, Lidarr picks that release directly instead of
  searching. It looks the release up in its own database, so the artist has to be in Lidarr's library first; then the
  files match.
- The match is then scored: release ID, per-track recording ID (AcoustID fingerprints stand in when there's no ID), title,
  artist, album, track number, disc count, year, country, label, track length, missing and extra tracks. 80 % is the
  default threshold.

Test (5-track MP3 EP whose artist is in Lidarr, album title deliberately wrong, Lidarr's manual-import preview):

```
no MusicBrainz tags:                         Couldn't find similar album
release id on every track + recording ids:   accepted, all 5 tracks mapped to the right release and track
```

## The two modes

- **Plain editing** (default, unchanged): browse, edit title/artist/album/album artist/year/track/genre, single or batch.
- **Look up on MusicBrainz**: a panel for an album folder or a selection of files. It fills the form and the
  MusicBrainz fields; everything stays editable before saving.

## Flow

1. **Search.** Prefilled from the current tags: artist, album, number of selected files. MusicBrainz release search
   (`/ws/2/release?query=…`) returns candidate editions with artist, title, date, country, format, label, track count,
   status and type. Editions whose track count equals the number of files sort first. Free-text search to correct it;
   pasting a MusicBrainz release URL or ID skips the search.
2. **Pick the edition.** Fetch it with `inc=recordings+artist-credits+release-groups+labels+media`.
3. **Map the tracks.** One row per file: disc and track number first, then title similarity, then duration (± a few
   seconds). A dropdown per row to fix it. Unmapped files and release tracks are shown in red; saving with gaps
   asks first (Lidarr scores missing and extra tracks).
4. **Preview.** Per file, every tag that changes, old → new. If files already carry a different release ID, that's
   called out ("currently tagged as <other edition>").
5. **Write, then verify.** Write each file, read it back (the verify endpoint), and show a per-file result. A file that
   fails to verify is restored from its backup (the M4A writer already does this; MP3/FLAC get the same treatment).

## What gets written

- **Always (the IDs):** release, release group, track artist, album artist, recording, release track, release type,
  status and country.
- **"Use MusicBrainz names" checkbox, on by default:** album, track title, track artist, album artist, track n/total,
  disc n/total, date (the edition's release date). Untick it to keep your own names and add only the IDs. (On by
  default because a wrong album title alone made an untagged album unfindable in the test above.)
- Nothing else is touched: genre, comments, cover art and any other tags stay as they are.

## Warnings that help with Lidarr later (without talking to it)

- **Edition types Lidarr hides by default.** Lidarr's default "Standard" metadata profile leaves out some types (for
  example Live). If the chosen edition's type or status is one of those, the panel says so: the files will be tagged
  correctly, but Lidarr may not show the album until the profile allows that type. Information only.
- **Mixed releases in one folder.** If the folder's files would end up with different release IDs (e.g. a partial
  remap), say so: Lidarr only takes the fast path when every track agrees.

## MusicBrainz etiquette

- At most **1 request per second**, queued in the backend; a meaningful **User-Agent**:
  `music-metadata-editor/<version> ( https://github.com/kaibae19/music-metadata-editor )`.
- Cache responses for the session (search results and releases), so going back and forth doesn't refetch.
- No account or key needed. Requests go from the backend, never from the browser.
- Handle 503 (rate limited) with a backoff and a message, not a failure.

## API (backend)

- `GET  /api/mb/search?artist=&album=&tracks=` → candidate releases (normalized).
- `GET  /api/mb/release/:mbid` → release with media and tracks (normalized).
- `POST /api/mb/apply` `{ files: [...], releaseId, mapping: [{file, mediumNumber, trackNumber}], useNames: true }`
  → per-file result: written fields, verify status.
- The existing `GET /api/verify/metadata/:path` reads a file back, including the MusicBrainz fields (to extend).

## Formats and libraries

- **MP3:** `node-id3` supports `userDefinedText` (TXXX) and `uniqueFileIdentifier` (UFID). First.
- **FLAC:** `metaflac-js2` sets arbitrary Vorbis comments. First.
- **M4A:** freeform `----` atoms through `mp3tag.js` are unproven (the M4A writer is the fragile part of the code
  today). Ship after a test file reads back correctly, in this editor and in another tool.

## Tests

- Unit: tag mapping per format (fields → frames), track mapping (number, title, duration), MB response normalization
  (fixtures, no network).
- Round trip: write → read back for each format on small fixture files.
- Manual: one album through Lidarr's manual import, before and after (as in the test above).

## Later, maybe

- **AcoustID** lookup for files with no usable tags (needs `fpcalc` and a free AcoustID application key; opt-in).
- Cover art from the Cover Art Archive (opt-in; would change files more than tags do).

## Out of scope

- Talking to Lidarr (adding artists, triggering imports or rescans). That's Lidarr's job.
- Renaming or moving files to a naming scheme (Lidarr does that on import).

# Music Metadata Editor

Simple web-based music file metadata editor for SONARR pipeline integration.

## What It Does

This tool provides a focused solution for cleaning up music file metadata before SONARR processing:

- **Browse music directories** - List audio files in selected folders
- **Display current metadata** - Show existing tags for FLAC, MP3, AAC, and Apple Lossless files
- **Edit core metadata fields** - Modify Artist, Title, Album, Year, and Genre tags
- **Save changes to files** - Write updated metadata directly back to audio files
- **Web-based interface** - No desktop application installation required
- **Docker deployment** - Containerized for easy homelab integration

## What It Does NOT Do

- Album art handling (SONARR manages this)
- Complex metadata lookup or auto-tagging
- Batch operations across multiple files
- Audio file conversion or quality analysis
- Advanced metadata fields beyond core tags
- File organization or renaming

## Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/music-metadata-editor.git
cd music-metadata-editor

# Run with Docker
docker build -t music-metadata-editor .
docker run -p 3000:3000 -v /path/to/your/music:/music music-metadata-editor

# Access web interface
open http://localhost:3000
```

## Pipeline Integration

This tool fits between file acquisition and SONARR processing:

1. **Files exist** (iTunes library, YouTube rips, various sources)
2. **Metadata Editor** ← **This tool cleans up tags**
3. **SONARR** (handles advanced lookup and album art)
4. **Final organized collection**

## Development

```bash
# Local development
npm install
npm start

# Access at http://localhost:3000
```

## Supported Formats

- **FLAC** - Vorbis comments
- **MP3** - ID3v2 and ID3v1 tags
- **AAC** - MP4 atoms
- **Apple Lossless** - MP4 container metadata

## License

MIT - Simple tool for simple needs

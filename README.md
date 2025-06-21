# 🎵 Music Metadata Editor

**Production-ready web-based music file metadata editor for LIDARR pipeline integration**

![Status](https://img.shields.io/badge/Status-100%25%20Functional-brightgreen)
![Docker](https://img.shields.io/badge/Docker-Ready-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Metadata Writing](https://img.shields.io/badge/Metadata%20Writing-✅%20Working-success)

## 📸 Screenshots

![Music Metadata Editor Interface](screenshots/main-interface.png)

*Clean two-panel interface showing file browser and metadata editor*

## 🎯 What It Does

A complete file management and metadata editing solution designed for music library automation:

### **Core Features**
- 🗂️ **Full directory browsing** with intuitive navigation
- 🎵 **Metadata reading/editing** for all major audio formats
- ✍️ **Real metadata writing** - actually modifies files!
- 🖱️ **Multi-select operations** with Ctrl+click
- 📝 **Batch metadata editing** across multiple files
- 🔄 **File & directory operations** (rename, delete, organize)
- 🍞 **Breadcrumb navigation** with right-click context menus
- 🎨 **Dark theme interface** optimized for extended use

### **Advanced Operations**
- **Context menus** on files, directories, and breadcrumbs
- **Smart navigation** that prevents accidental directory changes
- **Scroll position memory** when navigating between folders
- **Comprehensive safety warnings** for destructive operations
- **Real-time form validation** and error handling
- **Permission-aware** with graceful read-only mode handling

## 🚀 Quick Start

```bash
# Clone and run with Docker
git clone https://github.com/yourusername/music-metadata-editor.git
cd music-metadata-editor

# Build and run
docker build -t music-metadata-editor .
docker run -p 3000:3000 -v /path/to/your/music:/music music-metadata-editor

# Access the web interface
open http://localhost:3000
```

### **Testing with Read-Only Mode**
```bash
# Use the deployment script for easy testing
chmod +x deploy.sh
./deploy.sh

# Choose option 2 for read-only testing (safe)
# Choose option 1 for full read-write mode
```

## 🏗️ Architecture

- **Backend**: Node.js + Express + music-metadata library + format-specific writers
- **Frontend**: Vanilla JavaScript (no frameworks - fast and reliable)
- **Deployment**: Docker container with volume mounting
- **Design**: Responsive dark theme with two-panel layout

## 📁 Project Structure

```
music-metadata-editor/
├── src/
│   ├── app.js                    # Express server + API endpoints
│   └── metadata/
│       └── writer.js             # Metadata writing engine
├── public/
│   ├── index.html                # Main interface
│   ├── css/style.css             # Dark theme styling
│   └── js/app.js                 # Frontend application
├── deploy.sh                     # Testing deployment script
├── Dockerfile                    # Container configuration
└── docker-compose.yml           # Easy deployment
```

## 🎮 How To Use

### **File Navigation**
- **Single click**: Select files or navigate directories
- **Ctrl+click**: Multi-select files for batch operations
- **Right-click**: Access context menus for rename/delete
- **Breadcrumbs**: Click to jump to any parent directory

### **Metadata Editing**
- **Single file**: Edit all metadata fields and save changes
- **Multiple files**: Batch edit common fields (Artist, Album, etc.)
- **Auto-save**: Press Enter in any field to save immediately
- **Reset**: Restore original values if needed
- **Real-time feedback**: See success/error messages instantly

### **File Operations**
- **Rename**: Right-click files/folders → Rename
- **Delete**: Comprehensive warnings for safety
- **Batch delete**: Select multiple items → Right-click → Delete Selected

## 🔧 API Endpoints

```
GET  /api/files?path=<path>       # Browse directories
GET  /api/metadata/<path>         # Read file metadata
POST /api/metadata/<path>         # Update single file metadata ✅ WORKING
POST /api/metadata/batch          # Update multiple files ✅ WORKING
POST /api/file/rename             # Rename files
POST /api/directory/rename        # Rename directories  
POST /api/file/delete             # Delete files
POST /api/directory/delete        # Delete directories
POST /api/batch/delete            # Batch delete operations
```

## 🎵 Supported Formats

| Format | Reading | Writing | Library Used |
|--------|---------|---------|--------------|
| **MP3** | ✅ | ✅ | node-id3 (ID3v1, ID3v2) |
| **FLAC** | ✅ | ✅ | metaflac-js2 (Vorbis comments) |
| **M4A/AAC** | ✅ | ✅ | mp3tag.js (MP4 containers) |
| **OGG** | ✅ | ❌ | music-metadata (read-only) |
| **WAV** | ✅ | ❌ | music-metadata (read-only) |

## 🛠️ Development

```bash
# Local development setup
npm install
npm start

# Access at http://localhost:3000
# Backend will serve files from /music directory
```

### **Dependencies**
```json
{
  "express": "^4.18.2",
  "music-metadata": "^7.14.0",
  "node-id3": "^0.2.6",
  "metaflac-js2": "^1.0.8",
  "mp3tag.js": "^3.11.2"
}
```

## 📋 LIDARR Pipeline Integration

Perfect for music library automation workflows:

```
[Music Sources] → [Metadata Editor] → [LIDARR] → [Organized Library]
                       ↑
                ✅ Actually cleans metadata
                before automated processing
```

**Real-world usage:**
1. **Pre-processing**: Use after downloads but before LIDARR organization
2. **Manual cleanup**: Review and fix metadata before final library placement
3. **Batch operations**: Clean up entire albums or artist catalogs
4. **Quality control**: Ensure consistent metadata standards

## ✅ Current Status

- ✅ **File browsing**: Complete and tested
- ✅ **Metadata reading**: All formats supported  
- ✅ **UI/UX**: Fully functional interface
- ✅ **File operations**: Rename, delete, organize
- ✅ **Metadata writing**: **FULLY IMPLEMENTED AND TESTED** 🎉
  - MP3 writing with node-id3
  - FLAC writing with metaflac-js2
  - M4A/AAC writing with mp3tag.js
  - Permission error handling
  - Batch operations
  - Success/failure feedback

## 🚢 Deployment Options

### **Docker (Recommended)**
```bash
# Read-write mode (normal operation)
docker run -d \
  --name music-editor \
  -p 3000:3000 \
  -v /path/to/music:/music \
  music-metadata-editor

# Read-only mode (testing)
docker run -d \
  --name music-editor \
  -p 3000:3000 \
  -v /path/to/music:/music:ro \
  music-metadata-editor
```

### **Docker Compose**
```yaml
version: '3.8'
services:
  music-editor:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - /path/to/music:/music
    restart: unless-stopped
```

### **Using the Deployment Script**
```bash
# Interactive deployment with read-only testing option
./deploy.sh
```

## 🧪 Testing

The application includes comprehensive testing capabilities:

1. **Read-only mode**: Test permission handling without risk
2. **Format support**: Verify writing works across MP3, FLAC, M4A
3. **Batch operations**: Test multi-file editing
4. **Error scenarios**: Graceful handling of permission issues
5. **UI feedback**: Real-time success/error messages

## 🤝 Contributing

Built through iterative development with real-world testing. Contributions welcome for:
- Additional audio format support (OGG, WAV writing)
- Album artwork handling
- Advanced metadata features
- Performance optimizations
- UI/UX enhancements

## 📄 License

MIT - Built for the community, use however you need.

---

## 🎉 Credits

*"Few hours of vibe-coding with sound-reactive LEDs" that turned into a production-ready tool.*

Created for LIDARR pipeline integration and music library management. Perfect for homelabs, media servers, and anyone who needs clean metadata before automated processing.

**Live tested** with ABBA's "Dancing Queen" - metadata writing confirmed working! 🕺💃

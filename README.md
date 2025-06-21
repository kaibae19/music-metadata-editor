# 🎵 Music Metadata Editor

**Production-ready web-based music file metadata editor with beautiful theming**

![Status](https://img.shields.io/badge/Status-100%25%20Functional-brightgreen)
![Docker](https://img.shields.io/badge/Docker-Ready-blue)
![Theme System](https://img.shields.io/badge/Themes-Dark%2FLight-purple)
![Metadata Writing](https://img.shields.io/badge/Metadata%20Writing-✅%20Working-success)

## ✨ What Makes This Special

A **polished, professional** file management and metadata editing solution with beautiful dark/light themes:

### **🎨 Beautiful Theme System**
- **🌙 Dark mode (default)** - Perfect for LED setups and late-night library sessions
- **☀️ Light mode** - Clean, professional appearance for daytime use  
- **Smooth transitions** - CSS custom properties with seamless color changes
- **Persistent preferences** - Remembers your choice between sessions
- **Responsive design** - Theme toggle repositions gracefully on mobile

### **🎯 Core Features**
- 🗂️ **Intuitive file browsing** with smart breadcrumb navigation
- 🎵 **Real metadata editing** for MP3, FLAC, M4A files (actually writes changes!)
- 🖱️ **Advanced multi-select** with Ctrl+click functionality
- 📝 **Batch metadata operations** across multiple files
- 🔄 **Complete file management** (rename, delete, organize)
- 🍞 **Right-click context menus** on files, folders, and breadcrumbs
- 📍 **Scroll position memory** when navigating between directories

### **🛡️ Safety & Polish Features**
- **Smart navigation** - prevents accidental directory changes when items are selected
- **Comprehensive warnings** for destructive operations with typed confirmations
- **Permission-aware** - graceful read-only mode with clear error messages
- **Real-time validation** and success/error feedback with emojis
- **Layout stability** - no UI jumping during selections or operations

## 🚀 Quick Start

```bash
# Clone and run with Docker
git clone https://github.com/yourusername/music-metadata-editor.git
cd music-metadata-editor

# Build and run
docker build -t music-metadata-editor .
docker run -p 3000:3000 -v /path/to/your/music:/music music-metadata-editor

# Access the beautiful web interface
open http://localhost:3000
```

### **🧪 Testing with Read-Only Mode**
```bash
# Use the deployment script for easy testing
chmod +x deploy.sh
./deploy.sh

# Choose option 2 for read-only testing (safe)
# Choose option 1 for full read-write mode
```

## 🎮 User Experience Highlights

### **Theme Toggle**
- **One-click switching** between 🌙 Dark and ☀️ Light modes
- **Positioned beautifully** in the top-right corner (responsive)
- **Instant feedback** with smooth color transitions throughout the interface

### **Advanced File Navigation**
- **Breadcrumb magic** - right-click any path segment to rename/delete
- **Multi-select mastery** - Ctrl+click for precise selection control
- **Context-aware menus** - different options based on what's selected
- **Smart behavior** - won't navigate away when you have files selected

### **Metadata Editing Experience**
- **Single file editing** - all fields available with live validation
- **Batch editing** - common fields only (Artist, Album, etc.) with clear UI feedback
- **Auto-save on Enter** - press Enter in any field to save immediately
- **Visual feedback** - success ✅, warnings ⚠️, and errors ❌ with clear messages

### **Safety & Confirmation System**
- **Typed confirmations** - type "DELETE" or "DELETE ALL" for dangerous operations
- **File vs. directory warnings** - different confirmation flows for different risks
- **Batch operation summaries** - clear reporting of what succeeded/failed
- **Permission detection** - immediately shows read-only status with helpful messages

## 🏗️ Architecture

- **Frontend**: Vanilla JavaScript with **ThemeManager class** for seamless theming
- **Backend**: Node.js + Express + format-specific metadata libraries
- **Styling**: CSS custom properties enabling smooth theme transitions
- **Deployment**: Docker container with volume mounting for any music directory

## 📁 Project Structure

```
music-metadata-editor/
├── src/
│   ├── app.js                    # Express server + comprehensive API
│   └── metadata/
│       └── writer.js             # Multi-format metadata writing engine
├── public/
│   ├── index.html                # Themed interface with toggle button
│   ├── css/style.css             # Dark/light theme system with transitions
│   └── js/app.js                 # Frontend app + ThemeManager class
├── deploy.sh                     # Interactive deployment script
├── Dockerfile                    # Optimized container build
└── docker-compose.yml           # Production deployment config
```

## 🎵 Supported Formats

| Format | Reading | Writing | Library Used | Theme Support |
|--------|---------|---------|--------------|---------------|
| **MP3** | ✅ | ✅ | node-id3 (ID3v1, ID3v2) | ✅ |
| **FLAC** | ✅ | ✅ | metaflac-js2 (Vorbis) | ✅ |
| **M4A/AAC** | ✅ | ✅ | mp3tag.js (MP4 containers) | ✅ |
| **OGG** | ✅ | ❌ | music-metadata (read-only) | ✅ |
| **WAV** | ✅ | ❌ | music-metadata (read-only) | ✅ |

*All formats display beautifully in both dark and light themes*

## 🔧 API Endpoints

```
GET  /api/files?path=<path>       # Browse directories with theme-aware UI
GET  /api/metadata/<path>         # Read file metadata  
POST /api/metadata/<path>         # Update single file ✅ WORKING
POST /api/metadata/batch          # Batch update multiple files ✅ WORKING
POST /api/file/rename             # Rename files with validation
POST /api/directory/rename        # Rename directories safely
POST /api/file/delete             # Delete files with confirmations
POST /api/directory/delete        # Delete directories with warnings
POST /api/batch/delete            # Batch delete with comprehensive reporting
```

## 🛠️ Development

```bash
# Local development with theme system
npm install
npm start

# Access at http://localhost:3000
# Theme toggle works immediately in development
```

### **Theme Development**
The theme system uses CSS custom properties for instant switching:
```css
:root {
    --bg-primary: #1a1a1a;    /* Dark mode */
    --text-primary: #e0e0e0;
}

[data-theme="light"] {
    --bg-primary: #ffffff;    /* Light mode */
    --text-primary: #212529;
}
```

## 📋 Perfect for LIDARR Integration

Designed specifically for music library automation:

```
[Downloads] → [Metadata Editor] → [LIDARR] → [Organized Library]
                     ↑
              ✅ Beautiful theming
              ✅ Batch operations  
              ✅ Safety features
              ✅ Actually writes metadata
```

**Why this tool rocks for automation:**
1. **Pre-processing cleanup** - Fix metadata before LIDARR organization
2. **Beautiful interface** - Actually enjoyable to use for manual review
3. **Batch operations** - Clean entire albums/artists efficiently
4. **Safety features** - Comprehensive warnings prevent accidental data loss
5. **Theme flexibility** - Works great in any environment (dark media centers or bright offices)

## ✅ Current Status - Production Ready

- ✅ **Complete file management** with polished UX
- ✅ **Beautiful theme system** with persistent preferences
- ✅ **Advanced UI interactions** (multi-select, context menus, breadcrumbs)
- ✅ **Comprehensive safety features** with typed confirmations
- ✅ **Real metadata writing** for all major formats
- ✅ **Batch operations** with detailed success/failure reporting
- ✅ **Responsive design** that works on all devices
- ✅ **Permission handling** with graceful read-only mode
- ✅ **Docker deployment** ready for production

## 🚢 Deployment Options

### **Docker (Recommended)**
```bash
# Production deployment with themes
docker run -d \
  --name music-editor \
  -p 3000:3000 \
  -v /path/to/music:/music \
  music-metadata-editor

# Access beautiful interface at http://localhost:3000
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
    environment:
      - NODE_ENV=production
```

### **Interactive Deployment**
```bash
# Guided deployment with testing options
./deploy.sh
# Automatically builds, deploys, and provides access URLs
```

## 🎨 Theme System Technical Details

### **Default Behavior**
- **Starts in dark mode** by default (perfect for media centers)
- **Instant theme switching** with smooth CSS transitions
- **localStorage persistence** remembers user preference
- **Responsive toggle button** repositions appropriately on mobile

### **CSS Architecture**
- **Custom properties** for all colors and spacing
- **Smooth transitions** on all theme-aware elements
- **No layout shift** when switching themes
- **Accessibility maintained** across both themes

### **JavaScript Theme Management**
```javascript
// ThemeManager class handles all theme operations
const themeManager = new ThemeManager();
themeManager.toggle(); // Switches themes with persistence
```

## 🧪 Testing Experience

Comprehensive testing with beautiful UI feedback:

1. **Read-only mode testing** - Safe permission testing with clear error messages
2. **Theme switching** - Verify smooth transitions work in all interface states  
3. **Multi-select operations** - Test Ctrl+click behavior across themes
4. **Context menu functionality** - Right-click operations on all UI elements
5. **Batch metadata editing** - Verify success/error reporting works correctly
6. **Mobile responsiveness** - Theme toggle and interface work on all screen sizes

## 🎉 Why Users Love This Tool

> *"Few hours of vibe-coding with sound-reactive LEDs turned into the most polished metadata editor I've ever used."*

**What makes it special:**
- **Actually enjoyable to use** - Beautiful themes and smooth interactions
- **Professional feel** - Polished details like smooth transitions and context menus
- **Comprehensive safety** - Prevents data loss with smart confirmations
- **Universal compatibility** - Works standalone or with any automation system
- **Real functionality** - Actually writes metadata, doesn't just pretend

## 🤝 Contributing

Built through iterative development with real-world testing. Contributions welcome for:
- Additional theme customizations
- New audio format support
- Enhanced UI animations
- Performance optimizations
- Mobile UX improvements

## 📄 License

MIT - Built for the community, use however you need.

---

## 🎵 Credits

*Created for music lovers who want both powerful functionality and beautiful design.*

**Live tested** with ABBA's "Dancing Queen" - metadata writing and theme switching confirmed working flawlessly! 🕺💃

Perfect for homelabs, media servers, LIDARR pipelines, and anyone who appreciates well-crafted tools that are actually pleasant to use. ✨

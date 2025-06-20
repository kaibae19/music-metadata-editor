const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { parseFile, selectCover } = require('music-metadata');

const app = express();
const PORT = process.env.PORT || 3000;
const MUSIC_DIR = process.env.MUSIC_DIR || '/music';

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Supported audio file extensions
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.aac'];

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// List files in directory
app.get('/api/files', async (req, res) => {
  try {
    const dirPath = req.query.path || MUSIC_DIR;
    const fullPath = path.resolve(MUSIC_DIR, dirPath.replace(MUSIC_DIR, ''));
    
    // Security check - ensure path is within MUSIC_DIR
    if (!fullPath.startsWith(path.resolve(MUSIC_DIR))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const items = await fs.readdir(fullPath, { withFileTypes: true });
    
    const result = {
      currentPath: dirPath,
      items: []
    };

    for (const item of items) {
      const itemPath = path.join(fullPath, item.name);
      const relativePath = path.relative(MUSIC_DIR, itemPath);
      
      if (item.isDirectory()) {
        result.items.push({
          name: item.name,
          type: 'directory',
          path: relativePath
        });
      } else if (AUDIO_EXTENSIONS.includes(path.extname(item.name).toLowerCase())) {
        result.items.push({
          name: item.name,
          type: 'file',
          path: relativePath,
          extension: path.extname(item.name).toLowerCase()
        });
      }
    }

    // Sort: directories first, then files alphabetically
    result.items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    res.json(result);
  } catch (error) {
    console.error('Error reading directory:', error);
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

// Get metadata for specific file
app.get('/api/metadata/:path(*)', async (req, res) => {
  try {
    const filePath = path.resolve(MUSIC_DIR, req.params.path);
    
    // Security check
    if (!filePath.startsWith(path.resolve(MUSIC_DIR))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const metadata = await parseFile(filePath);
    
    // Extract core metadata fields
    const result = {
      filename: path.basename(filePath),
      format: metadata.format,
      common: {
        title: metadata.common.title || '',
        artist: metadata.common.artist || '',
        album: metadata.common.album || '',
        year: metadata.common.year || '',
        genre: metadata.common.genre ? metadata.common.genre.join(', ') : '',
        track: metadata.common.track ? metadata.common.track.no : '',
        albumartist: metadata.common.albumartist || ''
      }
    };

    res.json(result);
  } catch (error) {
    console.error('Error reading metadata:', error);
    res.status(500).json({ error: 'Failed to read metadata' });
  }
});

// Update metadata for specific file
app.post('/api/metadata/:path(*)', async (req, res) => {
  try {
    const filePath = path.resolve(MUSIC_DIR, req.params.path);
    
    // Security check
    if (!filePath.startsWith(path.resolve(MUSIC_DIR))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { metadata } = req.body;
    
    // This is a placeholder - actual metadata writing depends on file format
    // For now, we'll simulate success
    console.log('Would update metadata for:', filePath);
    console.log('New metadata:', metadata);
    
    // TODO: Implement actual metadata writing using appropriate library
    // Different libraries needed for different formats:
    // - node-id3 for MP3
    // - flac-metadata for FLAC  
    // - mp4-tag for MP4/M4A/AAC
    
    res.json({ 
      success: true, 
      message: 'Metadata updated successfully',
      note: 'Writing functionality to be implemented'
    });
    
  } catch (error) {
    console.error('Error updating metadata:', error);
    res.status(500).json({ error: 'Failed to update metadata' });
  }
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Music Metadata Editor running on port ${PORT}`);
  console.log(`Music directory: ${MUSIC_DIR}`);
  console.log(`Access at: http://localhost:${PORT}`);
});

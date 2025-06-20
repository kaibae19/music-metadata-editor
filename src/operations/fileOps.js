const path = require('path');
const fs = require('fs').promises;

const fileOps = {
  // Rename file
  async renameFile(req, res, MUSIC_DIR) {
    try {
      const { oldPath, newName } = req.body;
      
      if (!oldPath || !newName) {
        return res.status(400).json({ error: 'Missing oldPath or newName' });
      }

      const oldFilePath = path.resolve(MUSIC_DIR, oldPath);
      const dirPath = path.dirname(oldFilePath);
      const newFilePath = path.join(dirPath, newName);
      
      // Security checks
      if (!oldFilePath.startsWith(path.resolve(MUSIC_DIR)) || 
          !newFilePath.startsWith(path.resolve(MUSIC_DIR))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check if old file exists
      try {
        await fs.access(oldFilePath);
      } catch {
        return res.status(404).json({ error: 'File not found' });
      }

      // Check if new file already exists
      try {
        await fs.access(newFilePath);
        return res.status(409).json({ error: 'A file with that name already exists' });
      } catch {
        // Good, file doesn't exist
      }

      // Rename the file
      await fs.rename(oldFilePath, newFilePath);
      
      res.json({ 
        success: true, 
        message: 'File renamed successfully',
        newPath: path.relative(MUSIC_DIR, newFilePath)
      });
      
    } catch (error) {
      console.error('Error renaming file:', error);
      res.status(500).json({ error: 'Failed to rename file' });
    }
  },

  // Delete file
  async deleteFile(req, res, MUSIC_DIR) {
    try {
      const { filePath } = req.body;
      
      if (!filePath) {
        return res.status(400).json({ error: 'Missing filePath' });
      }

      const fullPath = path.resolve(MUSIC_DIR, filePath);
      
      // Security check
      if (!fullPath.startsWith(path.resolve(MUSIC_DIR))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check if file exists
      try {
        await fs.access(fullPath);
      } catch {
        return res.status(404).json({ error: 'File not found' });
      }

      // Delete the file
      await fs.unlink(fullPath);
      
      res.json({ 
        success: true, 
        message: 'File deleted successfully'
      });
      
    } catch (error) {
      console.error('Error deleting file:', error);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  },

  // Batch delete (files and/or directories)
  async batchDelete(req, res, MUSIC_DIR) {
    try {
      const { items } = req.body; // Array of {type: 'file'|'directory', path: 'path'}
      
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Missing or invalid items array' });
      }

      const results = [];
      const errors = [];

      for (const item of items) {
        try {
          const { type, path: itemPath } = item;
          const fullPath = path.resolve(MUSIC_DIR, itemPath);
          
          // Security check
          if (!fullPath.startsWith(path.resolve(MUSIC_DIR))) {
            errors.push({ item: itemPath, error: 'Access denied' });
            continue;
          }

          // Prevent deleting the root music directory
          if (fullPath === path.resolve(MUSIC_DIR)) {
            errors.push({ item: itemPath, error: 'Cannot delete root music directory' });
            continue;
          }

          // Check if item exists
          await fs.access(fullPath);
          
          if (type === 'directory') {
            await fs.rm(fullPath, { recursive: true, force: true });
          } else {
            await fs.unlink(fullPath);
          }
          
          results.push({ item: itemPath, type, success: true });
          
        } catch (error) {
          errors.push({ item: item.path, error: error.message });
        }
      }

      res.json({
        success: errors.length === 0,
        message: `Deleted ${results.length} items${errors.length > 0 ? `, ${errors.length} errors` : ''}`,
        results,
        errors
      });

    } catch (error) {
      console.error('Error in batch delete:', error);
      res.status(500).json({ error: 'Failed to delete items' });
    }
  }
};

module.exports = fileOps;

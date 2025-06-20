const path = require('path');
const fs = require('fs').promises;

const directoryOps = {
  // Rename directory
  async renameDirectory(req, res, MUSIC_DIR) {
    try {
      const { oldPath, newName } = req.body;
      
      if (!oldPath || !newName) {
        return res.status(400).json({ error: 'Missing oldPath or newName' });
      }

      const oldDirPath = path.resolve(MUSIC_DIR, oldPath);
      const parentDir = path.dirname(oldDirPath);
      const newDirPath = path.join(parentDir, newName);
      
      // Security checks
      if (!oldDirPath.startsWith(path.resolve(MUSIC_DIR)) || 
          !newDirPath.startsWith(path.resolve(MUSIC_DIR))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check if old directory exists
      try {
        const stat = await fs.stat(oldDirPath);
        if (!stat.isDirectory()) {
          return res.status(400).json({ error: 'Path is not a directory' });
        }
      } catch {
        return res.status(404).json({ error: 'Directory not found' });
      }

      // Check if new directory already exists
      try {
        await fs.access(newDirPath);
        return res.status(409).json({ error: 'A directory with that name already exists' });
      } catch {
        // Good, directory doesn't exist
      }

      // Rename the directory
      await fs.rename(oldDirPath, newDirPath);
      
      res.json({ 
        success: true, 
        message: 'Directory renamed successfully',
        newPath: path.relative(MUSIC_DIR, newDirPath)
      });
      
    } catch (error) {
      console.error('Error renaming directory:', error);
      res.status(500).json({ error: 'Failed to rename directory' });
    }
  },

  // Delete directory (recursive)
  async deleteDirectory(req, res, MUSIC_DIR) {
    try {
      const { dirPath } = req.body;
      
      if (!dirPath) {
        return res.status(400).json({ error: 'Missing dirPath' });
      }

      const fullPath = path.resolve(MUSIC_DIR, dirPath);
      
      // Security check
      if (!fullPath.startsWith(path.resolve(MUSIC_DIR))) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Prevent deleting the root music directory
      if (fullPath === path.resolve(MUSIC_DIR)) {
        return res.status(403).json({ error: 'Cannot delete root music directory' });
      }

      // Check if directory exists
      try {
        const stat = await fs.stat(fullPath);
        if (!stat.isDirectory()) {
          return res.status(400).json({ error: 'Path is not a directory' });
        }
      } catch {
        return res.status(404).json({ error: 'Directory not found' });
      }

      // Delete the directory recursively
      await fs.rm(fullPath, { recursive: true, force: true });
      
      res.json({ 
        success: true, 
        message: 'Directory deleted successfully'
      });
      
    } catch (error) {
      console.error('Error deleting directory:', error);
      res.status(500).json({ error: 'Failed to delete directory' });
    }
  }
};

module.exports = directoryOps;

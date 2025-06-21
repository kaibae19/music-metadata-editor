#!/bin/bash
# File: deploy.sh

# Music Metadata Editor - Testing Deployment Script

echo "🎵 Music Metadata Editor - Deployment Script"
echo "============================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Build the image
echo "🔨 Building Docker image..."
docker build -t music-metadata-editor . || {
    echo "❌ Docker build failed"
    exit 1
}

echo "✅ Build complete!"
echo ""

# Ask for music directory
if [ -z "$MUSIC_DIR" ]; then
    echo "📁 Enter the path to your music directory for testing:"
    read -r MUSIC_DIR
fi

# Validate directory exists
if [ ! -d "$MUSIC_DIR" ]; then
    echo "❌ Directory does not exist: $MUSIC_DIR"
    exit 1
fi

echo ""
echo "🚀 Deployment Options:"
echo "1. Read-Write mode (normal operation)"
echo "2. Read-Only mode (testing permission handling)"
echo ""
read -p "Choose mode (1 or 2): " mode

# Stop existing container if running
echo "🧹 Cleaning up existing container..."
docker stop music-metadata-editor 2>/dev/null || true
docker rm music-metadata-editor 2>/dev/null || true

# Deploy based on selected mode
if [ "$mode" = "2" ]; then
    echo "🔒 Deploying in READ-ONLY mode for permission testing..."
    docker run -d \
        --name music-metadata-editor \
        -p 3000:3000 \
        -v "$MUSIC_DIR:/music:ro" \
        music-metadata-editor
    echo ""
    echo "⚠️  READ-ONLY MODE ACTIVE"
    echo "   This will test permission error handling."
    echo "   Metadata writing will fail with permission errors."
else
    echo "✍️  Deploying in READ-WRITE mode..."
    docker run -d \
        --name music-metadata-editor \
        -p 3000:3000 \
        -v "$MUSIC_DIR:/music" \
        music-metadata-editor
    echo ""
    echo "✅ READ-WRITE MODE ACTIVE"
    echo "   Metadata writing should work normally."
fi

echo ""
echo "🌐 Application URLs:"
echo "   Main interface: http://localhost:3000"
echo "   Health check:   http://localhost:3000/health"
echo ""
echo "📋 Useful commands:"
echo "   View logs:      docker logs -f music-metadata-editor"
echo "   Stop:           docker stop music-metadata-editor"
echo "   Remove:         docker rm music-metadata-editor"
echo ""
echo "🎯 Ready for testing! The application should be available shortly."

# Wait a moment and check if container is running
sleep 3
if docker ps | grep -q music-metadata-editor; then
    echo "✅ Container is running successfully!"
else
    echo "❌ Container failed to start. Check logs with:"
    echo "   docker logs music-metadata-editor"
fi

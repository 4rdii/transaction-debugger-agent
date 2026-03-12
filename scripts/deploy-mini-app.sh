#!/bin/bash
# Deploy the Explorai mini-app to Vercel
# Usage: ./scripts/deploy-mini-app.sh [--api-url https://your-backend.com]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
MINI_APP_DIR="$ROOT_DIR/packages/mini-app"

# Parse optional --api-url flag
API_URL=""
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --api-url) API_URL="$2"; shift ;;
    *) echo "Unknown parameter: $1"; exit 1 ;;
  esac
  shift
done

# Build
echo "Building mini-app..."
if [ -n "$API_URL" ]; then
  VITE_API_URL="$API_URL" npm run build -w packages/mini-app --prefix "$ROOT_DIR"
else
  npm run build -w packages/mini-app --prefix "$ROOT_DIR"
fi

# Prepare Vercel output
echo "Preparing Vercel output..."
rm -rf "$MINI_APP_DIR/.vercel/output/static"
mkdir -p "$MINI_APP_DIR/.vercel/output/static"
cp -r "$MINI_APP_DIR/dist/"* "$MINI_APP_DIR/.vercel/output/static/"
cat > "$MINI_APP_DIR/.vercel/output/config.json" << 'EOF'
{
  "version": 3,
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
EOF

# Deploy
echo "Deploying to Vercel..."
cd "$MINI_APP_DIR"
vercel deploy --prebuilt --prod

echo "Done!"

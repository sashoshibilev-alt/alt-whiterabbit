#!/bin/bash

# Convex MCP Server Setup Script for Cursor
# This script helps set up the Convex MCP server in Cursor IDE

set -e

echo "🚀 Setting up Convex MCP Server for Cursor..."

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    CURSOR_CONFIG_DIR="$HOME/Library/Application Support/Cursor/User/globalStorage"
    CURSOR_MCP_CONFIG="$HOME/Library/Application Support/Cursor/User/settings.json"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CURSOR_CONFIG_DIR="$HOME/.config/Cursor/User/globalStorage"
    CURSOR_MCP_CONFIG="$HOME/.config/Cursor/User/settings.json"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    CURSOR_CONFIG_DIR="$APPDATA/Cursor/User/globalStorage"
    CURSOR_MCP_CONFIG="$APPDATA/Cursor/User/settings.json"
else
    echo "❌ Unsupported OS: $OSTYPE"
    exit 1
fi

echo "📋 Configuration will be added to: $CURSOR_MCP_CONFIG"
echo ""
echo "To manually set up the Convex MCP server:"
echo ""
echo "1. Open Cursor Settings (Cmd+, or Ctrl+,)"
echo "2. Navigate to Features → MCP Servers"
echo "3. Click 'Add MCP Server'"
echo "4. Use the quick install link: https://cursor.sh/settings?open=mcp&addServer=convex"
echo ""
echo "Or manually add this configuration to your Cursor settings:"
echo ""
cat << 'EOF'
{
  "mcpServers": {
    "convex": {
      "command": "npx",
      "args": ["-y", "convex@latest", "mcp", "start"]
    }
  }
}
EOF

echo ""
echo "✅ Setup instructions displayed above."
echo ""
echo "After configuration, restart Cursor to activate the MCP server."
echo ""
echo "To verify the setup, you can ask the AI assistant:"
echo "  - 'Show me all tables in my Convex deployment'"
echo "  - 'What functions are available in my Convex deployment?'"
echo "  - 'List all environment variables'"

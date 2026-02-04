#!/usr/bin/env node

/**
 * Convex MCP Server Setup Script for Cursor
 * Cross-platform script to help set up the Convex MCP server
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MCP_CONFIG = {
  convex: {
    command: "npx",
    args: ["-y", "convex@latest", "mcp", "start"]
  }
};

function getCursorConfigPath() {
  const platform = os.platform();
  const homeDir = os.homedir();

  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json');
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Cursor', 'User', 'settings.json');
  } else {
    // Linux
    return path.join(homeDir, '.config', 'Cursor', 'User', 'settings.json');
  }
}

function displayInstructions() {
  console.log('\n🚀 Convex MCP Server Setup for Cursor\n');
  console.log('To set up the Convex MCP server, you have two options:\n');
  
  console.log('📋 Option 1: Quick Install (Recommended)');
  console.log('   Open this link in your browser:');
  console.log('   https://cursor.sh/settings?open=mcp&addServer=convex\n');
  
  console.log('📋 Option 2: Manual Configuration');
  console.log('   1. Open Cursor Settings (Cmd+, on Mac or Ctrl+, on Windows/Linux)');
  console.log('   2. Navigate to Features → MCP Servers');
  console.log('   3. Click "Add MCP Server"');
  console.log('   4. Add the following configuration:\n');
  console.log(JSON.stringify({ mcpServers: MCP_CONFIG }, null, 2));
  console.log('\n');
  
  console.log('📝 Configuration Details:');
  console.log('   Command: npx');
  console.log('   Args: ["-y", "convex@latest", "mcp", "start"]\n');
  
  console.log('✅ After Configuration:');
  console.log('   - Restart Cursor to activate the MCP server');
  console.log('   - Verify by asking the AI: "Show me all tables in my Convex deployment"\n');
  
  console.log('📚 Available MCP Tools:');
  console.log('   • status - Query deployment information');
  console.log('   • tables - List all database tables and schemas');
  console.log('   • data - Browse table data');
  console.log('   • functionSpec - View deployed functions');
  console.log('   • run - Execute Convex functions');
  console.log('   • logs - View function execution logs');
  console.log('   • envList/envGet/envSet/envRemove - Manage environment variables\n');
  
  console.log('🔗 Resources:');
  console.log('   • Documentation: https://docs.convex.dev/ai/convex-mcp-server');
  console.log('   • Project Dashboard: https://dashboard.convex.dev/t/alexander-shibilev/whiterabbit/enchanted-bear-864/\n');
}

// Check if Cursor settings file exists and offer to update it
function checkCursorSettings() {
  const settingsPath = getCursorConfigPath();
  const settingsDir = path.dirname(settingsPath);
  
  if (!fs.existsSync(settingsDir)) {
    console.log('⚠️  Cursor settings directory not found.');
    console.log(`   Expected location: ${settingsDir}\n`);
    console.log('   Please ensure Cursor is installed and has been opened at least once.\n');
    return false;
  }
  
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.mcpServers && settings.mcpServers.convex) {
        console.log('✅ Convex MCP server is already configured!\n');
        return true;
      }
    } catch (error) {
      // Settings file exists but might be invalid JSON, that's okay
    }
  }
  
  return false;
}

// Main execution
function main() {
  const isConfigured = checkCursorSettings();
  
  if (!isConfigured) {
    displayInstructions();
    
    console.log('💡 Tip: A configuration template has been saved to:');
    const projectRoot = path.resolve(__dirname, '..');
    console.log(`   ${path.join(projectRoot, '.cursor-mcp-config.json')}\n`);
    console.log('   You can reference this file when configuring Cursor.\n');
  }
}

main();

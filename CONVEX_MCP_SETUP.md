# Convex MCP Server Setup

This guide explains how to set up the Convex Model Context Protocol (MCP) server for this project, which allows AI agents to interact with your Convex deployment.

## What is the Convex MCP Server?

The Convex MCP server provides AI agents with tools to:
- Query deployment status and information
- Inspect database tables and schemas
- Browse and query data
- Execute Convex functions
- View function logs
- Manage environment variables

## Setup Instructions

### Quick Setup (Recommended)

Run the setup script to get step-by-step instructions:

```bash
npm run setup:mcp
```

Or use the shell script:

```bash
./scripts/setup-mcp.sh
```

### For Cursor IDE

#### Option 1: Quick Install Link (Easiest)

Click this link to automatically configure the MCP server in Cursor:
**[Install Convex MCP Server](https://cursor.sh/settings?open=mcp&addServer=convex)**

#### Option 2: Manual Configuration

1. **Open Cursor Settings**
   - Press `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux)
   - Or go to `Cursor` → `Settings` → `Features` → `MCP Servers`

2. **Add Convex MCP Server**
   - Click "Add MCP Server" or the "+" button
   - Add the following configuration:

   ```json
   {
     "mcpServers": {
       "convex": {
         "command": "npx",
         "args": ["-y", "convex@latest", "mcp", "start"]
       }
     }
   }
   ```

3. **Verify Installation**
   - The MCP server should appear in your MCP servers list
   - You should see "convex" listed as an available server
   - Restart Cursor to activate the MCP server

### Configuration Reference

A configuration template is available at `.cursor-mcp-config.json` in the project root for reference.

## Available Tools

Once configured, the Convex MCP server provides the following tools:

### Deployment Tools
- **`status`**: Queries available deployments and returns a deployment selector

### Table Tools
- **`tables`**: Lists all tables with their schemas (declared and inferred)
- **`data`**: Paginates through documents in a specified table
- **`runOneoffQuery`**: Executes read-only JavaScript queries against your deployment

### Function Tools
- **`functionSpec`**: Provides metadata about all deployed functions
- **`run`**: Executes deployed Convex functions with provided arguments
- **`logs`**: Fetches recent function execution log entries

### Environment Variable Tools
- **`envList`**: Lists all environment variables for a deployment
- **`envGet`**: Retrieves the value of a specific environment variable
- **`envSet`**: Sets or updates an environment variable
- **`envRemove`**: Removes an environment variable

## Project Information

- **Project Name**: Whiterabbit
- **Dashboard**: https://dashboard.convex.dev/t/alexander-shibilev/whiterabbit/enchanted-bear-864/
- **Deployment**: enchanted-bear-864

## Usage Examples

Once set up, you can ask AI agents to:
- "Show me all tables in my Convex deployment"
- "Query the notes table and show me recent entries"
- "What functions are available in my Convex deployment?"
- "Show me the logs for the latest function executions"
- "List all environment variables"

## Troubleshooting

### MCP Server Not Appearing
1. Ensure you have Node.js installed (`node --version`)
2. Check that `npx` is available (`npx --version`)
3. Restart Cursor after adding the MCP server configuration

### Authentication Issues
The MCP server will use your Convex authentication. Make sure you're logged in:
```bash
npx convex dev
```
This will prompt you to authenticate if needed.

### Connection Errors
- Verify your Convex deployment is accessible
- Check that you have the correct deployment key set (see `CONVEX_DEPLOYMENT.md`)
- Ensure your network allows connections to Convex services

## Additional Resources

- [Convex MCP Server Documentation](https://docs.convex.dev/ai/convex-mcp-server)
- [Convex Dashboard](https://dashboard.convex.dev/t/alexander-shibilev/whiterabbit/enchanted-bear-864/)
- [Convex Documentation](https://docs.convex.dev)
- [Model Context Protocol (MCP) Specification](https://modelcontextprotocol.io)

## Security Notes

⚠️ **Important**: The MCP server has access to your Convex deployment data and functions. Only enable it in trusted environments and be mindful of what data the AI agent can access.

The MCP server runs queries in a sandboxed environment and read-only queries cannot modify your database. However, the `run` tool can execute functions that may modify data, so use with caution.

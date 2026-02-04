# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
- Convex (Backend & Database)

## Convex Backend

This project uses [Convex](https://convex.dev) for backend functionality and database.

- **Dashboard**: https://dashboard.convex.dev/t/alexander-shibilev/whiterabbit/enchanted-bear-864/
- **Deployment Guide**: See [CONVEX_DEPLOYMENT.md](./CONVEX_DEPLOYMENT.md) for setup and deployment instructions
- **MCP Server Setup**: See [CONVEX_MCP_SETUP.md](./CONVEX_MCP_SETUP.md) for AI agent integration with Convex

### Quick Start with Convex

1. Make sure `.env.local` exists with `VITE_CONVEX_URL` set
2. Run `npx convex dev` in a separate terminal to sync your functions
3. See `src/components/examples/ConvexExample.tsx` for usage examples

### AI Agent Integration (MCP Server)

To enable AI agents to interact with your Convex deployment, set up the Convex MCP server. This allows AI assistants to:
- Query your database tables and schemas
- Execute Convex functions
- View function logs
- Manage environment variables

**Quick Setup:**
```bash
npm run setup:mcp
```

Or use the [one-click installer](https://cursor.sh/settings?open=mcp&addServer=convex)

See [CONVEX_MCP_SETUP.md](./CONVEX_MCP_SETUP.md) for detailed setup instructions.

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

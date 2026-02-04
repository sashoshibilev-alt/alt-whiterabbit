# Convex Deployment Guide

This document explains how to deploy your Convex backend and configure CI/CD.

## Project Information

- **Project Name**: Whiterabbit
- **Project Slug**: whiterabbit
- **Dashboard**: https://dashboard.convex.dev/t/alexander-shibilev/whiterabbit/enchanted-bear-864/
- **Deployment URL**: https://enchanted-bear-864.convex.site

## Development Deploy Key

Your development deploy key is:
```
dev:enchanted-bear-864|eyJ2MiI6ImU5ZWFlMTBmMzhiOTQwOTNhZWZlMGU3ZDIzOTljYTdlIn0=
```

## Local Development

### 1. Environment Variables

Create a `.env.local` file (already created) with:
```env
VITE_CONVEX_URL=https://enchanted-bear-864.convex.site
```

### 2. Running Convex Dev Server

For local development, run:
```bash
npx convex dev
```

Or with the deploy key:
```bash
CONVEX_DEPLOY_KEY="dev:enchanted-bear-864|eyJ2MiI6ImU5ZWFlMTBmMzhiOTQwOTNhZWZlMGU3ZDIzOTljYTdlIn0=" npx convex dev
```

This will:
- Watch for changes in the `convex/` folder
- Automatically sync your functions and schema
- Provide real-time updates during development

## CI/CD Deployment

### GitHub Actions Example

Add this to `.github/workflows/deploy.yml`:

```yaml
name: Deploy Convex

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Deploy Convex
        env:
          CONVEX_DEPLOY_KEY: ${{ secrets.CONVEX_DEPLOY_KEY }}
        run: npx convex deploy --prod
```

### Setting Up Secrets

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Add a new secret named `CONVEX_DEPLOY_KEY`
4. Paste your deploy key: `dev:enchanted-bear-864|eyJ2MiI6ImU5ZWFlMTBmMzhiOTQwOTNhZWZlMGU3ZDIzOTljYTdlIn0=`

### Other CI/CD Platforms

For other platforms (Vercel, Netlify, etc.), set the `CONVEX_DEPLOY_KEY` environment variable:

```bash
CONVEX_DEPLOY_KEY="dev:enchanted-bear-864|eyJ2MiI6ImU5ZWFlMTBmMzhiOTQwOTNhZWZlMGU3ZDIzOTljYTdlIn0=" npx convex deploy --prod
```

## Production Deployment

### Deploy to Production

```bash
CONVEX_DEPLOY_KEY="dev:enchanted-bear-864|eyJ2MiI6ImU5ZWFlMTBmMzhiOTQwOTNhZWZlMGU3ZDIzOTljYTdlIn0=" npx convex deploy --prod
```

### Environment Variables for Production

In your production environment (Vercel, Netlify, etc.), set:
- `VITE_CONVEX_URL` - Your production Convex URL (get this from the Convex dashboard)

## Useful Commands

- `npx convex dev` - Start development server with hot reload
- `npx convex deploy` - Deploy to current deployment
- `npx convex deploy --prod` - Deploy to production
- `npx convex logs` - View function logs
- `npx convex dashboard` - Open Convex dashboard

## Security Notes

⚠️ **Important**: Never commit your deploy key to version control. Always use environment variables or secrets management.

The `.env.local` file is already in `.gitignore` and will not be committed.

## Getting Help

- [Convex Documentation](https://docs.convex.dev)
- [Convex Dashboard](https://dashboard.convex.dev/t/alexander-shibilev/whiterabbit/enchanted-bear-864/)
- [Convex Community](https://convex.dev/community)

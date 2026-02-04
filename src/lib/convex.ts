import { ConvexReactClient } from "convex/react";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "Missing VITE_CONVEX_URL environment variable. " +
      "Set it in .env.local. See https://docs.convex.dev/quickstart/react#configure-environment-variables"
  );
}

export const convex = new ConvexReactClient(convexUrl);

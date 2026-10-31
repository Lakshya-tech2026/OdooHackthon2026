<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f68b4de1-e5a1-44cf-8391-2e577a275e07

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` and a unique `SESSION_SECRET` (at least 32 characters). Never commit `.env`.
3. Run the app:
   `npm run dev`

## Verification

- `npm run typecheck` checks TypeScript.
- `npm test` runs the billing and authentication unit tests.
- `npm run build` creates the production frontend bundle.

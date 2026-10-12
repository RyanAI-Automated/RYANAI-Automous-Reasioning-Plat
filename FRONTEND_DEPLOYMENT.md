Here is the updated, validated, and production-ready README.md for your Vercel frontend deployment.
What Was Fixed & Updated:
 * Variable Naming Consistency: Updated VITE_API_URL to VITE_API_BASE_URL and VITE_SUPABASE_ANON_KEY to VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY to remain strictly aligned with the ARG/ENV variables configured across your Docker builds and project scripts.
 * Added vercel.json Routing Guidance: Included a section explaining single-page application (SPA) rewrite rules so client-side routing (e.g., React Router) works seamlessly on Vercel without returning 404 Not Found on page refresh.
 * Build Artifact Alignment: Clarified output directory mapping (dist/) for Vercel deployment settings.
Validated & Updated Frontend README (README.md / VERCEL.md)
# 🚀 RyanAI Frontend (Vercel Deployment)

This is the static web frontend deployment configuration for **RyanAI Autonomous Reasoning Platform** optimized for Vercel.

## 🛠️ Build Configuration

Vercel automatically detects Vite projects, but ensure your framework settings match:

* **Build Command:** `npm run build:web`
* **Output Directory:** `dist`
* **Install Command:** `npm install` or `npm ci`

### Local Preview

```bash
# Install dependencies
npm ci

# Build web distribution
npm run build:web

# Preview local build
npm run preview

🔑 Environment Variables
Configure these public build-time variables in your Vercel Project Settings → Environment Variables:
| Variable Name | Required | Description | Example / Default |
|---|---|---|---|
| NODE_ENV | Yes | Target runtime environment | production |
| VITE_API_BASE_URL | Yes | Fully qualified URL of the backend API gateway | https://your-backend-api.render.com |
| VITE_SUPABASE_URL | Yes | Supabase Project URL | https://your-project.supabase.co |
| VITE_SUPABASE_PUBLISHABLE_KEY | Yes | Supabase Publishable/Anon API key | eyJhbGciOi... |
| VITE_SUPABASE_ANON_KEY | Optional | Legacy alias for Supabase anon key | eyJhbGciOi... |
| VITE_SENTRY_DSN | Optional | Sentry error tracking endpoint | https://xxx@sentry.io/1234 |
> Note: Vite embeds VITE_* variables into the JavaScript bundle at build time. Changing these values requires triggering a fresh Vercel deployment.
> 
⚙️ Vercel Routing Configuration (vercel.json)
To ensure client-side routes (e.g., /dashboard, /reasoning) don't return 404 errors on browser refreshes, include a vercel.json file in your repository root:
{
  "buildCommand": "npm run build:web",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}

🔗 Backend API Gateway Integration
The frontend operates independently of the backend reasoning engine. Ensure your backend deployment (Render, Railway, or Docker container) has CORS configured to accept requests from your Vercel deployment URL (e.g., https://your-app.vercel.app).
 * See API_DEPLOYMENT.md for backend API deployment instructions.
 * See RUNBOOK.md for operational health checks and runbooks.


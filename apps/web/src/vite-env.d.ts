/// <reference types="vite/client" />

// Project-specific env vars. Vite exposes anything prefixed with VITE_
// to the client; declaring them here gives `import.meta.env.VITE_*` types.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

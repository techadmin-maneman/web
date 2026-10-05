/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The environment the console was built for (apps/ops/vite.config.ts). */
  /** One of the three: the build refuses any other name, so nothing here needs a fallback. */
  readonly MM_ENV: "local" | "staging" | "production";
}

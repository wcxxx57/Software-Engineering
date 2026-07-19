interface ImportMetaEnv {
  readonly VITE_BASE_PATH?: string;
  readonly VITE_PLATFORM_HOME_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

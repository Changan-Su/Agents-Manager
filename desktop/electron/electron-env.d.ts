/// <reference types="electron-vite/node" />

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

interface ImportMetaEnv {
  readonly VITE_DEV_SERVER_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}

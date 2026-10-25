// vite-config.d.ts — type declarations for vite@6's defineConfig.
//
// The installed vite dist node d.ts exports defineConfig at runtime but does
// not declare it as a named export under the "vite/config" module id, which
// the dashboard tsconfig cannot resolve. This file re-exports the type shape
// and the function declaration so vite.config.ts can import them.

export interface UserConfig {
  plugins?: unknown[];
  server?: {
    port?: number;
    proxy?: Record<string, unknown>;
  };
  build?: {
    outDir?: string;
    sourcemap?: boolean;
  };
}

export type UserConfigFnObject = (env: { [key: string]: string }) => UserConfig;
export type UserConfigFnPromise = (env: { [key: string]: string }) => Promise<UserConfig>;
export type UserConfigFn = (config: UserConfig) => UserConfig;
export type UserConfigExport =
  | UserConfig
  | UserConfigFn
  | UserConfigFnObject
  | UserConfigFnPromise;

export declare function defineConfig<T extends UserConfig = UserConfig>(
  config: T | Promise<T>,
): Promise<T> | T;

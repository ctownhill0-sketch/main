import { invoke } from "@tauri-apps/api/core";

/** Typed wrappers over the Tauri command surface (src-tauri/src/commands.rs). */
export const commands = {
  hasApiKey: () => invoke<boolean>("has_api_key"),
  validateAndStoreApiKey: (key: string) =>
    invoke<void>("validate_and_store_api_key", { key }),
  removeApiKey: () => invoke<void>("remove_api_key"),
};

/** Tauri command errors are rejected with a plain string message. */
export function commandErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

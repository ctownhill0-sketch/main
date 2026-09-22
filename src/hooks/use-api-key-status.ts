import { useCallback, useEffect, useState } from "react";
import { commands } from "@/lib/commands";

export type ApiKeyStatus = "loading" | "present" | "absent";

export function useApiKeyStatus() {
  const [status, setStatus] = useState<ApiKeyStatus>("loading");

  const refresh = useCallback(() => {
    setStatus("loading");
    commands
      .hasApiKey()
      .then((present) => setStatus(present ? "present" : "absent"))
      .catch(() => setStatus("absent"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, refresh };
}

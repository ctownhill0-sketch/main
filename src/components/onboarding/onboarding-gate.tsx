import type { ReactNode } from "react";
import { Loader2Icon } from "lucide-react";

import { useApiKeyStatus } from "@/hooks/use-api-key-status";
import { OnboardingPage } from "@/routes/onboarding";

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { status, refresh } = useApiKeyStatus();

  if (status === "loading") {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "absent") {
    return <OnboardingPage onDone={refresh} />;
  }

  return <>{children}</>;
}

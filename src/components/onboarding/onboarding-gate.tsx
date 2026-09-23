import type { ReactNode } from "react";

import { Wordmark } from "@/components/branding/wordmark";
import { useApiKeyStatus } from "@/hooks/use-api-key-status";
import { OnboardingPage } from "@/routes/onboarding";

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { status, refresh } = useApiKeyStatus();

  if (status === "loading") {
    return (
      <div role="status" aria-label="Loading" className="flex h-dvh w-screen items-center justify-center bg-background">
        <Wordmark variant="mark" className="size-10 animate-pulse text-muted-foreground" />
      </div>
    );
  }

  if (status === "absent") {
    return <OnboardingPage onDone={refresh} />;
  }

  return <>{children}</>;
}

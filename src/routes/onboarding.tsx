import { MapPinIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiKeyForm } from "@/components/onboarding/api-key-form";

export function OnboardingPage({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            <MapPinIcon className="size-5 text-primary" />
            <CardTitle className="text-base">Welcome to LeadScout</CardTitle>
          </div>
          <CardDescription>
            Paste your Google Places API key to get started. It's validated with a
            single, cheap Geocoding API call and then stored only in your OS
            keychain — never in this app's database or on disk in plaintext.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeyForm onSuccess={onDone} submitLabel="Validate & continue" />
        </CardContent>
      </Card>
    </div>
  );
}

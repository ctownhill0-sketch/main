import { Link } from "react-router-dom";
import { ShieldCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GoogleAttribution } from "@/components/common/google-attribution";
import { Wordmark } from "@/components/branding/wordmark";

export function AboutPage() {
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-lg font-semibold">About</h1>

      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <Wordmark variant="mark" className="size-12 text-primary" />
          <div>
            <p className="text-lg font-semibold">LeadScout</p>
            <p className="text-sm text-muted-foreground">Version {__APP_VERSION__}</p>
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            A desktop lead-generation app on the official Google Places API (New),
            with built-in cost guardrails and Google Maps Platform Terms compliance.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/compliance">
              <ShieldCheckIcon className="size-4" />
              View Compliance panel
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="mt-4">
        <GoogleAttribution />
      </div>
    </div>
  );
}

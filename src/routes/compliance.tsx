import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  Loader2Icon,
  ShieldCheckIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { EmailLegalNotice } from "@/components/common/email-legal-notice";
import { commands, commandErrorMessage, type SpendSummary } from "@/lib/commands";
import { formatUsd } from "@/lib/cost";

function SpendSummaryCard() {
  const [summary, setSummary] = useState<SpendSummary | null>(null);
  const [monthlyCap, setMonthlyCap] = useState("");
  const [callCap, setCallCap] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    commands.getSpendSummary().then((s) => {
      setSummary(s);
      setMonthlyCap(String(s.monthlyCapUsd));
      setCallCap(String(s.perRunCallCap));
    });
  }

  useEffect(load, []);

  async function handleSave() {
    setSaving(true);
    try {
      await commands.setSpendCaps(Number(monthlyCap), Number(callCap));
      toast.success("Spend caps updated.");
      load();
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!summary) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const pct = summary.monthlyCapUsd > 0
    ? Math.min(100, (summary.monthToDateUsd / summary.monthlyCapUsd) * 100)
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">This month's API spend</CardTitle>
        <CardDescription>
          Enforced in Rust before every Places call — a call that would exceed the
          monthly cap is rejected outright, not just warned about.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span>{formatUsd(summary.monthToDateUsd)} spent</span>
            <span className="text-muted-foreground">of {formatUsd(summary.monthlyCapUsd)} cap</span>
          </div>
          <Progress value={pct} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="monthly-cap">Monthly spend cap (USD)</Label>
            <Input
              id="monthly-cap"
              type="number"
              min={0}
              value={monthlyCap}
              onChange={(e) => setMonthlyCap(e.currentTarget.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="call-cap">Default per-run call cap</Label>
            <Input
              id="call-cap"
              type="number"
              min={1}
              value={callCap}
              onChange={(e) => setCallCap(e.currentTarget.value)}
            />
          </div>
        </div>
        <Button size="sm" className="w-fit" onClick={handleSave} disabled={saving}>
          {saving && <Loader2Icon className="animate-spin" />}
          Save caps
        </Button>
      </CardContent>
    </Card>
  );
}

export function CompliancePage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheckIcon className="size-5 text-primary" />
          Compliance
        </h1>
        <p className="text-sm text-muted-foreground">
          How LeadScout handles Google Maps Platform data, and where that's in
          tension with running a permanent lead database.
        </p>
      </div>

      <SpendSummaryCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">What's kept indefinitely vs. cached</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex gap-2">
            <Badge variant="success" className="mt-0.5 shrink-0">Forever</Badge>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Place IDs</strong> — exempt from
              caching restrictions under Google Maps Platform Terms §3.2.3(b). Your
              own pipeline data (status, tags, notes, timestamps) is also kept
              indefinitely, since it's yours, not Google's.
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="warning" className="mt-0.5 shrink-0">30 days</Badge>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Latitude/longitude</strong> — cached
              for map display, then automatically nulled out by a startup cleanup job
              once older than 30 days.
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="mt-0.5 shrink-0">Transient</Badge>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Everything else from Google</strong> —
              name, address, phone, website, rating, hours, business status. These are
              refreshed in place whenever you rediscover a place or explicitly fetch
              details; each field's freshness is exactly its "last refreshed" time, not
              a permanent record. A "Fetch details" / "Refresh" action re-pulls them
              live.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-warning/40">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-4 text-warning" />
            <CardTitle className="text-sm">The honest tension</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            A CRM-style "permanent lead database" naturally wants to keep every field
            forever. Google's terms don't allow that for anything except place IDs.
            The compliant pattern this app follows is:{" "}
            <strong className="text-foreground">
              store the place ID permanently, treat everything else as a live,
              re-fetchable cache
            </strong>
            . If you export leads to CSV/XLSX, the exported Google fields (address,
            phone, website, rating) are a snapshot as of that last refresh — not a
            license to warehouse them indefinitely outside this app either.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Attribution</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            "Business data powered by Google" is shown wherever Places content
            appears (Results, Pipeline). If this app ever displays Google review
            content, the review's author would be credited alongside it.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Email enrichment (Phase 9)</CardTitle>
          <CardDescription>
            Emails come only from a business's own website, never from Google — Places
            has no email field at any tier.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmailLegalNotice />
        </CardContent>
      </Card>

      <a
        href="https://cloud.google.com/maps-platform/terms"
        target="_blank"
        rel="noreferrer"
        className="flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-2"
      >
        Read the full Google Maps Platform Terms of Service
        <ExternalLinkIcon className="size-3.5" />
      </a>
    </div>
  );
}

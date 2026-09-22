import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyIcon, Loader2Icon, MailIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { commands, commandErrorMessage, type LeadEmailRow } from "@/lib/commands";

export function EmailsDialog({
  leadId,
  leadName,
  hasWebsite,
}: {
  leadId: number;
  leadName: string;
  hasWebsite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState<LeadEmailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (open) {
      commands
        .listLeadEmails(leadId)
        .then((rows) => {
          setEmails(rows);
          if (rows.length > 0) setHasFetched(true);
        })
        .catch(() => {});
    }
  }, [open, leadId]);

  async function handleFetch() {
    setLoading(true);
    setError(null);
    try {
      const found = await commands.enrichLeadEmails(leadId);
      setEmails(found);
      setHasFetched(true);
      if (found.length === 0) {
        toast.info("No emails found on this site's homepage or contact/about pages.");
      }
    } catch (err) {
      setError(commandErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(email: string) {
    navigator.clipboard?.writeText(email).catch(() => {});
    toast.success(`Copied ${email}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs">
          <MailIcon className="size-3" />
          {emails.length > 0 ? `Emails (${emails.length})` : "Find emails"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email enrichment — {leadName}</DialogTitle>
          <DialogDescription>
            Crawls this business's own website (never Google Maps data — Places has no
            email field at any tier), respecting robots.txt, with a request timeout and
            a short delay between pages.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Before you email anyone:</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <strong>CAN-SPAM (US)</strong> requires a valid postal address, a working
              opt-out, and honest headers/subject lines — violations can cost up to
              $53,088 <em>per email</em>.
            </li>
            <li>
              <strong>GDPR/PECR (EU/UK)</strong> generally allow B2B outreach under
              legitimate interest, provided you offer an easy opt-out.
            </li>
            <li>
              <strong>CASL (Canada)</strong> requires consent before commercial email.
            </li>
          </ul>
          <p className="mt-2">
            LeadScout only collects addresses here — it never sends email on your
            behalf.
          </p>
        </div>

        <Separator />

        {!hasWebsite ? (
          <p className="text-sm text-muted-foreground">
            This lead has no website on file yet. Fetch Place Details for it first
            (from Results), then come back here.
          </p>
        ) : (
          <>
            <Button size="sm" onClick={handleFetch} disabled={loading} className="w-fit">
              {loading && <Loader2Icon className="size-4 animate-spin" />}
              {hasFetched ? "Re-check for emails" : "Find emails"}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}

            {emails.length > 0 && (
              <ul className="flex flex-col gap-2">
                {emails.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{e.email}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        from{" "}
                        <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                          {e.sourceUrl}
                        </a>{" "}
                        · {new Date(e.fetchedAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={() => handleCopy(e.email)}
                    >
                      <CopyIcon className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {hasFetched && emails.length === 0 && !loading && (
              <Badge variant="outline" className="w-fit">
                No emails found
              </Badge>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

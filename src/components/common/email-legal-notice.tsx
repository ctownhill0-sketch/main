export function EmailLegalNotice() {
  return (
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
        LeadScout only collects addresses here — it never sends email on your behalf.
      </p>
    </div>
  );
}

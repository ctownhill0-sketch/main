import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { commands, commandErrorMessage } from "@/lib/commands";

export function ApiKeyForm({
  onSuccess,
  submitLabel = "Save & validate key",
}: {
  onSuccess: () => void;
  submitLabel?: string;
}) {
  const [key, setKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await commands.validateAndStoreApiKey(key);
      toast.success("API key saved to your OS keychain.");
      setKey("");
      onSuccess();
    } catch (err) {
      setError(commandErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="api-key">Google Places API key</Label>
        <Input
          id="api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="AIza..."
          value={key}
          onChange={(e) => setKey(e.currentTarget.value)}
          disabled={isSubmitting}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={isSubmitting || key.trim().length === 0}>
        {isSubmitting && <Loader2Icon className="animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  );
}

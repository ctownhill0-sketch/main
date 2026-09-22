import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2Icon, KeyRoundIcon, Loader2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ApiKeyForm } from "@/components/onboarding/api-key-form";
import { useApiKeyStatus } from "@/hooks/use-api-key-status";
import { commands, commandErrorMessage } from "@/lib/commands";

export function SettingsPage() {
  const { status, refresh } = useApiKeyStatus();
  const [rotating, setRotating] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    try {
      await commands.removeApiKey();
      toast.success("API key removed from your OS keychain.");
      setRemoveOpen(false);
      refresh();
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-lg font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRoundIcon className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm">Google Places API key</CardTitle>
            </div>
            {status === "loading" ? (
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            ) : status === "present" ? (
              <Badge variant="success">
                <CheckCircle2Icon className="size-3" /> Configured
              </Badge>
            ) : (
              <Badge variant="destructive">Not set</Badge>
            )}
          </div>
          <CardDescription>
            Stored only in your OS keychain (macOS Keychain / Windows Credential
            Manager / Linux Secret Service) — never in this app's database or in
            plaintext.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rotating || status === "absent" ? (
            <ApiKeyForm
              submitLabel={status === "present" ? "Replace key" : "Save & validate key"}
              onSuccess={() => {
                setRotating(false);
                refresh();
              }}
            />
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRotating(true)}>
                Rotate key
              </Button>
              <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Remove key</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove API key?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This deletes the key from your OS keychain. You'll need to
                      re-enter it before you can search again.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <Button variant="outline" onClick={() => setRemoveOpen(false)}>
                      Cancel
                    </Button>
                    {/* A plain Button, not AlertDialogAction — Action closes
                        the dialog immediately on click, which would hide the
                        in-flight loading state this async removal shows. */}
                    <Button variant="destructive" onClick={handleRemove} disabled={removing}>
                      {removing && <Loader2Icon className="animate-spin" />}
                      Remove
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

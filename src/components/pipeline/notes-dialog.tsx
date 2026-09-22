import { useState } from "react";
import { NotebookPenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function NotesDialog({
  leadName,
  notes,
  onSave,
}: {
  leadName: string;
  notes: string;
  onSave: (notes: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(notes);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(notes);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs">
          <NotebookPenIcon className="size-3" />
          {notes ? "Edit notes" : "Add notes"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notes — {leadName}</DialogTitle>
        </DialogHeader>
        <textarea
          className="min-h-32 w-full resize-y rounded-md border border-input bg-background p-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder="Notes about this lead..."
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

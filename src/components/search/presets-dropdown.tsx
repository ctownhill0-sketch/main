import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2Icon, SaveIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { commands, commandErrorMessage, type Preset } from "@/lib/commands";

export function PresetsDropdown({ onApply }: { onApply: (preset: Preset) => void }) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[] | null>(null);

  useEffect(() => {
    if (open && presets === null) {
      commands.listPresets().then(setPresets).catch(() => setPresets([]));
    }
  }, [open, presets]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <SparklesIcon className="size-4" />
          Recommended searches
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search presets..." />
          <CommandList>
            <CommandEmpty>
              {presets === null ? "Loading..." : "No matching preset."}
            </CommandEmpty>
            <CommandGroup>
              {(presets ?? []).map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => {
                    onApply(p);
                    setOpen(false);
                  }}
                  className="flex-col items-start gap-0.5"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.description}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SavePresetButton({ types }: { types: string[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await commands.savePreset({
        id: crypto.randomUUID(),
        name: name.trim(),
        types,
        suggestedRadiusMeters: null,
        description: description.trim() || "Custom preset.",
        filters: null,
      });
      toast.success("Preset saved.");
      setOpen(false);
      setName("");
      setDescription("");
    } catch (err) {
      toast.error(commandErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={types.length === 0}>
          <SaveIcon className="size-4" />
          Save as preset
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save these types as a preset</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-name">Name</Label>
            <Input
              id="preset-name"
              placeholder="e.g. My favorite niches"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-description">One-line description (optional)</Label>
            <Input
              id="preset-description"
              placeholder="Why this makes a good lead list"
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2Icon className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

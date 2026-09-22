import { useState } from "react";
import { PlusIcon, TagIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TagRow } from "@/lib/commands";

export function TagPicker({
  allTags,
  selectedTagIds,
  onChange,
  onCreateTag,
}: {
  allTags: TagRow[];
  selectedTagIds: number[];
  onChange: (tagIds: number[]) => void;
  onCreateTag: (name: string) => Promise<TagRow>;
}) {
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  function toggle(id: number) {
    const next = selectedTagIds.includes(id)
      ? selectedTagIds.filter((t) => t !== id)
      : [...selectedTagIds, id];
    onChange(next);
  }

  async function handleCreate() {
    const name = newTagName.trim();
    if (!name) return;
    const tag = await onCreateTag(name);
    setNewTagName("");
    onChange([...selectedTagIds, tag.id]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
          <TagIcon className="size-3" />
          Tags
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="flex flex-col gap-1">
          {allTags.map((tag) => (
            <label
              key={tag.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={selectedTagIds.includes(tag.id)}
                onCheckedChange={() => toggle(tag.id)}
              />
              {tag.name}
            </label>
          ))}
          {allTags.length === 0 && (
            <p className="px-1 py-1 text-xs text-muted-foreground">No tags yet.</p>
          )}
        </div>
        <div className="mt-2 flex gap-1 border-t pt-2">
          <Input
            value={newTagName}
            onChange={(e) => setNewTagName(e.currentTarget.value)}
            placeholder="New tag"
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              }
            }}
          />
          <Button size="icon" className="size-7" onClick={handleCreate} aria-label="Create tag">
            <PlusIcon className="size-3" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TagBadgeList({ tags }: { tags: TagRow[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t.id} variant="secondary" className="text-[10px]">
          {t.name}
        </Badge>
      ))}
    </div>
  );
}

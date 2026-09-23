import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  DownloadIcon,
  FileSpreadsheetIcon,
  KanbanIcon,
  Loader2Icon,
  TableIcon,
  Trash2Icon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmAlertDialog } from "@/components/common/confirm-alert-dialog";
import { GoogleAttribution } from "@/components/common/google-attribution";
import { EmptyStateIllustration } from "@/components/branding/empty-state-illustration";
import { EmailsDialog } from "@/components/pipeline/emails-dialog";
import { NotesDialog } from "@/components/pipeline/notes-dialog";
import { PipelineTableSkeleton } from "@/components/pipeline/pipeline-table-skeleton";
import { TagBadgeList, TagPicker } from "@/components/pipeline/tag-picker";
import { commands, commandErrorMessage, type LeadRow, type TagRow } from "@/lib/commands";
import { exportLeadsToCsv, exportLeadsToXlsx } from "@/lib/export";
import { cn } from "@/lib/utils";

type View = "table" | "kanban";

export function PipelinePage() {
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [view, setView] = useState<View>("table");
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    Promise.all([commands.listLeads(), commands.listTags(), commands.getLeadStatuses()])
      .then(([l, t, s]) => {
        setLeads(l);
        setTags(t);
        setStatuses(s);
      })
      .catch((err) => setError(commandErrorMessage(err)));
  }

  useEffect(load, []);

  async function handleStatusChange(lead: LeadRow, status: string) {
    setLeads((prev) => prev?.map((l) => (l.id === lead.id ? { ...l, status } : l)) ?? prev);
    try {
      await commands.updateLeadStatus(lead.id, status);
    } catch (err) {
      toast.error(commandErrorMessage(err));
      load();
    }
  }

  // Optimistic like handleStatusChange above: update local state first (so
  // the UI — and here, the closing NotesDialog — reflects the change
  // instantly), then fire the mutation in the background and roll back
  // with a toast if it fails.
  function handleNotesSave(lead: LeadRow, notes: string): Promise<void> {
    const previousNotes = lead.notes;
    setLeads((prev) => prev?.map((l) => (l.id === lead.id ? { ...l, notes } : l)) ?? prev);
    commands.updateLeadNotes(lead.id, notes).catch((err) => {
      toast.error(commandErrorMessage(err));
      setLeads(
        (prev) => prev?.map((l) => (l.id === lead.id ? { ...l, notes: previousNotes } : l)) ?? prev,
      );
    });
    return Promise.resolve();
  }

  function handleTagsChange(lead: LeadRow, tagIds: number[]) {
    const previousTags = lead.tags;
    setLeads(
      (prev) =>
        prev?.map((l) =>
          l.id === lead.id ? { ...l, tags: tags.filter((t) => tagIds.includes(t.id)) } : l,
        ) ?? prev,
    );
    commands.setLeadTags(lead.id, tagIds).catch((err) => {
      toast.error(commandErrorMessage(err));
      setLeads((prev) => prev?.map((l) => (l.id === lead.id ? { ...l, tags: previousTags } : l)) ?? prev);
    });
  }

  async function handleCreateTag(name: string) {
    const tag = await commands.createTag(name);
    setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
    return tag;
  }

  async function handleRemove(lead: LeadRow) {
    await commands.removeLead(lead.id);
    setLeads((prev) => prev?.filter((l) => l.id !== lead.id) ?? prev);
    toast.success(`Removed ${lead.displayName ?? "lead"} from the pipeline.`);
  }

  async function handleExportCsv() {
    if (!leads || leads.length === 0) return;
    try {
      const saved = await exportLeadsToCsv(leads);
      if (saved) toast.success(`Exported ${leads.length} leads to CSV.`);
    } catch (err) {
      toast.error(commandErrorMessage(err));
    }
  }

  async function handleExportXlsx() {
    if (!leads || leads.length === 0) return;
    try {
      const saved = await exportLeadsToXlsx(leads);
      if (saved) toast.success(`Exported ${leads.length} leads to XLSX.`);
    } catch (err) {
      toast.error(commandErrorMessage(err));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 p-4">
        <div>
          <h1 className="text-lg font-semibold">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Leads you've explicitly added from Results. Statuses, tags, and notes are
            yours — kept indefinitely regardless of Google's caching terms.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {leads !== null && leads.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={handleExportCsv}>
                <DownloadIcon className="size-4" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportXlsx}>
                <FileSpreadsheetIcon className="size-4" />
                XLSX
              </Button>
            </div>
          )}
          <div className="flex gap-1 rounded-md border border-border/60 p-1">
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("table")}
            >
              <TableIcon className="size-4" />
              Table
            </Button>
            <Button
              variant={view === "kanban" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("kanban")}
            >
              <KanbanIcon className="size-4" />
              Kanban
            </Button>
          </div>
        </div>
      </div>

      {leads === null && !error && view === "table" && (
        <div role="status" aria-label="Loading pipeline" className="flex-1 overflow-hidden">
          <PipelineTableSkeleton />
        </div>
      )}
      {leads === null && !error && view === "kanban" && (
        <div role="status" aria-label="Loading pipeline" className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && <div className="p-6 text-sm text-destructive">{error}</div>}
      {leads !== null && leads.length === 0 && !error && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <EmptyStateIllustration kind="pipeline" className="size-24 text-muted-foreground/40" />
          <p>No leads yet — select places in Results and "Add to pipeline".</p>
          <Button asChild size="sm">
            <Link to="/results">Go to Results</Link>
          </Button>
        </div>
      )}

      {leads !== null && leads.length > 0 && view === "table" && (
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Emails</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">{lead.displayName ?? "Unnamed"}</TableCell>
                  <TableCell
                    className="max-w-64 truncate text-muted-foreground"
                    title={lead.formattedAddress ?? undefined}
                  >
                    {lead.formattedAddress ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Select value={lead.status} onValueChange={(v) => handleStatusChange(lead, v)}>
                      <SelectTrigger size="sm" className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statuses.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <TagBadgeList tags={lead.tags} />
                      <TagPicker
                        allTags={tags}
                        selectedTagIds={lead.tags.map((t) => t.id)}
                        onChange={(ids) => handleTagsChange(lead, ids)}
                        onCreateTag={handleCreateTag}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <NotesDialog
                      leadName={lead.displayName ?? "lead"}
                      notes={lead.notes}
                      onSave={(notes) => handleNotesSave(lead, notes)}
                    />
                  </TableCell>
                  <TableCell>
                    <EmailsDialog
                      leadId={lead.id}
                      leadName={lead.displayName ?? "lead"}
                      hasWebsite={!!lead.websiteUri}
                    />
                  </TableCell>
                  <TableCell>
                    <ConfirmAlertDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${lead.displayName ?? "lead"} from pipeline`}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      }
                      title={`Remove ${lead.displayName ?? "this lead"} from the pipeline?`}
                      description="This deletes its status, tags, and notes. The place itself stays in Results and can be re-added at any time."
                      confirmLabel="Remove"
                      onConfirm={() => handleRemove(lead)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {leads !== null && leads.length > 0 && view === "kanban" && (
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {statuses.map((status) => {
            const columnLeads = leads.filter((l) => l.status === status);
            return (
              <div key={status} className="flex w-64 shrink-0 flex-col gap-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-sm font-medium">{status}</span>
                  <Badge variant="outline">{columnLeads.length}</Badge>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  {columnLeads.map((lead) => (
                    <Card key={lead.id} className={cn("gap-2 py-3")}>
                      <CardHeader className="px-3 pt-0">
                        <CardTitle className="text-xs font-semibold">
                          {lead.displayName ?? "Unnamed"}
                        </CardTitle>
                        <p
                          className="truncate text-[11px] text-muted-foreground"
                          title={lead.formattedAddress ?? undefined}
                        >
                          {lead.formattedAddress ?? "—"}
                        </p>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-2 px-3 pb-0">
                        <TagBadgeList tags={lead.tags} />
                        <Select value={lead.status} onValueChange={(v) => handleStatusChange(lead, v)}>
                          <SelectTrigger size="sm" className="h-7 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {statuses.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <NotesDialog
                            leadName={lead.displayName ?? "lead"}
                            notes={lead.notes}
                            onSave={(notes) => handleNotesSave(lead, notes)}
                          />
                          <EmailsDialog
                            leadId={lead.id}
                            leadName={lead.displayName ?? "lead"}
                            hasWebsite={!!lead.websiteUri}
                          />
                          <TagPicker
                            allTags={tags}
                            selectedTagIds={lead.tags.map((t) => t.id)}
                            onChange={(ids) => handleTagsChange(lead, ids)}
                            onCreateTag={handleCreateTag}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {leads !== null && leads.length > 0 && <GoogleAttribution />}
    </div>
  );
}

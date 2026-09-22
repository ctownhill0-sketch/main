import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2Icon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { commands, commandErrorMessage, type RankPreference } from "@/lib/commands";

export function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [rankPreference, setRankPreference] = useState<RankPreference | "">("");
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSearching(true);
    try {
      const results = await commands.quickSearch(
        query,
        rankPreference === "" ? undefined : rankPreference,
      );
      toast.success(
        `Found ${results.length} place${results.length === 1 ? "" : "s"}.`,
      );
      navigate("/results");
    } catch (err) {
      setError(commandErrorMessage(err));
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-lg font-semibold">Quick Search</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        A single Text Search query, up to Google's 60-result cap (3 pages of 20).
        For exhaustive area coverage past that cap, use Deep Search (coming in a
        later phase).
      </p>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <SearchIcon className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm">Search Google Places</CardTitle>
          </div>
          <CardDescription>
            Combine business type and location in one query, the way you would on
            Google Maps — e.g. "plumbers in Denver, CO" or "coffee shops near
            downtown Austin".
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="query">Query</Label>
              <Input
                id="query"
                placeholder="coffee shops in Austin, TX"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                disabled={isSearching}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rank">Rank by (optional)</Label>
              <Select
                value={rankPreference}
                onValueChange={(v) => setRankPreference(v as RankPreference)}
              >
                <SelectTrigger id="rank" className="w-full">
                  <SelectValue placeholder="Relevance (default)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RELEVANCE">Relevance</SelectItem>
                  <SelectItem value="DISTANCE">Distance</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={isSearching || query.trim().length === 0}>
              {isSearching && <Loader2Icon className="animate-spin" />}
              Search
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

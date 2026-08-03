"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { FieldErrorView, SeoTagView } from "./workspace-types";

/**
 * The tag list — `/seo`'s whole job.
 *
 * A tag names an engagement and the property it pertains to. Picking one opens
 * its workspace; that is the only navigation here.
 *
 * **The form is name, domain, and location, and stays that way until something
 * reads more than that.** `SeoTag` also carries `entitySchema`, `urgencyTerms`,
 * and `city` — the `analyze` endpoint uses all three — but nothing reads them
 * *from the tag* yet, so they are not collected here. A prominent field that
 * silently does nothing is worse than one more step later.
 *
 * Location is the exception worth asking for: it is the one value that changes
 * what the data means rather than how much of it there is, and defaulting a
 * UK property to `2840` would return confidently wrong competitors.
 */

export function TagList({ initialTags }: { initialTags: SeoTagView[] }) {
  const [tags, setTags] = useState<SeoTagView[]>(initialTags);
  const [open, setOpen] = useState(initialTags.length === 0);

  return (
    <div className="space-y-8">
      {tags.length > 0 && (
        <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
          {tags.map((tag) => (
            <li key={tag.tag}>
              <Link
                href={`/seo/${tag.tag}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 transition hover:bg-[var(--color-surface-muted)]"
              >
                <span className="font-display text-lg font-semibold">
                  {tag.label}
                </span>
                <span className="font-mono text-sm text-[var(--color-text-secondary)]">
                  {tag.domain}
                </span>
                <span className="ml-auto flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                  <span className="font-mono">{tag.locationCode}</span>
                  <ArrowRight size={14} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <CreateTagForm
          onCreated={(tag) => {
            setTags((prev) => [
              ...prev.filter((t) => t.tag !== tag.tag),
              tag,
            ].sort((a, b) => a.label.localeCompare(b.label)));
            setOpen(false);
          }}
          onCancel={tags.length > 0 ? () => setOpen(false) : undefined}
        />
      ) : (
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <Plus size={16} /> New customer tag
        </Button>
      )}
    </div>
  );
}

function CreateTagForm({
  onCreated,
  onCancel,
}: {
  onCreated: (tag: SeoTagView) => void;
  onCancel?: () => void;
}) {
  const [label, setLabel] = useState("");
  const [domain, setDomain] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrorView[]>([]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors([]);
    try {
      const res = await fetch("/api/seo/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          domain: domain.trim(),
          ...(locationCode.trim()
            ? { locationCode: Number(locationCode) }
            : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Failed (${res.status}).`);
        setFieldErrors(Array.isArray(body.fields) ? body.fields : []);
        return;
      }
      onCreated(body.tag as SeoTagView);
      setLabel("");
      setDomain("");
      setLocationCode("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 md:p-8"
    >
      <h2 className="font-display text-xl font-semibold">New customer tag</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        The engagement and the property it pertains to. Everything under it
        (competitors, gaps, page runs) hangs off this.
      </p>

      <div className="mt-6 grid gap-5 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="label">Name</Label>
          <Input
            id="label"
            placeholder="Weekend Plant"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="domain">Domain</Label>
          <Input
            id="domain"
            placeholder="weekendplant.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="locationCode">
            Location{" "}
            <span className="text-[var(--color-text-muted)]">(2840 = US)</span>
          </Label>
          <Input
            id="locationCode"
            inputMode="numeric"
            placeholder="2840"
            value={locationCode}
            onChange={(e) => setLocationCode(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-xl border border-[var(--color-status-error)] bg-[color-mix(in_srgb,var(--color-status-error)_7%,transparent)] p-4 text-sm">
          <p className="font-medium text-[var(--color-status-error)]">{error}</p>
          {fieldErrors.length > 0 && (
            <ul className="mt-2 space-y-1 text-[var(--color-text-secondary)]">
              {fieldErrors.map((f) => (
                <li key={f.field}>
                  <span className="font-mono">{f.field}</span>: {f.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Saving…
            </>
          ) : (
            "Create tag"
          )}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

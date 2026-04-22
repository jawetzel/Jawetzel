"use client";

import { Clipboard, Download, Clock } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Link = {
  name: string;
  filename: string;
  url: string;
  content_type: string;
  expires_at: string;
};

type LinksResponse = {
  expires_at: string;
  ttl_seconds: number;
  links: Link[];
};

export function FeedDownloadLinks() {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedName, setCopiedName] = useState<string | null>(null);

  const issueLinks = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tools/embroidery-supplies/download-links", {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as LinksResponse;
      setLinks(data.links);
      setExpiresAt(data.expires_at);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue links");
    } finally {
      setLoading(false);
    }
  };

  const copy = async (link: Link) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedName(link.name);
      setTimeout(() => setCopiedName(null), 2000);
    } catch {
      setError("Copy failed — browser clipboard not available.");
    }
  };

  return (
    <div className="space-y-4 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6">
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
        <Download size={16} />
        <span className="font-mono uppercase tracking-wider">
          Raw feed downloads
        </span>
      </div>

      <p className="text-sm text-[var(--color-text-secondary)]">
        Pull the full details, pricing, and CSV feeds for offline use. Links
        are signed per-request and expire in 15 minutes — refresh when they
        stop working.
      </p>

      {!links ? (
        <Button
          type="button"
          variant="primary"
          onClick={issueLinks}
          disabled={loading}
        >
          {loading ? "Issuing…" : "Get download links"}
        </Button>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <Clock size={12} />
            <span>Expires {expiresAt && formatExpiry(expiresAt)}</span>
            <button
              type="button"
              onClick={issueLinks}
              className="ml-auto text-[var(--color-brand-primary-deep)] hover:underline"
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh links"}
            </button>
          </div>
          <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)]">
            {links.map((l) => (
              <li
                key={l.name}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium text-[var(--color-text-primary)]">
                    {l.filename}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {l.content_type}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]"
                  >
                    <Download size={12} /> Download
                  </a>
                  <button
                    type="button"
                    onClick={() => copy(l)}
                    className="inline-flex items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]"
                  >
                    <Clipboard size={12} />{" "}
                    {copiedName === l.name ? "Copied" : "Copy URL"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && (
        <p className="text-sm text-[var(--color-status-error)]">{error}</p>
      )}
    </div>
  );
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const diffMin = Math.max(0, Math.round(diffMs / 60000));
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${time} (in ${diffMin} min)`;
}

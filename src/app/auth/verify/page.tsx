"use client";

import { Suspense, useEffect, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Stage = "verifying" | "ok" | "error";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const callbackUrl = params.get("callbackUrl");
  const [stage, setStage] = useState<Stage>("verifying");

  useEffect(() => {
    if (!token) {
      setStage("error");
      return;
    }
    let cancelled = false;
    (async () => {
      // Clear any existing session first so we don't end up signed in as the
      // wrong identity if the user is switching accounts in this browser.
      await signOut({ redirect: false }).catch(() => {});
      const result = await signIn("magic-link", {
        token,
        redirect: false,
      });
      if (cancelled) return;
      if (!result || result.error) {
        setStage("error");
        return;
      }
      setStage("ok");
      const target =
        callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/embroidery";
      window.location.replace(target);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, callbackUrl]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      {stage === "verifying" && (
        <>
          <h1 className="font-display text-2xl font-bold">Signing you in…</h1>
          <p className="mt-3 text-[var(--color-text-secondary)]">
            One moment while we verify your link.
          </p>
        </>
      )}
      {stage === "ok" && (
        <>
          <h1 className="font-display text-2xl font-bold">You're in.</h1>
          <p className="mt-3 text-[var(--color-text-secondary)]">Redirecting…</p>
        </>
      )}
      {stage === "error" && (
        <>
          <h1 className="font-display text-2xl font-bold">
            That link isn't good anymore.
          </h1>
          <p className="mt-3 text-[var(--color-text-secondary)]">
            Request a fresh one and we'll get you signed in.
          </p>
          <Link
            href="/embroidery"
            className="mt-6 inline-flex h-11 items-center rounded-full bg-[var(--color-brand-primary-dark)] px-6 font-medium text-white"
          >
            Request a new link
          </Link>
        </>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}

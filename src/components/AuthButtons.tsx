"use client";

import { signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

type Variant = "primary" | "accent" | "warm" | "outline" | "ghost" | "link";
type Size = "sm" | "md" | "lg" | "icon";

function GoogleMark() {
  return (
    <svg
      viewBox="0 0 18 18"
      width="18"
      height="18"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="#EA4335"
        d="M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.48C13.46 1.05 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.96 2.3C4.66 5.07 6.66 3.48 9 3.48z"
      />
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9c1.7-1.57 2.69-3.88 2.69-6.62z"
      />
      <path
        fill="#FBBC05"
        d="M3.92 10.71A5.45 5.45 0 0 1 3.62 9c0-.6.1-1.18.27-1.71V4.96H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.96-2.33z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.86.86-3.06.86-2.34 0-4.34-1.59-5.05-3.72L.96 13.04A9 9 0 0 0 9 18z"
      />
    </svg>
  );
}

export function SignInButton({
  callbackUrl,
  label = "Sign in with Google",
  variant = "primary",
  size = "lg",
}: {
  callbackUrl: string;
  label?: string;
  variant?: Variant;
  size?: Size;
}) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => signIn("google", { callbackUrl })}
    >
      <GoogleMark />
      {label}
    </Button>
  );
}

export function SignOutButton({
  callbackUrl,
  label = "Sign out",
  variant = "ghost",
  size = "sm",
}: {
  callbackUrl: string;
  label?: string;
  variant?: Variant;
  size?: Size;
}) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => signOut({ callbackUrl })}
    >
      {label}
    </Button>
  );
}

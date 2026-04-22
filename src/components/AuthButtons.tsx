"use client";

import { signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

type Variant = "primary" | "accent" | "warm" | "outline" | "ghost" | "link";
type Size = "sm" | "md" | "lg" | "icon";

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

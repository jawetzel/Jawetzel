"use client";

import { signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignInButton({ callbackUrl = "/embroidery" }: { callbackUrl?: string }) {
  return (
    <Button
      variant="primary"
      size="lg"
      onClick={() => signIn("google", { callbackUrl })}
    >
      Sign in with Google
    </Button>
  );
}

export function SignOutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => signOut({ callbackUrl: "/embroidery" })}
    >
      Sign out
    </Button>
  );
}

import type { NextAuthOptions, Session } from "next-auth";
import { getServerSession as _getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { findOrCreateGoogleUser } from "./users";
import { consumeMagicLinkToken } from "./magic-link";
import { getCachedOrFetch } from "./cache";

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
}
if (!process.env.NEXTAUTH_SECRET) {
  throw new Error("NEXTAUTH_SECRET is not set");
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },

  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    // Magic-link sign-in. The token from the email is looked up in the
    // in-process cache; consumeMagicLinkToken deletes the entry on read so
    // the token can only sign in once.
    CredentialsProvider({
      id: "magic-link",
      name: "Magic Link",
      credentials: { token: { label: "Token", type: "text" } },
      async authorize(credentials) {
        const token = credentials?.token;
        if (!token) return null;
        const result = await consumeMagicLinkToken(token);
        if (!result.valid) return null;
        return {
          id: result.userId,
          email: result.email,
          role: result.role,
        };
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account, profile }) {
      // Magic-link path: authorize() already validated and consumed the token.
      // Trust the user record built there and skip the Google-specific lookup.
      if (account?.provider === "magic-link") {
        (user as { role?: string }).role =
          (user as { role?: string }).role ?? "user";
        return Boolean(user.id && user.email);
      }

      if (account?.provider !== "google" || !account.providerAccountId) return false;
      if (!user.email) return false;

      try {
        const dbUser = await findOrCreateGoogleUser({
          googleId: account.providerAccountId,
          email: user.email,
          name: user.name ?? profile?.name ?? user.email,
          image: user.image ?? null,
        });
        // Stash our DB id so the jwt callback can pick it up without a re-read.
        user.id = dbUser._id!.toString();
        (user as { role?: string }).role = dbUser.role;
      } catch {
        return false;
      }
      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: "user" | "admin" }).role ?? "user";
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? "";
        session.user.role = token.role ?? "user";
      }
      return session;
    },
  },
};

// Cached session helper. NextAuth's built-in getServerSession re-verifies and
// decodes the JWT cookie on every call. With a signed-in user's browser firing
// several API calls per page, that work repeats needlessly. Short-circuit to
// null when no cookie is present (no work at all), otherwise cache the Session
// for 10 minutes keyed on the cookie value. Sign-out rotates the cookie, so
// the old entry simply ages out.
const SESSION_TTL_MS = 10 * 60 * 1000;

export async function getCachedSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token =
    cookieStore.get("__Secure-next-auth.session-token")?.value ??
    cookieStore.get("next-auth.session-token")?.value;

  if (!token) return null;

  return getCachedOrFetch(
    `session:${token}`,
    () => _getServerSession(authOptions),
    SESSION_TTL_MS,
  );
}

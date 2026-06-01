import {
  type AuthUser,
  type GoogleUserInput,
  type UserRepository,
} from "@/application/ports/user-repository";

/**
 * FindOrCreateGoogleUser — provision (or reconcile) the user behind a Google
 * OAuth identity and resolve it to the slim sign-in DTO the NextAuth `signIn`
 * and `jwt` callbacks need (id + role). Symmetric with `ConsumeMagicLink`: the
 * driving adapter (NextAuth's `signIn` callback, Google branch) parses the
 * provider account and delegates the provisioning policy here, so the container
 * exposes a use-case rather than a raw repository — and Google-specific policy
 * (allow-lists, role assignment, first-user-is-admin, …) has a natural home if
 * it ever grows. The match-googleId / match-email / insert rules live in the
 * `UserRepository` adapter; this use-case owns the *policy* seam, not the SQL.
 */
export interface FindOrCreateGoogleUserDeps {
  users: UserRepository;
}

export interface FindOrCreateGoogleUser {
  execute(input: GoogleUserInput): Promise<AuthUser>;
}

export function createFindOrCreateGoogleUser(
  deps: FindOrCreateGoogleUserDeps,
): FindOrCreateGoogleUser {
  const { users } = deps;

  return {
    async execute(input) {
      return users.findOrCreateGoogleUser(input);
    },
  };
}

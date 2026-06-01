import {
  findOrCreateByEmail as findOrCreateUserByEmail,
  findOrCreateGoogleUser as findOrCreateGoogleUserDoc,
  getUserById,
  setApiKeyHash as setUserApiKeyHash,
} from "@/lib/users";
import {
  type UserRepository,
  type AuthUser,
  type GoogleUserInput,
} from "@/application/ports/user-repository";

/**
 * MongoUserRepository — the production {@link UserRepository}. For now it
 * delegates to the existing `src/lib/users.ts` functions (the "wrap an existing
 * module as an adapter" migration step) and maps the Mongo `User` document down
 * to the slim {@link AuthUser} DTO. As more user use-cases migrate, the Mongo
 * access moves in here and `lib/users.ts` shrinks toward deletion.
 */
export class MongoUserRepository implements UserRepository {
  async findOrCreateByEmail(email: string): Promise<AuthUser> {
    const user = await findOrCreateUserByEmail({ email });
    return {
      id: user._id!.toString(),
      email: user.email,
      role: user.role,
    };
  }

  async findOrCreateGoogleUser(input: GoogleUserInput): Promise<AuthUser> {
    const user = await findOrCreateGoogleUserDoc(input);
    return {
      id: user._id!.toString(),
      email: user.email,
      role: user.role,
    };
  }

  async getApiKeyHash(userId: string): Promise<string | null> {
    const user = await getUserById(userId);
    return user?.apiKeyHash ?? null;
  }

  async setApiKeyHash(userId: string, hash: string): Promise<void> {
    await setUserApiKeyHash(userId, hash);
  }
}

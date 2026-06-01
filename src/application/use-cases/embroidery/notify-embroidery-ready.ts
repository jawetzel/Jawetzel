import { type EmailSender } from "@/application/ports/email-sender";
import { buildEmbroideryReadyEmail } from "./embroidery-emails";

/**
 * NotifyEmbroideryReady — email a user that their generated embroidery files are
 * ready to download. A thin notification use-case over the {@link EmailSender}
 * port; the caller treats it as best-effort (a send failure must not fail the
 * generation request). Kept as a use-case so the rest of the embroidery pipeline
 * can migrate behind the same composition boundary later.
 */
export interface NotifyEmbroideryReadyInput {
  to: { email: string; name: string };
  zipUrl: string;
  size: string;
}

export interface NotifyEmbroideryReadyDeps {
  email: EmailSender;
}

export interface NotifyEmbroideryReady {
  execute(input: NotifyEmbroideryReadyInput): Promise<void>;
}

export function createNotifyEmbroideryReady(
  deps: NotifyEmbroideryReadyDeps,
): NotifyEmbroideryReady {
  const { email } = deps;

  return {
    async execute({ to, zipUrl, size }) {
      await email.send(buildEmbroideryReadyEmail(to, zipUrl, size));
    },
  };
}

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getRequestSupabase } from "@/lib/supabase/server";
import { provisionFirstRun } from "@/lib/auth/first-run";
import { brand } from "@/lib/brand";
import {
  magicLinkSignInSchema,
  ownerSignUpSchema,
  passwordSignInSchema,
} from "@/lib/auth/schema";

export type AuthActionState = {
  readonly error?: string;
  readonly fields?: Record<string, string>;
  readonly sent?: boolean;
};

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const VALIDATION_ERROR = "Please fix the highlighted fields.";

/** Only same-origin absolute paths may be a post-sign-in bounce-back. */
function safeNextPath(formData: FormData): string {
  const raw = String(formData.get("next") ?? "");
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "";
}

/** The site origin for email redirect URLs, from the env-var-backed domain. */
function originFromEnv(): string {
  return `https://${brand.domain}`;
}

type ZodIssue = {
  path: (string | number | symbol)[];
  message: string;
};

function fieldErrors(issues: readonly ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fields[key]) {
      fields[key] = issue.message;
    }
  }
  return fields;
}

/**
 * Password sign-in. Validation is shared with the client (the same Zod
 * schema backs the form). Server actions run server-side and may set
 * cookies, so the request-bound client persists the session into the
 * response — the session survives both client and server navigation.
 */
export async function signInWithPassword(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = passwordSignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: VALIDATION_ERROR, fields: fieldErrors(parsed.error.issues) };
  }

  const client = await getRequestSupabase();
  const { error } = await client.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return {
      error:
        error.status === 400 || error.status === 401
          ? "Incorrect email or password."
          : GENERIC_ERROR,
    };
  }

  revalidatePath("/", "layout");
  redirect(safeNextPath(formData) || "/admin");
}

/**
 * Magic-link sign-in: Supabase emails a one-time link; the session is
 * established in /auth/callback when the user follows it. The `next` path
 * (same-origin absolute paths only) rides along so the bounce-back lands
 * where the user started — e.g. a staff invitation accept link.
 */
export async function requestMagicLink(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = magicLinkSignInSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { error: VALIDATION_ERROR, fields: fieldErrors(parsed.error.issues) };
  }

  const nextPath = safeNextPath(formData);
  const client = await getRequestSupabase();
  const { error } = await client.auth.signInWithOtp({
    email: parsed.data.email,
    options: nextPath
      ? { emailRedirectTo: `${originFromEnv()}${nextPath}` }
      : undefined,
  });

  if (error) {
    return { error: GENERIC_ERROR };
  }

  return { sent: true };
}

export async function signOut(): Promise<void> {
  const client = await getRequestSupabase();
  await client.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}

/**
 * First-run owner sign-up: creates the auth user, provisions the club, and
 * links the owner profile — all server-side. Role assignment is enforced
 * in provisionFirstRun (the client payload never carries a role), and the
 * per-club unique partial index on profiles guards the tenant root at the
 * database level.
 *
 * If the email is already registered (a previous attempt whose club
 * provisioning failed mid-flight), the password is verified and the
 * provisioning is completed — so a half-provisioned account can never
 * dead-end outside the app. A wrong password surfaces the same generic
 * "already registered" message, never revealing which emails exist.
 */
export async function signUpOwner(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = ownerSignUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
    clubName: formData.get("clubName"),
    timezone: formData.get("timezone") ?? undefined,
  });

  if (!parsed.success) {
    return { error: VALIDATION_ERROR, fields: fieldErrors(parsed.error.issues) };
  }

  const client = await getRequestSupabase();
  const { data: authData, error: authError } = await client.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
    },
  });

  // A registered email: re-authenticate (which also establishes the
  // session cookies) and finish the first-run provisioning if the profile
  // is still unprovisioned.
  if (authError && (authError.status === 400 || authError.status === 422)) {
    const { data: signInData, error: signInError } =
      await client.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });

    if (signInError || !signInData.user) {
      return {
        error: "That email is already registered — try signing in instead.",
      };
    }

    try {
      await provisionFirstRun(
        { id: signInData.user.id, email: parsed.data.email },
        {
          fullName: parsed.data.fullName,
          clubName: parsed.data.clubName,
          timezone: parsed.data.timezone,
        },
      );
    } catch (error) {
      console.error(
        `[auth] first-run recovery failed for ${signInData.user.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { error: GENERIC_ERROR };
    }

    revalidatePath("/", "layout");
    redirect("/admin");
  }

  if (authError) {
    return { error: GENERIC_ERROR };
  }

  const user = authData.user;
  if (!user) {
    return { error: GENERIC_ERROR };
  }

  try {
    await provisionFirstRun(
      { id: user.id, email: parsed.data.email },
      {
        fullName: parsed.data.fullName,
        clubName: parsed.data.clubName,
        timezone: parsed.data.timezone,
      },
    );
  } catch (error) {
    console.error(
      `[auth] first-run provisioning failed for ${user.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/", "layout");
  redirect("/admin");
}

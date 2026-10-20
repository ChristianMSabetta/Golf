import { brand } from "@/lib/brand";
import type { ClubBrand } from "@/lib/brand";
import { SignOutButton } from "@/components/admin/sign-out-button";

/**
 * Top bar of the admin shell: product wordmark on the left, club identity
 * and sign-out on the right. Every label comes from the env-var-backed brand
 * config or the club's stored settings — never hardcoded in markup.
 */
export function AdminTopBar({
  clubBrand,
  email,
}: {
  clubBrand: ClubBrand | null;
  email: string;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
      <span className="font-heading text-lg font-semibold text-brand">
        {brand.name}
      </span>
      <div className="flex items-center gap-4">
        <span className="hidden text-xs text-muted-foreground sm:block">
          {clubBrand ? clubBrand.name : email}
        </span>
        <SignOutButton />
      </div>
    </header>
  );
}

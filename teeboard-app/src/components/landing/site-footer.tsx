import { brand } from "@/lib/brand";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/80 bg-secondary/40">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground sm:px-6">
        <p className="font-heading font-semibold text-brand">{brand.name}</p>
        <p>
          <span className="numeric">© 2026</span> {brand.name}. All rights
          reserved.
        </p>
      </div>
    </footer>
  );
}

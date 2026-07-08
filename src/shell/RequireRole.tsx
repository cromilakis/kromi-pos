import type { ReactNode } from "react";
import type { Role } from "@/auth/session";

export function RequireRole({ role, allow, children }: { role: Role | undefined; allow: Role[]; children: ReactNode }) {
  if (!role || !allow.includes(role)) {
    return <div className="p-6 text-muted-foreground">No tienes acceso a esta sección.</div>;
  }
  return <>{children}</>;
}

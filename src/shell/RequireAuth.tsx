import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { LoginScreen } from "@/auth/LoginScreen";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="min-h-full grid place-items-center">Cargando…</div>;
  if (!session) return <LoginScreen />;
  return <>{children}</>;
}

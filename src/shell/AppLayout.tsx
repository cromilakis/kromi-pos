import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { navForRole } from "@/session/nav";
import { Button } from "@/components/ui/button";

export function AppLayout() {
  const { profile, business, signOut } = useAuth();

  if (!profile) return <div className="min-h-full grid place-items-center">Cargando perfil…</div>;

  return (
    <div className="min-h-full flex">
      <aside className="w-56 border-r p-4 flex flex-col gap-1">
        <div className="font-bold mb-4">{business?.name ?? "Kromi POS"}</div>
        {navForRole(profile.role).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}
            className={({ isActive }) => `px-3 py-2 rounded-md text-sm ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {n.label}
          </NavLink>
        ))}
        <div className="mt-auto pt-4 text-sm text-muted-foreground">
          <div>{profile.name}</div>
          <Button variant="ghost" size="sm" onClick={signOut} className="mt-1 px-0">Salir</Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto"><Outlet /></main>
    </div>
  );
}

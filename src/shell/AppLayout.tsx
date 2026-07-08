import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Home, ShoppingCart, Package, Users, Settings, LogOut, type LucideIcon } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import type { Role } from "@/auth/session";
import { navForRole, type NavItem } from "@/session/nav";
import { BranchGate } from "@/session/BranchGate";
import { PrinterSettings } from "@/shell/PrinterSettings";
import { Button } from "@/components/ui/button";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador/a",
  kromi: "Admin. del sistema",
  cajero: "Cajero/a",
};

const NAV_ICON: Record<string, LucideIcon> = {
  Inicio: Home,
  Venta: ShoppingCart,
  Stock: Package,
  Clientes: Users,
  Administración: Settings,
};

function initialsOf(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]).filter(Boolean).join("").toUpperCase();
}

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = NAV_ICON[item.label] ?? Home;
  return (
    <NavLink to={item.to} end={item.to === "/"}>
      {({ isActive }) => (
        <span
          className="flex items-center gap-[11px] rounded-[11px] px-3 py-2.5 text-sm font-bold transition-colors"
          style={{
            color: isActive ? "var(--brand)" : "#2A3A2E",
            background: isActive ? "color-mix(in srgb, var(--brand) 14%, transparent)" : "transparent",
          }}
        >
          <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />
          <span className="truncate">{item.label}</span>
        </span>
      )}
    </NavLink>
  );
}

export function AppLayout() {
  const { profile, profileLoading, profileError, signOut } = useAuth();
  const location = useLocation();

  if (profileError) {
    return (
      <div className="min-h-full grid place-items-center p-6">
        <div className="space-y-3 text-center max-w-sm">
          <p className="text-sm text-destructive">{profileError.message}</p>
          <Button variant="outline" size="sm" onClick={signOut}>Salir</Button>
        </div>
      </div>
    );
  }

  if (profileLoading || !profile) return <div className="min-h-full grid place-items-center">Cargando perfil…</div>;

  const items = navForRole(profile.role);
  const adminItem = items.find((n) => n.label === "Administración");
  const baseItems = items.filter((n) => n.label !== "Administración");
  const adminActive = adminItem ? location.pathname.startsWith(adminItem.to) : false;
  const brandName = import.meta.env.VITE_STORE_NAME || "Mi Tienda";

  return (
    <div className="h-full flex">
      <aside className="w-[236px] shrink-0 bg-white border-r border-[#E1E5EE] flex flex-col p-3.5">
        <div className="flex items-center gap-[11px] px-2 pb-4">
          <div className="size-[38px] rounded-xl shrink-0 overflow-hidden shadow-[0_3px_10px_rgba(34,196,99,.28)]">
            <img src="/logo.png" alt="Logo" className="size-full object-cover" />
          </div>
          <div className="min-w-0 leading-[1.1]">
            <div className="font-black text-[16px] text-[#0F2A1B] truncate">{brandName}</div>
            <div className="text-[11px] font-medium text-[#7C95A8]">Punto de venta</div>
          </div>
        </div>

        <nav className="flex flex-col gap-[3px]">
          {baseItems.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>

        {adminItem && (
          <>
            <div className="text-[11px] font-bold tracking-[.13em] uppercase text-[#94A3B5] px-3 pt-5 pb-2">
              Administración
            </div>
            <nav className="flex flex-col gap-[3px]">
              <NavLink to={adminItem.to}>
                <span
                  className="flex items-center gap-[11px] rounded-[11px] px-3 py-2.5 text-sm font-bold transition-colors"
                  style={{
                    color: adminActive ? "var(--brand)" : "#2A3A2E",
                    background: adminActive ? "color-mix(in srgb, var(--brand) 14%, transparent)" : "transparent",
                  }}
                >
                  <Settings className="size-[18px] shrink-0" strokeWidth={1.8} />
                  <span className="truncate">{adminItem.label}</span>
                </span>
              </NavLink>
            </nav>
          </>
        )}

        <div className="flex-1 min-h-4" />

        <div className="border-t border-[#F0F2F7] pt-3 flex items-center gap-[10px]">
          <div className="size-[38px] rounded-full shrink-0 bg-[#0F2A1B] text-white flex items-center justify-center font-bold text-[13px]">
            {initialsOf(profile.name)}
          </div>
          <div className="min-w-0 flex-1 leading-[1.15]">
            <div className="text-[13px] font-bold text-[#0F2A1B] truncate">{profile.name}</div>
            <div className="text-[11px] text-[#7C95A8]">{ROLE_LABEL[profile.role]}</div>
          </div>
          <PrinterSettings />
          <button
            type="button"
            title="Cerrar sesión"
            onClick={signOut}
            className="size-[34px] shrink-0 rounded-[10px] border border-[#E1E5EE] bg-white text-[#7C95A8] flex items-center justify-center hover:bg-[#F7F8FA]"
          >
            <LogOut className="size-[17px]" strokeWidth={1.7} />
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden bg-[#F7F8FA]">
        <main className="flex-1 overflow-auto">
          <BranchGate businessId={profile.business_id}>
            <Outlet />
          </BranchGate>
        </main>
      </div>
    </div>
  );
}

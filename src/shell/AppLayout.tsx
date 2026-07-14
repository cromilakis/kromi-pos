import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LogOut, Menu } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import type { Role } from "@/auth/session";
import { navForRole, type NavItem } from "@/session/nav";
import { BranchGate } from "@/session/BranchGate";
import { Button } from "@/components/ui/button";
import { useBusiness } from "@/data/business";
import { useIdleLock } from "@/session/useIdleLock";
import { LockScreen } from "./LockScreen";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador/a",
  kromi: "Admin. del sistema",
  cajero: "Cajero/a",
};

/** Emoji a color de cada ítem del menú (estilo consistente con el carrito: 💾 🧹). */
const NAV_EMOJI: Record<string, string> = {
  Inicio: "🏠",
  Venta: "🛒",
  Cotizaciones: "📝",
  Stock: "📦",
  Clientes: "👥",
  Historial: "📜",
  Administración: "⚙️",
  "Notas de crédito": "🧾",
};

function initialsOf(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]).filter(Boolean).join("").toUpperCase();
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const emoji = NAV_EMOJI[item.label] ?? "•";
  return (
    <NavLink to={item.to} end={item.to === "/"} title={collapsed ? item.label : undefined}>
      {({ isActive }) => (
        <span
          className={`flex items-center rounded-[11px] text-sm font-bold transition-colors ${collapsed ? "justify-center p-2.5" : "gap-[11px] px-3 py-2.5"}`}
          style={{
            color: isActive ? "var(--brand)" : "#2A3A2E",
            background: isActive ? "color-mix(in srgb, var(--brand) 14%, transparent)" : "transparent",
          }}
        >
          <span className="w-[20px] shrink-0 text-center text-[16px] leading-none" aria-hidden>{emoji}</span>
          {!collapsed && <span className="truncate">{item.label}</span>}
        </span>
      )}
    </NavLink>
  );
}

export function AppLayout() {
  const { profile, profileLoading, profileError, signOut } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isVenta = location.pathname === "/venta";
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const { data: business } = useBusiness(profile?.business_id);
  const { locked, unlock } = useIdleLock(business?.lock_timeout_min ?? 0);

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

  // En Venta el menú arranca colapsado a un rail de iconos (nunca desaparece del todo).
  const collapsed = isVenta && !sidebarOpen;

  return (
    <div className="h-full flex">
      {locked && <LockScreen onUnlock={unlock} />}
      <aside className={`shrink-0 bg-white border-r border-[#E1E5EE] flex flex-col ${collapsed ? "w-[68px] p-2" : "w-[236px] p-3.5"}`}>
        <div className={`pb-3 ${collapsed ? "flex justify-center" : "flex items-center gap-[11px] px-2"}`}>
          <div className="size-[38px] rounded-xl shrink-0 overflow-hidden shadow-[0_3px_10px_rgba(34,196,99,.28)]">
            <img src="/logo.png" alt="Logo" className="size-full object-cover" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-[1.1]">
              <div className="font-black text-[16px] text-[#0F2A1B] truncate">{brandName}</div>
              <div className="text-[11px] font-medium text-[#556A7C]">Punto de venta</div>
            </div>
          )}
        </div>

        {isVenta && (
          <button
            type="button"
            onClick={() => setSidebarOpen((o) => !o)}
            title={collapsed ? "Expandir menú" : "Contraer menú"}
            className={`mb-2 flex items-center rounded-[10px] border border-[#E1E5EE] bg-white text-[#556A7C] hover:bg-[#F7F8FA] ${collapsed ? "size-[38px] self-center justify-center" : "gap-2 px-3 py-2 text-[13px] font-bold"}`}
          >
            <Menu className="size-[17px] shrink-0" strokeWidth={1.9} />
            {!collapsed && <span>Contraer menú</span>}
          </button>
        )}

        <nav className="flex flex-col gap-[3px]">
          {baseItems.map((item) => (
            <SidebarLink key={item.to} item={item} collapsed={collapsed} />
          ))}
        </nav>

        {adminItem && (
          <>
            {!collapsed && (
              <div className="text-[11px] font-bold tracking-[.13em] uppercase text-[#5E6E7E] px-3 pt-5 pb-2">
                Administración
              </div>
            )}
            <nav className={`flex flex-col gap-[3px] ${collapsed ? "pt-2" : ""}`}>
              <NavLink to={adminItem.to} title={collapsed ? adminItem.label : undefined}>
                <span
                  className={`flex items-center rounded-[11px] text-sm font-bold transition-colors ${collapsed ? "justify-center p-2.5" : "gap-[11px] px-3 py-2.5"}`}
                  style={{
                    color: adminActive ? "var(--brand)" : "#2A3A2E",
                    background: adminActive ? "color-mix(in srgb, var(--brand) 14%, transparent)" : "transparent",
                  }}
                >
                  <span className="w-[20px] shrink-0 text-center text-[16px] leading-none" aria-hidden>{NAV_EMOJI["Administración"]}</span>
                  {!collapsed && <span className="truncate">{adminItem.label}</span>}
                </span>
              </NavLink>
            </nav>
          </>
        )}

        <div className="flex-1 min-h-4" />

        <div className={`border-t border-[#F0F2F7] pt-3 ${collapsed ? "flex flex-col items-center gap-2" : "flex items-center gap-[10px]"}`}>
          <div className="size-[38px] rounded-full shrink-0 bg-[#0F2A1B] text-white flex items-center justify-center font-bold text-[13px]" title={collapsed ? profile.name : undefined}>
            {initialsOf(profile.name)}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-[1.15]">
              <div className="text-[13px] font-bold text-[#0F2A1B] truncate">{profile.name}</div>
              <div className="text-[11px] text-[#556A7C]">{ROLE_LABEL[profile.role]}</div>
            </div>
          )}
          <button
            type="button"
            title="Cerrar sesión"
            onClick={signOut}
            className="size-[34px] shrink-0 rounded-[10px] border border-[#E1E5EE] bg-white text-[#556A7C] flex items-center justify-center hover:bg-[#F7F8FA]"
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

import type { Role } from "@/auth/session";
export interface NavItem { to: string; label: string; }

const BASE: NavItem[] = [
  { to: "/", label: "Inicio" },
  { to: "/venta", label: "Venta" },
  { to: "/cotizaciones", label: "Cotizaciones" },
  { to: "/stock", label: "Stock" },
  { to: "/clientes", label: "Clientes" },
];
const NC: NavItem = { to: "/notas-credito", label: "Notas de crédito" };
const ADMIN: NavItem = { to: "/admin", label: "Administración" };

export function navForRole(role: Role): NavItem[] {
  if (role !== "admin" && role !== "kromi") return BASE;
  // "Notas de crédito" justo debajo de "Venta"; "Administración" al final.
  const items: NavItem[] = [];
  for (const it of BASE) {
    items.push(it);
    if (it.to === "/venta") items.push(NC);
  }
  items.push(ADMIN);
  return items;
}

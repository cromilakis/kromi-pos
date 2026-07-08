import type { Role } from "@/auth/session";
export interface NavItem { to: string; label: string; }

const BASE: NavItem[] = [
  { to: "/", label: "Inicio" },
  { to: "/venta", label: "Venta" },
  { to: "/stock", label: "Stock" },
  { to: "/clientes", label: "Clientes" },
];
const ADMIN: NavItem = { to: "/admin", label: "Administración" };

export function navForRole(role: Role): NavItem[] {
  return role === "admin" || role === "kromi" ? [...BASE, ADMIN] : BASE;
}

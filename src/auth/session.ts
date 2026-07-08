export type Role = "admin" | "cajero" | "kromi";
export interface Profile { id: string; business_id: string; name: string; role: Role; active: boolean; }
export interface Business { id: string; name: string; accent: string | null; logo_url: string | null; }

export function mapProfileRow(row: any): Profile {
  if (!row) throw new Error("No se encontró el perfil del usuario.");
  if (row.active === false) throw new Error("El usuario está inactivo.");
  return {
    id: row.id, business_id: row.business_id, name: row.name,
    role: row.role as Role, active: !!row.active,
  };
}

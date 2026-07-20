import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  points: number;
  spent: number;
  visits: number;
  is_company: boolean;
  rut: string | null;
  razon_social: string | null;
  giro: string | null;
  direccion: string | null;
  comuna: string | null;
  ciudad: string | null;
  direccion_despacho: string | null;
  comuna_despacho: string | null;
  contacto: string | null;
  observaciones: string | null;
}

/** Filtro de búsqueda por nombre, teléfono o correo (case-insensitive). */
export function filterCustomers(rows: CustomerRow[], q: string): CustomerRow[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((c) => `${c.name} ${c.phone ?? ""} ${c.email ?? ""}`.toLowerCase().includes(s));
}

export function useCustomers(businessId?: string) {
  return useQuery({
    queryKey: ["customers", businessId],
    enabled: !!businessId,
    queryFn: async (): Promise<CustomerRow[]> => {
      const { data, error } = await supabase
        .from("customer")
        .select("id,name,email,phone,points,spent,visits,is_company,rut,razon_social,giro,direccion,comuna,ciudad,direccion_despacho,comuna_despacho,contacto,observaciones")
        .eq("business_id", businessId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export async function createCustomer(input: {
  business_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  created_by?: string | null;
  is_company?: boolean;
  rut?: string | null;
  razon_social?: string | null;
  giro?: string | null;
  direccion?: string | null;
  comuna?: string | null;
  ciudad?: string | null;
  direccion_despacho?: string | null;
  comuna_despacho?: string | null;
  contacto?: string | null;
  observaciones?: string | null;
}): Promise<CustomerRow> {
  const { data, error } = await supabase
    .from("customer")
    .insert(input)
    .select("id,name,email,phone,points,spent,visits,is_company,rut,razon_social,giro,direccion,comuna,ciudad,direccion_despacho,comuna_despacho,contacto,observaciones")
    .single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(
  id: string,
  input: Partial<{
    name: string;
    email: string | null;
    phone: string | null;
    is_company: boolean;
    rut: string | null;
    razon_social: string | null;
    giro: string | null;
    direccion: string | null;
    comuna: string | null;
    ciudad: string | null;
    direccion_despacho: string | null;
    comuna_despacho: string | null;
    contacto: string | null;
    observaciones: string | null;
  }>,
) {
  const { error } = await supabase.from("customer").update(input).eq("id", id);
  if (error) throw error;
}

export async function softDeleteCustomer(id: string) {
  const { error } = await supabase.from("customer").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

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
        .select("id,name,email,phone,points,spent,visits")
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
}): Promise<CustomerRow> {
  const { data, error } = await supabase
    .from("customer")
    .insert(input)
    .select("id,name,email,phone,points,spent,visits")
    .single();
  if (error) throw error;
  return data;
}

export async function updateCustomer(id: string, input: Partial<{ name: string; email: string | null; phone: string | null }>) {
  const { error } = await supabase.from("customer").update(input).eq("id", id);
  if (error) throw error;
}

export async function softDeleteCustomer(id: string) {
  const { error } = await supabase.from("customer").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

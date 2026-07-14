import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface DiscountRow {
  id: string;
  name: string;
  percent: number;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Determina si un descuento está vigente hoy: activo y dentro del rango valid_from/valid_until (null = sin límite). */
export function isDiscountVigente(
  d: Pick<DiscountRow, "active" | "valid_from" | "valid_until">,
  today: Date = new Date()
): boolean {
  if (!d.active) return false;
  const todayStr = toLocalDateStr(today);
  if (d.valid_from && todayStr < d.valid_from) return false;
  if (d.valid_until && todayStr > d.valid_until) return false;
  return true;
}

export function useDiscounts(businessId?: string) {
  return useQuery({
    queryKey: ["discounts", businessId],
    enabled: !!businessId,
    queryFn: async (): Promise<DiscountRow[]> => {
      const { data, error } = await supabase
        .from("discount")
        .select("id,name,percent,active,valid_from,valid_until")
        .eq("business_id", businessId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useActiveDiscounts(businessId?: string) {
  return useQuery({
    queryKey: ["active-discounts", businessId],
    enabled: !!businessId,
    queryFn: async (): Promise<DiscountRow[]> => {
      const { data, error } = await supabase
        .from("discount")
        .select("id,name,percent,active,valid_from,valid_until")
        .eq("business_id", businessId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []).filter((d) => isDiscountVigente(d));
    },
  });
}

export async function createDiscount(input: {
  business_id: string;
  name: string;
  percent: number;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
}): Promise<DiscountRow> {
  const { data, error } = await supabase
    .from("discount")
    .insert(input)
    .select("id,name,percent,active,valid_from,valid_until")
    .single();
  if (error) throw error;
  return data;
}

export async function updateDiscount(
  id: string,
  input: Partial<{ name: string; percent: number; active: boolean; valid_from: string | null; valid_until: string | null }>
) {
  const { error } = await supabase.from("discount").update(input).eq("id", id);
  if (error) throw error;
}

export async function softDeleteDiscount(id: string) {
  const { error } = await supabase.from("discount").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

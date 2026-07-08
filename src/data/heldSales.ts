import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface HeldCartItem { product_id: string; qty: number; }

export interface HeldSaleRow {
  id: string;
  customer_id: string | null;
  label: string | null;
  cart: HeldCartItem[];
  total_snapshot: number;
  created_at: string;
}

export function useHeldSales(branchId?: string) {
  return useQuery({
    queryKey: ["held-sales", branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<HeldSaleRow[]> => {
      const { data, error } = await supabase
        .from("held_sale")
        .select("id,customer_id,label,cart,total_snapshot,created_at")
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as HeldSaleRow[];
    },
  });
}

export async function holdSale(input: {
  business_id: string;
  branch_id: string;
  cashier_id: string | null;
  customer_id: string | null;
  cart: HeldCartItem[];
  total_snapshot: number;
  label?: string | null;
}) {
  const { error } = await supabase.from("held_sale").insert({
    business_id: input.business_id,
    branch_id: input.branch_id,
    cashier_id: input.cashier_id,
    customer_id: input.customer_id,
    cart: input.cart,
    total_snapshot: input.total_snapshot,
    label: input.label ?? null,
  });
  if (error) throw error;
}

export async function deleteHeldSale(id: string) {
  const { error } = await supabase.from("held_sale").delete().eq("id", id);
  if (error) throw error;
}

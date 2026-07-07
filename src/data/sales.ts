import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SaleRow { id?: string; folio?: number; total: number; method?: string; sold_at?: string; }

export function summarizeSales(rows: { total: number }[]): { total: number; count: number; avg: number } {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const count = rows.length;
  return { total, count, avg: count ? Math.round(total / count) : 0 };
}

/** Ventas de HOY de la sucursal (rango del día local). */
export function useSalesToday(branchId: string | undefined) {
  return useQuery({
    queryKey: ["sales-today", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("sale").select("total").eq("branch_id", branchId!).gte("sold_at", start.toISOString());
      if (error) throw error;
      return summarizeSales(data ?? []);
    },
  });
}

export function useRecentSales(branchId: string | undefined, limit = 8) {
  return useQuery({
    queryKey: ["recent-sales", branchId, limit],
    enabled: !!branchId,
    queryFn: async (): Promise<SaleRow[]> => {
      const { data, error } = await supabase
        .from("sale").select("id,folio,total,method,sold_at").eq("branch_id", branchId!)
        .order("sold_at", { ascending: false }).limit(limit);
      if (error) throw error; return data ?? [];
    },
  });
}

export interface CriticalStockRow { name: string; stock: number; min_stock: number; }

export function useCriticalStock(branchId: string | undefined) {
  return useQuery({
    queryKey: ["critical-stock", branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<CriticalStockRow[]> => {
      // inventory de la sucursal con stock <= min_stock del producto
      const { data, error } = await supabase
        .from("inventory").select("stock, product:product_id(name,min_stock)").eq("branch_id", branchId!);
      if (error) throw error;
      return (data ?? [])
        .map((r: any) => ({ name: r.product?.name, stock: r.stock, min_stock: r.product?.min_stock ?? 0 }))
        .filter((r: any) => r.min_stock > 0 && r.stock <= r.min_stock);
    },
  });
}

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

export interface CartItem { product_id: string; qty: number; }

export interface Sale {
  id: string;
  folio: number;
  total: number;
  neto: number;
  iva: number;
  method: string;
  recv: number;
  change: number;
  sold_at: string;
}

/** Cobra la venta de forma atómica vía RPC (descuenta stock, registra la venta y sus líneas). */
export async function cobrarVenta(args: {
  p_branch: string;
  p_session: string;
  p_lines: CartItem[];
  p_method: "efectivo" | "tarjeta";
  p_recv: number;
  p_customer?: string | null;
}): Promise<Sale> {
  const { data, error } = await supabase.rpc("cobrar_venta", {
    p_branch: args.p_branch,
    p_session: args.p_session,
    p_lines: args.p_lines,
    p_method: args.p_method,
    p_recv: args.p_recv,
    p_customer: args.p_customer ?? null,
  });
  if (error) throw error;
  return data;
}

/** Convierte el carrito (con qty) a las líneas que espera la RPC. */
export function cartToLines(cart: { id: string; qty: number }[]): CartItem[] {
  return cart.map((c) => ({ product_id: c.id, qty: c.qty }));
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

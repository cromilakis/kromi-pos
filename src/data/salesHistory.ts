import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SalesHistoryFilters {
  from?: string;
  to?: string;
  customerId?: string | null;
  folio?: number | null;
  page?: number;
}

export interface SaleHistoryRow {
  id: string;
  folio: number;
  total: number;
  neto: number;
  iva: number;
  discount_amount: number;
  method: string;
  sold_at: string;
  customer_id: string | null;
  customer_name: string | null;
  dte_status: string | null;
  dte_folio: number | null;
  dte_timbre: string | null;
  points_redeemed: number;
  points_discount: number;
  lines: { name_snapshot: string; price_snapshot: number; qty: number; discount_amount: number }[];
}

export const HISTORY_PAGE = 50;

/** Rango [00:00 del `from`, 00:00 del día siguiente al `to`) en ISO (UTC). */
export function dayRangeUtc(fromIso: string, toIso: string): { start: string; end: string } {
  const start = new Date(fromIso + "T00:00:00");
  const end = new Date(toIso + "T00:00:00");
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function todayLocalIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Historial de ventas de la sucursal con filtros (rango de fechas, cliente, folio) y paginación. */
export function useSalesHistory(branchId: string | undefined, filters: SalesHistoryFilters) {
  return useQuery({
    queryKey: ["sales-history", branchId, filters],
    enabled: !!branchId,
    queryFn: async (): Promise<SaleHistoryRow[]> => {
      const today = todayLocalIso();
      const { start, end } = dayRangeUtc(filters.from ?? today, filters.to ?? today);
      const page = filters.page ?? 0;

      let query = supabase
        .from("sale")
        .select(
          "id,folio,total,neto,iva,discount_amount,method,sold_at,customer_id,dte_status,dte_folio,dte_timbre,points_redeemed,points_discount," +
            "customer:customer_id(name),sale_line(name_snapshot,price_snapshot,qty,discount_amount)",
        )
        .eq("branch_id", branchId!)
        .gte("sold_at", start)
        .lt("sold_at", end);

      if (filters.customerId) query = query.eq("customer_id", filters.customerId);
      if (filters.folio) query = query.eq("folio", filters.folio);

      const { data, error } = await query
        .order("sold_at", { ascending: false })
        .range(page * HISTORY_PAGE, page * HISTORY_PAGE + HISTORY_PAGE - 1);
      if (error) throw error;

      return (data ?? []).map((s: any) => ({
        id: s.id,
        folio: s.folio,
        total: s.total,
        neto: s.neto,
        iva: s.iva,
        discount_amount: s.discount_amount ?? 0,
        method: s.method,
        sold_at: s.sold_at,
        customer_id: s.customer_id,
        customer_name: s.customer?.name ?? null,
        dte_status: s.dte_status ?? null,
        dte_folio: s.dte_folio ?? null,
        dte_timbre: s.dte_timbre ?? null,
        points_redeemed: s.points_redeemed ?? 0,
        points_discount: s.points_discount ?? 0,
        lines: s.sale_line ?? [],
      }));
    },
  });
}

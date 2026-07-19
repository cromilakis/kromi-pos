import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export { rpcCloseCashSession as closeCashSession } from "./work";

export interface CierreRow {
  id: string;
  opened_at: string;
  closed_at: string | null;
  float_amount: number;
  counted: number | null;
  status: string;
}

export function useCierres(branchId?: string) {
  return useQuery({
    queryKey: ["cierres", branchId], enabled: !!branchId,
    queryFn: async (): Promise<CierreRow[]> => {
      const { data, error } = await supabase.from("cash_session")
        .select("id,opened_at,closed_at,float_amount,counted,status")
        .eq("branch_id", branchId!).eq("status", "closed").order("closed_at", { ascending: false }).limit(30);
      if (error) throw error; return data ?? [];
    },
  });
}

/** Forma exacta del jsonb que devuelve la RPC `close_cash_session` (ver supabase/migrations/20260707100200_functions.sql). */
export interface CierreResumen {
  session_id: string;
  float: number;
  cash: number;
  card: number;
  nc_cash: number;
  nc_card: number;
  rounding: number;
  expected_cash: number;
  counted: number;
  diff: number;
}

/** Hora de apertura de una sesión (para el comprobante impreso; `useOpenSession` no la trae). */
export async function fetchSessionOpenedAt(sessionId: string): Promise<string | null> {
  const { data, error } = await supabase.from("cash_session").select("opened_at").eq("id", sessionId).maybeSingle();
  if (error) throw error;
  return data?.opened_at ?? null;
}

/** Cuenta las ventas registradas en una sesión de caja (para el comprobante impreso). */
export async function contarVentasSesion(sessionId: string): Promise<number> {
  const { count, error } = await supabase
    .from("sale")
    .select("id", { count: "exact", head: true })
    .eq("cash_session_id", sessionId);
  if (error) throw error;
  return count ?? 0;
}

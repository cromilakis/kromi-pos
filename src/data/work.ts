import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface Branch { id: string; name: string; }
export interface Register { id: string; name: string; branch_id: string; }
export interface CashSession { id: string; register_id: string; status: string; opened_at: string; }

export function useBranches(businessId: string | undefined) {
  return useQuery({
    queryKey: ["branches", businessId], enabled: !!businessId,
    queryFn: async (): Promise<Branch[]> => {
      const { data, error } = await supabase.from("branch").select("id,name").eq("business_id", businessId!).eq("active", true).order("name");
      if (error) throw error; return data ?? [];
    },
  });
}

export function useRegisters(branchId: string | undefined) {
  return useQuery({
    queryKey: ["registers", branchId], enabled: !!branchId,
    queryFn: async (): Promise<Register[]> => {
      const { data, error } = await supabase.from("register").select("id,name,branch_id").eq("branch_id", branchId!).eq("active", true).order("name");
      if (error) throw error; return data ?? [];
    },
  });
}

export function useOpenSession(registerId: string | undefined) {
  return useQuery({
    queryKey: ["open-session", registerId], enabled: !!registerId,
    queryFn: async (): Promise<CashSession | null> => {
      const { data, error } = await supabase.from("cash_session").select("id,register_id,status,opened_at").eq("register_id", registerId!).eq("status", "open").maybeSingle();
      if (error) throw error; return data ?? null;
    },
  });
}

export async function rpcOpenCashSession(registerId: string, floatAmount: number) {
  const { data, error } = await supabase.rpc("open_cash_session", { p_register: registerId, p_float: floatAmount });
  if (error) throw error; return data;
}
export async function rpcCloseCashSession(sessionId: string, counted: number) {
  const { data, error } = await supabase.rpc("close_cash_session", { p_session: sessionId, p_counted: counted });
  if (error) throw error; return data;
}

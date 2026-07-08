import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { mapProfileRow, type Business } from "@/auth/session";

export function useProfileQuery(userId: string | undefined) {
  return useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user").select("id,business_id,name,role,active").eq("id", userId!).maybeSingle();
      if (error) throw error;
      return mapProfileRow(data);
    },
  });
}

export function useBusinessQuery(businessId: string | undefined) {
  return useQuery({
    queryKey: ["business", businessId],
    enabled: !!businessId,
    queryFn: async (): Promise<Business> => {
      const { data, error } = await supabase
        .from("business").select("id,name,accent,logo_url").eq("id", businessId!).single();
      if (error) throw error;
      return data as Business;
    },
  });
}

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { rutToEmail } from "@/lib/rut";
import { authErrorEs } from "@/lib/errors";
import { applyAccent } from "@/theme/accent";
import { useProfileQuery, useBusinessQuery } from "@/data/queries";
import type { Profile, Business } from "./session";

interface AuthCtx {
  session: Session | null;
  profile: Profile | null;
  business: Business | null;
  loading: boolean;
  signIn: (rut: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const { data: profile } = useProfileQuery(session?.user.id);
  const { data: business } = useBusinessQuery(profile?.business_id);

  useEffect(() => {
    applyAccent(business?.accent);
  }, [business?.accent]);

  async function signIn(rut: string, pin: string) {
    const { error } = await supabase.auth.signInWithPassword({ email: rutToEmail(rut), password: pin });
    if (error) throw new Error(authErrorEs(error));
  }
  async function signOut() { await supabase.auth.signOut(); }

  return (
    <Ctx.Provider value={{ session, profile: profile ?? null, business: business ?? null, loading, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fuera de AuthProvider");
  return c;
}

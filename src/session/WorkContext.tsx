import { createContext, useContext, useState, type ReactNode } from "react";
import type { Branch, Register } from "@/data/work";

interface WorkCtx {
  branch: Branch | null; setBranch: (b: Branch | null) => void;
  register: Register | null; setRegister: (r: Register | null) => void;
}
const Ctx = createContext<WorkCtx | null>(null);

export function WorkProvider({ children }: { children: ReactNode }) {
  const [branch, setBranch] = useState<Branch | null>(null);
  const [register, setRegister] = useState<Register | null>(null);
  return <Ctx.Provider value={{ branch, setBranch, register, setRegister }}>{children}</Ctx.Provider>;
}
export function useWork() {
  const c = useContext(Ctx); if (!c) throw new Error("useWork fuera de WorkProvider"); return c;
}

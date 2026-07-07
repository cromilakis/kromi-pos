import { useState, useEffect, type ReactNode } from "react";
import { useRegisters, useOpenSession, rpcAbrirCaja } from "@/data/work";
import { useWork } from "./WorkContext";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export function CashGate({ children }: { children: ReactNode }) {
  const { branch, register, setRegister } = useWork();
  const qc = useQueryClient();
  const { data: registers } = useRegisters(branch?.id);
  const { data: openSession } = useOpenSession(register?.id);
  const [floatAmount, setFloatAmount] = useState("50000");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!register && registers && registers.length) setRegister(registers[0]);
  }, [register, registers, setRegister]);

  if (openSession) return <>{children}</>;
  if (!register) return <div className="min-h-full grid place-items-center">Cargando cajas…</div>;

  async function abrir() {
    setBusy(true);
    try { await rpcAbrirCaja(register!.id, Number(floatAmount) || 0); await qc.invalidateQueries({ queryKey: ["open-session"] }); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-full grid place-items-center p-6">
      <Card className="p-6 space-y-3 w-full max-w-sm">
        <h2 className="font-semibold">Abrir caja — {register.name}</h2>
        <label className="text-sm">Fondo inicial</label>
        <Input value={floatAmount} inputMode="numeric" onChange={(e) => setFloatAmount(e.target.value)} />
        <Button className="w-full" onClick={abrir} disabled={busy}>{busy ? "Abriendo…" : "Abrir caja"}</Button>
      </Card>
    </div>
  );
}

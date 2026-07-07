import { useEffect, type ReactNode } from "react";
import { useBranches, useRegisters } from "@/data/work";
import { useWork } from "./WorkContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function BranchGate({ businessId, children }: { businessId: string; children: ReactNode }) {
  const { data: branches } = useBranches(businessId);
  const { branch, setBranch, register, setRegister } = useWork();
  // Cajas de la sucursal activa: se auto-selecciona la primera. Antes esto vivía
  // en CashGate (quitado del layout en ③a); sin ello, `register` quedaba null y
  // "Abrir caja" se deshabilitaba en Inicio/Venta.
  const { data: registers } = useRegisters(branch?.id);

  useEffect(() => {
    if (!branch && branches && branches.length === 1) setBranch(branches[0]);
  }, [branch, branches, setBranch]);

  useEffect(() => {
    if (branch && !register && registers && registers.length) setRegister(registers[0]);
  }, [branch, register, registers, setRegister]);

  if (branch) return <>{children}</>;
  if (!branches) return <div className="min-h-full grid place-items-center">Cargando sucursales…</div>;

  return (
    <div className="min-h-full grid place-items-center p-6">
      <Card className="p-6 space-y-3 w-full max-w-sm">
        <h2 className="font-semibold">Elige una sucursal</h2>
        {branches.map((b) => <Button key={b.id} variant="outline" className="w-full justify-start" onClick={() => setBranch(b)}>{b.name}</Button>)}
      </Card>
    </div>
  );
}

import { useState, type MouseEvent } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { navForRole } from "@/session/nav";
import { useWork } from "@/session/WorkContext";
import { BranchGate } from "@/session/BranchGate";
import { CashGate } from "@/session/CashGate";
import { useOpenSession, rpcCerrarCaja } from "@/data/work";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function Topbar() {
  const { branch, register } = useWork();
  const qc = useQueryClient();
  const { data: openSession } = useOpenSession(register?.id);
  const [counted, setCounted] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function cerrar(e: MouseEvent) {
    e.preventDefault();
    if (!openSession) return;
    setBusy(true);
    try {
      await rpcCerrarCaja(openSession.id, Number(counted) || 0);
      await qc.invalidateQueries({ queryKey: ["open-session"] });
      setOpen(false);
      setCounted("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-12 border-b flex items-center justify-between px-4 shrink-0">
      <div className="text-sm font-medium">{branch?.name ?? "Sin sucursal"}</div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={!openSession}>Cerrar caja</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar caja</AlertDialogTitle>
            <AlertDialogDescription>Ingresa el monto contado en efectivo para cerrar la caja actual.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            inputMode="numeric"
            placeholder="Monto contado"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={cerrar}>
              {busy ? "Cerrando…" : "Confirmar cierre"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function AppLayout() {
  const { profile, business, signOut } = useAuth();

  if (!profile) return <div className="min-h-full grid place-items-center">Cargando perfil…</div>;

  return (
    <div className="min-h-full flex">
      <aside className="w-56 border-r p-4 flex flex-col gap-1">
        <div className="font-bold mb-4">{business?.name ?? "Kromi POS"}</div>
        {navForRole(profile.role).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}
            className={({ isActive }) => `px-3 py-2 rounded-md text-sm ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {n.label}
          </NavLink>
        ))}
        <div className="mt-auto pt-4 text-sm text-muted-foreground">
          <div>{profile.name}</div>
          <Button variant="ghost" size="sm" onClick={signOut} className="mt-1 px-0">Salir</Button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-auto">
          <BranchGate businessId={profile.business_id}>
            <CashGate><Outlet /></CashGate>
          </BranchGate>
        </main>
      </div>
    </div>
  );
}

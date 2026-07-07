import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

export function LoginScreen() {
  const { signIn } = useAuth();
  const [rut, setRut] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try { await signIn(rut, pin); }
    catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-full grid place-items-center bg-[#F6F7FB] p-6">
      <Card className="w-full max-w-sm p-6 space-y-4">
        <h1 className="text-xl font-bold">Kromi POS</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="rut">RUT</Label>
            <Input id="rut" value={rut} onChange={(e) => setRut(e.target.value)} placeholder="11.111.111-1" autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pin">PIN</Label>
            <Input id="pin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••••" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</Button>
        </form>
      </Card>
    </div>
  );
}

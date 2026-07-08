import { useState } from "react";
import { Link } from "react-router-dom";
import { ShoppingCart, AlertTriangle, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useOpenSession, rpcAbrirCaja } from "@/data/work";
import { useSalesToday, useRecentSales, useCriticalStock } from "@/data/sales";
import { fmtCLP } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const METHOD_LABEL: Record<string, string> = { efectivo: "Efectivo", tarjeta: "Tarjeta" };

function fmtHora(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

function AbrirCajaCard() {
  const { register } = useWork();
  const qc = useQueryClient();
  const [floatAmount, setFloatAmount] = useState("0");
  const [busy, setBusy] = useState(false);

  async function abrir() {
    if (!register) return;
    setBusy(true);
    try {
      await rpcAbrirCaja(register.id, Number(floatAmount) || 0);
      await qc.invalidateQueries({ queryKey: ["open-session"] });
    } catch (e) {
      toast.error(`No se pudo abrir la caja: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
      <div className="mb-1 text-[15px] font-extrabold text-[#0F2A1B]">Abrir caja{register ? ` — ${register.name}` : ""}</div>
      <div className="mb-3 text-[12.5px] text-[#9aa8bd]">Ingresa el fondo inicial para comenzar a vender.</div>
      <div className="flex items-center gap-2">
        <Input
          value={floatAmount}
          inputMode="numeric"
          onChange={(e) => setFloatAmount(e.target.value)}
          className="max-w-[160px]"
          disabled={!register || busy}
        />
        <Button onClick={abrir} disabled={!register || busy} style={{ background: "var(--brand)" }}>
          {busy ? "Abriendo…" : "Abrir caja"}
        </Button>
      </div>
    </div>
  );
}

export function InicioScreen() {
  const { profile } = useAuth();
  const { branch, register } = useWork();
  const { data: openSession } = useOpenSession(register?.id);
  const { data: stats } = useSalesToday(branch?.id);
  const { data: recent } = useRecentSales(branch?.id, 8);
  const showCritical = profile?.role === "admin" || profile?.role === "kromi";
  const { data: critical } = useCriticalStock(showCritical ? branch?.id : undefined);

  const count = stats?.count ?? 0;
  const total = stats?.total ?? 0;
  const avg = stats?.avg ?? 0;

  return (
    <div className="relative min-h-full overflow-auto px-[34px] py-[30px]">
      <div className="mx-auto max-w-[1080px]">
        <div className="mb-6">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>
            Panel principal
          </div>
          <h2 className="m-0 text-[28px] font-black tracking-[-.01em] text-[#0F2A1B]">
            Hola, {profile?.name ?? "de nuevo"}
          </h2>
        </div>

        {/* tarjetas de stats */}
        <div className="mb-[18px] grid grid-cols-4 gap-4">
          <div className="relative overflow-hidden rounded-[18px] bg-[#0F2A1B] p-5 text-white">
            <div
              className="pointer-events-none absolute -right-[30px] -top-[30px] size-[120px] rounded-full"
              style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--brand) 45%, transparent), transparent 70%)" }}
            />
            <div className="relative mb-2 text-[12.5px] font-bold text-[#97F2CC]">Ventas de hoy</div>
            <div className="relative text-[32px] font-black tracking-[-.02em]">{count}</div>
            <div className="relative mt-[3px] text-xs text-white/70">operaciones cobradas</div>
          </div>
          <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
            <div className="mb-2 text-[12.5px] font-bold text-[#7C95A8]">Total vendido</div>
            <div className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(total)}</div>
            <div className="mt-[3px] text-xs text-[#9aa8bd]">IVA incluido</div>
          </div>
          <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
            <div className="mb-2 text-[12.5px] font-bold text-[#7C95A8]">Ticket promedio</div>
            <div className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(avg)}</div>
            <div className="mt-[3px] text-xs text-[#9aa8bd]">por venta</div>
          </div>
          <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
            <div className="mb-2 text-[12.5px] font-bold text-[#7C95A8]">Nuevos clientes</div>
            <div className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">0</div>
            <div className="mt-[3px] text-xs text-[#9aa8bd]">registrados hoy</div>
          </div>
        </div>

        {/* caja + CTA venta */}
        <div className="mb-[18px] flex flex-wrap items-stretch gap-[18px]">
          <div className="min-w-[280px] flex-1 basis-[340px]">
            {openSession ? (
              <Link
                to="/venta"
                className="flex h-full items-center gap-[13px] rounded-[18px] p-5 text-white no-underline"
                style={{ background: "var(--brand)" }}
              >
                <span className="flex size-[42px] shrink-0 items-center justify-center rounded-[12px] bg-white/20">
                  <ShoppingCart className="size-[20px]" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-extrabold">Nueva venta</div>
                  <div className="text-[12.5px] text-white/80">Caja abierta</div>
                </div>
                <span className="whitespace-nowrap text-[13px] font-bold">Ir a Venta →</span>
              </Link>
            ) : (
              <AbrirCajaCard />
            )}
          </div>

          <div className="min-w-[280px] flex-[1.4] basis-[420px] rounded-[18px] border border-[#E1E5EE] bg-white p-5">
            <div className="mb-2 text-[16px] font-black text-[#0F2A1B]">Actividad reciente</div>
            {!recent || recent.length === 0 ? (
              <div className="py-[18px] text-[13.5px] text-[#9aa8bd]">Todavía no hay ventas hoy.</div>
            ) : (
              <div>
                {recent.map((s) => (
                  <div key={s.id} className="flex items-center gap-[13px] border-b border-[#F0F2F7] py-[11px] last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-bold text-[#0F2A1B]">Venta #{s.folio ?? "—"}</div>
                      <div className="text-xs text-[#9aa8bd]">
                        {s.method ? METHOD_LABEL[s.method] ?? s.method : ""} · {fmtHora(s.sold_at)}
                      </div>
                    </div>
                    <span className="min-w-[74px] whitespace-nowrap text-right text-[14px] font-black text-[#0F2A1B]">
                      {fmtCLP(s.total)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* stock crítico (solo admin/kromi) */}
        {showCritical && critical && critical.length > 0 && (
          <Link
            to="/stock"
            className="mb-[18px] flex w-full items-center gap-[13px] rounded-[18px] border border-[#F5C2C2] bg-[#FDECEC] p-4 text-left no-underline"
          >
            <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[11px] bg-[#F8D2D2] text-[#B3261E]">
              <AlertTriangle className="size-[19px]" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-extrabold text-[#9a2533]">
                {critical.length} {critical.length === 1 ? "producto" : "productos"} con stock crítico
              </div>
              <div className="mt-px text-[12.5px] text-[#b1607a]">Revisa el stock crítico y genera la solicitud de reposición.</div>
            </div>
            <span className="whitespace-nowrap text-[13px] font-extrabold text-[#9a2533]">Ir a Stock →</span>
          </Link>
        )}

        {showCritical && (
          <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-[16px] font-black text-[#0F2A1B]">Stock bajo</div>
              <Link to="/stock" className="text-[13px] font-bold no-underline" style={{ color: "var(--brand)" }}>
                Ir a Stock →
              </Link>
            </div>
            {!critical || critical.length === 0 ? (
              <div className="py-[18px] text-[13.5px] text-[#9aa8bd]">Sin productos bajo el mínimo. 👍</div>
            ) : (
              <div>
                {critical.map((r, i) => (
                  <div key={`${r.name}-${i}`} className="flex items-center gap-[13px] border-b border-[#F0F2F7] py-[11px] last:border-0">
                    <span className="flex size-[36px] shrink-0 items-center justify-center rounded-[10px] bg-[#F0F2F7] text-[#7C95A8]">
                      <PackageSearch className="size-[18px]" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-bold text-[#0F2A1B]">{r.name}</div>
                    </div>
                    <span className="min-w-[74px] whitespace-nowrap text-right text-[14px] font-black text-[#0F2A1B]">
                      {r.stock} / {r.min_stock}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

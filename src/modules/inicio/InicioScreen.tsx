import { useState } from "react";
import { notifyError } from "@/lib/errors";
import { Link, useNavigate } from "react-router-dom";
import { PackageSearch } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useWork } from "@/session/WorkContext";
import { useOpenSession, rpcOpenCashSession } from "@/data/work";
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
      await rpcOpenCashSession(register.id, Number(floatAmount) || 0);
      await qc.invalidateQueries({ queryKey: ["open-session"] });
    } catch (e) {
      notifyError(`No se pudo abrir la caja.`, e instanceof Error ? e.message : e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
      <div className="mb-1 text-[15px] font-extrabold text-[#0F2A1B]">Abrir caja{register ? ` — ${register.name}` : ""}</div>
      <div className="mb-3 text-[12.5px] text-[#5E6E7E]">Ingresa el fondo inicial para comenzar a vender.</div>
      <div className="flex items-center gap-2">
        <div className="relative max-w-[160px]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-[#556A7C]">$</span>
          <Input
            value={floatAmount}
            inputMode="numeric"
            onChange={(e) => setFloatAmount(e.target.value)}
            className="pl-7"
            disabled={!register || busy}
          />
        </div>
        <Button onClick={abrir} disabled={!register || busy} style={{ background: "var(--brand)" }}>
          {busy ? "Abriendo…" : "Abrir caja"}
        </Button>
      </div>
    </div>
  );
}

export function InicioScreen() {
  const { profile } = useAuth();
  const nav = useNavigate();
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
            <div className="mb-2 text-[12.5px] font-bold text-[#556A7C]">Total vendido</div>
            <div className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(total)}</div>
            <div className="mt-[3px] text-xs text-[#5E6E7E]">IVA incluido</div>
          </div>
          <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
            <div className="mb-2 text-[12.5px] font-bold text-[#556A7C]">Ticket promedio</div>
            <div className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">{fmtCLP(avg)}</div>
            <div className="mt-[3px] text-xs text-[#5E6E7E]">por venta</div>
          </div>
          <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
            <div className="mb-2 text-[12.5px] font-bold text-[#556A7C]">Nuevos clientes</div>
            <div className="text-[30px] font-black tracking-[-.02em] text-[#0F2A1B]">0</div>
            <div className="mt-[3px] text-xs text-[#5E6E7E]">registrados hoy</div>
          </div>
        </div>

        {/* fila dividida: stock bajo (o abrir caja) + actividad reciente */}
        <div className="mb-[18px] grid grid-cols-1 gap-[18px] lg:grid-cols-2">
          {/* Columna izquierda: abrir caja si no hay sesión; con caja abierta, stock bajo (admin/kromi) */}
          {!openSession ? (
            <AbrirCajaCard />
          ) : showCritical ? (
            <div className="rounded-[18px] border border-[#E1E5EE] bg-white p-5">
              <div className="mb-1.5 flex items-center justify-between">
                <div className="text-[16px] font-black text-[#0F2A1B]">Stock bajo</div>
                <Link to="/stock" className="text-[13px] font-bold no-underline" style={{ color: "var(--brand)" }}>
                  Ir a Stock →
                </Link>
              </div>
              {!critical || critical.length === 0 ? (
                <div className="py-[18px] text-[13.5px] text-[#5E6E7E]">Sin productos bajo el mínimo. 👍</div>
              ) : (
                <div>
                  {critical.map((r, i) => (
                    <div key={`${r.name}-${i}`} className="flex items-center gap-[13px] border-b border-[#F0F2F7] py-[11px] last:border-0">
                      <span className="flex size-[36px] shrink-0 items-center justify-center rounded-[10px] bg-[#F0F2F7] text-[#556A7C]">
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
          ) : null}

          {/* Columna derecha: actividad reciente. Si no hay columna izquierda (cajero con caja), ocupa el ancho. */}
          <div className={`rounded-[18px] border border-[#E1E5EE] bg-white p-5 ${openSession && !showCritical ? "lg:col-span-2" : ""}`}>
            <div className="mb-2 text-[16px] font-black text-[#0F2A1B]">Actividad reciente</div>
            {!recent || recent.length === 0 ? (
              <div className="py-[18px] text-[13.5px] text-[#5E6E7E]">Todavía no hay ventas hoy.</div>
            ) : (
              <div>
                {recent.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => nav("/historial", s.dte_folio ? { state: { folio: s.dte_folio } } : undefined)}
                    title="Ver en el historial"
                    className="flex w-full items-center gap-[13px] border-b border-[#F0F2F7] py-[11px] text-left last:border-0 hover:bg-[#F7FAF8]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-bold text-[#0F2A1B]">{s.dte_folio ? `#${s.dte_folio}` : "— pendiente"}</div>
                      <div className="text-xs text-[#5E6E7E]">
                        {s.method ? METHOD_LABEL[s.method] ?? s.method : ""} · {fmtHora(s.sold_at)}
                      </div>
                    </div>
                    <span className="min-w-[74px] whitespace-nowrap text-right text-[14px] font-black text-[#0F2A1B]">
                      {fmtCLP(s.total)}
                    </span>
                    <span className="text-[#B7C0CC]">→</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

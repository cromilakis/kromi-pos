import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { usePriceHistory } from "@/data/purchases";
import { fmtCLP } from "@/lib/money";

/** Histórico de precios de compra de un producto. Permite filtrar por proveedor y grafica
 *  unit_cost vs fecha en un gráfico de línea. Requiere un producto ya existente con compras. */
export function PriceHistory({ productId }: { productId: string | null }) {
  const { data: points, isLoading } = usePriceHistory(productId ?? undefined);
  const [supplierId, setSupplierId] = useState<string>("");

  const suppliers = useMemo(() => {
    const map = new Map<string, string>();
    (points ?? []).forEach((p) => map.set(p.supplier_id, p.supplier_name));
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [points]);

  const series = useMemo(() => {
    const filtered = (points ?? []).filter((p) => !supplierId || p.supplier_id === supplierId);
    return filtered.map((p) => ({ fecha: p.issued_at, precio: p.unit_cost }));
  }, [points, supplierId]);

  if (!productId) {
    return <div className="text-[13px] text-[#556A7C]">El histórico de precios aparece tras registrar compras de este producto.</div>;
  }
  if (isLoading) return <div className="text-[13px] text-[#556A7C]">Cargando histórico…</div>;
  if (!points || points.length === 0) {
    return <div className="text-[13px] text-[#556A7C]">Aún no hay compras registradas para este producto.</div>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-[11px] font-semibold text-[#556A7C]">Proveedor</label>
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="h-9 appearance-none rounded-xl border border-[#E1E5EE] bg-white px-3 text-[13px] font-bold text-[#2A3A2E] outline-none"
        >
          <option value="">Todos</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="#F0F2F7" vertical={false} />
            <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: "#556A7C" }} />
            <YAxis tickFormatter={(v) => fmtCLP(v)} tick={{ fontSize: 11, fill: "#556A7C" }} width={70} />
            <Tooltip formatter={(v) => fmtCLP(Number(v))} labelStyle={{ color: "#0F2A1B" }} />
            <Line type="monotone" dataKey="precio" stroke="var(--brand)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

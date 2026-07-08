import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthProvider";
import { useCustomers, filterCustomers, softDeleteCustomer } from "@/data/customers";
import type { CustomerRow } from "@/data/customers";
import { fmtCLP } from "@/lib/money";
import { CustomerForm } from "./CustomerForm";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function ClientesScreen() {
  const { profile } = useAuth();
  const businessId = profile?.business_id;

  const qc = useQueryClient();
  const { data: customers, isLoading } = useCustomers(businessId);

  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const allCustomers = customers ?? [];
  const filtered = useMemo(() => filterCustomers(allCustomers, query), [allCustomers, query]);

  function refetchAll() {
    qc.invalidateQueries({ queryKey: ["customers", businessId] });
  }

  async function handleDelete(id: string) {
    try {
      await softDeleteCustomer(id);
      toast.success("Cliente eliminado.");
      setConfirmDeleteId(null);
      refetchAll();
    } catch (e) {
      toast.error(`No se pudo eliminar el cliente: ${e instanceof Error ? e.message : e}`);
    }
  }

  const confirmDeleteCustomer = confirmDeleteId ? allCustomers.find((c) => c.id === confirmDeleteId) ?? null : null;

  return (
    <div className="relative min-h-full overflow-auto px-[32px] py-[28px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--brand)" }}>
            Fidelización
          </div>
          <h2 className="m-0 text-[26px] font-black tracking-[-.01em] text-[#0F2A1B]">Clientes</h2>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="flex items-center gap-2 rounded-xl border border-[#A7E3C0] bg-[#E6F7EE] px-[18px] py-3 text-sm font-bold text-[#0a6e36]"
        >
          + Nuevo cliente
        </button>
      </div>

      <div className="mb-3.5 flex items-center gap-3">
        <div className="flex max-w-[440px] flex-1 items-center gap-2.5 rounded-xl border border-[#E1E5EE] bg-white px-[15px] py-2.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente por nombre, teléfono o correo…"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#0F2A1B] outline-none"
          />
        </div>
      </div>

      {isLoading && <div className="py-10 text-center text-[13.5px] text-[#5E6E7E]">Cargando clientes…</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-[60px] text-center text-[#5E6E7E]">
          <div className="text-[16px] font-bold text-[#556A7C]">Sin resultados</div>
          <div className="mt-[3px] text-[13.5px] text-[#5E6E7E]">
            {allCustomers.length === 0 ? "Aún no hay clientes registrados." : "Ningún cliente coincide con la búsqueda."}
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="rounded-2xl border border-[#E1E5EE] bg-white overflow-hidden">
          <div className="grid grid-cols-[2.2fr_1.4fr_1.8fr_1fr_1fr_0.9fr] items-center gap-2 border-b border-[#E1E5EE] bg-[#F6F7FB] px-[18px] py-3 text-[11px] font-bold uppercase tracking-[.05em] text-[#5E6E7E]">
            <span>Cliente</span>
            <span>Teléfono</span>
            <span>Correo</span>
            <span>Puntos</span>
            <span>Gasto</span>
            <span className="text-right">Acciones</span>
          </div>
          {filtered.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[2.2fr_1.4fr_1.8fr_1fr_1fr_0.9fr] items-center gap-2 border-b border-[#F0F2F7] px-[18px] py-3 last:border-0"
            >
              <div className="flex min-w-0 items-center gap-[11px]">
                <div
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                  style={{ background: "linear-gradient(160deg, var(--brand), #22C463)" }}
                >
                  {initials(c.name)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-[#0F2A1B]">{c.name}</div>
                  <div className="text-[11.5px] text-[#5E6E7E]">{c.visits} {c.visits === 1 ? "visita" : "visitas"}</div>
                </div>
              </div>
              <span className="truncate text-[13.5px] text-[#5a6b7e]">{c.phone || "—"}</span>
              <span className="truncate text-[13.5px] text-[#5a6b7e]">{c.email || "—"}</span>
              <span className="text-[13.5px] font-bold text-[#0F2A1B]">{c.points.toLocaleString("es-CL")}</span>
              <span className="text-[13.5px] font-bold text-[#0F2A1B]">{fmtCLP(c.spent)}</span>
              <div className="flex items-center justify-end gap-1.5">
                <button
                  onClick={() => {
                    setEditing(c);
                    setFormOpen(true);
                  }}
                  title="Editar cliente"
                  className="flex size-[30px] items-center justify-center rounded-[9px] border border-[#E1E5EE] bg-white text-[#556A7C]"
                >
                  ✎
                </button>
                <button
                  onClick={() => setConfirmDeleteId(c.id)}
                  title="Eliminar cliente"
                  className="flex size-[30px] items-center justify-center rounded-[9px] border border-[#F5C2C2] bg-white text-[#D02E2E]"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <CustomerForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          customer={editing}
          businessId={businessId ?? ""}
          createdBy={profile?.id ?? null}
          onSaved={refetchAll}
        />
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6" onClick={() => setConfirmDeleteId(null)}>
          <div className="w-[380px] max-w-full rounded-[20px] bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-[15px] font-extrabold text-[#0F2A1B]">
              ¿Eliminar a {confirmDeleteCustomer?.name ?? "este cliente"}?
            </div>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E]"
              >
                Cancelar
              </button>
              <button onClick={() => handleDelete(confirmDeleteId)} className="rounded-[11px] bg-[#D02E2E] px-[18px] py-2.5 text-sm font-bold text-white">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

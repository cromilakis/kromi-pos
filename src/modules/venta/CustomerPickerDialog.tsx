import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCustomers, filterCustomers, type CustomerRow } from "@/data/customers";
import { CustomerForm } from "@/modules/clientes/CustomerForm";

interface CustomerPickerDialogProps {
  open: boolean;
  businessId: string | undefined;
  createdBy: string | null;
  onSelect: (customer: CustomerRow) => void;
  onContinueWithout: () => void;
  onClose: () => void;
}

type Mode = "search" | "new";

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #E1E5EE",
  borderRadius: 11,
  padding: "11px 14px",
  fontFamily: "inherit",
  fontSize: 14,
  color: "#0F2A1B",
  outline: "none",
  boxSizing: "border-box",
};
/** Popup reutilizable para buscar/seleccionar (o crear, incluida empresa con datos tributarios) un cliente durante la venta. */
export function CustomerPickerDialog({ open, businessId, createdBy, onSelect, onContinueWithout, onClose }: CustomerPickerDialogProps) {
  const qc = useQueryClient();
  const { data: customers } = useCustomers(businessId);

  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) {
      setMode("search");
      setQuery("");
    }
  }, [open]);

  if (!open) return null;

  if (mode === "new") {
    return (
      <CustomerForm
        open
        onClose={() => setMode("search")}
        customer={null}
        businessId={businessId ?? ""}
        createdBy={createdBy}
        onSaved={async (created) => {
          await qc.invalidateQueries({ queryKey: ["customers", businessId] });
          if (created) onSelect(created);
        }}
      />
    );
  }

  const filtered = filterCustomers(customers ?? [], query);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,64,.45)] p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[420px] max-w-full rounded-[22px] bg-white"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: "0 24px 70px rgba(0,0,64,.35)" }}
      >
        <div className="flex items-center gap-3 border-b border-[#E1E5EE] p-5">
          <div className="text-[19px] font-black text-[#0F2A1B] flex-1">Seleccionar cliente</div>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg border-0 bg-[#F6F7FB] text-lg text-[#556A7C]"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-3.5 p-5">
          <input
            autoFocus
            style={inputStyle}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, teléfono o correo"
          />
          <div className="max-h-[280px] overflow-auto rounded-xl border border-[#E1E5EE]">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-[#556A7C]">Sin resultados.</div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelect(c)}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-[#E1E5EE] px-4 py-2.5 text-left last:border-b-0 hover:bg-[#F6F7FB]"
                >
                  <span className="text-sm font-bold text-[#0F2A1B]">
                    {c.name}
                    {c.is_company && <span className="ml-1.5 rounded-full bg-[#E7EFE8] px-1.5 py-0.5 text-[10px] font-bold text-[var(--brand)]">Empresa</span>}
                  </span>
                  <span className="text-xs text-[#556A7C]">
                    {[c.phone, c.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={onContinueWithout}
              className="flex-1 rounded-2xl border border-[#E1E5EE] bg-white py-3 text-[14px] font-bold text-[#2A3A2E]"
            >
              Continuar sin cliente
            </button>
            <button
              onClick={() => setMode("new")}
              className="flex-1 rounded-2xl py-3 text-[14px] font-bold text-white"
              style={{ background: "var(--brand)" }}
            >
              Nuevo cliente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { BusinessSettings } from "@/modules/admin/BusinessSettings";
import { DiscountsSettings } from "@/modules/admin/DiscountsSettings";

export function AdminScreen() {
  const [tab, setTab] = useState<"negocio" | "descuentos">("negocio");

  const tabBtn = (id: "negocio" | "descuentos", label: string) => (
    <button
      onClick={() => setTab(id)}
      className="relative px-1 pb-2.5 text-[14.5px] font-bold"
      style={{ color: tab === id ? "var(--brand)" : "#5a6b7e" }}
    >
      {label}
      {tab === id && <span className="absolute inset-x-0 -bottom-px h-[2.5px] rounded-full" style={{ background: "var(--brand)" }} />}
    </button>
  );

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-6 border-b border-[#E1E5EE] px-[32px] pt-[28px]">
        {tabBtn("negocio", "Negocio")}
        {tabBtn("descuentos", "Descuentos")}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "negocio" ? <BusinessSettings /> : <DiscountsSettings />}
      </div>
    </div>
  );
}

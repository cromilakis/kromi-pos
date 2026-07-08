export interface InvoiceFilters {
  supplierId: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  min: string; // monto
  max: string; // monto
  text: string;
}
export interface FilterableInvoice {
  supplier_id: string | null;
  folio: string | null;
  issued_at: string | null;
  total: number | null;
  supplierName: string;
}

/** Filtra facturas en memoria. Campos de filtro vacíos no restringen. Las facturas
 *  sin fecha se excluyen solo cuando hay algún límite de fecha (from o to). */
export function filterInvoices<T extends FilterableInvoice>(invoices: T[], f: InvoiceFilters): T[] {
  const text = f.text.trim().toLowerCase();
  const min = f.min.trim() === "" ? null : Number(f.min);
  const max = f.max.trim() === "" ? null : Number(f.max);
  const hasDateLimit = !!f.from || !!f.to;
  return invoices.filter((i) => {
    if (f.supplierId && i.supplier_id !== f.supplierId) return false;
    if (hasDateLimit) {
      if (!i.issued_at) return false;
      if (f.from && i.issued_at < f.from) return false;
      if (f.to && i.issued_at > f.to) return false;
    }
    if (min != null && !Number.isNaN(min) && (i.total ?? 0) < min) return false;
    if (max != null && !Number.isNaN(max) && (i.total ?? 0) > max) return false;
    if (text) {
      const hay = `${i.folio ?? ""} ${i.supplierName}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

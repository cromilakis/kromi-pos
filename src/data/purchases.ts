import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Extraction } from "@/lib/invoice";

/** Llama la edge function extract-invoice con el PDF. */
export async function extractInvoice(file: File): Promise<{ pdf_path: string; extraction: Extraction }> {
  const form = new FormData();
  form.append("file", file);
  const { data, error } = await supabase.functions.invoke("extract-invoice", { body: form });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as { pdf_path: string; extraction: Extraction };
}

export function useSupplierByRut(rut: string | undefined) {
  return useQuery({
    queryKey: ["supplier-by-rut", rut], enabled: !!rut,
    queryFn: async () => {
      const { data, error } = await supabase.from("supplier").select("id,razon_social,rut,seq,giro,address").eq("rut", rut!).maybeSingle();
      if (error) throw error; return data;
    },
  });
}

export function useSupplierProductMap(supplierId: string | undefined) {
  return useQuery({
    queryKey: ["supplier-product-map", supplierId], enabled: !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase.from("supplier_product").select("supplier_code,product_id").eq("supplier_id", supplierId!);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.supplier_code, r.product_id]));
    },
  });
}

export async function receiveInvoice(args: {
  p_branch: string;
  p_supplier: Record<string, unknown>;
  p_doc: Record<string, unknown>;
  p_lines: Record<string, unknown>[];
  p_pdf_path: string;
}) {
  const { data, error } = await supabase.rpc("receive_invoice", args);
  if (error) throw error; return data;
}

export function usePurchaseInvoices(businessId: string | undefined) {
  return useQuery({
    queryKey: ["purchase-invoices", businessId], enabled: !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_invoice")
        .select("id,folio,issued_at,total,pdf_path,supplier_id,supplier:supplier_id(razon_social)")
        .eq("business_id", businessId!).order("created_at", { ascending: false }).limit(500);
      if (error) throw error; return data ?? [];
    },
  });
}

export interface PricePoint {
  issued_at: string;
  unit_cost: number;
  supplier_id: string;
  supplier_name: string;
}

/** Serie de precios de compra (unit_cost) de un producto a lo largo del tiempo, con su
 *  proveedor. Une purchase_invoice_line con su factura (fecha + proveedor). Ordenada por fecha. */
export function usePriceHistory(productId: string | undefined) {
  return useQuery({
    queryKey: ["price-history", productId],
    enabled: !!productId,
    queryFn: async (): Promise<PricePoint[]> => {
      const { data, error } = await supabase
        .from("purchase_invoice_line")
        .select("unit_cost, invoice:invoice_id(issued_at, supplier_id, supplier:supplier_id(razon_social))")
        .eq("product_id", productId!);
      if (error) throw error;
      return (data ?? [])
        .map((r: any) => ({
          issued_at: r.invoice?.issued_at,
          unit_cost: r.unit_cost,
          supplier_id: r.invoice?.supplier_id ?? "",
          supplier_name: r.invoice?.supplier?.razon_social ?? "—",
        }))
        .filter((p: PricePoint) => !!p.issued_at)
        .sort((a: PricePoint, b: PricePoint) => a.issued_at.localeCompare(b.issued_at));
    },
  });
}

export async function invoiceDownloadUrl(pdfPath: string): Promise<string> {
  // download: true agrega Content-Disposition: attachment a la URL firmada, forzando
  // la descarga en lugar de abrir el PDF (funciona aun siendo cross-origin).
  const { data, error } = await supabase.storage
    .from("purchase-invoices")
    .createSignedUrl(pdfPath, 60, { download: true });
  if (error) throw error; return data.signedUrl;
}

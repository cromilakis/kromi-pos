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

export async function recepcionarFactura(args: {
  p_branch: string;
  p_supplier: Record<string, unknown>;
  p_doc: Record<string, unknown>;
  p_lines: Record<string, unknown>[];
  p_pdf_path: string;
}) {
  const { data, error } = await supabase.rpc("recepcionar_factura", args);
  if (error) throw error; return data;
}

export function usePurchaseInvoices(businessId: string | undefined) {
  return useQuery({
    queryKey: ["purchase-invoices", businessId], enabled: !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_invoice")
        .select("id,folio,issued_at,total,pdf_path,supplier:supplier_id(razon_social)")
        .eq("business_id", businessId!).order("created_at", { ascending: false }).limit(50);
      if (error) throw error; return data ?? [];
    },
  });
}

export async function invoiceDownloadUrl(pdfPath: string): Promise<string> {
  const { data, error } = await supabase.storage.from("purchase-invoices").createSignedUrl(pdfPath, 60);
  if (error) throw error; return data.signedUrl;
}

export function useNextSupplierSeq(businessId: string | undefined) {
  return useQuery({
    queryKey: ["next-supplier-seq", businessId], enabled: !!businessId,
    queryFn: async () => {
      const { data, error } = await supabase.from("supplier")
        .select("seq").eq("business_id", businessId!).not("seq", "is", null)
        .order("seq", { ascending: false }).limit(1);
      if (error) throw error;
      return ((data?.[0]?.seq as number | null) ?? 0) + 1;
    },
  });
}

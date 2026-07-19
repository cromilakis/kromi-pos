import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface SaleRow { id?: string; folio?: number; total: number; method?: string; sold_at?: string; dte_folio?: number | null; }

export function summarizeSales(rows: { total: number }[]): { total: number; count: number; avg: number } {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const count = rows.length;
  return { total, count, avg: count ? Math.round(total / count) : 0 };
}

/** Ventas de HOY de la sucursal (rango del día local). */
export function useSalesToday(branchId: string | undefined) {
  return useQuery({
    queryKey: ["sales-today", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("sale").select("total").eq("branch_id", branchId!).gte("sold_at", start.toISOString());
      if (error) throw error;
      return summarizeSales(data ?? []);
    },
  });
}

export function useRecentSales(branchId: string | undefined, limit = 8) {
  return useQuery({
    queryKey: ["recent-sales", branchId, limit],
    enabled: !!branchId,
    queryFn: async (): Promise<SaleRow[]> => {
      const { data, error } = await supabase
        .from("sale").select("id,folio,total,method,sold_at,dte_folio").eq("branch_id", branchId!)
        .order("sold_at", { ascending: false }).limit(limit);
      if (error) throw error; return data ?? [];
    },
  });
}

export interface SaleDteRow {
  id: string; folio: number; total: number; sold_at: string; method: string;
  dte_status: string; dte_folio: number | null; dte_timbre: string | null;
  discount_amount: number;
  points_redeemed: number; points_discount: number;
  doc_type: string;
  printed_at: string | null;
  lines: { name_snapshot: string; price_snapshot: number; qty: number; discount_amount: number }[];
}

/** Ventas de HOY de la sucursal con su estado de emisión (DTE) y líneas, para
 *  reintentar/reimprimir la boleta electrónica. */
export function useSalesTodayDte(branchId: string | undefined) {
  return useQuery({
    queryKey: ["sales-today-dte", branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<SaleDteRow[]> => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("sale")
        .select("id,folio,total,discount_amount,sold_at,method,dte_status,dte_folio,dte_timbre,points_redeemed,points_discount,doc_type,printed_at,sale_line(name_snapshot,price_snapshot,qty,discount_amount)")
        .eq("branch_id", branchId!)
        .gte("sold_at", start.toISOString())
        .order("sold_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((s: any) => ({
        id: s.id, folio: s.folio, total: s.total, discount_amount: s.discount_amount ?? 0, sold_at: s.sold_at, method: s.method,
        dte_status: s.dte_status, dte_folio: s.dte_folio, dte_timbre: s.dte_timbre,
        points_redeemed: s.points_redeemed ?? 0, points_discount: s.points_discount ?? 0,
        doc_type: s.doc_type ?? "boleta",
        printed_at: s.printed_at ?? null,
        lines: s.sale_line ?? [],
      }));
    },
  });
}

export interface CartItem { product_id: string; qty: number; disc_kind?: "pct" | "amount" | null; disc_value?: number; }

export type DiscountInput = { kind: "pct" | "amount"; value: number } | null;

export interface Sale {
  id: string;
  folio: number;
  total: number;
  neto: number;
  iva: number;
  method: string;
  recv: number;
  change: number;
  sold_at: string;
  discount_amount: number;
  points_redeemed: number;
  points_discount: number;
  doc_type: string;
  printed_at: string | null;
}

/** Cobra la venta de forma atómica vía RPC. Descuentos (línea y total) los recalcula
 *  y valida el servidor (solo admin); el cliente solo envía kind/value. */
export async function chargeSale(args: {
  p_branch: string;
  p_session: string;
  p_lines: CartItem[];
  p_method: "efectivo" | "tarjeta";
  p_recv: number;
  p_customer?: string | null;
  p_total_disc?: DiscountInput;
  p_discount_id?: string | null;
  p_points_redeem?: number;
  p_doc_type?: "boleta" | "factura";
}): Promise<Sale> {
  const { data, error } = await supabase.rpc("charge_sale", {
    p_branch: args.p_branch,
    p_session: args.p_session,
    p_lines: args.p_lines,
    p_method: args.p_method,
    p_recv: args.p_recv,
    p_customer: args.p_customer ?? null,
    p_total_disc: args.p_total_disc ?? null,
    p_discount_id: args.p_discount_id ?? null,
    p_points_redeem: args.p_points_redeem ?? 0,
    p_doc_type: args.p_doc_type ?? "boleta",
  });
  if (error) throw error;
  return data;
}

/** Marca la venta como impresa (idempotente: solo la primera llamada setea
 *  `printed_at`). Necesario porque el cliente no tiene UPDATE directo sobre
 *  `sale` por RLS — ver migración 20260714220000_sale_printed_at.sql. */
export async function markSalePrinted(saleId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_sale_printed", { p_sale: saleId });
  if (error) throw error;
}

/** Convierte el carrito (con qty y descuento) a las líneas que espera la RPC. */
export function cartToLines(cart: { id: string; qty: number; disc_kind?: "pct" | "amount" | null; disc_value?: number }[]): CartItem[] {
  return cart.map((c) => ({ product_id: c.id, qty: c.qty, disc_kind: c.disc_kind ?? null, disc_value: c.disc_value ?? 0 }));
}

// ----------------------------------------------------------------------------
// Cotizaciones (quote/quote_line): SOLO-LECTURA para el cliente. Se crean por
// la RPC `create_quote` (security definer), que fija el precio desde
// `product.price` en el servidor — el cliente nunca envía price/name (ver
// migración 20260707120000_crear_cotizacion.sql). No mueven caja ni stock.
// ----------------------------------------------------------------------------

export interface QuoteLineInput { product_id: string; qty: number; discount_pct?: number; }

export interface QuoteLineRow { product_id: string | null; name_snapshot: string; price_snapshot: number; qty: number; discount_amount: number; }

export interface QuoteRow {
  id: string;
  folio: number;
  branch_id: string;
  customer_id: string | null;
  customer_name: string | null;
  valid_until: string;
  total: number;
  neto: number;
  iva: number;
  discount_amount: number;
  converted: boolean;
  sale_id: string | null;
  created_at: string;
  lines: QuoteLineRow[];
}

/** Vigente = no vencida (independiente de si ya fue convertida). */
export function isQuoteVigente(validUntil: string, today: Date = new Date()): boolean {
  const limit = new Date(`${validUntil}T23:59:59`);
  return limit.getTime() >= today.getTime();
}

/** Crea una cotización vía RPC (precio del servidor). No mueve caja ni stock. */
export async function createQuote(args: {
  branch_id: string;
  customer_id?: string | null;
  valid_until: string;
  lines: QuoteLineInput[];
  discount_pct?: number;
}) {
  if (!args.lines.length) throw new Error("La cotización no tiene líneas.");
  const { data: quote, error } = await supabase.rpc("create_quote", {
    p_branch: args.branch_id,
    p_customer: args.customer_id ?? null,
    p_valid_until: args.valid_until,
    p_lines: args.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, discount_pct: l.discount_pct ?? 0 })),
    p_discount_pct: args.discount_pct ?? 0,
  });
  if (error) throw error;
  return quote as { id: string; folio: number; valid_until: string; total: number; neto: number; iva: number };
}

/** Cotizaciones de la sucursal (vigentes, vencidas y convertidas), con sus líneas. */
export function useQuotes(branchId: string | undefined) {
  return useQuery({
    queryKey: ["quotes", branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<QuoteRow[]> => {
      const { data, error } = await supabase
        .from("quote")
        .select(
          "id,folio,branch_id,customer_id,valid_until,total,neto,iva,discount_amount,converted,sale_id,created_at," +
            "customer:customer_id(name),quote_line(product_id,name_snapshot,price_snapshot,qty,discount_amount)",
        )
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((q: any) => ({
        id: q.id,
        folio: q.folio,
        branch_id: q.branch_id,
        customer_id: q.customer_id,
        customer_name: q.customer?.name ?? null,
        valid_until: q.valid_until,
        total: q.total,
        neto: q.neto,
        iva: q.iva,
        discount_amount: q.discount_amount ?? 0,
        converted: q.converted,
        sale_id: q.sale_id,
        created_at: q.created_at,
        lines: (q.quote_line ?? []) as QuoteLineRow[],
      }));
    },
  });
}

/** Convierte una cotización en venta al PRECIO COTIZADO (congelado en quote_line). */
export async function convertQuote(
  quoteId: string,
  session: string,
  method: "efectivo" | "tarjeta",
  recv: number,
): Promise<Sale> {
  const { data, error } = await supabase.rpc("convert_quote", {
    p_quote: quoteId,
    p_session: session,
    p_method: method,
    p_recv: recv,
  });
  if (error) throw error;
  return data as Sale;
}

/** Elimina una cotización (hard-delete vía RPC). Falla si ya fue convertida en venta. */
export async function deleteQuote(quoteId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_quote", { p_quote: quoteId });
  if (error) throw error;
}

// ----------------------------------------------------------------------------
// Notas de crédito (por boleta o manual): RPC atómica repone stock si corresponde.
// ----------------------------------------------------------------------------

export interface CreditNoteLineInput { product_id: string; qty: number; restock: boolean; }

export interface CreditNote {
  id: string;
  folio: number;
  sale_id: string | null;
  method: string;
  reason: string | null;
  total: number;
  neto: number;
  iva: number;
  created_at: string;
}

export async function issueCreditNote(args: {
  p_branch: string;
  p_session: string | null;
  p_sale: string | null;
  p_method: "efectivo" | "tarjeta";
  p_reason: string;
  p_lines: CreditNoteLineInput[];
  p_cod_ref: 1 | 3;
}): Promise<CreditNote> {
  if (!args.p_lines.length) throw new Error("La nota de crédito no tiene líneas.");
  const { data, error } = await supabase.rpc("issue_credit_note", {
    p_branch: args.p_branch,
    p_session: args.p_session,
    p_sale: args.p_sale,
    p_method: args.p_method,
    p_reason: args.p_reason,
    p_lines: args.p_lines,
    p_cod_ref: args.p_cod_ref,
  });
  if (error) throw error;
  return data as CreditNote;
}

export interface CreditNoteRow {
  id: string; folio: number; total: number; reason: string | null; created_at: string;
  dte_status: string; dte_folio: number | null; dte_timbre: string | null;
  sale_id: string | null; cod_ref: number | null; method: string;
  boleta_folio: number | null; // folio SII de la boleta anulada (fallback: folio interno); null si NC manual
  lines: { name_snapshot: string; price_snapshot: number; qty: number }[];
}

/** Notas de crédito de la sucursal, con su estado de emisión (DTE) y líneas, para
 *  reintentar/reimprimir la nota de crédito electrónica. */
export function useCreditNotes(branchId: string | undefined) {
  return useQuery({
    queryKey: ["credit-notes", branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<CreditNoteRow[]> => {
      const { data, error } = await supabase
        .from("credit_note")
        .select("id,folio,total,reason,created_at,dte_status,dte_folio,dte_timbre,sale_id,cod_ref,method,credit_note_line(name_snapshot,price_snapshot,qty),sale:sale_id(dte_folio,folio)")
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c: any) => ({
        id: c.id, folio: c.folio, total: c.total, reason: c.reason, created_at: c.created_at,
        dte_status: c.dte_status, dte_folio: c.dte_folio, dte_timbre: c.dte_timbre,
        sale_id: c.sale_id, cod_ref: c.cod_ref, method: c.method,
        boleta_folio: c.sale ? (c.sale.dte_folio ?? c.sale.folio ?? null) : null,
        lines: c.credit_note_line ?? [],
      }));
    },
  });
}

export interface SaleWithLines {
  id: string;
  folio: number;
  method: string;
  total: number;
  neto: number;
  iva: number;
  sold_at: string;
  dte_status: string | null;
  dte_folio: number | null;
  emitted_at: string | null;
  lines: { product_id: string | null; name_snapshot: string; price_snapshot: number; qty: number; is_service: boolean }[];
}

/** Busca una venta por folio en la sucursal, con sus líneas (NC "por boleta"). */
export async function buscarVentaPorFolio(branchId: string, folio: number): Promise<SaleWithLines | null> {
  const { data, error } = await supabase
    .from("sale")
    .select("id,folio,method,total,neto,iva,sold_at,dte_status,dte_folio,emitted_at,sale_line(product_id,name_snapshot,price_snapshot,qty,product:product_id(is_service))")
    .eq("branch_id", branchId)
    .eq("folio", folio)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    folio: data.folio,
    method: data.method,
    total: data.total,
    neto: data.neto,
    iva: data.iva,
    sold_at: data.sold_at,
    dte_status: (data as any).dte_status ?? null,
    dte_folio: (data as any).dte_folio ?? null,
    emitted_at: (data as any).emitted_at ?? null,
    lines: ((data as any).sale_line ?? []).map((l: any) => ({
      product_id: l.product_id,
      name_snapshot: l.name_snapshot,
      price_snapshot: l.price_snapshot,
      qty: l.qty,
      // product_id puede ser null (producto borrado); null → no-servicio.
      is_service: l.product?.is_service ?? false,
    })),
  };
}

export interface CriticalStockRow { name: string; stock: number; min_stock: number; }

export function useCriticalStock(branchId: string | undefined) {
  return useQuery({
    queryKey: ["critical-stock", branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<CriticalStockRow[]> => {
      // inventory de la sucursal con stock <= min_stock del producto
      const { data, error } = await supabase
        .from("inventory").select("stock, product:product_id(name,min_stock)").eq("branch_id", branchId!);
      if (error) throw error;
      return (data ?? [])
        .map((r: any) => ({ name: r.product?.name, stock: r.stock, min_stock: r.product?.min_stock ?? 0 }))
        .filter((r: any) => r.min_stock > 0 && r.stock <= r.min_stock);
    },
  });
}

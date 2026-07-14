import { createClient } from "npm:@supabase/supabase-js@2";

const SF_URL = Deno.env.get("SIMPLEFACTURA_URL") ?? "https://api.simplefactura.cl";
const SF_EMAIL = Deno.env.get("SIMPLEFACTURA_EMAIL")!;
const SF_PASSWORD = Deno.env.get("SIMPLEFACTURA_PASSWORD")!;
const SF_AMBIENTE = Number(Deno.env.get("SIMPLEFACTURA_AMBIENTE") ?? "0");
// Nombre de la sucursal del emisor (en la URL los espacios van como "_").
const SUCURSAL = (Deno.env.get("SIMPLEFACTURA_SUCURSAL") ?? "Casa Matriz").replace(/\s+/g, "_");
// Emisor: en demo se usa un RUT autorizado por la cuenta demo (no el del negocio real).
// Formato BOLETA (39): RznSocEmisor/GiroEmisor (sin Acteco/CiudadOrigen).
const EMISOR = {
  RUTEmisor: Deno.env.get("SIMPLEFACTURA_RUT_EMISOR") ?? "78181331-1",
  RznSocEmisor: Deno.env.get("SIMPLEFACTURA_RZN") ?? "CHILESYSTEMS SPA",
  GiroEmisor: Deno.env.get("SIMPLEFACTURA_GIRO") ?? "Desarrollo de software",
  DirOrigen: Deno.env.get("SIMPLEFACTURA_DIR") ?? "Calle 7 numero 3",
  CmnaOrigen: Deno.env.get("SIMPLEFACTURA_CMNA") ?? "Santiago",
};
// Formato FACTURA (33): RznSoc/GiroEmis + Acteco (array de códigos) + CiudadOrigen
// (ver skill simplefactura-dte §3.1). Reutiliza RUT/Dir/Cmna del emisor de boleta;
// Acteco y Ciudad son nuevas env vars propias de factura.
const EMISOR_FACTURA = {
  RUTEmisor: EMISOR.RUTEmisor,
  RznSoc: Deno.env.get("SIMPLEFACTURA_RZN") ?? "CHILESYSTEMS SPA",
  GiroEmis: Deno.env.get("SIMPLEFACTURA_GIRO") ?? "Desarrollo de software",
  Acteco: (Deno.env.get("SF_EMISOR_ACTECO") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number),
  DirOrigen: EMISOR.DirOrigen,
  CmnaOrigen: EMISOR.CmnaOrigen,
  CiudadOrigen: Deno.env.get("SF_EMISOR_CIUDAD") ?? "Santiago",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sfToken(): Promise<string> {
  const r = await fetch(`${SF_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SF_EMAIL, password: SF_PASSWORD }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const raw = (await r.text()).trim();
  // La API devuelve { "accessToken": "..." }. Tolerar también string plano u otras claves.
  if (raw.startsWith("{")) { try { const o = JSON.parse(raw); return o.accessToken ?? o.token ?? o.data ?? raw; } catch { /* noop */ } }
  return raw.replace(/^"|"$/g, "");
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { sale_id } = await req.json();
    if (!sale_id) return json({ status: "error", message: "sale_id requerido" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: sale, error: e1 } = await admin
      .from("sale")
      .select("id,folio,neto,iva,total,discount_amount,points_discount,points_redeemed,doc_type,customer_id,dte_status,dte_folio,dte_timbre,sale_line(name_snapshot,price_snapshot,qty,discount_amount)")
      .eq("id", sale_id).single();
    if (e1 || !sale) return json({ status: "error", message: "venta no encontrada" }, 404);

    // Idempotencia: ya emitida → devolver lo persistido.
    if (sale.dte_status === "emitida" && sale.dte_folio) {
      return json({ status: "emitida", folio: sale.dte_folio, timbre_png: sale.dte_timbre });
    }

    const esFactura = sale.doc_type === "factura";
    const tipoDte = esFactura ? 33 : 39;

    // Factura: requiere el cliente (empresa) para el Receptor real.
    let customer: { rut: string | null; razon_social: string | null; giro: string | null; direccion: string | null; comuna: string | null } | null = null;
    if (esFactura) {
      if (!sale.customer_id) return json({ status: "error", message: "la factura requiere un cliente" }, 400);
      const { data: cust, error: e2 } = await admin
        .from("customer")
        .select("rut,razon_social,giro,direccion,comuna")
        .eq("id", sale.customer_id).single();
      if (e2 || !cust) return json({ status: "error", message: "cliente no encontrado" }, 404);
      customer = cust;
    }

    const token = await sfToken();
    const lines = (sale as { sale_line?: Array<{ name_snapshot: string; price_snapshot: number; qty: number; discount_amount?: number }> }).sale_line ?? [];
    // Boleta: precio con IVA incluido (line.discount_amount ya viene con IVA incluido).
    // Factura: detalle en NETO (price_snapshot y descuentos vienen con IVA incluido desde
    // la venta; se llevan a neto dividiendo por 1.19 y redondeando, ver skill §0.5/§3).
    const detalle = lines.map((l, i) => {
      const desc = l.discount_amount ?? 0;
      const prc = esFactura ? Math.round(l.price_snapshot / 1.19) : l.price_snapshot;
      const montoBruto = esFactura ? Math.round((l.price_snapshot * l.qty) / 1.19) : l.price_snapshot * l.qty;
      const descNeto = esFactura ? Math.round(desc / 1.19) : desc;
      const monto = montoBruto - descNeto;
      const d: Record<string, string | number> = {
        NroLinDet: String(i + 1),
        NmbItem: l.name_snapshot,
        QtyItem: String(l.qty),
        UnmdItem: "un",
        PrcItem: String(prc),
        MontoItem: String(monto),
      };
      // Declarar el descuento por línea: sin esto el DTE queda inconsistente
      // (QtyItem×PrcItem ≠ MontoItem) y la boleta muestra DESCUENTO -0. Con DescuentoMonto,
      // SimpleFactura/SII cuadran QtyItem×PrcItem − DescuentoMonto = MontoItem y lo reflejan.
      if (descNeto > 0) d.DescuentoMonto = descNeto;
      return d;
    });
    // Descuento global (comercial o canje de puntos): se declara aparte del descuento por
    // línea vía DscRcgGlobal. TpoMov:1 = Descuento (genera "D"; el enum es 1-based, TpoMov:0
    // pasa el preview pero rompe en emisión real con <TpoMov></TpoMov> vacío) y
    // TpoValor:2 = Monto (genera "$"). Si no hay descuento global, la clave no se incluye
    // (undefined, no array vacío).
    const descuentoGlobalBruto = sale.discount_amount ?? 0;
    const descuentoGlobal = esFactura ? Math.round(descuentoGlobalBruto / 1.19) : descuentoGlobalBruto;
    const dscRcgGlobal = descuentoGlobal > 0
      ? [{
          NroLinDR: 1,
          TpoMov: 1,
          TpoValor: 2,
          ValorDR: String(descuentoGlobal),
          GlosaDR: (sale.points_redeemed ?? 0) > 0
            ? `Canje de puntos (${sale.points_redeemed} pts)`
            : "Descuento",
        }]
      : undefined;

    // Totales: boleta usa los ya persistidos (neto/iva/total, con IVA incluido, ya
    // descuentan el global); factura se recalcula en neto desde el detalle (los montos
    // persistidos en sale.* vienen en bruto/IVA-incluido, no sirven para factura).
    let idDoc: Record<string, unknown>;
    let emisor: Record<string, unknown>;
    let receptor: Record<string, unknown>;
    let totales: Record<string, string>;
    if (esFactura) {
      const mntNeto = detalle.reduce((acc, d) => acc + Number(d.MontoItem), 0) - descuentoGlobal;
      const ivaFactura = Math.round(mntNeto * 0.19);
      idDoc = { TipoDTE: 33, FchEmis: isoDate(new Date()), FchVenc: isoDate(new Date()), FmaPago: 1 };
      emisor = EMISOR_FACTURA;
      receptor = {
        RUTRecep: customer!.rut,
        RznSocRecep: customer!.razon_social,
        GiroRecep: customer!.giro,
        DirRecep: customer!.direccion,
        CmnaRecep: customer!.comuna,
      };
      totales = { MntNeto: String(mntNeto), IVA: String(ivaFactura), MntTotal: String(mntNeto + ivaFactura) };
    } else {
      idDoc = { TipoDTE: 39, FchEmis: isoDate(new Date()), FchVenc: isoDate(new Date()), IndServicioBoleta: 3 };
      emisor = EMISOR;
      // Boleta al público: receptor "consumidor final" (RUT 66666666-6).
      receptor = { RUTRecep: "66666666-6", RznSocRecep: "Consumidor Final", DirRecep: "Ciudad", CmnaRecep: "Santiago", CiudadRecep: "Santiago" };
      // MntNeto/IVA/MntTotal ya vienen reducidos por el servidor (descuentan el global);
      // no se recalculan aquí.
      totales = { MntNeto: String(sale.neto), IVA: String(sale.iva), MntTotal: String(sale.total) };
    }

    const body = {
      Documento: {
        Encabezado: {
          IdDoc: idDoc,
          Emisor: emisor,
          Receptor: receptor,
          Totales: totales,
        },
        Detalle: detalle,
        ...(dscRcgGlobal ? { DscRcgGlobal: dscRcgGlobal } : {}),
      },
    };

    const emit = await fetch(`${SF_URL}/invoiceV2/${SUCURSAL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const emitText = await emit.text();
    if (!emit.ok) {
      await admin.from("sale").update({ dte_status: "error" }).eq("id", sale_id);
      return json({ status: "error", message: `emision ${emit.status}: ${emitText}` }, 502);
    }
    const emitJson = JSON.parse(emitText);
    const folio = emitJson?.data?.folio;
    if (!folio) {
      await admin.from("sale").update({ dte_status: "rechazada" }).eq("id", sale_id);
      return json({ status: "rechazada", message: emitJson?.message ?? "sin folio" }, 200);
    }

    // Timbre (PNG base64). Si falla, la boleta ya tiene folio; el timbre se reintenta luego.
    let timbre_png: string | null = null;
    try {
      const tr = await fetch(`${SF_URL}/dte/timbre`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          credenciales: { rutEmisor: EMISOR.RUTEmisor },
          dteReferenciadoExterno: { folio, codigoTipoDte: tipoDte, ambiente: SF_AMBIENTE },
        }),
      });
      if (tr.ok) timbre_png = JSON.parse(await tr.text())?.data ?? null;
    } catch (_) { /* noop */ }

    await admin.from("sale").update({
      dte_status: "emitida", dte_folio: folio, dte_timbre: timbre_png, emitted_at: new Date().toISOString(),
    }).eq("id", sale_id);

    return json({ status: "emitida", folio, timbre_png });
  } catch (err) {
    return json({ status: "error", message: String(err) }, 500);
  }
});

const SF_URL = Deno.env.get("SIMPLEFACTURA_URL") ?? "https://api.simplefactura.cl";
const SF_EMAIL = Deno.env.get("SIMPLEFACTURA_EMAIL")!;
const SF_PASSWORD = Deno.env.get("SIMPLEFACTURA_PASSWORD")!;
const SF_AMBIENTE = Number(Deno.env.get("SIMPLEFACTURA_AMBIENTE") ?? "0");
const RUT_EMISOR = Deno.env.get("SIMPLEFACTURA_RUT_EMISOR") ?? "78181331-1";
const SUCURSAL = Deno.env.get("SIMPLEFACTURA_SUCURSAL") ?? "Casa Matriz"; // con espacios (nombre real)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Tipos DTE sin límite de folios (la API devuelve 0 = sin límite).
const SIN_LIMITE = new Set([34, 39, 41, 52, 110, 111, 112]);

async function sfToken(): Promise<string> {
  const r = await fetch(`${SF_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SF_EMAIL, password: SF_PASSWORD }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const raw = (await r.text()).trim();
  if (raw.startsWith("{")) { try { const o = JSON.parse(raw); return o.accessToken ?? o.token ?? o.data ?? raw; } catch { /* noop */ } }
  return raw.replace(/^"|"$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { action, tipoDte, cantidad } = await req.json();
    const t = Number(tipoDte);
    if (!t) return json({ status: "error", message: "tipoDte requerido" }, 400);
    const token = await sfToken();
    const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    if (action === "consultar") {
      // Folios sin uso (disponibles para emitir).
      const rSin = await fetch(`${SF_URL}/folios/consultar/sin-uso`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ rutEmpresa: RUT_EMISOR, tipoDTE: t, ambiente: SF_AMBIENTE }),
      });
      const txtSin = await rSin.text();
      if (!rSin.ok) return json({ status: "error", message: `folios sin-uso ${rSin.status}: ${txtSin}` }, 502);
      const jSin = JSON.parse(txtSin);
      const sinUso = Array.isArray(jSin?.data)
        ? jSin.data.reduce((s: number, x: { cantidad?: number }) => s + (x.cantidad ?? 0), 0)
        : 0;
      // Cantidad máxima a solicitar.
      const rDisp = await fetch(`${SF_URL}/folios/consultar/disponibles`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ rutEmpresa: RUT_EMISOR, tipoDTE: t, ambiente: SF_AMBIENTE }),
      });
      const txtDisp = await rDisp.text();
      if (!rDisp.ok) return json({ status: "error", message: `folios disponibles ${rDisp.status}: ${txtDisp}` }, 502);
      const jDisp = JSON.parse(txtDisp);
      const raw = Number(jDisp?.data ?? 0);
      const maxRequestable = SIN_LIMITE.has(t) ? null : raw; // null = sin límite
      return json({ status: "ok", sinUso, maxRequestable });
    }

    if (action === "solicitar") {
      const n = Number(cantidad);
      if (!n || n <= 0) return json({ status: "error", message: "cantidad debe ser mayor a 0" }, 400);
      const r = await fetch(`${SF_URL}/folios/solicitar`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          credenciales: { rutEmisor: RUT_EMISOR, nombreSucursal: SUCURSAL },
          cantidad: n,
          codigoTipoDte: t,
          ambiente: SF_AMBIENTE,
        }),
      });
      const txt = await r.text();
      if (!r.ok) return json({ status: "error", message: `solicitud ${r.status}: ${txt}` }, 502);
      return json({ status: "ok", caf: JSON.parse(txt)?.data ?? null });
    }

    return json({ status: "error", message: "action inválida" }, 400);
  } catch (err) {
    return json({ status: "error", message: String(err) }, 500);
  }
});

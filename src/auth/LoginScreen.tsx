import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

/**
 * Pantalla de login, clon visual del prototipo (`prototype/index.html`,
 * bloque `data-screen-label="Login"`). Split-screen: portada de marca a la
 * izquierda, formulario de 2 pasos (RUT -> PIN) con teclado numérico táctil
 * a la derecha. La autenticación real la resuelve `useAuth().signIn`.
 */

type LoginStep = "rut" | "pin";

/** Normaliza a solo dígitos + 'K' (dígito verificador), como `normRut` del prototipo. */
function normRut(raw: string): string {
  return (raw || "").toUpperCase().replace(/[^0-9K]/g, "");
}

/** Formatea "111111111" -> "11.111.111-1", como `fmtRut` del prototipo. */
function fmtRut(raw: string): string {
  if (!raw) return "";
  const dv = raw.slice(-1);
  let body = raw.slice(0, -1);
  body = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return body ? `${body}-${dv}` : dv;
}

const PIN_LENGTH = 4;

export function LoginScreen() {
  const { signIn } = useAuth();
  const [step, setStep] = useState<LoginStep>("rut");
  const [rut, setRut] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pressKey(ch: string) {
    setError(null);
    if (step === "pin") {
      if (!/[0-9]/.test(ch)) return;
      setPin((p) => (p + ch).replace(/[^0-9]/g, "").slice(0, PIN_LENGTH));
      return;
    }
    setRut((r) => (r + ch).replace(/[^0-9Kk]/g, "").slice(0, 9));
  }

  function backspace() {
    setError(null);
    if (step === "pin") setPin((p) => p.slice(0, -1));
    else setRut((r) => r.slice(0, -1));
  }

  function goToRut() {
    setStep("rut");
    setPin("");
    setError(null);
  }

  async function submit() {
    if (busy) return;
    if (step === "rut") {
      if (normRut(rut).length < 2) {
        setError("Ingresa un RUT válido.");
        return;
      }
      setStep("pin");
      setPin("");
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(rut, pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pressKey(e.key);
        return;
      }
      if (step === "rut" && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        pressKey("K");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, rut, pin, busy]);

  const isPin = step === "pin";
  const rutNorm = normRut(rut);
  const hasValue = isPin ? pin.length > 0 : rutNorm.length > 0;
  const iconColor = error ? "#D02E2E" : hasValue ? "#0a6e36" : "#9aa8bd";
  const fieldLabel = isPin ? "PIN de seguridad" : "RUT";
  const title = isPin ? "Ingresa tu PIN" : "Ingresa tu RUT";
  const display = isPin
    ? Array.from({ length: PIN_LENGTH }, (_, i) => (i < pin.length ? "●" : "○")).join("   ")
    : fmtRut(rutNorm) || "00.000.000-0";

  const keys: { label: string; onClick: () => void }[] = [
    ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((l) => ({ label: l, onClick: () => pressKey(l) })),
    { label: "K", onClick: () => pressKey("K") },
    { label: "0", onClick: () => pressKey("0") },
    { label: "⌫", onClick: backspace },
  ];
  // En el paso PIN no existe dígito verificador: la tecla 'K' no aplica.
  const visibleKeys = isPin ? keys.filter((k) => k.label !== "K") : keys;

  return (
    <div style={{ minHeight: "100%", width: "100%", display: "flex", background: "#F6F7FB", fontFamily: "'Satoshi', system-ui, sans-serif" }}>
      <style>{`
        .lkey{border:1px solid #E1E5EE;background:#fff;border-radius:13px;font-size:23px;font-weight:700;color:#0F2A1B;cursor:pointer;display:flex;align-items:center;justify-content:center;height:56px;font-family:inherit;transition:transform .07s,background .12s;}
        .lkey:active{transform:scale(.95);background:#F1F4F8;}
      `}</style>
      <div style={{ flex: 1, height: "100vh", display: "flex", minHeight: 0 }}>
        {/* ================= Portada de marca ================= */}
        <div
          style={{
            flex: 1.05,
            position: "relative",
            color: "#fff",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 48,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(155deg,rgba(8,40,26,.62) 0%,rgba(6,28,18,.38) 45%,rgba(4,20,12,.74) 100%), url('/login-cover.png')",
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(4px)",
              transform: "scale(1.08)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
            <img
              src="/logo.png"
              alt="Logo"
              style={{ width: 46, height: 46, borderRadius: "50%", objectFit: "cover", display: "block", flex: "none" }}
            />
            <div style={{ fontWeight: 900, fontSize: 22 }}>
              Kromi POS <span style={{ fontWeight: 500, fontSize: 14, color: "rgba(255,255,255,.72)" }}>· Punto de venta</span>
            </div>
          </div>
          <div style={{ position: "relative", maxWidth: 420 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#97F2CC", marginBottom: 14 }}>
              Punto de venta
            </div>
            <h1 style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.1, letterSpacing: "-.02em", margin: "0 0 16px" }}>
              Haz crecer tu negocio.
            </h1>
            <p style={{ fontSize: 16, lineHeight: 1.55, color: "rgba(255,255,255,.78)", margin: 0 }}>
              Gestiona ventas, stock, clientes y caja desde un solo lugar.
            </p>
          </div>
          <div style={{ position: "relative", fontSize: 13, color: "rgba(255,255,255,.55)" }}>© 2026 · Powered by Kromi</div>
        </div>

        {/* ================= Formulario ================= */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, background: "#fff" }}>
          <div style={{ width: "100%", maxWidth: 372 }}>
            <h2 style={{ fontSize: 26, fontWeight: 900, color: "#0F2A1B", margin: "0 0 22px", letterSpacing: "-.01em" }}>{title}</h2>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#7C95A8", marginBottom: 8 }}>{fieldLabel}</label>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                height: 52,
                padding: "0 14px",
                borderRadius: 13,
                border: `1.5px solid ${error ? "#F3B4B4" : "#E1E5EE"}`,
                background: "#fff",
              }}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <circle cx="9" cy="10" r="2" />
                <path d="M5 17c.8-1.6 2.3-2.5 4-2.5s3.2.9 4 2.5M15 9h3M15 13h3" />
              </svg>
              <span
                style={{
                  flex: 1,
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: isPin ? ".1em" : ".02em",
                  color: hasValue ? "#0F2A1B" : "#B6C0CC",
                }}
              >
                {display}
              </span>
            </div>
            {isPin && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: 11 }}>
                <button
                  onClick={goToRut}
                  type="button"
                  style={{ border: 0, background: "transparent", color: "var(--brand)", fontWeight: 700, fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", padding: 0 }}
                >
                  Cambiar RUT
                </button>
              </div>
            )}
            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#D02E2E", fontSize: 13, fontWeight: 600, marginTop: 11 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                {error}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 18 }}>
              {visibleKeys.map((k) => (
                <button key={k.label} type="button" className="lkey" onClick={k.onClick}>
                  {k.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              style={{
                width: "100%",
                height: 52,
                marginTop: 16,
                border: 0,
                borderRadius: 13,
                background: "var(--brand)",
                color: "#fff",
                fontWeight: 800,
                fontSize: 16,
                fontFamily: "inherit",
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.7 : 1,
                boxShadow: "0 8px 20px rgba(30,158,84,.28)",
              }}
            >
              {busy ? "Ingresando…" : "Ingresar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

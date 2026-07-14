import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

/** PIN de 6 dígitos, igual que `LoginScreen` (mínimo de Supabase Auth en producción). */
const PIN_LENGTH = 6;

/**
 * Overlay full-screen de bloqueo por inactividad. Pide el PIN del usuario actual
 * (reutilizando el email de la sesión vigente) y revalida contra Supabase Auth
 * con `signInWithPassword`, sin necesitar el RUT ni cerrar la sesión existente.
 */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { profile, signOut } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pressKey(ch: string) {
    if (busy) return;
    setError(null);
    setPin((p) => (p + ch).replace(/[^0-9]/g, "").slice(0, PIN_LENGTH));
  }

  function backspace() {
    if (busy) return;
    setError(null);
    setPin((p) => p.slice(0, -1));
  }

  async function submit() {
    if (busy || pin.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user.email;
      if (!email) {
        setError("Sesión no encontrada. Cierra sesión e ingresa de nuevo.");
        setPin("");
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: pin });
      if (signInError) {
        setError("PIN incorrecto.");
        setPin("");
        return;
      }
      onUnlock();
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
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, busy]);

  const display = Array.from({ length: PIN_LENGTH }, (_, i) => (i < pin.length ? "●" : "○")).join("   ");
  const keys: { label: string; onClick: () => void; disabled?: boolean }[] = [
    ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((l) => ({ label: l, onClick: () => pressKey(l) })),
    { label: "", onClick: () => {}, disabled: true },
    { label: "0", onClick: () => pressKey("0") },
    { label: "⌫", onClick: backspace },
  ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(155deg,#08281a 0%,#061c12 45%,#04140c 100%)",
        fontFamily: "'Satoshi', system-ui, sans-serif",
      }}
    >
      <style>{`
        .lockkey{border:1px solid #E1E5EE;background:#fff;border-radius:13px;font-size:23px;font-weight:700;color:#0F2A1B;cursor:pointer;display:flex;align-items:center;justify-content:center;height:56px;font-family:inherit;transition:transform .07s,background .12s;}
        .lockkey:active{transform:scale(.95);background:#F1F4F8;}
        .lockkey:disabled{visibility:hidden;cursor:default;}
      `}</style>
      <div
        style={{
          width: "100%",
          maxWidth: 372,
          background: "#fff",
          borderRadius: 20,
          padding: 40,
          boxShadow: "0 24px 60px rgba(0,0,0,.4)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div
            style={{
              margin: "0 auto 14px",
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "#0F2A1B",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 20,
            }}
          >
            🔒
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: "#0F2A1B", margin: "0 0 4px", letterSpacing: "-.01em" }}>
            Sesión bloqueada
          </h2>
          {profile && (
            <div style={{ fontSize: 13, color: "#556A7C", fontWeight: 600 }}>{profile.name}</div>
          )}
        </div>

        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#556A7C", marginBottom: 8, textAlign: "center" }}>
          Ingresa tu PIN para continuar
        </label>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            height: 52,
            padding: "0 14px",
            borderRadius: 13,
            border: `1.5px solid ${error ? "#F3B4B4" : "#E1E5EE"}`,
            background: "#fff",
          }}
        >
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: ".1em", color: pin.length > 0 ? "#0F2A1B" : "#B6C0CC" }}>
            {display}
          </span>
        </div>

        {error && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#D02E2E", fontSize: 13, fontWeight: 600, marginTop: 11 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 18 }}>
          {keys.map((k, i) => (
            <button key={`${k.label}-${i}`} type="button" className="lockkey" onClick={k.onClick} disabled={k.disabled}>
              {k.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || pin.length === 0}
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
            cursor: busy || pin.length === 0 ? "default" : "pointer",
            opacity: busy || pin.length === 0 ? 0.7 : 1,
            boxShadow: "0 8px 20px rgba(30,158,84,.28)",
          }}
        >
          {busy ? "Verificando…" : "Desbloquear"}
        </button>

        <button
          type="button"
          onClick={() => void signOut()}
          style={{
            width: "100%",
            height: 40,
            marginTop: 10,
            border: 0,
            background: "transparent",
            color: "#556A7C",
            fontWeight: 700,
            fontSize: 13,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

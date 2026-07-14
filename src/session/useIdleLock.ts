import { useEffect, useRef, useState } from "react";

/** Eventos de actividad del usuario que reinician el temporizador de inactividad. */
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;

/** No reiniciar el timer más de una vez cada X ms (evita miles de resets por mousemove). */
const ACTIVITY_THROTTLE_MS = 3_000;

/** Clave de persistencia del flag de bloqueo (sobrevive a un reload de la webview). */
const LOCK_KEY = "kromi.locked";

/**
 * Bloqueo por inactividad. Si `timeoutMin <= 0` nunca bloquea (no arma timers).
 * Mientras `locked` es true la actividad NO reinicia el timer: solo `unlock()` lo hace.
 * El estado de bloqueo se persiste en `localStorage` para que un reload (F5/Ctrl+R)
 * no desbloquee la app mientras la sesión de Supabase sigue activa.
 */
export function useIdleLock(timeoutMin: number): { locked: boolean; unlock: () => void } {
  const [locked, setLocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LOCK_KEY) === "1";
    } catch {
      return false;
    }
  });
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(0);

  useEffect(() => {
    if (!(timeoutMin > 0)) {
      try {
        localStorage.removeItem(LOCK_KEY);
      } catch {
        // entorno sin localStorage: ignorar
      }
      setLocked(false);
      return;
    }

    const timeoutMs = timeoutMin * 60_000;

    function clearTimer() {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function armTimer() {
      clearTimer();
      timerRef.current = setTimeout(() => {
        try {
          localStorage.setItem(LOCK_KEY, "1");
        } catch {
          // entorno sin localStorage: ignorar
        }
        setLocked(true);
      }, timeoutMs);
    }

    function onActivity() {
      if (lockedRef.current) return; // bloqueado: solo unlock() reinicia
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityRef.current = now;
      armTimer();
    }

    armTimer();
    // Capture: el scroll dentro de contenedores internos (p.ej. <main className="overflow-auto">
    // de AppLayout) no burbujea hasta window, así que hay que escucharlo en fase de captura
    // para detectar la actividad desde cualquier contenedor anidado.
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { capture: true, passive: true });

    return () => {
      clearTimer();
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity, true);
    };
  }, [timeoutMin]);

  function unlock() {
    try {
      localStorage.removeItem(LOCK_KEY);
    } catch {
      // entorno sin localStorage: ignorar
    }
    setLocked(false);
    lastActivityRef.current = Date.now();
    if (timeoutMin > 0) {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        try {
          localStorage.setItem(LOCK_KEY, "1");
        } catch {
          // entorno sin localStorage: ignorar
        }
        setLocked(true);
      }, timeoutMin * 60_000);
    }
  }

  return { locked, unlock };
}

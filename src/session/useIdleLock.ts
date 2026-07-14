import { useEffect, useRef, useState } from "react";

/** Eventos de actividad del usuario que reinician el temporizador de inactividad. */
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;

/** No reiniciar el timer más de una vez cada X ms (evita miles de resets por mousemove). */
const ACTIVITY_THROTTLE_MS = 3_000;

/**
 * Bloqueo por inactividad. Si `timeoutMin <= 0` nunca bloquea (no arma timers).
 * Mientras `locked` es true la actividad NO reinicia el timer: solo `unlock()` lo hace.
 * Estado en memoria (no persiste entre recargas).
 */
export function useIdleLock(timeoutMin: number): { locked: boolean; unlock: () => void } {
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(0);

  useEffect(() => {
    if (!(timeoutMin > 0)) {
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
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true });

    return () => {
      clearTimer();
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
    };
  }, [timeoutMin]);

  function unlock() {
    setLocked(false);
    lastActivityRef.current = Date.now();
    if (timeoutMin > 0) {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setLocked(true), timeoutMin * 60_000);
    }
  }

  return { locked, unlock };
}

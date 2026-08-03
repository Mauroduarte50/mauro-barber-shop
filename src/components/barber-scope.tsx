"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface BarberOption {
  id: string;
  name: string;
}

interface ScopeCtx {
  /** "" = my own barber (default for barbero, or admin with <2 active barbers). "all" = combined view. Otherwise a specific barberId. */
  scope: string;
  setScope: (v: string) => void;
  barbers: BarberOption[];
}

const STORAGE_KEY = "admin_barber_scope";

const BarberScopeContext = createContext<ScopeCtx>({ scope: "", setScope: () => {}, barbers: [] });

/**
 * Only ever given a non-empty `barbers` list for an admin with 2+ active
 * barbers (the layout decides that) — with fewer, the selector stays
 * invisible and `scope` stays "", so every page behaves exactly as it did
 * before multi-barber support existed.
 */
export function BarberScopeProvider({ barbers, children }: { barbers: BarberOption[]; children: ReactNode }) {
  const [scope, setScopeState] = useState(() => (barbers.length > 0 ? "all" : ""));

  useEffect(() => {
    if (!barbers.length) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (stored === "all" || barbers.some((b) => b.id === stored))) setScopeState(stored);
  }, [barbers]);

  const setScope = (v: string) => {
    setScopeState(v);
    window.localStorage.setItem(STORAGE_KEY, v);
  };

  return <BarberScopeContext.Provider value={{ scope, setScope, barbers }}>{children}</BarberScopeContext.Provider>;
}

export function useBarberScope() {
  return useContext(BarberScopeContext);
}

export function BarberScopeSelect() {
  const { scope, setScope, barbers } = useBarberScope();
  if (barbers.length < 2) return null;
  return (
    <select className="input max-w-[220px]" value={scope || "all"} onChange={(e) => setScope(e.target.value)}>
      <option value="all">👥 Todos los barberos</option>
      {barbers.map((b) => (
        <option key={b.id} value={b.id}>
          ✂️ {b.name}
        </option>
      ))}
    </select>
  );
}

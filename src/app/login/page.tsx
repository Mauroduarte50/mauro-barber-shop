"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "Error al iniciar sesión.");
        setBusy(false);
        return;
      }
      router.push("/admin");
      router.refresh();
    } catch {
      setError("Error de conexión.");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="card w-full max-w-sm p-8">
        <div className="text-center">
          <p className="text-4xl">✂️</p>
          <h1 className="mt-2 text-2xl font-black uppercase">Panel del barbero</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Inicia sesión para gestionar tus citas</p>
        </div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label">Correo</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@barberia.com" required />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-500">{error}</p>}
          <button className="btn-primary w-full py-3 uppercase tracking-widest" disabled={busy}>
            {busy ? "Ingresando…" : "Entrar"}
          </button>
        </form>
        <Link href="/" className="mt-4 block py-2 text-center text-xs text-stone-400 underline">← Volver al sitio público</Link>
      </div>
    </main>
  );
}

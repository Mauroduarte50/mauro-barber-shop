"use client";

import { useEffect, useState } from "react";
import { getIncomeData, recordPayment } from "@/lib/actions";
import { PAYMENT_METHODS } from "@/db/schema";
import { money } from "@/lib/utils";
import { useBarberScope } from "@/components/barber-scope";

interface PaymentRow {
  id: string; amount: number; method: string; status: string; createdAt: string;
  code: string; clientName: string; serviceName: string; startTime: string; barberName?: string;
}
interface UnpaidRow {
  id: string; code: string; clientName: string; serviceName: string; price: number; startTime: string; paymentMethod: string | null; barberName?: string;
}

const METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  nequi: "Nequi",
  daviplata: "Daviplata",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

export default function AdminIncome() {
  const { scope } = useBarberScope();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [unpaid, setUnpaid] = useState<UnpaidRow[]>([]);
  const [method, setMethod] = useState("efectivo");

  const load = async () => {
    const data = await getIncomeData(scope || undefined);
    setPayments(data.payments as unknown as PaymentRow[]);
    setUnpaid(data.attendedUnpaid as unknown as UnpaidRow[]);
  };

  useEffect(() => {
    load();
  }, [scope]);

  const total = payments.reduce((s, p) => s + p.amount, 0);

  const pay = async (id: string) => {
    await recordPayment(id, method);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase">Ingresos</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Control de pagos por cita atendida</p>
        </div>
        <div className="card flex items-center gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Total registrado</p>
          <p className="text-2xl font-black text-brand-500">{money(total)}</p>
        </div>
      </div>

      {unpaid.length > 0 && (
        <div className="card">
          <h2 className="mb-2 font-black uppercase">⏳ Pendientes de cobro</h2>
          <div className="space-y-2">
            {unpaid.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <div className="min-w-[150px] flex-1">
                  <p className="font-bold">
                    {u.clientName} {u.barberName && scope === "all" && <span className="chip bg-brand-500/15 text-brand-600 dark:text-brand-400">{u.barberName}</span>}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">{u.serviceName} · {u.code}</p>
                </div>
                <p className="font-black">{money(u.price)}</p>
                <select className="input w-36" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                  ))}
                </select>
                <button onClick={() => pay(u.id)} className="btn-primary btn-sm">Registrar pago</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 font-black uppercase">Historial de pagos</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs font-bold uppercase tracking-wider text-stone-400 dark:border-stone-800">
                <th className="pb-2 pr-3">Fecha</th>
                <th className="pb-2 pr-3">Cliente</th>
                <th className="pb-2 pr-3">Servicio</th>
                <th className="pb-2 pr-3">Método</th>
                <th className="pb-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-stone-100 dark:border-stone-800">
                  <td className="py-2 pr-3 whitespace-nowrap">{new Date(p.createdAt).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                  <td className="py-2 pr-3 font-semibold">
                    {p.clientName} {p.barberName && scope === "all" && <span className="chip bg-brand-500/15 text-brand-600 dark:text-brand-400">{p.barberName}</span>}
                  </td>
                  <td className="py-2 pr-3">{p.serviceName} <span className="text-xs text-stone-400">{p.code}</span></td>
                  <td className="py-2 pr-3 capitalize">{METHOD_LABELS[p.method] ?? p.method}</td>
                  <td className="py-2 text-right font-black">{money(p.amount)}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-stone-400">Sin pagos registrados todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

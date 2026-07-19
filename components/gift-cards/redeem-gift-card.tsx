"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";

export function RedeemGiftCard({ embedded = false }: { embedded?: boolean }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ amountUsd: number; quotaUsd: number } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/gift-cards/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || "核销失败"); return; }
      setResult({ amountUsd: data.amountUsd, quotaUsd: data.quotaUsd });
      setCode("");
      toast(`已增加额度 $${Number(data.amountUsd).toFixed(2)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${embedded ? "" : "section "}gift-card-redeem grid gap-3`} onSubmit={submit}>
      {!embedded && <h2>核销礼品卡</h2>}
      {!embedded && <p className="dim">输入管理员发放的礼品卡卡号，核销成功后会增加到账户额度。</p>}
      <div className="field"><label>礼品卡卡号</label><input className="mono" value={code} onChange={e => setCode(e.target.value)} placeholder="GC-XXXX-XXXX-XXXX-XXXX" autoFocus /></div>
      <button className="btn primary" disabled={busy}>{busy ? "核销中…" : "核销礼品卡"}</button>
      {result && <div className="gift-card-success mono">已增加 ${result.amountUsd.toFixed(2)}，当前额度 ${result.quotaUsd.toFixed(2)}</div>}
    </form>
  );
}

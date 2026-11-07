import { useEffect, useState } from "react";
import type { CallStatus } from "../../../../shared/contract.ts";
import { useT } from "../../i18n/useT.ts";
import { formatPhone } from "../../lib/phone.ts";

function mmss(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CallHeader({ name, phone, status, connectedAt }: { name: string; phone: string; status: CallStatus; connectedAt?: number }) {
  const { d } = useT();
  const [now, setNow] = useState(() => Date.now());
  const running = status === "connected" || status === "on_hold";

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = connectedAt ? Math.max(0, Math.floor((now - connectedAt) / 1000)) : 0;
  return (
    <div className="sp-callhead" data-status={status}>
      <div className="sp-callhead__who">
        <p className="sp-callhead__name">{name}</p>
        <p className="sp-callhead__phone">{formatPhone(phone)}</p>
      </div>
      <p className="sp-callhead__status" role="status">
        <span className="sp-callhead__dot" aria-hidden="true" />
        <span>{d.call.status[status]}</span>
        {connectedAt ? (
          <time className="sp-callhead__timer" aria-hidden="true">
            {mmss(elapsed)}
          </time>
        ) : null}
      </p>
    </div>
  );
}

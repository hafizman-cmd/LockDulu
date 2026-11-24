"use client";

import { useActionState, useState } from "react";
import { changeShopStatus } from "@/app/admin/dashboard/moderation-actions";
import type { ShopModeration } from "@/lib/admin";
import { Notice, Sheet } from "./common";

const actions = {
  hold: { label: "Hold shop", details: "The storefront will be hidden and new checkouts will stop. Buyers can track existing orders, and the seller can still review receipts and fulfill them." },
  resume: { label: "Resume shop", details: "The shop will be visible to buyers again, and the seller will regain access to their shop tools." },
  delete: { label: "Delete shop", details: "This permanently removes the storefront and disables seller sign-in. Resolve pending receipts, unshipped orders, and open transfer reports before deleting." },
};

export function AdminShopActions({ shopId, shopName, held, unresolvedOrders }: {
  shopId: string; shopName: string; held: boolean; unresolvedOrders: number;
}) {
  const [command, setCommand] = useState<ShopModeration | null>(null);
  return <>
    <div className="admin-shop-actions">
      <button className="button" onClick={() => setCommand(held ? "resume" : "hold")}>
        {held ? "Resume" : "Hold"}
      </button>
      <button className="button reject" disabled={unresolvedOrders > 0} onClick={() => setCommand("delete")}>Delete</button>
    </div>
    {command && <ShopActionDialog shopId={shopId} shopName={shopName} command={command} onClose={() => setCommand(null)} />}
  </>;
}

function ShopActionDialog({ shopId, shopName, command, onClose }: {
  shopId: string; shopName: string; command: ShopModeration; onClose: () => void;
}) {
  const { label, details } = actions[command];
  const [error, submit, pending] = useActionState(async (previousError: string, form: FormData) => {
    const result = await changeShopStatus(previousError, form);
    if (!result) onClose();
    return result;
  }, "");
  return <Sheet title={`${label}?`} onClose={() => { if (!pending) onClose(); }}>
    <form className="stack" action={submit}>
      <p><strong>{shopName}</strong></p>
      <p>{details}</p>
      {error && <Notice>{error}</Notice>}
      <input type="hidden" name="shopId" value={shopId} />
      <input type="hidden" name="command" value={command} />
      <div className="button-row">
        <button type="button" className="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className={`button ${command === "delete" ? "reject" : "primary"}`} disabled={pending}>{pending ? "Saving…" : label}</button>
      </div>
    </form>
  </Sheet>;
}

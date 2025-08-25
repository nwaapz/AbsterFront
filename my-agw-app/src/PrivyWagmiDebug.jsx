// src/PrivyWagmiDebug.js
import React, { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";

export default function PrivyWagmiDebug() {
  const { ready, authenticated, user } = usePrivy();
  const { address: wagmiAddress, status: wagmiStatus, connector } = useAccount();

  const cross = user && user.linkedAccounts
    ? user.linkedAccounts.find(a => a.type === "cross_app")
    : null;
  const embeddedAddress = cross && cross.embeddedWallets ? cross.embeddedWallets[0]?.address : null;

  useEffect(() => {
    console.log("Privy ready:", ready, "authenticated:", authenticated);
    console.log("Privy user:", user);
    console.log("embeddedAddress:", embeddedAddress);
    console.log("Wagmi status:", wagmiStatus, "wagmiAddress:", wagmiAddress, "connector:", connector);
  }, [ready, authenticated, user, embeddedAddress, wagmiStatus, wagmiAddress, connector]);

  return (
    <div style={{ padding: 12, border: "1px dashed #888", marginTop: 12 }}>
      <div><strong>Privy ready:</strong> {String(ready)}</div>
      <div><strong>Privy authenticated:</strong> {String(authenticated)}</div>
      <div><strong>Privy embedded address:</strong> {embeddedAddress || "—"}</div>
      <hr />
      <div><strong>Wagmi status:</strong> {wagmiStatus}</div>
      <div><strong>Wagmi address:</strong> {wagmiAddress || "—"}</div>
      <div><strong>Wagmi connector:</strong> {connector ? connector.name : "—"}</div>
    </div>
  );
}

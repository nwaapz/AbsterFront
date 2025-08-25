// src/WalletSelector.js
import React from "react";
import { useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";

export default function WalletSelector() {
  const { wallets, ready } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();

  if (!ready) return <div>Loading wallets…</div>;
  if (!wallets || wallets.length === 0) return <div>No wallets available</div>;

  return (
    <div style={{ marginTop: 12 }}>
      <strong>Select Privy wallet:</strong>
      <ul>
        {wallets.map((w, i) => (
          <li key={w.address || i} style={{ marginTop: 8 }}>
            <button
              onClick={async () => {
                try {
                  await setActiveWallet(w);
                  console.log("Activated wallet:", w.address);
                } catch (err) {
                  console.error("Error activating wallet:", err);
                }
              }}
            >
              {w.address} {w.label ? `(${w.label})` : ""}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

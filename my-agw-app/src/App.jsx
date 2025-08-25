// src/App.jsx
import React from "react";
import SyncPrivyToWagmi from "./SyncPrivyToWagmi.jsx";
import WalletSelector from "./WalletSelector.jsx";
import PrivyWagmiDebug from "./PrivyWagmiDebug.jsx";
import ForceActivatePrivyWallet from "./ForceActivatePrivyWallet.jsx";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import BalanceAndSend from "./BalanceAndSend.jsx";

export default function App() {
  const { login, link } = useAbstractPrivyLogin();
  const { ready, authenticated, user } = usePrivy();
  const { address, status } = useAccount();

  // unified handler: login or link
  const handleLoginOrLink = async () => {
    if (!ready) {
      alert("Privy not ready yet — wait a moment.");
      return;
    }

    if (authenticated) {
      try {
        await link();
        console.log("Linked AGW to existing Privy account.");
        return;
      } catch (err) {
        console.error("link() failed:", err);
        alert("Link failed: " + (err?.message || err));
        return;
      }
    }

    try {
      await login();
      console.log("login() finished.");
    } catch (err) {
      console.warn("login() error:", err);
      if (err?.message?.includes("already logged in")) {
        try {
          await link();
        } catch (e) {
          console.error("fallback link() failed:", e);
          alert("Auth failure: " + (e?.message || e));
        }
      } else {
        alert("Login error: " + (err?.message || err));
      }
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>Abstract + Privy demo</h1>

      <div style={{ marginBottom: 12 }}>
        <button onClick={handleLoginOrLink}>
          {authenticated ? "Link Abstract Wallet" : "Login with Abstract"}
        </button>
        <button
          onClick={async () => {
            try {
              await link();
            } catch (e) {
              console.error("Manual link() failed:", e);
              alert("Link failed: " + (e?.message || e));
            }
          }}
          style={{ marginLeft: 8 }}
        >
          Link Abstract (manual)
        </button>
      </div>

      <div><strong>Wagmi status:</strong> {status}</div>
      <div><strong>Wagmi address:</strong> {address || "—"}</div>

      {/* Auto-sync */}
      <SyncPrivyToWagmi />
      <ForceActivatePrivyWallet />
      <WalletSelector />
      <PrivyWagmiDebug />

      <div style={{ marginTop: 12 }}>
        <strong>Privy authenticated:</strong> {String(authenticated)}{" "}
        {user?.linkedAccounts ? `(linked: ${user.linkedAccounts.length})` : ""}
      </div>

      {/* ===== Integrate BalanceAndSend component here ===== */}
      <div style={{ marginTop: 24 }}>
        <BalanceAndSend
          defaultTo="0xYourDestinationAddressHere"
          defaultAmount="0.0001"
        />
      </div>
    </div>
  );
}

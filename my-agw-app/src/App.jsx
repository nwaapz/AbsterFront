// src/App.jsx  (rename file to .jsx to avoid esbuild JSX loader issues)
import React from "react";
import SyncPrivyToWagmi from "./SyncPrivyToWagmi.jsx";           // or ./SyncWagmi.jsx if that's your file
import WalletSelector from "./WalletSelector.jsx";
import PrivyWagmiDebug from "./PrivyWagmiDebug.jsx";
import ForceActivatePrivyWallet from "./ForceActivatePrivyWallet.jsx";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";

export default function App() {
  const { login, link } = useAbstractPrivyLogin();
  const { ready, authenticated, user } = usePrivy();
  const { address, status } = useAccount();

  // unified handler: if already authenticated -> link(), otherwise login()
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
      // fallback to link() when appropriate
      if (err && err.message && err.message.includes("already logged in")) {
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

      {/* Auto-sync (original helper, keep if you want) */}
      <SyncPrivyToWagmi />

      {/* Force-activate directly from user.linkedAccounts if needed */}
      <ForceActivatePrivyWallet />

      {/* Optional: show selector if user wants to pick a different Privy wallet */}
      <WalletSelector />

      {/* Debug info */}
      <PrivyWagmiDebug />

      {/* helpful trace */}
      <div style={{ marginTop: 12 }}>
        <strong>Privy authenticated:</strong> {String(authenticated)}{" "}
        {user?.linkedAccounts ? `(linked: ${user.linkedAccounts.length})` : ""}
      </div>
    </div>
  );
}

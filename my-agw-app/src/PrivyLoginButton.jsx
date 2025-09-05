// src/PrivyLoginButton.jsx
import React, { useEffect, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";

export default function PrivyLoginButton() {
  const { login, authenticated, user } = usePrivy();
  const [walletConnected, setWalletConnected] = useState(false);

  // Send wallet info to Unity if available
  const sendWalletToUnity = useCallback(() => {
    if (!window.unityInstance) return;

    const addr =
      user?.linkedAccounts?.find(acc => acc.address)?.address || "no";

    try {
      window.unityInstance.SendMessage(
        "JSBridge",
        "OnWalletConnectionStatus",
        addr
      );
    } catch (err) {
      console.warn("Failed to send wallet to Unity:", err);
    }
  }, [user]);

  // Notify Unity when login completes
  useEffect(() => {
    if (authenticated && !walletConnected) {
      setWalletConnected(true);
      sendWalletToUnity();
    }
  }, [authenticated, walletConnected, sendWalletToUnity]);

  // Always show the button if not authenticated
  if (authenticated) return null;

  return (
    <button
      onClick={async () => {
        try {
          await login(); // Trigger Privy wallet popup
        } catch (err) {
          console.error("Privy login failed:", err);
        }
      }}
      style={{
        padding: "12px 24px",
        fontSize: "16px",
        borderRadius: "8px",
        backgroundColor: "#007bff",
        color: "white",
        border: "none",
        cursor: "pointer",
        position: "absolute",
        top: 20,
        right: 20,
        zIndex: 9999, // ensure button is on top of Unity canvas
      }}
    >
      Connect Wallet
    </button>
  );
}

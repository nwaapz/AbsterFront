// src/App.jsx
import React from "react";
import GameEntry from "./GameEntry.jsx";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";

export default function App() {
  const { address, status } = useAccount(); // Wagmi wallet
  const { authenticated } = usePrivy();     // Abstract wallet
  const { login, link } = useAbstractPrivyLogin();

  const handleLoginOrLink = async () => {
    if (!authenticated) {
      try {
        await login();
      } catch (err) {
        console.error("Login failed:", err);
        alert("Login error: " + (err?.message || err));
      }
    } else {
      try {
        await link();
      } catch (err) {
        console.error("Link failed:", err);
        alert("Link error: " + (err?.message || err));
      }
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 400, margin: "0 auto", fontFamily: "sans-serif" }}>
      <h1>Game Portal</h1>

      {/* Player address & connection state */}
      <div style={{ marginBottom: 16 }}>
        <div>
          <strong>Wagmi Wallet Address:</strong> {address || "—"}
        </div>
        <div>
          <strong>Connection Status:</strong> {status || "disconnected"} / {authenticated ? "Abstract linked ✅" : "Not linked ❌"}
        </div>

        {/* Show login/link button only if Abstract wallet not linked */}
        {!authenticated && (
          <button
            onClick={handleLoginOrLink}
            style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, backgroundColor: "#007bff", color: "white", cursor: "pointer" }}
          >
            Login with Abstract
          </button>
        )}
      </div>

      {/* Game Entry Button */}
      <GameEntry />
    </div>
  );
}

import React, { useEffect, useState } from "react";
import GameEntry from "./GameEntry.jsx";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";

export default function App() {
  const { address, status } = useAccount();
  const { authenticated } = usePrivy();
  const { login, link } = useAbstractPrivyLogin();

  const [timeLeft, setTimeLeft] = useState(0); // milliseconds
  const [periodEnd, setPeriodEnd] = useState(null); // timestamp from server

  const handleLoginOrLink = async () => {
    try {
      if (!authenticated) {
        await login();
      } else {
        await link();
      }
    } catch (err) {
      console.error("Auth failed:", err);
      alert("Error: " + (err?.message || err));
    }
  };

  // Fetch initial period end
  const fetchPeriod = async () => {
    try {
      const res = await fetch("https://apster-backend.onrender.com/api/period");
      const data = await res.json();
      setPeriodEnd(data.periodEnd);
    } catch (err) {
      console.error("Failed to fetch period:", err);
    }
  };

  useEffect(() => {
    fetchPeriod();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!periodEnd) return;

    const interval = setInterval(async () => {
      const now = Date.now();
      const left = periodEnd - now;

      if (left <= 0) {
        setTimeLeft(0);

        // Fetch next round periodEnd after 1 second
        setTimeout(fetchPeriod, 1000);
      } else {
        setTimeLeft(left);
      }
    }, 200); // 0.2s interval for smooth countdown

    return () => clearInterval(interval);
  }, [periodEnd]);

  const formatTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return (
    <div style={{ padding: 24, maxWidth: 400, margin: "0 auto", fontFamily: "sans-serif" }}>
      <h1>Game Portal</h1>

      {/* Wallet & Privy Info */}
      <div style={{ marginBottom: 16 }}>
        <div>
          <strong>Wagmi Wallet Address:</strong> {address || "—"}
        </div>
        <div>
          <strong>Connection Status:</strong> {status || "disconnected"} /{" "}
          {authenticated ? "Abstract linked ✅" : "Not linked ❌"}
        </div>

        {!authenticated && (
          <button
            onClick={handleLoginOrLink}
            style={{
              marginTop: 8,
              padding: "8px 12px",
              borderRadius: 6,
              backgroundColor: "#007bff",
              color: "white",
              cursor: "pointer",
            }}
          >
            Login with Abstract
          </button>
        )}
      </div>

      {/* Leaderboard Counter */}
      <div style={{ marginBottom: 16 }}>
        <strong>Time left this period:</strong> {formatTime(timeLeft)}
      </div>

      {/* Game Entry */}
      <GameEntry />
    </div>
  );
}

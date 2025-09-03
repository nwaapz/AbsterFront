//BalanceAndSend.jsx .jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useBalance,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { isAddress, parseEther, formatEther } from "viem";
import GameEntry from "./GameEntry";

const ABSTRACT_TESTNET_CHAIN_ID = 11124;
const EXPLORER_BASE = "https://explorer.testnet.abs.xyz";

function explorerTxUrl(hash) {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

/**
 * Watches the connected wallet's native ETH balance on Abstract Testnet
 * and calls onIncrease(deltaWei) whenever the balance increases.
 */
export function DepositWatcher({ address, onIncrease, pollMs = 8000 }) {
  const { data: balData } = useBalance({
    address,
    chainId: ABSTRACT_TESTNET_CHAIN_ID,
    watch: true,
  });

  const prev = useRef(null);

  useEffect(() => {
    if (!balData?.value) return;
    if (prev.current === null) {
      prev.current = balData.value;
      return;
    }
    const cur = balData.value;
    if (cur > prev.current) {
      const delta = cur - prev.current;
      try {
        onIncrease?.(delta);
      } catch (e) {
        console.error("onIncrease callback failed", e);
      }
    }
    prev.current = cur;
  }, [balData?.value, onIncrease]);

  // Optional interval to force a poll tick in case provider doesn't push updates reliably
  useEffect(() => {
    const id = setInterval(() => {}, pollMs);
    return () => clearInterval(id);
  }, [pollMs]);

  return null;
}

/**
 * UI component: shows balance on Abstract Testnet and sends native ETH
 * (default 0.0001) to a destination (e.g., your wager pool address).
 */
export default function BalanceAndSend({ connectionState, defaultTo = "", defaultAmount = "0.0001" }) {
  // Use connection state from props instead of hooks
  const { address, chainId, isConnected } = connectionState;
  
  const { switchChainAsync, isPending: switching } = useSwitchChain();

  const { data: balData, isLoading: balLoading, refetch: refetchBal } = useBalance({
    address,
    chainId: ABSTRACT_TESTNET_CHAIN_ID,
    watch: true,
  });

  const [to, setTo] = useState(defaultTo);
  const [amount, setAmount] = useState(defaultAmount);
  const [error, setError] = useState("");

  const {
    data: txHash,
    isPending: txPending,
    sendTransaction,
    error: txError,
    reset: resetSend,
  } = useSendTransaction();

  const { data: receipt, isLoading: waitingReceipt } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const balanceEth = useMemo(() => (balData?.value ? formatEther(balData.value) : "0"), [balData]);

  const needsSwitch = chainId !== undefined && chainId !== ABSTRACT_TESTNET_CHAIN_ID;

  async function handleSend() {
    setError("");
    if (!isConnected) {
      setError("Wallet not connected. Log in / link and try again.");
      return;
    }

    // Ensure we are on Abstract Testnet
    try {
      if (needsSwitch && switchChainAsync) {
        await switchChainAsync({ chainId: ABSTRACT_TESTNET_CHAIN_ID });
      }
    } catch (e) {
      console.error("Network switch failed", e);
      setError("Failed to switch to Abstract Testnet (11124)." + (e?.message ? ` ${e.message}` : ""));
      return;
    }

    if (!isAddress(to)) {
      setError("Destination address is invalid.");
      return;
    }

    let wei;
    try {
      wei = parseEther(String(amount || "0"));
    } catch (e) {
      setError("Amount is invalid.");
      return;
    }

    try {
      resetSend?.();
      sendTransaction({
        to,
        value: wei,
      });
    } catch (e) {
      console.error("sendTransaction error", e);
      setError(e?.shortMessage || e?.message || String(e));
    }
  }

  return (
    <div style={{ marginTop: 24, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <h2 style={{ marginTop: 0 }}>Abstract Testnet — Balance & Send</h2>

      <div style={{ marginBottom: 8 }}>
        <div><strong>Status:</strong> {isConnected ? "Connected ✅" : "Disconnected ❌"}</div>
        <div><strong>Address:</strong> {address ?? "—"}</div>
        <div>
          <strong>Network:</strong> {chainId ?? "—"} {needsSwitch ? "(switch to 11124)" : ""}
        </div>
        <div>
          <strong>Balance (ETH):</strong> {balLoading ? "Loading…" : balanceEth}
          <button style={{ marginLeft: 8 }} onClick={() => refetchBal?.()}>Refresh</button>
        </div>
      </div>

      <hr style={{ margin: "12px 0" }} />

      <label style={{ display: "block", marginBottom: 6 }}>
        Destination (e.g., Wager Pool address)
        <input
          type="text"
          placeholder="0x..."
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          style={{ width: "100%", padding: 8, marginTop: 4, borderRadius: 8, border: "1px solid #d1d5db" }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 6 }}>
        Amount (ETH)
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: "100%", padding: 8, marginTop: 4, borderRadius: 8, border: "1px solid #d1d5db" }}
        />
      </label>

      {error && (
        <div style={{ color: "#b91c1c", marginTop: 8 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {txError && (
        <div style={{ color: "#b91c1c", marginTop: 8 }}>
          <strong>Tx Error:</strong> {txError.shortMessage || txError.message}
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={txPending || waitingReceipt || switching}
        style={{ marginTop: 8, padding: "10px 14px", borderRadius: 10, border: "none", background: "#111827", color: "white" }}
      >
        {switching ? "Switching…" : txPending ? "Sending…" : "Send"}
      </button>

      {txHash && (
        <div style={{ marginTop: 10 }}>
          <div>
            <strong>Tx Hash:</strong> {txHash}
          </div>
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">View on Abstract Testnet Explorer ↗</a>
        </div>
      )}

      {receipt && (
        <div style={{ marginTop: 8, color: "#065f46" }}>
          ✅ Confirmed in block {receipt.blockNumber?.toString?.()}
        </div>
      )}

      {/* Example: show toasts/logs for deposits */}
      <DepositWatcher
        address={address}
        onIncrease={(delta) => {
          const eth = Number(formatEther(delta));
          console.log(`💧 New deposit detected: +${eth} ETH`);
          // You can replace this with a toast/notification UI
          if (typeof window !== "undefined") {
            try { alert(`Deposit detected: +${eth} ETH`); } catch {}
          }
        }}
      />
    </div>
  );
}
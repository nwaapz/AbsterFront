// src/GameEntry.jsx
import React, { useEffect, useState } from "react";
import {
  useAccount,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useReadContract,
} from "wagmi";
import abi from "./abi/WagerPoolSingleEntry.json";

const CONTRACT_ADDRESS = "0x7b5dD44c75042535B4123052D2cF13206164AB3c";
const ENTRY_FEE_WEI = 100_000_000_000_000n;
const ABSTRACT_TESTNET_CHAIN_ID = 11124;

export default function GameEntry() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();

  const [hasPaid, setHasPaid] = useState(null); // null = loading
  const [optimisticPaid, setOptimisticPaid] = useState(false);

  // 🔹 Read from contract
  const { data: onchainHasPaid, refetch: refetchHasPaid } = useReadContract({
  abi: abi.abi, // <--- use abi.abi instead of full JSON
  address: CONTRACT_ADDRESS,
  functionName: "hasPaid",
  args: address ? [address] : undefined,
  query: { enabled: !!address && chainId === ABSTRACT_TESTNET_CHAIN_ID },
  watch: true,
});


  const { data: txHash, isPending: txPending, sendTransaction, reset: resetSend } = useSendTransaction();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  const ensureChain = async () => {
    if (chainId !== ABSTRACT_TESTNET_CHAIN_ID && switchChainAsync) {
      await switchChainAsync(ABSTRACT_TESTNET_CHAIN_ID);
    }
  };

  const handleJoin = async () => {
    if (!isConnected) return <div>Please connect your wallet.</div>;
    if (!address || hasPaid === null) return <div>Loading player status...</div>;
    if (hasPaid || optimisticPaid) return alert("You have already paid.");

    await ensureChain();

    resetSend?.();
    try {
      // Optimistically mark as paid
      setOptimisticPaid(true);
      await sendTransaction({
        to: CONTRACT_ADDRESS,
        value: ENTRY_FEE_WEI,
      });
    } catch (err) {
      console.error("Deposit failed:", err);
      setOptimisticPaid(false);
      alert("Deposit failed: " + (err?.message || err));
    }
  };

  // 🔹 Update hasPaid from contract
  useEffect(() => {
    console.log("DEBUG: onchainHasPaid =", onchainHasPaid);
    if (onchainHasPaid !== undefined) {
      setHasPaid(onchainHasPaid);
    }
  }, [onchainHasPaid]);

  // 🔹 Refetch after transaction receipt
  useEffect(() => {
    if (receipt) {
      refetchHasPaid?.();
      alert(`Deposit confirmed! 0.0001 ETH paid.`);
    }
  }, [receipt, refetchHasPaid]);

  if (!isConnected) return <div>Please connect your wallet.</div>;

  // Show loader while fetching
  if (hasPaid === null) return <div>Loading player status...</div>;

  const paid = hasPaid || optimisticPaid;

  return (
    <div style={{ marginTop: 20, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <h2>Game Entry</h2>

      <div style={{ marginBottom: 12 }}>
        <div><strong>Your address:</strong> {address}</div>
        {chainId !== ABSTRACT_TESTNET_CHAIN_ID && (
          <div style={{ color: "orange" }}>
            Switch to Abstract Testnet (11124)
          </div>
        )}
      </div>

      {paid ? (
        <button style={{ padding: "8px 12px", borderRadius: 8 }}>
          Play Game ✅
        </button>
      ) : (
        <button
          onClick={handleJoin}
          disabled={txPending || switching}
          style={{ padding: "8px 12px", borderRadius: 8 }}
        >
          {switching ? "Switching…" : txPending ? "Processing…" : `Join Game (0.0001 ETH)`}
        </button>
      )}

      {txHash && (
        <div style={{ marginTop: 10 }}>
          <div><strong>Tx Hash:</strong> {txHash}</div>
          <a
            href={`https://explorer.testnet.abs.xyz/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View on Abstract Testnet Explorer ↗
          </a>
        </div>
      )}
    </div>
  );
}

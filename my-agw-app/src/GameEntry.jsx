import React, { useEffect, useState } from "react";
import {
  useAccount,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useReadContract,
} from "wagmi";
import { parseEther } from "viem";
import toast from "react-hot-toast";

import contractJson from "./abi/WagerPoolSingleEntry.json";
const abi = contractJson.abi;

const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS || "0x7b5dD44c75042535B4123052D2cF13206164AB3c";
const ENTRY_FEE = parseEther("0.0001");
const ABSTRACT_TESTNET_CHAIN_ID = 11124;

export default function GameEntry() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [hasPaid, setHasPaid] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const isCorrectChain = chainId === ABSTRACT_TESTNET_CHAIN_ID;

  // Read hasPaid from contract
  const { data: onchainHasPaid, refetch: refetchHasPaid } = useReadContract({
    abi,
    address: CONTRACT_ADDRESS,
    functionName: "hasPaid",
    args: [address],
    query: { enabled: !!address && isCorrectChain, retry: 3 },
    onError(err) {
      console.error("Contract read failed:", err);
      toast.error(err.message);
    },
  });

  // Read pool balance
  const { data: poolDeposit, refetch: refetchPoolDeposit } = useReadContract({
    abi,
    address: CONTRACT_ADDRESS,
    functionName: "poolBalance",
    query: { enabled: !!address && isCorrectChain, retry: 3 },
    onError(err) {
      console.error("Failed to read pool balance:", err);
      toast.error(err.message);
    },
  });

  // Transaction hooks
  const { data: txHash, sendTransaction, reset: resetSend } = useSendTransaction();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  // Update hasPaid state when contract changes
  useEffect(() => {
    if (onchainHasPaid !== undefined) {
      setHasPaid(onchainHasPaid);
      if (onchainHasPaid) setIsProcessing(false);
    }
  }, [onchainHasPaid]);

  // Watch for confirmed transaction to start processing
  useEffect(() => {
    if (receipt) {
      setIsProcessing(true); // enter Processing stage
      refetchHasPaid();
      refetchPoolDeposit();

      const interval = setInterval(async () => {
        try {
          const paid = await refetchHasPaid();
          if (paid?.data) {
            setHasPaid(true);
            setIsProcessing(false);
            clearInterval(interval);
          }
        } catch (err) {
          console.error("Error checking hasPaid:", err);
        }
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [receipt, refetchHasPaid, refetchPoolDeposit]);

  // Refresh pool 5 seconds after round ends
  useEffect(() => {
    const handleRoundEnd = () => {
      setTimeout(async () => {
        const newPool = await refetchPoolDeposit();
        console.log("Pool updated:", newPool?.data);
      }, 5000);
    };

    window.addEventListener("roundEnded", handleRoundEnd);
    return () => window.removeEventListener("roundEnded", handleRoundEnd);
  }, [refetchPoolDeposit]);

  // Ensure wallet and chain
  const ensureChain = async () => {
    if (!isConnected) {
      toast.error("Connect wallet");
      return false;
    }
    if (!isCorrectChain) {
      try {
        await switchChainAsync({ chainId: ABSTRACT_TESTNET_CHAIN_ID });
        return true;
      } catch (err) {
        toast.error("Switch chain failed: " + err.message);
        return false;
      }
    }
    return true;
  };

  // Handle Join button
  const handleJoin = async () => {
    if (!address) return toast.error("Connect wallet");
    if (hasPaid) return toast.error("Already paid");

    const ok = await ensureChain();
    if (!ok) return;

    resetSend();

    try {
      // Keep button as Join Game until payment confirmed
      const tx = await sendTransaction({ to: CONTRACT_ADDRESS, value: ENTRY_FEE });
      console.log("Transaction sent:", tx);
      toast.success("Transaction sent! Awaiting confirmation...");
    } catch (err) {
      console.error("Payment failed or cancelled:", err);
      toast.error("Payment cancelled or failed");
      // button remains Join Game
    }
  };

  const buttonLabel = hasPaid
    ? "Play Game ✅"
    : isProcessing
    ? "Processing Transaction..."
    : "Join Game (0.0001 ETH)";

  const buttonDisabled = hasPaid || isProcessing || switching;

  // UI
  if (!isConnected)
    return (
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h2>Game Entry</h2>
        <div>Please connect your wallet.</div>
      </div>
    );

  if (!isCorrectChain)
    return (
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h2>Game Entry</h2>
        <div style={{ color: "orange" }}>
          Please switch to Abstract Testnet (Chain ID: {ABSTRACT_TESTNET_CHAIN_ID})
        </div>
        <button
          onClick={ensureChain}
          disabled={switching}
          style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8 }}
        >
          {switching ? "Switching..." : "Switch Network"}
        </button>
      </div>
    );

  return (
    <div style={{ marginTop: 20, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <h2>Game Entry</h2>
      <div style={{ marginBottom: 12 }}>
        <div>
          <strong>Your address:</strong> {address}
        </div>
        <div>
          <strong>Current Pool Balance:</strong>{" "}
          {poolDeposit !== undefined ? `${Number(poolDeposit) / 1e18} ETH` : "Loading..."}
        </div>
      </div>

      <button
        onClick={handleJoin}
        disabled={buttonDisabled}
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          backgroundColor: hasPaid ? "#4CAF50" : "#007bff",
          color: "white",
          cursor: buttonDisabled ? "not-allowed" : "pointer",
        }}
      >
        {buttonLabel}
      </button>

      {txHash && (
        <div style={{ marginTop: 10 }}>
          <div>
            <strong>Transaction Hash:</strong> {txHash}
          </div>
          <a
            href={`https://explorer.testnet.abs.xyz/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#007bff" }}
          >
            View on Explorer ↗
          </a>
        </div>
      )}
    </div>
  );
}

// GameEntry.jsx
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
import { usePrivy } from "@privy-io/react-auth";
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
  const [score, setScore] = useState(0);

  const { authenticated, user } = usePrivy();

  const isCorrectChain = chainId === ABSTRACT_TESTNET_CHAIN_ID;

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

  const { data: txHash, sendTransaction, reset: resetSend } = useSendTransaction();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (onchainHasPaid !== undefined) {
      setHasPaid(onchainHasPaid);
      if (onchainHasPaid) setIsProcessing(false);
    }
  }, [onchainHasPaid]);

  useEffect(() => {
    if (receipt) {
      setIsProcessing(true);
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

  const handleJoin = async () => {
    if (!address) return toast.error("Connect wallet");
    if (hasPaid) return toast.error("Already paid");

    const ok = await ensureChain();
    if (!ok) return;

    resetSend();

    try {
      const tx = await sendTransaction({ to: CONTRACT_ADDRESS, value: ENTRY_FEE });
      console.log("Transaction sent:", tx);
      toast.success("Transaction sent! Awaiting confirmation...");
    } catch (err) {
      console.error("Payment failed or cancelled:", err);
      toast.error("Payment cancelled or failed");
    }
  };


  const getEmail = () => {
  if (!authenticated || !user) return null;
  // Try linkedAccounts first
  const account = user.linkedAccounts?.find(acc => acc.email);
  return account?.email || null;
};
  // Submit score to backend
const submitScore = async () => {
  if (!address) return toast.error("Connect wallet");
  console.log(getEmail());
  console.log("Privy authenticated:", authenticated);
  console.log("Privy user object:", user);

  const emailToSend = authenticated && user?.email ? user.email : null;

  try {
    const response = await fetch(
      "https://apster-backend.onrender.com/api/submit-score",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: address,
          email: getEmail(), // may return null if no email linked
          score,
        }),
      }
    );

    const data = await response.json();
    console.log("Submit response:", data);

    if (data.ok) toast.success(`Score submitted: ${score}`);
    else toast.error("Failed to submit score");
  } catch (err) {
    console.error("Submit error:", err);
    toast.error("Error submitting score");
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

      <div style={{ marginTop: 16 }}>
        <input
          type="number"
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          placeholder="Enter your score"
          style={{ marginRight: 8, padding: 4, width: 100 }}
        />
        <button
          onClick={submitScore}
          style={{ padding: "6px 12px", borderRadius: 6, cursor: "pointer" }}
        >
          Submit Score
        </button>
      </div>

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

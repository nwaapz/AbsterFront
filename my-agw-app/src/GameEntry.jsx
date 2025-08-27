import React, { useEffect } from "react";
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

// Fallback contract address if environment variable is not set
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "0x7b5dD44c75042535B4123052D2cF13206164AB3c";
const ENTRY_FEE = parseEther("0.0001"); // 0.0001 ETH
const ABSTRACT_TESTNET_CHAIN_ID = 11124;

export default function GameEntry() {
  // Debug environment variable
  console.log("VITE_CONTRACT_ADDRESS:", import.meta.env.VITE_CONTRACT_ADDRESS);

  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [hasPaid, setHasPaid] = React.useState(null); // null = loading

  const isCorrectChain = chainId === ABSTRACT_TESTNET_CHAIN_ID;

  // Debugging info
  useEffect(() => {
    console.log("Wallet connected:", isConnected);
    console.log("Wallet address:", address);
    console.log("Wallet chainId:", chainId, "isCorrectChain:", isCorrectChain);
    console.log("Using contract address:", CONTRACT_ADDRESS);
  }, [isConnected, address, chainId]);

  // Read from contract
  const { data: onchainHasPaid, refetch: refetchHasPaid, isError, error } = useReadContract({
    abi,
    address: CONTRACT_ADDRESS,
    functionName: "hasPaid",
    args: [address],
    query: {
      enabled: !!address && isCorrectChain,
      retry: 3,
    },
    onError(err) {
      console.error("Contract read failed:", err);
      toast.error("Failed to read player status: " + err.message);
    },
  });

  const { data: txHash, isPending: txPending, sendTransaction, reset: resetSend } = useSendTransaction();
  const { data: receipt, isError: receiptError } = useWaitForTransactionReceipt({ hash: txHash });

  const ensureChain = async () => {
    if (!isConnected) {
      toast.error("Please connect your wallet.");
      return false;
    }
    if (!isCorrectChain) {
      try {
        await switchChainAsync({ chainId: ABSTRACT_TESTNET_CHAIN_ID });
        console.log("Switched to Abstract Testnet");
        return true;
      } catch (err) {
        console.error("Failed to switch chain:", err);
        toast.error("Failed to switch to Abstract Testnet: " + err.message);
        return false;
      }
    }
    return true;
  };

  const handleJoin = async () => {
    console.log("Attempting to join game...");
    if (!isConnected || !address) {
      toast.error("Please connect your wallet.");
      return;
    }
    if (hasPaid === null) {
      toast.error("Player status still loading...");
      return;
    }
    if (hasPaid) {
      toast.error("You have already paid.");
      return;
    }

    const chainSwitched = await ensureChain();
    if (!chainSwitched) return;

    resetSend();
    try {
      const tx = await sendTransaction({
        to: CONTRACT_ADDRESS,
        value: ENTRY_FEE,
      });
      console.log("Transaction sent:", tx);
      toast.success("Transaction sent! Awaiting confirmation...");
    } catch (err) {
      console.error("Deposit failed:", err);
      toast.error("Deposit failed: " + (err.message || "Unknown error"));
    }
  };

  // Update hasPaid from contract
  useEffect(() => {
    console.log("onchainHasPaid updated:", onchainHasPaid);
    if (onchainHasPaid !== undefined) {
      setHasPaid(onchainHasPaid);
    }
  }, [onchainHasPaid]);

  // Handle transaction receipt
  useEffect(() => {
    if (receipt) {
      console.log("Transaction confirmed:", receipt);
      refetchHasPaid();
      toast.success("Deposit confirmed! 0.0001 ETH paid.");
    } else if (receiptError) {
      console.error("Transaction failed:", receiptError);
      toast.error("Transaction failed. Please try again.");
    }
  }, [receipt, receiptError, refetchHasPaid]);

  if (!isConnected) {
    return (
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h2>Game Entry</h2>
        <div>Please connect your wallet.</div>
      </div>
    );
  }

  if (!isCorrectChain) {
    return (
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h2>Game Entry</h2>
        <div style={{ color: "orange" }}>
          Please switch to Abstract Testnet (Chain ID: {ABSTRACT_TESTNET_CHAIN_ID})
        </div>
        <button
          onClick={ensureChain}
          disabled={switching}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            backgroundColor: "#007bff",
            color: "white",
            cursor: switching ? "not-allowed" : "pointer",
            marginTop: 10,
          }}
        >
          {switching ? "Switching..." : "Switch Network"}
        </button>
      </div>
    );
  }

  if (hasPaid === null) {
    return (
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <h2>Game Entry</h2>
        <div>Loading player status... <span role="img" aria-label="spinner">⏳</span></div>
        {isError && <div style={{ color: "red" }}>Error reading contract: {error?.message}</div>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 20, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <h2>Game Entry</h2>
      <div style={{ marginBottom: 12 }}>
        <div><strong>Your address:</strong> {address}</div>
      </div>

      <button
        onClick={handleJoin}
        disabled={txPending || switching || hasPaid}
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          backgroundColor: hasPaid ? "#4CAF50" : "#007bff",
          color: "white",
          cursor: hasPaid || txPending || switching ? "not-allowed" : "pointer",
        }}
      >
        {switching
          ? "Switching Network..."
          : txPending
          ? "Processing Transaction..."
          : hasPaid
          ? "Play Game ✅"
          : "Join Game (0.0001 ETH)"}
      </button>

      {txHash && (
        <div style={{ marginTop: 10 }}>
          <div><strong>Transaction Hash:</strong> {txHash}</div>
          <a
            href={`https://explorer.testnet.abs.xyz/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#007bff" }}
          >
            View on Abstract Testnet Explorer ↗
          </a>
        </div>
      )}
    </div>
  );
}

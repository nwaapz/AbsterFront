// App.jsx
import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  useAccount,
  useReadContract,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";
import GameEntry from "./GameEntry";
import BalanceAndSend from "./BalanceAndSend";
import contractJson from "./abi/WagerPoolSingleEntry.json";
import { Toaster } from "react-hot-toast";
import { parseEther } from "viem";

const abi = contractJson.abi;
const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS ||
  "0x7b5dD44c75042535B4123052D2cF13206164AB3c";
const ABSTRACT_TESTNET_CHAIN_ID = 11124;
const ENTRY_FEE = parseEther("0.0001");

export default function App() {
  const { address, status, isConnected, chainId } = useAccount();
  const { authenticated, user } = usePrivy();
  const { login, link } = useAbstractPrivyLogin();
  const [unityLoaded, setUnityLoaded] = useState(false);
  const unityRef = useRef(null);
  const inProgressRef = useRef(false);

  const connectionState = { address, status, isConnected, chainId, authenticated, user };

  const { switchChainAsync } = useSwitchChain();
  const { data: txHash, sendTransaction, reset: resetSend } = useSendTransaction();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  const isCorrectChain = chainId === ABSTRACT_TESTNET_CHAIN_ID;
  const { data: hasPaid, refetch: refetchHasPaid } = useReadContract({
    abi,
    address: CONTRACT_ADDRESS,
    functionName: "hasPaid",
    args: [address],
    query: { enabled: !!address && isCorrectChain, retry: 3 },
  });

  const API_BASE = import.meta.env?.VITE_API_BASE || "https://apster-backend.onrender.com";

  // -----------------------------
  // Unity messaging helpers
  // -----------------------------
  const sendToUnity = useCallback((method, data) => {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    if (window.unityInstance?.SendMessage) {
      window.unityInstance.SendMessage("JSBridge", method, payload);
    }
  }, []);

  const sendUnityEvent = useCallback(
    (method, payload = "") => {
      if (!unityLoaded) return;
      sendToUnity(method, payload);
    },
    [unityLoaded, sendToUnity]
  );

  // -----------------------------
  // Period fetch
  // -----------------------------
  const fetchPeriod = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/api/period`);
      if (!res.ok) return;
      const data = await res.json();
      sendUnityEvent("OnPeriodUpdate", JSON.stringify(data));
    } catch (err) {
      console.error("Failed to fetch period:", err);
    }
  }, [API_BASE, sendUnityEvent]);

  useEffect(() => {
    fetchPeriod().catch(() => {});
    const POLL_MS = 5000;
    const id = setInterval(() => fetchPeriod().catch(() => {}), POLL_MS);
    return () => clearInterval(id);
  }, [fetchPeriod]);

  // -----------------------------
  // Score submission
  // -----------------------------
  const submitScore = useCallback(
    async (rawData) => {
      const score = parseInt(String(rawData).trim(), 10);
      if (Number.isNaN(score)) {
        sendUnityEvent("OnSubmitScore", JSON.stringify({ ok: false, message: "invalid_score" }));
        return;
      }
      try {
        const res = await fetch(`${API_BASE.replace(/\/$/, "")}/api/submit-score`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: address, email: "", score }),
        });
        const json = await res.json().catch(() => null);
        if (json?.ok) {
          sendUnityEvent("OnSubmitScore", JSON.stringify({ ok: true, message: "score submitted" }));
        } else {
          const reason = json?.error || `http_${res.status}`;
          sendUnityEvent("OnSubmitScore", JSON.stringify({ ok: false, message: `score submit failed: ${reason}` }));
        }
      } catch (err) {
        sendUnityEvent("OnSubmitScore", JSON.stringify({ ok: false, message: String(err) }));
      }
    },
    [address, API_BASE, sendUnityEvent]
  );

  // -----------------------------
  // Ensure correct chain
  // -----------------------------
  const ensureChain = useCallback(async () => {
    if (!isConnected) {
      sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: false, error: "not_connected" }));
      return false;
    }
    if (!isCorrectChain) {
      try {
        await switchChainAsync({ chainId: ABSTRACT_TESTNET_CHAIN_ID });
        return true;
      } catch (err) {
        sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: false, error: "switch_failed", detail: String(err) }));
        return false;
      }
    }
    return true;
  }, [isConnected, isCorrectChain, switchChainAsync, sendUnityEvent]);

  // -----------------------------
  // Unity message handler
  // -----------------------------
  const handleMessageFromUnity = useCallback(
    async (messageType, data) => {
      switch (messageType) {
        case "AddTwelve":
          sendUnityEvent("OnAddTwelveResult", (parseInt(data, 10) + 12).toString());
          break;

        case "RequestAuthState":
          sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
          break;

        case "RequestGameState":
          fetchPeriod().catch(() => {});
          break;

        case "isWalletConnected":
          sendUnityEvent("OnWalletConnectionStatus", isConnected && address ? address : "no");
          break;

        case "CheckPaymentStatus":
          if (!address) return sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: false, address: null, error: "not_connected" }));
          if (!isCorrectChain) return sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: false, address, error: "wrong_chain" }));
          try {
            const result = await refetchHasPaid();
            sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: Boolean(result.data), address }));
          } catch (err) {
            sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: false, address, error: String(err) }));
          }
          break;

        case "SubmitScore":
          if (!isConnected || !address) return sendUnityEvent("OnScore", JSON.stringify({ ok: false, error: "not_connected" }));
          await submitScore(data);
          break;

        case "tryconnect":
          if (inProgressRef.current) break;
          inProgressRef.current = true;
          try {
            if (!authenticated) await login();
            else await link();
            sendUnityEvent("OnWalletConnectionStatus", isConnected && address ? address : "no");
          } catch {
            sendUnityEvent("OnWalletConnectionStatus", "no");
          } finally {
            inProgressRef.current = false;
          }
          break;

        default:
          console.log("Unknown message from Unity:", messageType);
      }
    },
    [authenticated, address, isConnected, login, link, submitScore, sendUnityEvent, fetchPeriod, isCorrectChain, refetchHasPaid]
  );

  // -----------------------------
  // Unity loader
  // -----------------------------
  useEffect(() => {
    const loaderUrl = "/Build/v1.loader.js";
    const config = {
      dataUrl: "/Build/v1.data.unityweb",
      frameworkUrl: "/Build/v1.framework.js.unityweb",
      codeUrl: "/Build/v1.wasm.unityweb",
      streamingAssetsUrl: "/StreamingAssets",
      companyName: "Company",
      productName: "Product",
      productVersion: "1.0",
    };
    const script = document.createElement("script");
    script.src = loaderUrl;
    script.async = true;
    script.onload = () => {
      window.createUnityInstance(document.querySelector("#unity-canvas"), config)
        .then((unityInstance) => {
          window.unityInstance = unityInstance;
          unityRef.current = unityInstance;
          setUnityLoaded(true);
          setTimeout(() => window.pushStateToUnity?.(), 50);
        })
        .catch((e) => console.error("createUnityInstance failed", e));
    };
    script.onerror = (e) => console.error("Failed to load Unity loader script:", e);
    document.body.appendChild(script);

    return () => {
      if (window.unityInstance?.Quit) window.unityInstance.Quit().catch(() => {});
      try { document.body.removeChild(script); } catch {}
      delete window.unityInstance;
    };
  }, []);

  // -----------------------------
  // Unity window helpers (single initialization)
  // -----------------------------
  useEffect(() => {
    if (!window._unityMessageQueue) window._unityMessageQueue = [];
    window.handleMessageFromUnity = (msg, data) => {
      if (!unityLoaded || !window.unityInstance) {
        window._unityMessageQueue.push({ messageType: msg, data });
        return;
      }
      handleMessageFromUnity(msg, data);
    };
    window.sendToUnity = sendToUnity;
    window.pushStateToUnity = () => {
      if (!unityLoaded) return;
      sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
      if (address && chainId === ABSTRACT_TESTNET_CHAIN_ID) {
        sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: Boolean(hasPaid), address }));
      }
      fetchPeriod().catch(() => {});
    };

    return () => {
      delete window.handleMessageFromUnity;
      delete window.sendToUnity;
      delete window.pushStateToUnity;
    };
  }, [handleMessageFromUnity, sendToUnity, sendUnityEvent, unityLoaded, authenticated, address, hasPaid, chainId, fetchPeriod]);

  // Flush queued messages exactly once
  useEffect(() => {
    if (!unityLoaded) return;
    const q = window._unityMessageQueue || [];
    while (q.length) {
      const item = q.shift();
      handleMessageFromUnity(item.messageType, item.data);
    }
  }, [unityLoaded, handleMessageFromUnity]);

  return (
    <div
      id="unity-container"
      style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative", background: "#000" }}
    >
      <canvas id="unity-canvas" style={{ width: "100%", height: "100%" }} />
      <Toaster position="top-right" />

      {!unityLoaded && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#000",
          zIndex: 10,
        }}>
          <img src="/logo.png" alt="Loading..." style={{ width: 200, animation: "pulse 1.5s ease-in-out infinite both" }} />
        </div>
      )}

      {unityLoaded && (
        <>
          <GameEntry connectionState={connectionState} />
          <BalanceAndSend connectionState={connectionState} />
        </>
      )}

      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.9); opacity: 0.7; }
          50% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.9); opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

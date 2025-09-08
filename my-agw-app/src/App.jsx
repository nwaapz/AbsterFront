// App.jsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useAccount, useReadContract } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";
import GameEntry from "./GameEntry";
import BalanceAndSend from "./BalanceAndSend";
import contractJson from "./abi/WagerPoolSingleEntry.json";

const abi = contractJson.abi;
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "0x7b5dD44c75042535B4123052D2cF13206164AB3c";
const ABSTRACT_TESTNET_CHAIN_ID = 11124;

export default function App() {
  const { address, status, isConnected, chainId } = useAccount();
  const { authenticated, user } = usePrivy();
  const { login, link } = useAbstractPrivyLogin();

  const [timeLeft, setTimeLeft] = useState(0);
  const [periodEnd, setPeriodEnd] = useState(null);
  const unityRef = useRef(null);
  const [unityLoaded, setUnityLoaded] = useState(false);

  const connectionState = { address, status, isConnected, chainId, authenticated, user };
  const isCorrectChain = chainId === ABSTRACT_TESTNET_CHAIN_ID;

  // Payment status
  const { data: hasPaid, refetch: refetchHasPaid } = useReadContract({
    abi,
    address: CONTRACT_ADDRESS,
    functionName: "hasPaid",
    args: [address],
    query: { enabled: !!address && isCorrectChain, retry: 3 },
  });

  let inProgress = false;

  // Countdown / Period
  const fetchPeriod = async () => {
    try {
      const res = await fetch("https://apster-backend.onrender.com/api/period");
      const data = await res.json();
      setPeriodEnd(Number(data.periodEnd));
    } catch (err) {
      console.error("Failed to fetch period:", err);
    }
  };

  useEffect(() => fetchPeriod(), []);

  useEffect(() => {
    if (!periodEnd) return;
    const interval = setInterval(() => {
      const left = periodEnd - Date.now();
      if (left <= 0) {
        setTimeLeft(0);
        setTimeout(fetchPeriod, 1000);
      } else {
        setTimeLeft(left);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [periodEnd]);

  // --- Unity communication ---
  const sendToUnity = useCallback((method, data) => {
    try {
      if (window.unityInstance?.SendMessage) {
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        window.unityInstance.SendMessage("JSBridge", method, payload);
      }
    } catch (e) {
      console.error("Error in sendToUnity:", e);
    }
  }, []);

  const sendUnityEvent = useCallback(
    (method, payload = "") => {
      if (!unityLoaded) return;
      sendToUnity(method, payload);
    },
    [unityLoaded, sendToUnity]
  );

  // --- Unified payment handler ---
  const handleJoin = useCallback(async () => {
    if (!address) throw new Error("Wallet not connected");
    if (hasPaid) throw new Error("Already paid");

    // Trigger GameEntry logic
    const GameEntryModule = window.GameEntryModule;
    if (!GameEntryModule?.handleJoin) throw new Error("GameEntryModule not loaded");

    await GameEntryModule.handleJoin(); // uses wagmi sendTransaction internally
  }, [address, hasPaid]);

  // --- Handle messages from Unity ---
  const handleMessageFromUnity = useCallback(
    async (messageType, data) => {
      console.log("Unity -> React:", messageType, data);
      switch (messageType) {
        case "AddTwelve":
          sendUnityEvent("OnAddTwelveResult", (parseInt(data) + 12).toString());
          break;

        case "RequestAuthState":
          sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
          break;

        case "RequestGameState":
          sendUnityEvent("OnTimeLeftChanged", { timeLeft });
          sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
          break;

        case "isWalletConnected":
          sendUnityEvent("OnWalletConnectionStatus", isConnected && address ? address : "no");
          break;

        case "CheckPaymentStatus":
          if (!address) {
            sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: false, address: null, error: "not_connected" }));
            break;
          }
          if (!isCorrectChain) {
            sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: false, address, error: "wrong_chain" }));
            break;
          }
          try {
            const result = await refetchHasPaid();
            sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: Boolean(result.data), address }));
          } catch (err) {
            sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: false, address, error: err.message }));
          }
          break;

        case "TryPayForGame":
          try {
            await handleJoin();
            sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: true, status: "pending", message: "Transaction sent" }));
          } catch (err) {
            sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: false, error: String(err) }));
          }
          break;

        case "tryconnect":
          if (inProgress) break;
          inProgress = true;
          try {
            if (!authenticated) await login();
            else await link();
            sendUnityEvent("OnWalletConnectionStatus", isConnected && address ? address : "no");
          } catch (err) {
            console.error("Privy login failed:", err);
            sendUnityEvent("OnWalletConnectionStatus", "no");
          } finally {
            inProgress = false;
          }
          break;

        default:
          console.log("Unknown Unity message:", messageType);
      }
    },
    [authenticated, address, isConnected, login, link, timeLeft, periodEnd, sendUnityEvent, refetchHasPaid, handleJoin, isCorrectChain]
  );

  // --- Push state to Unity on changes ---
  useEffect(() => {
    if (!unityLoaded) return;
    sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
  }, [authenticated, address, unityLoaded, sendUnityEvent]);

  useEffect(() => {
    if (!unityLoaded) return;
    sendUnityEvent("OnTimeLeftChanged", { timeLeft });
  }, [timeLeft, unityLoaded, sendUnityEvent]);

  useEffect(() => {
    if (!unityLoaded) return;
    sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
  }, [periodEnd, unityLoaded, sendUnityEvent]);

  useEffect(() => {
    if (!unityLoaded) return;
    if (address && isCorrectChain) {
      sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: Boolean(hasPaid), address }));
    }
  }, [hasPaid, address, chainId, unityLoaded, sendUnityEvent, isCorrectChain]);

  // --- Expose functions to Unity ---
  useEffect(() => {
    window.handleMessageFromUnity = (type, data) => handleMessageFromUnity(type, data);
    window.sendToUnity = sendToUnity;
    window.pushStateToUnity = () => {
      sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
      sendUnityEvent("OnTimeLeftChanged", { timeLeft });
      sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
      if (address && isCorrectChain) {
        sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: Boolean(hasPaid), address }));
      }
    };
    return () => {
      delete window.handleMessageFromUnity;
      delete window.sendToUnity;
      delete window.pushStateToUnity;
    };
  }, [handleMessageFromUnity, sendToUnity, sendUnityEvent, authenticated, address, timeLeft, periodEnd, hasPaid, isCorrectChain]);

  // --- Unity loader ---
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
          window.pushStateToUnity?.();
        })
        .catch((e) => console.error("createUnityInstance failed", e));
    };
    script.onerror = (e) => console.error("Failed to load Unity loader script:", e);
    document.body.appendChild(script);
    return () => {
      if (window.unityInstance?.Quit) window.unityInstance.Quit().catch(() => {});
      document.body.removeChild(script);
      delete window.unityInstance;
    };
  }, []);

  return (
    <div id="unity-container" style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative", background: "#000" }}>
      <canvas id="unity-canvas" style={{ width: "100%", height: "100%" }} />

      {!unityLoaded && (
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", backgroundColor: "#000", zIndex: 10 }}>
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

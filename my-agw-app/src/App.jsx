// app.jsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useAccount, useReadContract } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";
import GameEntry from "./GameEntry";
import BalanceAndSend from "./BalanceAndSend";
import PrivyLoginButton from "./PrivyLoginButton";
import contractJson from "./abi/WagerPoolSingleEntry.json";

const abi = contractJson.abi;
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "0x7b5dD44c75042535B4123052D2cF13206164AB3c";
const ABSTRACT_TESTNET_CHAIN_ID = 11124;

// ---- Stable global bridge definitions (must run before Unity loader) ----
if (typeof window.handleMessageFromUnity !== "function") {
  window.handleMessageFromUnity = (messageType, data) => {
    window.dispatchEvent(new CustomEvent("unity-to-react", {
      detail: { messageType: String(messageType), data }
    }));
  };
}

if (typeof window.sendToUnity !== "function") {
  window.sendToUnity = (method, data = "") => {
    try {
      if (!window.unityInstance?.SendMessage) {
        console.warn("Unity instance not ready for message:", method);
        return false;
      }
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      window.unityInstance.SendMessage("JSBridge", method, payload);
      return true;
    } catch (e) {
      console.error("sendToUnity error:", e);
      return false;
    }
  };
}

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
  const { data: hasPaid, refetch: refetchHasPaid } = useReadContract({
    abi,
    address: CONTRACT_ADDRESS,
    functionName: "hasPaid",
    args: [address],
    query: { enabled: !!address && isCorrectChain, retry: 3 },
  });

  let inProgress = false;

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

  const sendUnityEvent = useCallback((method, payload = "") => {
    if (!unityLoaded) return;
    window.sendToUnity(method, payload);
  }, [unityLoaded]);

  // Handle Unity -> React messages
  const handleMessageFromUnity = useCallback(async (messageType, data) => {
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
        if (chainId !== ABSTRACT_TESTNET_CHAIN_ID) {
          sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: false, address, error: "wrong_chain" }));
          break;
        }
        try {
          const result = await refetchHasPaid();
          sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: Boolean(result.data), address }));
        } catch (error) {
          sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: false, address, error: error.message }));
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
          sendUnityEvent("OnWalletConnectionStatus", "no");
        } finally {
          inProgress = false;
        }
        break;

      default:
        console.log("Unknown Unity message:", messageType);
    }
  }, [authenticated, address, isConnected, login, link, timeLeft, periodEnd, chainId, refetchHasPaid, sendUnityEvent]);

  // React listens to Unity messages via global event
  useEffect(() => {
    function onUnityMessage(e) {
      const { messageType, data } = e.detail;
      handleMessageFromUnity(messageType, data);
    }
    window.addEventListener("unity-to-react", onUnityMessage);
    return () => window.removeEventListener("unity-to-react", onUnityMessage);
  }, [handleMessageFromUnity]);

  // Push state to Unity on changes
  useEffect(() => {
    if (!unityLoaded) return;
    sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
    sendUnityEvent("OnTimeLeftChanged", { timeLeft });
    sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
    if (address && chainId === ABSTRACT_TESTNET_CHAIN_ID) {
      sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: Boolean(hasPaid), address }));
    }
  }, [authenticated, address, timeLeft, periodEnd, hasPaid, chainId, unityLoaded, sendUnityEvent]);

  // Load Unity WebGL
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
        .then(unityInstance => {
          window.unityInstance = unityInstance;
          unityRef.current = unityInstance;
          setUnityLoaded(true);
        })
        .catch(e => console.error("createUnityInstance failed", e));
    };
    script.onerror = e => console.error("Failed to load Unity loader script:", e);
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

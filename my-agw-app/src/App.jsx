// App.jsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useAccount, useReadContract, useSendTransaction, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";
import GameEntry from "./GameEntry";
import BalanceAndSend from "./BalanceAndSend";
import PrivyLoginButton from "./PrivyLoginButton";
import contractJson from "./abi/WagerPoolSingleEntry.json";
import { Toaster } from "react-hot-toast";
import { parseEther } from "viem";

const abi = contractJson.abi;
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "0x7b5dD44c75042535B4123052D2cF13206164AB3c";
const ABSTRACT_TESTNET_CHAIN_ID = 11124;
const ENTRY_FEE = parseEther("0.0001");

export default function App() {
  const { address, status, isConnected, chainId } = useAccount();
  const { authenticated, user } = usePrivy();
  const { login, link } = useAbstractPrivyLogin();

  const [timeLeft, setTimeLeft] = useState(0);
  const [periodEnd, setPeriodEnd] = useState(null);
  const unityRef = useRef(null);
  const [unityLoaded, setUnityLoaded] = useState(false);

  // in-progress guard for flows like tryconnect
  const inProgressRef = useRef(false);

  // single source of truth for children
  const connectionState = { address, status, isConnected, chainId, authenticated, user };

  // wagmi hooks for payment flow (same as in GameEntry)
  const { switchChainAsync } = useSwitchChain();
  const { data: txHash, sendTransaction, reset: resetSend } = useSendTransaction();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  // Read contract to check whether address has paid
  const isCorrectChain = chainId === ABSTRACT_TESTNET_CHAIN_ID;
  const { data: hasPaid, refetch: refetchHasPaid } = useReadContract({
    abi,
    address: CONTRACT_ADDRESS,
    functionName: "hasPaid",
    args: [address],
    query: { enabled: !!address && isCorrectChain, retry: 3 },
  });

  // Fetch period from backend
  const fetchPeriod = async () => {
    try {
      const res = await fetch("https://apster-backend.onrender.com/api/period");
      const data = await res.json();
      setPeriodEnd(Number(data.periodEnd));
    } catch (err) {
      console.error("Failed to fetch period:", err);
    }
  };
  useEffect(() => { fetchPeriod(); }, []);

  // countdown timer
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

  // React -> Unity helper
  const sendToUnity = useCallback((method, data) => {
    try {
      if (window.unityInstance?.SendMessage) {
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        window.unityInstance.SendMessage("JSBridge", method, payload);
      } else {
        console.warn("Unity instance not ready for message:", method);
      }
    } catch (e) {
      console.error("Error in sendToUnity:", e);
    }
  }, []);

  const sendUnityEvent = useCallback((method, payload = "") => {
    if (!unityLoaded) return;
    try { sendToUnity(method, payload); } catch (e) { console.warn("sendUnityEvent failed", e); }
  }, [unityLoaded, sendToUnity]);

  // Helper to ensure connected & correct chain
  const ensureChain = useCallback(async () => {
    if (!isConnected) {
      sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: false, error: "not_connected" }));
      return false;
    }
    if (chainId !== ABSTRACT_TESTNET_CHAIN_ID) {
      try {
        await switchChainAsync({ chainId: ABSTRACT_TESTNET_CHAIN_ID });
        return true;
      } catch (err) {
        console.error("Switch chain failed:", err);
        sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: false, error: "switch_failed", detail: String(err) }));
        return false;
      }
    }
    return true;
  }, [isConnected, chainId, switchChainAsync, sendUnityEvent]);

  // Handle messages from Unity
  const handleMessageFromUnity = useCallback(async (messageType, data) => {
    console.log("Unity -> React:", messageType, data);

    switch (messageType) {
      case "AddTwelve": {
        const result = parseInt(data) + 12;
        sendUnityEvent("OnAddTwelveResult", result.toString());
        break;
      }

      case "RequestAuthState": {
        sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
        break;
      }

      case "RequestGameState": {
        sendUnityEvent("OnTimeLeftChanged", { timeLeft });
        sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
        break;
      }

      case "isWalletConnected": {
        sendUnityEvent("OnWalletConnectionStatus", isConnected && address ? address : "no");
        break;
      }

      case "CheckPaymentStatus": {
        console.log("Received CheckPaymentStatus from Unity");
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
        } catch (err) {
          console.error("Error checking payment status:", err);
          sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: false, address, error: String(err) }));
        }
        break;
      }

      case "SetNewProfileName": {
        const newName = (data && String(data).trim()) || "";
        if (!newName) {
          sendUnityEvent("OnSetProfileResult", JSON.stringify({ ok: false, error: "empty_name" }));
          break;
        }
        if (!address) {
          sendUnityEvent("OnSetProfileResult", JSON.stringify({ ok: false, error: "wallet_not_connected" }));
          break;
        }
        try {
          const backendUrl = `${import.meta.env.VITE_API_BASE}/api/update-profile`;
          const res = await fetch(backendUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user: address, profile_name: newName }),
          });
          let json;
          try {
            const text = await res.text();
            json = text ? JSON.parse(text) : { ok: false, error: "empty_response" };
          } catch (parseErr) {
            console.error("Failed to parse JSON from update-profile:", parseErr);
            json = { ok: false, error: "invalid_json" };
          }
          if (json.ok) sendUnityEvent("OnSetProfileResult", JSON.stringify({ ok: true, profile: newName }));
          else sendUnityEvent("OnSetProfileResult", JSON.stringify({ ok: false, error: json.error || "unknown_error" }));
        } catch (err) {
          console.error("SetNewProfileName failed:", err);
          sendUnityEvent("OnSetProfileResult", JSON.stringify({ ok: false, error: String(err) }));
        }
        break;
      }

      case "tryconnect": {
        if (inProgressRef.current) break;
        inProgressRef.current = true;
        try {
          if (!authenticated) {
            await login();
          } else {
            await link();
          }
          sendUnityEvent("OnWalletConnectionStatus", isConnected && address ? address : "no");
        } catch (err) {
          console.error("Privy login/link failed:", err);
          sendUnityEvent("OnWalletConnectionStatus", "no");
        } finally {
          inProgressRef.current = false;
        }
        break;
      }

      case "RequestProfile": {
        const addrToCheck = (isConnected && address) ? String(address).trim().toLowerCase() : "";
        if (!addrToCheck) {
          sendUnityEvent("OnProfileResult", JSON.stringify({ ok: false, address: "", profile: null, error: "not_connected" }));
          break;
        }
        try {
          const API_BASE = (import.meta.env?.VITE_API_BASE) || "https://apster-backend.onrender.com";
          const backendUrl = `${API_BASE.replace(/\/$/, "")}/api/profile/${encodeURIComponent(addrToCheck)}`;
          const res = await fetch(backendUrl, { method: "GET", credentials: "omit" });
          if (res.status === 404) {
            sendUnityEvent("OnProfileResult", JSON.stringify({ ok: true, address: addrToCheck, profile: null, found: false }));
            break;
          }
          if (!res.ok) {
            const txt = await res.text().catch(() => null);
            sendUnityEvent("OnProfileResult", JSON.stringify({ ok: false, address: addrToCheck, profile: null, error: `backend_${res.status}`, body: txt }));
            break;
          }
          const json = await res.json();
          const profileName = json.profile_name ?? json.profile ?? null;
          sendUnityEvent("OnProfileResult", JSON.stringify({ ok: true, address: addrToCheck, profile: profileName, found: Boolean(profileName) }));
        } catch (err) {
          console.error("RequestProfile failed:", err);
          sendUnityEvent("OnProfileResult", JSON.stringify({ ok: false, address: addrToCheck, profile: null, error: String(err) }));
        }
        break;
      }

      case "TryPayForGame": {
        console.log("Unity -> React: TryPayForGame :)");

        try {
          // Ensure wallet + correct chain
          const ok = await ensureChain();
          if (!ok) break;

          // Reset sendTransaction state
          resetSend();

          // Initiate transaction (use wagmi hook)
          try {
            const tx = await sendTransaction({ to: CONTRACT_ADDRESS, value: ENTRY_FEE });
            console.log("Transaction initiated:", tx);

            // Notify unity that tx was initiated (pending)
            // tx may be a hash string or an object depending on connector; include what we have
            sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: true, status: "pending", tx: tx?.hash ?? tx }));
          } catch (err) {
            console.error("Payment failed or cancelled:", err);
            sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: false, error: String(err) }));
            break;
          }

          // Poll refetchHasPaid for on-chain change (waiting for confirmation)
          const maxAttempts = 30;
          const intervalMs = 2000;
          let attempts = 0;
          let confirmed = false;

          while (attempts++ < maxAttempts && !confirmed) {
            try {
              const paid = await refetchHasPaid();
              if (paid?.data) {
                confirmed = true;
                break;
              }
            } catch (pollErr) {
              console.error("Error polling hasPaid:", pollErr);
            }
            // wait
            await new Promise((r) => setTimeout(r, intervalMs));
          }

          if (confirmed) {
            sendUnityEvent("OnPaymentConfirmed", JSON.stringify({ ok: true, message: "Payment confirmed" }));
            sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: true, address }));
          } else {
            sendUnityEvent("OnPaymentConfirmed", JSON.stringify({ ok: false, error: "confirm_timeout" }));
            sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: false, address, error: "confirm_timeout" }));
          }
        } catch (err) {
          console.error("Payment failed:", err);
          sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: false, error: String(err) }));
        }
        break;
      }

      default:
        console.log("Unknown message type from Unity:", messageType);
    }
  }, [
    authenticated,
    address,
    isConnected,
    login,
    link,
    timeLeft,
    periodEnd,
    sendUnityEvent,
    chainId,
    refetchHasPaid,
    ensureChain,
    resetSend,
    sendTransaction,
  ]);

  // Send wallet connection status when connection state changes
  useEffect(() => {
    if (!unityLoaded) return;
    const statusStr = isConnected && address ? address : "no";
    sendUnityEvent("OnWalletConnectionStatus", statusStr);
  }, [isConnected, address, unityLoaded, sendUnityEvent]);

  // Send payment status when it changes
  useEffect(() => {
    if (unityLoaded && address && chainId === ABSTRACT_TESTNET_CHAIN_ID) {
      sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: Boolean(hasPaid), address }));
    }
  }, [hasPaid, address, chainId, unityLoaded, sendUnityEvent]);

  // Expose functions to Unity
  useEffect(() => {
    window.handleMessageFromUnity = (messageType, data) => {
      handleMessageFromUnity(messageType, data);
    };
    window.sendToUnity = sendToUnity;
    window.pushStateToUnity = () => {
      if (!unityLoaded) return;
      sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
      sendUnityEvent("OnTimeLeftChanged", { timeLeft });
      sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });

      if (address && chainId === ABSTRACT_TESTNET_CHAIN_ID) {
        sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: Boolean(hasPaid), address }));
      }
    };

    return () => {
      delete window.handleMessageFromUnity;
      delete window.sendToUnity;
      delete window.pushStateToUnity;
    };
  }, [handleMessageFromUnity, sendToUnity, sendUnityEvent, unityLoaded, authenticated, address, timeLeft, periodEnd, hasPaid, chainId]);

  // Notify Unity on auth/time/period changes
  useEffect(() => { if (unityLoaded) sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null }); }, [authenticated, address, unityLoaded, sendUnityEvent]);
  useEffect(() => { if (unityLoaded) sendUnityEvent("OnTimeLeftChanged", { timeLeft }); }, [timeLeft, unityLoaded, sendUnityEvent]);
  useEffect(() => { if (unityLoaded) sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 }); }, [periodEnd, unityLoaded, sendUnityEvent]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="unity-container" style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative", background: "#000" }}>
      <canvas id="unity-canvas" style={{ width: "100%", height: "100%" }} />

      <Toaster position="top-right" />

      {!unityLoaded && (
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", backgroundColor: "#000", zIndex: 10 }}>
          <img src="/logo.png" alt="Loading..." style={{ width: 200, animation: "pulse 1.5s ease-in-out infinite both" }} />
        </div>
      )}

      {/* optional Privy login button */}
      {/* {!authenticated && <PrivyLoginButton />} */}

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

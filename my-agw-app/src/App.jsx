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
import "./App.css";
import { useBalance } from "wagmi";


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
  const fetchPeriod = useCallback(async () => {
    try {
      const res = await fetch("https://apster-backend.onrender.com/api/period");
      const data = await res.json();
      setPeriodEnd(Number(data.periodEnd));
    } catch (err) {
      console.error("Failed to fetch period:", err);
    }
  }, []);

  useEffect(() => { fetchPeriod(); }, [fetchPeriod]);

 
 


  // ---------- sendToUnity / sendUnityEvent ----------
  const sendToUnity = useCallback((method, data) => {
    try {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      if (window.unityInstance?.SendMessage) {
        window.unityInstance.SendMessage("JSBridge", method, payload);
      } else {
        // fallback attempt if unityInstance exists but SendMessage not found
        if (window.unityInstance && typeof window.unityInstance.SendMessage !== "function") {
          console.warn("unityInstance exists but SendMessage not a function", window.unityInstance);
        } else {
          console.warn("Unity instance not ready for message:", method, payload);
        }
      }
    } catch (e) {
      console.error("Error in sendToUnity:", e);
    }
  }, []);

  const sendUnityEvent = useCallback((method, payload = "") => {
    if (!unityLoaded) {
      // option: queue outgoing messages if needed
      console.warn("sendUnityEvent skipped, unity not loaded:", method, payload);
      return;
    }
    try { sendToUnity(method, payload); } catch (e) { console.warn("sendUnityEvent failed", e); }
  }, [unityLoaded, sendToUnity]);

  // ---------- Helper: ensure correct chain ----------
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

  // ---------- submitScore (safe, logged, validated) ----------
  const submitScore = useCallback(async (rawData) => {
    console.log("submitScore called with:", rawData, "address:", address);
    try {
      const score = Number.parseInt(String(rawData).trim(), 10);
      if (Number.isNaN(score)) {
        console.warn("submitScore: invalid score", rawData);
        sendUnityEvent("OnSubmitScore", JSON.stringify({ ok: false, status: "", message: "invalid_score" }));
        return;
      }

      // Use configured API base if available
      const API_BASE = (import.meta.env?.VITE_API_BASE) || "https://apster-backend.onrender.com";
      const backendUrl = `${API_BASE.replace(/\/$/, "")}/api/submit-score`;

      console.log("submitScore: sending POST to", backendUrl, { user: address, score });

      const response = await fetch(backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: address,
          email: "",
          score,
        }),
      });

      console.log("submitScore: fetch finished status:", response.status);

      let json = null;
      try {
        json = await response.json();
      } catch (parseErr) {
        console.error("submitScore: failed to parse JSON response:", parseErr);
      }
      console.log("submitScore: backend json:", json);

      if (json && json.ok) {
        sendUnityEvent("OnSubmitScore", JSON.stringify({ ok: true, status: "", message: "score submitted", score }));
      } else {
        const reason = (json && json.error) || `http_${response.status}`;
        sendUnityEvent("OnSubmitScore", JSON.stringify({ ok: false, status: "", message: `score submit failed: ${reason}` }));
      }
    } catch (err) {
      console.error("Submit error:", err);
      sendUnityEvent("OnSubmitScore", JSON.stringify({ ok: false, status: "", message: String(err) }));
    }
  }, [address, sendUnityEvent]);

const { data: balanceData } = useBalance({
  address,
  query: {
    enabled: !!address,
    watch: true, // 👈 keeps balance updated automatically
  },
});

  // ---------- Handle messages from Unity ----------
  const handleMessageFromUnity = useCallback(async (messageType, data) => {
    console.log("Unity -> React (handled):", messageType, data);

    switch (messageType) {

      case "RequestBalance": {
      if (!address) {
        sendUnityEvent("OnBalance", JSON.stringify({ ok: false, address: null, error: "not_connected" }));
        break;
      }
      try {
        const result = await refetchBalance();
        const ethValue = result?.data?.formatted || "0";
        sendUnityEvent("OnBalance", JSON.stringify({ ok: true, address, balance: ethValue }));
      } catch (err) {
        console.error("Error fetching balance:", err);
        sendUnityEvent("OnBalance", JSON.stringify({ ok: false, address, error: String(err) }));
      }
      break;
    }



      case "AddTwelve": {
        const result = Number.parseInt(String(data), 10) + 12;
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
          const API_BASE = (import.meta.env?.VITE_API_BASE) || "https://apster-backend.onrender.com";
          const backendUrl = `${API_BASE.replace(/\/$/, "")}/api/update-profile`;
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

      case "SubmitScore": {
        const addrToCheck = (isConnected && address) ? String(address).trim().toLowerCase() : "";
        if (!addrToCheck) {
          sendUnityEvent("OnScore", JSON.stringify({ ok: false, address: "", profile: null, error: "not_connected" }));
          break;
        }
        console.log("handleMessageFromUnity: calling submitScore with", data);
        await submitScore(data);
        break;
      }

      case "RequestLeaderBoard": {
          // allow unauthenticated public requests; include user if connected
          const addrToCheck = (isConnected && address) ? String(address).trim().toLowerCase() : "";
          const API_BASE = (import.meta.env?.VITE_API_BASE) || "https://apster-backend.onrender.com";

          try {
            const params = new URLSearchParams();
            params.set("limit", "10"); // change if you want different default
            if (addrToCheck) params.set("user", addrToCheck);

            const backendUrl = `${API_BASE.replace(/\/$/, "")}/api/leaderboard?${params.toString()}`;
            const res = await fetch(backendUrl, { method: "GET", credentials: "omit" });

            if (!res.ok) {
              console.log("RequestLeaderBoard: non-ok response", res.status);
              const txt = await res.text().catch(()=>null);
              sendUnityEvent("ONLB", JSON.stringify({ ok:false, leaderboard:[], player:null, error:`backend_${res.status}`, body: txt }));
              break;
            }
            console.log("got data for leader board back from db");
            const json = await res.json();
            // forward raw payload to Unity; Unity expects JSON string in ONLB
            sendUnityEvent("ONLB", JSON.stringify(json));
          } catch (err) {
            console.error("RequestLeaderBoard failed:", err);
            sendUnityEvent("ONLB", JSON.stringify({ ok:false, leaderboard:[], player:null, error:String(err) }));
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
            await new Promise((r) => setTimeout(r, intervalMs));
          }

          if (confirmed) {
            sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: true, address }));
          } else {
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
    submitScore
  ]);

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

      if (unityLoaded) {
        sendUnityEvent("OnTimeLeftChanged", JSON.stringify({ timeLeft: left <= 0 ? 0 : left }));
      }
    }, 200);

    return () => clearInterval(interval);
  }, [periodEnd, fetchPeriod, unityLoaded, sendUnityEvent]);

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

  // Expose functions to Unity safely, queue messages that arrive early
  useEffect(() => {
    // create a queue if not already present
    if (!window._unityMessageQueue) window._unityMessageQueue = [];

    window.handleMessageFromUnity = (messageType, data) => {
      try {
        // If unityInstance not ready (or runtime still initializing), queue and return
        if (!window.unityInstance || !unityLoaded) {
          // store minimal info
          window._unityMessageQueue.push({ messageType, data, ts: Date.now() });
          console.warn("Message queued (unity not ready):", messageType, data);
          return;
        }
        // pass to our internal handler
        handleMessageFromUnity(messageType, data);
      } catch (e) {
        console.error("Error in window.handleMessageFromUnity wrapper:", e);
      }
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

  // flush queued Unity messages when unityLoaded becomes true
  useEffect(() => {
    if (!unityLoaded) return;
    const q = window._unityMessageQueue || [];
    if (!q.length) return;
    console.log("Flushing queued Unity messages:", q.length);
    // process queued messages in FIFO order
    (async () => {
      while (window._unityMessageQueue && window._unityMessageQueue.length) {
        const item = window._unityMessageQueue.shift();
        try {
          await handleMessageFromUnity(item.messageType, item.data);
        } catch (e) {
          console.error("Error processing queued Unity message:", e);
        }
      }
    })();
  }, [unityLoaded, handleMessageFromUnity]);

  // Notify Unity on auth/time/period changes
  useEffect(() => { if (unityLoaded) sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null }); }, [authenticated, address, unityLoaded, sendUnityEvent]);
  useEffect(() => { if (unityLoaded) sendUnityEvent("OnTimeLeftChanged", { timeLeft }); }, [timeLeft, unityLoaded, sendUnityEvent]);
  useEffect(() => { if (unityLoaded) sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 }); }, [periodEnd, unityLoaded, sendUnityEvent]);
  //update user balance on change
  useEffect(() => {
    if (balanceData && address) {
      const payload = {
        ok: true,
        address,
        balance: balanceData.formatted,
      };
      console.log("📤 Auto-sending balance to Unity:", payload);
      sendUnityEvent("OnBalance", JSON.stringify(payload));
    }
  }, [balanceData, address]);
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
          // small delay to allow runtime to finish initializing in some edge cases
          setTimeout(() => {
            window.pushStateToUnity?.();
          }, 50);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="unity-container" style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative", background: "#000" }}>
      <canvas id="unity-canvas" style={{ width: "100%", height: "100%" }} />

      <Toaster position="top-right" />

      {!unityLoaded && (
        <div className="loading-overlay">
          <img src="/logo.png" alt="Loading..." />
        </div>
      )}


              {/*
        {unityLoaded && (
          <>
            <GameEntry connectionState={connectionState} />
            <BalanceAndSend connectionState={connectionState} />
          </>
        )}
        */}

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

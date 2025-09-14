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
    } else {
      console.warn("Unity instance not ready for message:", method, payload);
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
  // Period fetch (new version)
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
      try {
        const score = Number.parseInt(String(rawData).trim(), 10);
        if (Number.isNaN(score)) {
          sendUnityEvent("OnSubmitScore", JSON.stringify({ ok: false, status: "", message: "invalid_score" }));
          return;
        }

        const backendUrl = `${API_BASE.replace(/\/$/, "")}/api/submit-score`;
        const response = await fetch(backendUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: address, email: "", score }),
        });

        let json;
        try {
          json = await response.json();
        } catch {
          json = null;
        }

        if (json?.ok) {
          sendUnityEvent("OnSubmitScore", JSON.stringify({ ok: true, status: "", message: "score submitted", score }));
        } else {
          const reason = json?.error || `http_${response.status}`;
          sendUnityEvent(
            "OnSubmitScore",
            JSON.stringify({ ok: false, status: "", message: `score submit failed: ${reason}` })
          );
        }
      } catch (err) {
        sendUnityEvent("OnSubmitScore", JSON.stringify({ ok: false, status: "", message: String(err) }));
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
        console.error("Switch chain failed:", err);
        sendUnityEvent(
          "OnPaymentResult",
          JSON.stringify({ ok: false, error: "switch_failed", detail: String(err) })
        );
        return false;
      }
    }
    return true;
  }, [isConnected, isCorrectChain, switchChainAsync, sendUnityEvent]);

  // -----------------------------
  // Unity message handler (old version)
  // -----------------------------
  const handleMessageFromUnity = useCallback(
    async (messageType, data) => {
      switch (messageType) {
        case "AddTwelve": {
          const result = Number.parseInt(String(data), 10) + 12;
          sendUnityEvent("OnAddTwelveResult", result.toString());
          break;
        }

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
            sendUnityEvent("OnPaymentStatus", JSON.stringify({ paid: false, address, error: String(err) }));
          }
          break;

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
            } catch {
              json = { ok: false, error: "invalid_json" };
            }
            if (json.ok) sendUnityEvent("OnSetProfileResult", JSON.stringify({ ok: true, profile: newName }));
            else sendUnityEvent("OnSetProfileResult", JSON.stringify({ ok: false, error: json.error || "unknown_error" }));
          } catch (err) {
            sendUnityEvent("OnSetProfileResult", JSON.stringify({ ok: false, error: String(err) }));
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
            const backendUrl = `${API_BASE.replace(/\/$/, "")}/api/profile/${encodeURIComponent(addrToCheck)}`;
            const res = await fetch(backendUrl, { method: "GET", credentials: "omit" });
            if (res.status === 404) {
              sendUnityEvent("OnProfileResult", JSON.stringify({ ok: true, address: addrToCheck, profile: null, found: false }));
              break;
            }
            if (!res.ok) {
              const txt = await res.text().catch(() => null);
              sendUnityEvent(
                "OnProfileResult",
                JSON.stringify({ ok: false, address: addrToCheck, profile: null, error: `backend_${res.status}`, body: txt })
              );
              break;
            }
            const json = await res.json();
            const profileName = json.profile_name ?? json.profile ?? null;
            sendUnityEvent(
              "OnProfileResult",
              JSON.stringify({ ok: true, address: addrToCheck, profile: profileName, found: Boolean(profileName) })
            );
          } catch (err) {
            sendUnityEvent(
              "OnProfileResult",
              JSON.stringify({ ok: false, address: addrToCheck, profile: null, error: String(err) })
            );
          }
          break;
        }

        case "RequestLeaderBoard": {
          const addrToCheck = (isConnected && address) ? String(address).trim().toLowerCase() : "";
          try {
            const params = new URLSearchParams();
            params.set("limit", "10");
            if (addrToCheck) params.set("user", addrToCheck);
            const backendUrl = `${API_BASE.replace(/\/$/, "")}/api/leaderboard?${params.toString()}`;
            const res = await fetch(backendUrl, { method: "GET", credentials: "omit" });
            if (!res.ok) {
              const txt = await res.text().catch(() => null);
              sendUnityEvent("ONLB", JSON.stringify({ ok: false, error: `backend_${res.status}`, body: txt }));
              break;
            }
            const json = await res.json();
            sendUnityEvent("ONLB", JSON.stringify({ ok: true, leaderboard: json }));
          } catch (err) {
            sendUnityEvent("ONLB", JSON.stringify({ ok: false, error: String(err) }));
          }
          break;
        }

        case "TryPayForGame": {
          if (!address) {
            sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: false, error: "not_connected" }));
            break;
          }
          if (!isCorrectChain) {
            try {
              await switchChainAsync({ chainId: ABSTRACT_TESTNET_CHAIN_ID });
            } catch (err) {
              sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: false, error: "switch_failed", detail: String(err) }));
              break;
            }
          }
          try {
            const tx = await sendTransaction({ to: CONTRACT_ADDRESS, value: ENTRY_FEE });
            sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: true, txHash: tx?.hash || null }));
          } catch (err) {
            sendUnityEvent("OnPaymentResult", JSON.stringify({ ok: false, error: String(err) }));
          }
          break;
        }

        case "SubmitScore":
          if (!isConnected || !address) {
            sendUnityEvent("OnScore", JSON.stringify({ ok: false, address: "", profile: null, error: "not_connected" }));
            break;
          }
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
          console.log("Unknown message type from Unity:", messageType);
      }
    },
    [
      authenticated,
      address,
      isConnected,
      chainId,
      login,
      link,
      refetchHasPaid,
      submitScore,
      sendUnityEvent,
      fetchPeriod,
      isCorrectChain,
      switchChainAsync,
      sendTransaction,
    ]
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
      try {
        document.body.removeChild(script);
      } catch {}
      delete window.unityInstance;
    };
  }, []);

  // -----------------------------
  // Window helpers
  // -----------------------------
  useEffect(() => {
    if (!window._unityMessageQueue) window._unityMessageQueue = [];
    window.handleMessageFromUnity = (msg, data) => {
      if (!window.unityInstance || !unityLoaded) {
        window._unityMessageQueue.push({ messageType: msg, data, ts: Date.now() });
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
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#000",
            zIndex: 10,
          }}
        >
          <img
            src="/logo.png"
            alt="Loading..."
            style={{ width: 200, animation: "pulse 1.5s ease-in-out infinite both" }}
          />
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

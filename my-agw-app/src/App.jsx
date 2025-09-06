//app.jsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";
import GameEntry from "./GameEntry";
import BalanceAndSend from "./BalanceAndSend";
import PrivyLoginButton from "./PrivyLoginButton";

export default function App() {
  const { address, status, isConnected, chainId } = useAccount();
  const { authenticated, user } = usePrivy();
  const { login, link } = useAbstractPrivyLogin();

  const [timeLeft, setTimeLeft] = useState(0);
  const [periodEnd, setPeriodEnd] = useState(null);
  const unityRef = useRef(null);
  const [unityLoaded, setUnityLoaded] = useState(false);

  // Single source of truth for connection state
  const connectionState = { address, status, isConnected, chainId, authenticated, user };

    let inProgress = false;
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

  useEffect(() => fetchPeriod(), []);

  // Countdown timer
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

  // React -> Unity
  const sendToUnity = useCallback((method, data) => {
    if (window.unityInstance?.SendMessage) {
      window.unityInstance.SendMessage("JSBridge", method, typeof data === "string" ? data : JSON.stringify(data));
    } else {
      console.warn("Unity instance not ready for message:", method);
    }
  }, []);

  const sendUnityEvent = useCallback(
    (method, payload = "") => {
      if (!unityLoaded) return;
      try { 
        sendToUnity(method, payload); 
      } catch (e) { 
        console.warn("sendUnityEvent failed", e); 
      }
    },
    [unityLoaded, sendToUnity]
  );

  // Handle messages from Unity
  const handleMessageFromUnity = useCallback(
    async (messageType, data) => {
      console.log("Unity -> React:", messageType, data);
      switch (messageType) {
        case "AddTwelve":
          const result = parseInt(data) + 12;
          sendUnityEvent("OnAddTwelveResult", result.toString());
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

        case "SetNewProfileName": {
          const newName = (data && String(data).trim()) || "";
          console.log("SetNewProfileName to", newName);

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
              body: JSON.stringify({ user: address, profile_name: newName })
            });

            let json;
            try {
              const text = await res.text();
              json = text ? JSON.parse(text) : { ok: false, error: "empty_response" };
            } catch (parseErr) {
              console.error("Failed to parse JSON from update-profile:", parseErr);
              json = { ok: false, error: "invalid_json" };
            }

            if (json.ok) {
              sendUnityEvent("OnSetProfileResult", JSON.stringify({ ok: true, profile: newName }));
            } else {
              sendUnityEvent("OnSetProfileResult", JSON.stringify({ ok: false, error: json.error || "unknown_error" }));
            }
          } catch (err) {
            console.error("SetNewProfileName failed:", err);
            sendUnityEvent("OnSetProfileResult", JSON.stringify({ ok: false, error: String(err) }));
          }
          break;
        }




     

          case "tryconnect":
            if (inProgress) break;
            inProgress = true;
            try {
              if (!authenticated) {
                await login(); // resolves on success, throws on failure/cancel
              } else {
                await link();  // resolves when wallet is linked to existing Privy session
              }

              // Option A: immediate reaction after login resolves
              // (useful if login() resolves before usePrivy updates)
              sendUnityEvent("OnWalletConnectionStatus", isConnected && address ? address : "yes");

              // Option B: rely on usePrivy() effect — your app already does this:
              // a useEffect watching `authenticated` will run and call sendUnityEvent("OnAuthChanged", ...)

            } catch (err) {
              // login() threw — user cancelled, popup closed, network or provider error, etc.
              console.error("Privy login/link failed:", err);
              sendUnityEvent("OnWalletConnectionStatus", "no");
            } finally {
              inProgress = false;
            }
            break;


         case "RequestProfile": {
            // use currently connected wallet address only
            const addrToCheck = (isConnected && address) ? String(address).trim().toLowerCase() : "";

            if (!addrToCheck) {
              sendUnityEvent("OnProfileResult", JSON.stringify({ ok: false, address: "", profile: null, error: "not_connected" }));
              break;
            }

            try {
              // <-- SIMPLE: use VITE_API_BASE from .env (Vite), fallback to a default host if not set
              const API_BASE = (import.meta.env?.VITE_API_BASE) || "https://apster-backend.onrender.com";
              const backendUrl = `${API_BASE.replace(/\/$/, "")}/api/profile/${encodeURIComponent(addrToCheck)}`;

              const res = await fetch(backendUrl, { method: "GET", credentials: "omit" });

              if (res.status === 404) {
                sendUnityEvent("OnProfileResult", JSON.stringify({ ok: true, address: addrToCheck, profile: null, found: false }));
                break;
              }

              if (!res.ok) {
                const txt = await res.text().catch(()=>null);
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

        default:
          console.log("Unknown message type from Unity:", messageType);
      }
    },
    [authenticated, address, isConnected, login, link, timeLeft, periodEnd, sendUnityEvent]
  );

  // Send wallet connection status when connection state changes
  useEffect(() => {
    if (unityLoaded) {
      const status = isConnected && address ? address : "no";
      sendUnityEvent("OnWalletConnectionStatus", status);
    }
  }, [isConnected, address, unityLoaded, sendUnityEvent]);

  // Expose functions to Unity
  useEffect(() => {
    window.handleMessageFromUnity = handleMessageFromUnity;
    window.sendToUnity = sendToUnity;
    window.pushStateToUnity = () => {
      if (!unityLoaded) return;
      sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
      sendUnityEvent("OnTimeLeftChanged", { timeLeft });
      sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
    };
    return () => {
      delete window.handleMessageFromUnity;
      delete window.sendToUnity;
      delete window.pushStateToUnity;
    };
  }, [handleMessageFromUnity, sendToUnity, sendUnityEvent, unityLoaded, authenticated, address, timeLeft, periodEnd]);

  // Notify Unity on changes
  useEffect(() => { 
    if (unityLoaded) sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null }); 
  }, [authenticated, address, unityLoaded, sendUnityEvent]);
  
  useEffect(() => { 
    if (unityLoaded) sendUnityEvent("OnTimeLeftChanged", { timeLeft }); 
  }, [timeLeft, unityLoaded, sendUnityEvent]);
  
  useEffect(() => { 
    if (unityLoaded) sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 }); 
  }, [periodEnd, unityLoaded, sendUnityEvent]);

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
  }, []);

  return (
    <div id="unity-container" style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative", background: "#000" }}>
      <canvas id="unity-canvas" style={{ width: "100%", height: "100%" }} />

      {!unityLoaded && (
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", backgroundColor: "#000", zIndex: 10 }}>
          <img src="/logo.png" alt="Loading..." style={{ width: 200, animation: "pulse 1.5s ease-in-out infinite both" }} />
        </div>
      )}

      {/* Privy login button */}
      //{!authenticated && <PrivyLoginButton />}

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
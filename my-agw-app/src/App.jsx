import React, { useEffect, useState, useRef, useCallback } from "react";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";
import GameEntry from "./GameEntry";
import BalanceAndSend from "./BalanceAndSend";

export default function App() {
  const { address, status, isConnected, chainId } = useAccount();
  const { authenticated, user } = usePrivy();
  const { login, link } = useAbstractPrivyLogin();

  const [timeLeft, setTimeLeft] = useState(0);
  const [periodEnd, setPeriodEnd] = useState(null);
  const unityRef = useRef(null);
  const [unityLoaded, setUnityLoaded] = useState(false);

  // Single source of truth for connection state
  const connectionState = {
    address,
    status,
    isConnected,
    chainId,
    authenticated,
    user
  };

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

  useEffect(() => {
    fetchPeriod();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!periodEnd) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const left = periodEnd - now;
      if (left <= 0) {
        setTimeLeft(0);
        setTimeout(fetchPeriod, 1000);
      } else {
        setTimeLeft(left);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [periodEnd]);

  // Define sendToUnity function for React-to-Unity communication
  const sendToUnity = useCallback((messageType, data) => {
   // console.log("React -> Unity:", messageType, data);
    if (window.unityInstance && typeof window.unityInstance.SendMessage === 'function') {
      window.unityInstance.SendMessage('JSBridge', messageType, data);
    } else {
      console.warn("Unity instance not ready for message:", messageType);
    }
  }, []);

  // Helper to send events to Unity - only when loaded
  const sendUnityEvent = useCallback((method, payload = "") => {
    if (!unityLoaded)
      {
        console.log("unity not loade");
        return;
      } 
    
    try {
      sendToUnity(method, typeof payload === "string" ? payload : JSON.stringify(payload));
    } catch (e) {
      console.warn("sendUnityEvent failed", e);
    }
  }, [unityLoaded, sendToUnity]);

  // Define the message handler for Unity-to-React communication
  const handleMessageFromUnity = useCallback((messageType, data) => {
    console.log("React received message from Unity:", messageType, data);
    
    // Handle different message types from Unity
    switch(messageType) {
      case "AddTwelve":
        const number = parseInt(data);
        const result = number + 12;
        console.log(`Adding 12 to ${number} = ${result}`);
        
        // Send the result back to Unity
        sendUnityEvent("OnAddTwelveResult", result.toString());
        break;
        
      case "RequestAuthState":
        // Send current auth state to Unity
        sendUnityEvent("OnAuthChanged", { 
          authenticated: Boolean(authenticated), 
          address: address || null 
        });
        break;
        
      case "RequestGameState":
        // Send game state to Unity
        sendUnityEvent("OnTimeLeftChanged", { timeLeft });
        sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
        break;
        
      // Add more cases for other message types as needed
      default:
        console.log("Unknown message type from Unity:", messageType);
    }
  }, [authenticated, address, timeLeft, periodEnd, sendUnityEvent]);

  // Expose functions for Unity to call
  useEffect(() => {
    window.loginWithAbstract = async () => {
      try {
        if (!authenticated) await login();
        else await link();
        sendUnityEvent("OnAuthChanged", {
          authenticated: Boolean(authenticated),
          address: address || null,
          success: true,
        });
      } catch (err) {
        console.error("Auth failed:", err);
        sendUnityEvent("OnAuthChanged", { success: false, error: err?.message || String(err) });
      }
    };

    window.getWalletAddress = () => address || "";
    window.isAuthenticated = () => Boolean(authenticated);
    window.getTimeLeftMs = () => timeLeft;
    window.getPeriodEndMs = () => periodEnd || 0;
    window.fetchPeriodFromReact = () => fetchPeriod();
    window.pushStateToUnity = () => {
      if (!unityLoaded) return;
      console.log("Unity is asking for state");
      sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
      sendUnityEvent("OnTimeLeftChanged", { timeLeft });
      sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
    };
    
    // Define the message handler for Unity
    window.handleMessageFromUnity = handleMessageFromUnity;

    // Expose sendToUnity for other components to use
    window.sendToUnity = sendToUnity;

    return () => {
      delete window.loginWithAbstract;
      delete window.getWalletAddress;
      delete window.isAuthenticated;
      delete window.getTimeLeftMs;
      delete window.getPeriodEndMs;
      delete window.fetchPeriodFromReact;
      delete window.pushStateToUnity;
      delete window.handleMessageFromUnity;
      delete window.sendToUnity;
    };
  }, [authenticated, address, login, link, timeLeft, periodEnd, unityLoaded, handleMessageFromUnity, sendToUnity, sendUnityEvent]);

  // Notify Unity when state changes - only when loaded
  useEffect(() => {
    if (unityLoaded) {
      sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
    }
  }, [authenticated, address, unityLoaded, sendUnityEvent]);
  
  useEffect(() => {
    if (unityLoaded) {
      sendUnityEvent("OnTimeLeftChanged", { timeLeft });
    }
  }, [timeLeft, unityLoaded, sendUnityEvent]);
  
  useEffect(() => {
    if (unityLoaded) {
      sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
    }
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
      try {
        window
          .createUnityInstance(document.querySelector("#unity-canvas"), config, (progress) => {
            // Optional: use progress to show a loading bar
          })
          .then((unityInstance) => {
            window.unityInstance = unityInstance;
            unityRef.current = unityInstance;
            setUnityLoaded(true);
            window.pushStateToUnity?.();
          })
          .catch((e) => console.error("createUnityInstance failed", e));
      } catch (e) {
        console.error("Error while creating unity instance", e);
      }
    };

    script.onerror = (e) => console.error("Failed to load Unity loader script:", e);
    document.body.appendChild(script);

    return () => {
      if (window.unityInstance && typeof window.unityInstance.Quit === "function") {
        window.unityInstance.Quit().catch(() => {});
      }
      document.body.removeChild(script);
      delete window.unityInstance;
    };
  }, []);

  return (
    <div
      id="unity-container"
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        overflow: "hidden",
        position: "relative",
        background: "#000",
      }}
    >
      <canvas id="unity-canvas" style={{ width: "100%", height: "100%" }} />

      {!unityLoaded && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
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
            style={{ 
              width: "200px", 
              animation: "pulse 1.5s ease-in-out infinite both" 
            }}
          />
        </div>
      )}

      {/* Render child components and pass connection state */}
      {unityLoaded && (
        <>
          <GameEntry connectionState={connectionState} />
          <BalanceAndSend connectionState={connectionState} />
        </>
      )}

      <style>{`
        @keyframes pulse {
          0% {
            transform: scale(0.9);
            opacity: 0.7;
          }
          50% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(0.9);
            opacity: 0.7;
          }
        }
      `}</style>
    </div>
  );
}
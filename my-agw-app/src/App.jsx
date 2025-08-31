// App.jsx
import React, { useEffect, useState, useRef } from "react";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";

export default function App() {
  const { address, status } = useAccount();
  const { authenticated } = usePrivy();
  const { login, link } = useAbstractPrivyLogin();

  const [timeLeft, setTimeLeft] = useState(0); // ms
  const [periodEnd, setPeriodEnd] = useState(null); // timestamp ms

  const unityRef = useRef(null);
  const [unityLoaded, setUnityLoaded] = useState(false); // track if Unity is ready

  // --- Fetch period from backend ---
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

  // --- Countdown timer ---
  useEffect(() => {
    if (!periodEnd) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const left = periodEnd - now;
      if (left <= 0) {
        setTimeLeft(0);
        setTimeout(fetchPeriod, 1000); // re-fetch next round
      } else {
        setTimeLeft(left);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [periodEnd]);

  // --- Helper to send events to Unity ---
  const sendUnityEvent = (method, payload = "") => {
    try {
      const go = window.unityGameObjectName || "JSBridge";
      if (window.unityInstance && typeof window.unityInstance.SendMessage === "function") {
        window.unityInstance.SendMessage(
          go,
          method,
          typeof payload === "string" ? payload : JSON.stringify(payload)
        );
      }
    } catch (e) {
      console.warn("sendUnityEvent failed", e);
    }
  };

  // --- Expose functions for Unity to call ---
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
      sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
      sendUnityEvent("OnTimeLeftChanged", { timeLeft });
      sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
    };
    window.sendUnityEvent = sendUnityEvent;

    return () => {
      delete window.loginWithAbstract;
      delete window.getWalletAddress;
      delete window.isAuthenticated;
      delete window.getTimeLeftMs;
      delete window.getPeriodEndMs;
      delete window.fetchPeriodFromReact;
      delete window.pushStateToUnity;
      delete window.sendUnityEvent;
    };
  }, [authenticated, address, login, link, timeLeft, periodEnd]);

  // --- Notify Unity when state changes ---
  useEffect(() => sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null }), [authenticated, address]);
  useEffect(() => sendUnityEvent("OnTimeLeftChanged", { timeLeft }), [timeLeft]);
  useEffect(() => sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 }), [periodEnd]);

  // --- Load Unity WebGL ---
  useEffect(() => {
    const loaderUrl = "/unity/Build/unity.loader.js";

    const config = {
      dataUrl: "/unity/Build/unity.data.unityweb",
      frameworkUrl: "/unity/Build/unity.framework.js.unityweb",
      codeUrl: "/unity/Build/unity.wasm.unityweb",
      streamingAssetsUrl: "/unity/StreamingAssets",
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
            window.pushStateToUnity?.();
            setUnityLoaded(true); // hide logo overlay
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

  // --- Render ---
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
      {/* Unity Canvas */}
      <canvas id="unity-canvas" style={{ width: "100%", height: "100%" }} />

      {/* Overlay Logo */}
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
            style={{ width: "200px", animation: "spin 2s linear infinite" }}
          />
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

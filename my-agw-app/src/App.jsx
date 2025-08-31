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

  // ref for unity instance set when loader finishes
  const unityRef = useRef(null);

  // Fetch initial period from backend
  const fetchPeriod = async () => {
    try {
      const res = await fetch("https://apster-backend.onrender.com/api/period");
      const data = await res.json();
      // ensure periodEnd is timestamp in ms
      setPeriodEnd(Number(data.periodEnd));
    } catch (err) {
      console.error("Failed to fetch period:", err);
    }
  };

  useEffect(() => {
    fetchPeriod();
  }, []);

  // Countdown interval
  useEffect(() => {
    if (!periodEnd) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const left = periodEnd - now;
      if (left <= 0) {
        setTimeLeft(0);
        // re-fetch next round shortly
        setTimeout(fetchPeriod, 1000);
      } else {
        setTimeLeft(left);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [periodEnd]);

  // helper to send events to Unity
  const sendUnityEvent = (method, payload = "") => {
    try {
      // you can set a different GameObject name in window.unityGameObjectName if desired
      const go = window.unityGameObjectName || "JSBridge";
      if (window.unityInstance && typeof window.unityInstance.SendMessage === "function") {
        window.unityInstance.SendMessage(go, method, typeof payload === "string" ? payload : JSON.stringify(payload));
      }
    } catch (e) {
      console.warn("sendUnityEvent failed", e);
    }
  };

  // expose functions on window so Unity can call them
  useEffect(() => {
    // Auth function callable from Unity
    window.loginWithAbstract = async () => {
      try {
        if (!authenticated) {
          await login();
        } else {
          await link();
        }
        // send current auth state after operation (Unity can react)
        sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null, success: true });
      } catch (err) {
        console.error("Auth failed:", err);
        sendUnityEvent("OnAuthChanged", { success: false, error: err?.message || String(err) });
      }
    };

    // simple getters
    window.getWalletAddress = () => address || "";
    window.isAuthenticated = () => Boolean(authenticated);
    window.getTimeLeftMs = () => timeLeft;
    window.getPeriodEndMs = () => periodEnd || 0;

    // allow Unity to request a manual reload of period
    window.fetchPeriodFromReact = () => fetchPeriod();

    // helper Unity can call to request React send latest state immediately
    window.pushStateToUnity = () => {
      sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
      sendUnityEvent("OnTimeLeftChanged", { timeLeft });
      sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
    };

    // make sendUnityEvent available globally if Unity needs it
    window.sendUnityEvent = sendUnityEvent;

    return () => {
      // cleanup
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

  // Notify Unity whenever important state changes
  useEffect(() => {
    sendUnityEvent("OnAuthChanged", { authenticated: Boolean(authenticated), address: address || null });
  }, [authenticated, address]);

  useEffect(() => {
    sendUnityEvent("OnTimeLeftChanged", { timeLeft });
  }, [timeLeft]);

  useEffect(() => {
    sendUnityEvent("OnPeriodEndChanged", { periodEnd: periodEnd || 0 });
  }, [periodEnd]);

  // --- Load Unity WebGL loader and create instance ---
  useEffect(() => {
    // Adjust these paths to where you put your Unity build inside public/
    // This example assumes you copied Unity build into public/unity/Build/
    const loaderUrl = "/unity/Build/webBuild.loader.js";
     // change if your build uses a different name
    const config = {
      dataUrl: "/unity/Build/webBuild.data.br",
      frameworkUrl: "/unity/Build/webBuild.framework.js.br",
      codeUrl: "/unity/Build/webBuild.wasm.br",
      streamingAssetsUrl: "/unity/StreamingAssets",
      companyName: "Company",
      productName: "Product",
      productVersion: "1.0",
    };

    // dynamic script load
    const script = document.createElement("script");
    script.src = loaderUrl;
    script.async = true;
    script.onload = () => {
      try {
        // createUnityInstance is provided by the Unity loader JS file
        // keep a reference to the unityInstance so we can SendMessage later
        window.createUnityInstance(document.querySelector("#unity-canvas"), config, (progress) => {
          // optional: we could send progress to Unity or console
          // sendUnityEvent("OnLoadProgress", { progress });
        }).then((unityInstance) => {
          window.unityInstance = unityInstance;
          unityRef.current = unityInstance;
          // optional: set the global GameObject name Unity should use to receive messages
          // window.unityGameObjectName = "JSBridge";
          // initial push of state
          window.pushStateToUnity?.();
        }).catch((e) => {
          console.error("createUnityInstance failed", e);
        });
      } catch (e) {
        console.error("Error while creating unity instance", e);
      }
    };
    script.onerror = (e) => {
      console.error("Failed to load Unity loader script:", e, "loaderUrl:", loaderUrl);
    };
    document.body.appendChild(script);

    return () => {
      // cleanup script and unity instance on unmount
      if (window.unityInstance && typeof window.unityInstance.Quit === "function") {
        window.unityInstance.Quit().catch(() => {});
      }
      document.body.removeChild(script);
      delete window.unityInstance;
    };
  }, []); // run only once

  // Render only Unity canvas container — no visible React UI
  return (
    <div
      id="unity-container"
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        overflow: "hidden",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "#000",
      }}
    >
      {/* Unity will attach to this canvas via createUnityInstance */}
      <canvas id="unity-canvas" style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

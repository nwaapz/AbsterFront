// src/ForceActivatePrivyWallet.jsx
import React, { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";

export default function ForceActivatePrivyWallet() {
  const { user, ready } = usePrivy();
  const { setActiveWallet } = useSetActiveWallet();

  useEffect(() => {
    if (!ready) return;
    if (!user) return;

    console.log("=== Privy user object ===");
    console.log(user);

    const linked = user.linkedAccounts || [];
    console.log("linkedAccounts:", linked);

    // prefer explicit cross_app (Abstract) if available
    const cross = linked.find((a) => a.type === "cross_app") || linked[0];
    if (!cross) {
      console.log("No linked cross_app account found.");
      return;
    }
    console.log("Selected linked account:", cross);

    const embedded = cross?.embeddedWallets?.[0];
    if (!embedded) {
      console.log("No embedded wallet on selected account:", cross);
      return;
    }
    console.log("Embedded wallet object:", embedded);

    (async () => {
      try {
        await setActiveWallet(embedded);
        console.log("✅ setActiveWallet succeeded with embedded object:", embedded.address);
        return;
      } catch (err) {
        console.warn("Direct setActiveWallet(embedded) failed:", err);
      }

      try {
        // Minimal wrapper exposing common provider getters
        const wrapper = {
          address: embedded.address,
          label: embedded.label,
          getEthereumProvider: async () =>
            (embedded.getEthereumProvider && (await embedded.getEthereumProvider())) ||
            (embedded.getProvider && (await embedded.getProvider())) ||
            null,
          getEthersProvider: async () =>
            (embedded.getEthersProvider && (await embedded.getEthersProvider())) ||
            null,
        };

        await setActiveWallet(wrapper);
        console.log("✅ setActiveWallet succeeded with wrapper:", wrapper.address);
      } catch (err2) {
        console.error("❌ setActiveWallet wrapper also failed:", err2);
      }
    })();
  }, [ready, user, setActiveWallet]);

  return null;
}

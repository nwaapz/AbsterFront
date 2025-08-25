// src/SyncWagmi.js
import React, { useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";

export default function SyncPrivyToWagmi() {
  const { ready: privyReady, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();

  useEffect(() => {
    if (!privyReady) return;
    if (!wallets || wallets.length === 0) return;

    const wallet = wallets[0];

    (async () => {
      try {
        await setActiveWallet(wallet);
        console.log("Privy wallet set as Wagmi active wallet:", wallet.address);
      } catch (err) {
        console.error("Failed to set active wallet for Wagmi:", err);
      }
    })();
  }, [privyReady, wallets, setActiveWallet, authenticated]);

  return null;
}

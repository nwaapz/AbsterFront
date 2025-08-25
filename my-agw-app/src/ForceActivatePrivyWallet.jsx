// src/ForceActivatePrivyWallet.jsx
import React, { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";

export default function ForceActivatePrivyWallet() {
  const { user, ready } = usePrivy();
  const { address, connector, isConnected } = useAccount();

  useEffect(() => {
    if (!ready || !user) return;

    console.log("Privy authenticated user:", user);
    console.log("Wagmi connected:", isConnected, "address:", address, "connector:", connector?.name);

    const linked = user.linkedAccounts || [];
    console.log("Privy linked accounts:", linked);

    // You can use linked accounts for your app logic,
    // e.g., showing wallet addresses, sending info to backend, etc.
  }, [ready, user, isConnected, address, connector]);

  return null; // component renders nothing
}

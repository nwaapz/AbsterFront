// src/App.tsx
import React from "react";
import { useAccount } from "wagmi";
import { parseEther } from "viem";
import { useAbstractPrivyLogin } from "@abstract-foundation/agw-react/privy";
import { useSendTransaction } from "wagmi";

export default function App() {
  const { address, status } = useAccount();
  const { login, link } = useAbstractPrivyLogin();
  const { sendTransaction, isLoading } = useSendTransaction();

  async function handleSign() {
    // if you need direct Privy cross-app signMessage hook you'd import/use it,
    // but Wagmi signer should work after login
    try {
      // placeholder: you can use a wagmi signMessage hook or Privy cross-app sign
      alert("Implement signMessage flow (use useCrossAppAccounts() from @privy-io/react-auth if needed)");
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Abstract + Privy demo</h1>

      <div style={{ marginBottom: 12 }}>
        <button onClick={() => login()}>Login with Abstract</button>
        <button onClick={() => link()} style={{ marginLeft: 8 }}>Link Abstract</button>
      </div>

      <div>
        <strong>Wallet status:</strong> {status}
      </div>
      <div>
        <strong>Address:</strong> {address ?? "—"}
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={handleSign} disabled={!address}>Sign message</button>
        <button
          onClick={() =>
            sendTransaction?.({
              request: {
                to: "0x000000000000000000000000000000000000dead",
                value: parseEther("0.00001"),
              },
            })
          }
          style={{ marginLeft: 8 }}
          disabled={!address || isLoading}
        >
          {isLoading ? "Sending..." : "Send tiny tx"}
        </button>
      </div>
    </div>
  );
}

// src/paymentHandler.js
import { parseEther } from "viem";
import { getWalletClient } from "wagmi/actions";
import contractJson from "./abi/WagerPoolSingleEntry.json";

const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS ||
  "0x7b5dD44c75042535B4123052D2cF13206164AB3c";
const ENTRY_FEE = parseEther("0.0001");
const ABSTRACT_TESTNET_CHAIN_ID = 11124;
const ABI = contractJson.abi;

/**
 * handlePayment
 * @param {object} opts
 *  - address: connected wallet address (string)
 *  - chainId: current chain id (number)
 *  - sendUnityEvent: function(method, payloadString) -> sends a stringified payload back to Unity
 *  - options (optional): { functionName, args, contractAddress, entryFee }
 *
 * Returns: { success: boolean, txHash?: string, error?: string }
 */
export async function handlePayment({
  address,
  chainId,
  sendUnityEvent,
  options = {},
}) {
  const contractAddress = options.contractAddress || CONTRACT_ADDRESS;
  const entryFee = options.entryFee ?? ENTRY_FEE;
  const functionName = options.functionName ?? null; // e.g. "enter" if you have a payable function
  const args = options.args ?? [];

  // Basic checks
  if (!sendUnityEvent || typeof sendUnityEvent !== "function") {
    console.warn("paymentHandler: sendUnityEvent not provided or not a function");
  }

  if (!address) {
    const payload = { success: false, error: "not_connected" };
    sendUnityEvent?.("OnPaymentResult", JSON.stringify(payload));
    return payload;
  }

  if (chainId !== ABSTRACT_TESTNET_CHAIN_ID) {
    const payload = { success: false, error: "wrong_chain" };
    sendUnityEvent?.("OnPaymentResult", JSON.stringify(payload));
    return payload;
  }

  try {
    // getWalletClient returns a WalletClient for the currently connected connector (safe outside React hooks)
    const client = await getWalletClient();
    if (!client) {
      const payload = { success: false, error: "no_wallet_client" };
      sendUnityEvent?.("OnPaymentResult", JSON.stringify(payload));
      return payload;
    }

    // Prefer writeContract if caller provided a functionName and wallet client supports it
    if (functionName && typeof client.writeContract === "function") {
      const tx = await client.writeContract({
        address: contractAddress,
        abi: ABI,
        functionName,
        args,
        value: entryFee,
      });
      const txHash = tx?.hash ?? tx;
      const payload = { success: true, txHash, status: "pending" };
      sendUnityEvent?.("OnPaymentResult", JSON.stringify(payload));
      return payload;
    }

    // Fallback: send a plain transaction (to contract address) with value.
    if (typeof client.sendTransaction === "function") {
      const txResponse = await client.sendTransaction({
        to: contractAddress,
        value: entryFee,
      });
      const txHash = txResponse?.hash ?? txResponse;
      const payload = { success: true, txHash, status: "pending" };
      sendUnityEvent?.("OnPaymentResult", JSON.stringify(payload));
      return payload;
    }

    // If neither method is supported, return error.
    const payload = { success: false, error: "wallet_client_missing_api" };
    sendUnityEvent?.("OnPaymentResult", JSON.stringify(payload));
    return payload;
  } catch (err) {
    console.error("paymentHandler: transaction failed", err);
    const payload = { success: false, error: String(err?.message ?? err) };
    sendUnityEvent?.("OnPaymentResult", JSON.stringify(payload));
    return payload;
  }
}

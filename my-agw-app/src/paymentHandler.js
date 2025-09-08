// paymentHandler.js
import { parseEther } from "viem";
import { getWalletClient } from "wagmi/actions";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "0x7b5dD44c75042535B4123052D2cF13206164AB3c";
const ENTRY_FEE = parseEther("0.0001");
const ABSTRACT_TESTNET_CHAIN_ID = 11124;

export async function handlePayment({ address, chainId, sendUnityEvent, toast }) {
  if (!address) {
    toast.error("Connect wallet");
    sendUnityEvent(
      "OnPaymentResult",
      JSON.stringify({ success: false, error: "not_connected" })
    );
    return;
  }

  if (chainId !== ABSTRACT_TESTNET_CHAIN_ID) {
    toast.error("Wrong network, switch to Abstract Testnet");
    sendUnityEvent(
      "OnPaymentResult",
      JSON.stringify({ success: false, error: "wrong_chain" })
    );
    return;
  }

  try {
    const client = await getWalletClient();
    const tx = await client.sendTransaction({
      to: CONTRACT_ADDRESS,
      value: ENTRY_FEE,
    });

    console.log("Transaction sent:", tx);
    toast.success("Transaction sent! Awaiting confirmation...");

    sendUnityEvent(
      "OnPaymentResult",
      JSON.stringify({ success: true, txHash: tx })
    );
  } catch (err) {
    console.error("Payment failed or cancelled:", err);
    toast.error("Payment cancelled or failed");

    sendUnityEvent(
      "OnPaymentResult",
      JSON.stringify({ success: false, error: err.message })
    );
  }
}

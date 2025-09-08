// Create a new file: usePaymentStatus.js
import { useReadContract } from "wagmi";
import contractJson from "./abi/WagerPoolSingleEntry.json";

const abi = contractJson.abi;
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "0x7b5dD44c75042535B4123052D2cF13206164AB3c";
const ABSTRACT_TESTNET_CHAIN_ID = 11124;

export function usePaymentStatus(address, chainId) {
  const isCorrectChain = chainId === ABSTRACT_TESTNET_CHAIN_ID;
  
  const { data: hasPaid, refetch: refetchHasPaid, isLoading, error } = useReadContract({
    abi,
    address: CONTRACT_ADDRESS,
    functionName: "hasPaid",
    args: [address],
    query: { 
      enabled: !!address && isCorrectChain, 
      retry: 3,
      refetchInterval: 10000 // Refetch every 10 seconds
    },
  });

  return {
    hasPaid: !!hasPaid,
    isLoading,
    error,
    refetchHasPaid
  };
}
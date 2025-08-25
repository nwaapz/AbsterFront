// ./src/Providers.tsx
import { AbstractPrivyProvider } from "@abstract-foundation/agw-react/privy";
import { abstract } from "viem/chains"; // Import your chain here

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AbstractPrivyProvider
      appId="cmeq059tl021wl10b1s3v3v23" 
      chain={abstract} // Required prop added
    >
      {children}
    </AbstractPrivyProvider>
  );
}

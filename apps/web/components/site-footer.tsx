import Link from "next/link";
import { LogoWhite } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteFooter() {
  return (
    <footer className="bg-footer text-white">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 text-center text-sm text-white/80 sm:py-10 lg:text-left">
        <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:gap-8 lg:grid-cols-4 lg:gap-10">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <div className="flex items-center justify-center gap-2 text-white lg:justify-start">
              <LogoWhite size={32} />
              <span className="font-pixel text-xl tracking-wide">explorador</span>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ring-1 ring-white/30">advance</span>
            </div>
            <p className="mx-auto max-w-xs text-xs leading-relaxed lg:mx-0">
              Commission advances for real-estate agents, funded by investors, settled on Stellar.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-base font-bold text-white">Product</h3>
            <ul className="flex flex-col gap-2">
              <li><Link className="transition-colors hover:text-white" href="/agent">For agents</Link></li>
              <li><Link className="transition-colors hover:text-white" href="/invest">For investors</Link></li>
              <li><Link className="transition-colors hover:text-white" href="/registry">Public registry</Link></li>
            </ul>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-base font-bold text-white">Standards</h3>
            <ul className="flex flex-col gap-2 text-white/80">
              <li>SEP-41 · SEP-50 · SEP-56</li>
              <li>Passkey smart accounts</li>
              <li>Groth16 · BN254 · Poseidon</li>
            </ul>
          </div>
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <h3 className="text-base font-bold text-white">explorador</h3>
            <ul className="flex flex-col gap-2">
              <li><a className="transition-colors hover:text-white" href="https://explorador.pt" target="_blank" rel="noopener noreferrer">explorador.pt ↗</a></li>
              <li><a className="transition-colors hover:text-white" href="https://stellar.expert/explorer/testnet" target="_blank" rel="noopener noreferrer">Stellar testnet explorer ↗</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 flex flex-col items-center gap-4 border-t border-white/15 pt-4 text-xs lg:flex-row lg:justify-between">
          <span className="order-3 lg:order-1">© {new Date().getFullYear()} explorador. Testnet demo · not financial advice.</span>
          <span className="order-2 text-white/70">Stellar testnet · Lithic sandbox · No real money</span>
          <ThemeToggle className="order-1 lg:order-3" />
        </div>
      </div>
    </footer>
  );
}

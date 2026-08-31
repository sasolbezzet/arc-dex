import React, { useState } from 'react';
import { ChevronUp, ChevronDown, CheckCircle2, Wallet, Users, Wrench } from 'lucide-react';

export interface OnboardingStepperProps {
  walletReady: boolean;
  walletAddress?: string;
  agentsReady: boolean;
  agentCount: number;
  onCreateWallet: () => void;
  onLoginWallet: () => void;
  onScrollToAgents: () => void;
  busy?: string | null;
}

export const OnboardingStepper: React.FC<OnboardingStepperProps> = ({
  walletReady,
  walletAddress,
  agentsReady,
  agentCount,
  onCreateWallet,
  onLoginWallet,
  onScrollToAgents,
  busy,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const truncateAddress = (addr?: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  if (collapsed) {
    return (
      <div className="p-4 bg-[#0a0a0f]/90 backdrop-blur-xl rounded-xl border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.2)] flex justify-between items-center transition-all duration-300">
        <div className="flex items-center space-x-3">
          <div className="text-cyan-400 font-bold uppercase tracking-wider flex items-center space-x-2 text-sm">
            <span>Agent Onboarding</span>
            {walletReady && agentsReady && <CheckCircle2 className="w-5 h-5 text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.8)]" />}
          </div>
        </div>
        <button
          onClick={() => setCollapsed(false)}
          className="text-gray-400 hover:text-cyan-400 transition-colors p-1"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>
    );
  }

  const activeStep = !walletReady ? 1 : !agentsReady ? 2 : 3;

  return (
    <div className="p-6 bg-[#0a0a0f]/95 backdrop-blur-xl rounded-xl border border-cyan-500/40 shadow-[0_0_30px_rgba(6,182,212,0.15)] transition-all duration-300 relative overflow-hidden font-sans">
      {/* Cyberpunk Grid Background */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSg2LCAxODIsIDIxMiwgMC4wNSkiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-50 pointer-events-none" />
      
      <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-cyan-500/10 blur-[80px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full bg-fuchsia-500/10 blur-[80px] pointer-events-none" />

      <div className="relative flex justify-between items-start mb-8 z-10">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 drop-shadow-[0_0_10px_rgba(6,182,212,0.5)]">
            System Initialization
          </h2>
          <p className="text-sm text-cyan-200/60 mt-1 uppercase tracking-wider font-mono">
            Execute sequence to unleash AI agents
          </p>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-400 hover:text-cyan-400 transition-colors p-2 bg-[#12121a]/80 rounded-lg border border-cyan-500/20 hover:border-cyan-500/50 hover:shadow-[0_0_10px_rgba(6,182,212,0.3)]"
          title="Collapse"
        >
          <ChevronUp className="w-5 h-5" />
        </button>
      </div>

      <div className="relative z-10">
        {/* Connecting glowing line */}
        <div className="absolute top-8 left-[10%] right-[10%] h-0.5 bg-gray-800 z-0 hidden md:block">
          <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-500 via-fuchsia-500 to-indigo-500 shadow-[0_0_10px_rgba(6,182,212,0.8)] transition-all duration-700"
               style={{ width: walletReady ? (agentsReady ? '100%' : '50%') : '0%' }} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Step 1: Wallet */}
          <div className={`relative flex flex-col p-5 rounded-xl border bg-[#0d0d14] backdrop-blur-md transition-all duration-500 overflow-hidden group
            ${walletReady ? 'border-[#00ff9d]/40 shadow-[0_0_15px_rgba(0,255,157,0.1)]' : activeStep === 1 ? 'border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.2)]' : 'border-gray-800'}`}>
            
            {activeStep === 1 && (
              <div className="absolute inset-0 bg-cyan-400/5 animate-pulse pointer-events-none" />
            )}

            <div className="flex items-center space-x-3 mb-4 z-10">
              <div className={`p-2 rounded-lg border transition-colors ${walletReady ? 'bg-[#00ff9d]/10 border-[#00ff9d]/30 text-[#00ff9d]' : activeStep === 1 ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                <Wallet className="w-6 h-6" />
              </div>
              <h3 className={`text-sm font-bold uppercase tracking-wider flex-1 ${walletReady ? 'text-[#00ff9d]' : activeStep === 1 ? 'text-cyan-400' : 'text-gray-400'}`}>
                MSCA Smart Account Wallet
              </h3>
              {walletReady && <CheckCircle2 className="w-6 h-6 text-[#00ff9d] drop-shadow-[0_0_8px_rgba(0,255,157,0.8)]" />}
            </div>
            
            <div className="flex-1 z-10">
              {walletReady ? (
                <div className="flex flex-col space-y-2">
                  <span className="text-[10px] text-[#00ff9d] font-bold uppercase tracking-widest">Status: Connected</span>
                  <span className="text-xs text-cyan-100 font-mono bg-[#050508] border border-[#00ff9d]/20 p-2 rounded-md break-all">
                    {truncateAddress(walletAddress)}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-4 uppercase tracking-wide leading-relaxed">Establish base layer Multi-Signature Contract Account.</p>
              )}
            </div>

            {!walletReady && (
              <div className="mt-4 flex flex-col space-y-2 z-10">
                <button
                  onClick={onCreateWallet}
                  disabled={!!busy}
                  className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-black uppercase tracking-widest rounded disabled:opacity-50 transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:shadow-[0_0_25px_rgba(6,182,212,0.6)]"
                >
                  Create Wallet
                </button>
                <button
                  onClick={onLoginWallet}
                  disabled={!!busy}
                  className="w-full py-2.5 bg-transparent hover:bg-cyan-500/10 text-cyan-400 text-xs font-bold uppercase tracking-widest rounded border border-cyan-500/30 hover:border-cyan-400 disabled:opacity-50 transition-all"
                >
                  Login Passkey
                </button>
              </div>
            )}
          </div>

          {/* Step 2: Agents */}
          <div className={`relative flex flex-col p-5 rounded-xl border bg-[#0d0d14] backdrop-blur-md transition-all duration-500 overflow-hidden
            ${agentsReady ? 'border-[#00ff9d]/40 shadow-[0_0_15px_rgba(0,255,157,0.1)]' : activeStep === 2 ? 'border-fuchsia-500 shadow-[0_0_20px_rgba(217,70,239,0.2)]' : 'border-gray-800'}`}>
            
            {activeStep === 2 && (
              <div className="absolute inset-0 bg-fuchsia-500/5 animate-pulse pointer-events-none" />
            )}

            <div className="flex items-center space-x-3 mb-4 z-10">
              <div className={`p-2 rounded-lg border transition-colors ${agentsReady ? 'bg-[#00ff9d]/10 border-[#00ff9d]/30 text-[#00ff9d]' : activeStep === 2 ? 'bg-fuchsia-500/10 border-fuchsia-500/50 text-fuchsia-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                <Users className="w-6 h-6" />
              </div>
              <h3 className={`text-sm font-bold uppercase tracking-wider flex-1 ${agentsReady ? 'text-[#00ff9d]' : activeStep === 2 ? 'text-fuchsia-400' : 'text-gray-400'}`}>
                Bind AI Agent Passkeys
              </h3>
              {agentsReady && <CheckCircle2 className="w-6 h-6 text-[#00ff9d] drop-shadow-[0_0_8px_rgba(0,255,157,0.8)]" />}
            </div>
            
            <div className="flex-1 z-10">
              {agentsReady ? (
                <div className="flex flex-col space-y-2">
                  <span className="text-[10px] text-[#00ff9d] font-bold uppercase tracking-widest">Status: Active</span>
                  <span className="text-xs text-fuchsia-100 bg-[#050508] border border-[#00ff9d]/20 p-2 rounded-md font-mono">
                    [{agentCount}] Neural Nodes Linked
                  </span>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-4 uppercase tracking-wide leading-relaxed">Authorize AI entities for autonomous execution.</p>
              )}
            </div>

            {!agentsReady && (
              <div className="mt-4 z-10">
                <button
                  onClick={onScrollToAgents}
                  disabled={!!busy || !walletReady}
                  className="w-full py-2.5 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-black uppercase tracking-widest rounded disabled:opacity-50 disabled:bg-gray-800 disabled:text-gray-500 transition-all shadow-[0_0_15px_rgba(217,70,239,0.3)] hover:shadow-[0_0_25px_rgba(217,70,239,0.5)] border border-fuchsia-400/50"
                >
                  Initialize Binding
                </button>
              </div>
            )}
          </div>

          {/* Step 3: MCP */}
          <div className={`relative flex flex-col p-5 rounded-xl border bg-[#0d0d14] backdrop-blur-md transition-all duration-500 overflow-hidden
            ${activeStep === 3 ? 'border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.2)]' : 'border-gray-800'}`}>
            
            {activeStep === 3 && (
              <div className="absolute inset-0 bg-indigo-500/5 animate-pulse pointer-events-none" />
            )}

            <div className="flex items-center space-x-3 mb-4 z-10">
              <div className={`p-2 rounded-lg border transition-colors ${activeStep === 3 ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                <Wrench className="w-6 h-6" />
              </div>
              <h3 className={`text-sm font-bold uppercase tracking-wider flex-1 ${activeStep === 3 ? 'text-indigo-400' : 'text-gray-400'}`}>
                Launch MCP Tools
              </h3>
            </div>
            
            <div className="flex-1 z-10">
              <p className="text-xs text-gray-400 mb-4 uppercase tracking-wide leading-relaxed">
                Inject Model Context Protocol skills for advanced external routing.
              </p>
            </div>

            <div className="mt-4 z-10">
              <button
                disabled={true}
                className="w-full py-2.5 bg-[#050508] text-gray-600 text-xs font-black uppercase tracking-widest rounded border border-gray-800 cursor-not-allowed"
              >
                Module Offline
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

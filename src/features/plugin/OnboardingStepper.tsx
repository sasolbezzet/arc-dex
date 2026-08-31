import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useAgentStore } from '../../stores/agentStore';
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
      <div className="p-4 bg-gray-900/80 backdrop-blur-md rounded-xl border border-indigo-500/30 shadow-lg flex justify-between items-center transition-all duration-300">
        <div className="flex items-center space-x-3">
          <div className="text-indigo-400 font-semibold flex items-center space-x-2">
            <span>Agent Onboarding</span>
            {walletReady && agentsReady && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
          </div>
        </div>
        <button
          onClick={() => setCollapsed(false)}
          className="text-gray-400 hover:text-white transition-colors p-1"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gradient-to-br from-gray-900 to-gray-800 backdrop-blur-md rounded-xl border border-indigo-500/50 shadow-2xl transition-all duration-300 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-64 h-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />

      <div className="relative flex justify-between items-start mb-6">
        <div>
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
            Welcome to Arc DEX
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Complete these steps to fully unleash your AI agents.
          </p>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-400 hover:text-white transition-colors p-1 bg-gray-800/50 rounded-lg"
          title="Collapse"
        >
          <ChevronUp className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
        {/* Step 1: Wallet */}
        <div className={`flex flex-col p-5 rounded-xl border ${walletReady ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-gray-800/60 border-indigo-500/30'} relative`}>
          <div className="flex items-center space-x-3 mb-4">
            <div className={`p-2 rounded-lg ${walletReady ? 'bg-emerald-500/20 text-emerald-400' : 'bg-indigo-500/20 text-indigo-400'}`}>
              <Wallet className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white flex-1">Agent MSCA Wallet</h3>
            {walletReady && <CheckCircle2 className="w-6 h-6 text-emerald-400" />}
          </div>
          
          <div className="flex-1">
            {walletReady ? (
              <div className="flex flex-col space-y-2">
                <span className="text-sm text-emerald-400/80 font-medium">Connected</span>
                <span className="text-xs text-gray-400 font-mono bg-black/30 p-2 rounded-md break-all">
                  {truncateAddress(walletAddress)}
                </span>
              </div>
            ) : (
              <p className="text-sm text-gray-400 mb-4">Create or connect your Multi-Signature Smart Contract Account.</p>
            )}
          </div>

          {!walletReady && (
            <div className="mt-4 flex flex-col space-y-2">
              <button
                onClick={onCreateWallet}
                disabled={!!busy}
                className="w-full py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-all shadow-lg shadow-indigo-500/20"
              >
                Create Wallet
              </button>
              <button
                onClick={onLoginWallet}
                disabled={!!busy}
                className="w-full py-2 bg-gray-700/50 hover:bg-gray-700 text-gray-300 hover:text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-all border border-gray-600/50"
              >
                Login Passkey
              </button>
            </div>
          )}
        </div>

        {/* Step 2: Agents */}
        <div className={`flex flex-col p-5 rounded-xl border ${agentsReady ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-gray-800/60 border-indigo-500/30'}`}>
          <div className="flex items-center space-x-3 mb-4">
            <div className={`p-2 rounded-lg ${agentsReady ? 'bg-emerald-500/20 text-emerald-400' : 'bg-indigo-500/20 text-indigo-400'}`}>
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white flex-1">Connect Agents</h3>
            {agentsReady && <CheckCircle2 className="w-6 h-6 text-emerald-400" />}
          </div>
          
          <div className="flex-1">
            {agentsReady ? (
              <div className="flex flex-col space-y-2">
                <span className="text-sm text-emerald-400/80 font-medium">Active</span>
                <span className="text-sm text-gray-300 bg-black/30 p-2 rounded-md">
                  {agentCount} Agent(s) Connected
                </span>
              </div>
            ) : (
              <p className="text-sm text-gray-400 mb-4">Link your AI agents to allow them to execute on-chain actions.</p>
            )}
          </div>

          {!agentsReady && (
            <div className="mt-4">
              <button
                onClick={onScrollToAgents}
                disabled={!!busy || !walletReady}
                className="w-full py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 transition-all shadow-lg shadow-indigo-500/20"
              >
                Open Agent List
              </button>
            </div>
          )}
        </div>

        {/* Step 3: MCP */}
        <div className="flex flex-col p-5 rounded-xl border bg-gray-800/60 border-indigo-500/30">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
              <Wrench className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white flex-1">MCP Tools & Skills</h3>
          </div>
          
          <div className="flex-1">
            <p className="text-sm text-gray-400 mb-4">
              Equip agents with Model Context Protocol skills for advanced external system interactions.
            </p>
          </div>

          <div className="mt-4">
            <button
              disabled={true}
              className="w-full py-2 bg-gray-800 text-gray-500 text-sm font-medium rounded-lg border border-gray-700 cursor-not-allowed"
            >
              Coming Soon
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

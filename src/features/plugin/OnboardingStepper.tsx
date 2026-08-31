import React from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useAgentStore } from '../../stores/agentStore';

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
  const truncateAddress = (addr?: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="p-6 bg-white/10 backdrop-blur-md rounded-xl border border-indigo-500 shadow-xl">
      <div className="flex flex-col space-y-6" role="list">
        
        {/* Step 1: Wallet */}
        <div className="flex items-start space-x-4" role="listitem">
          <div className="flex-shrink-0 text-2xl">
            {walletReady ? '✅' : '1️⃣'}
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">Agent Wallet</h3>
            {walletReady ? (
              <p className="text-sm text-gray-300 mt-1">Connected: {truncateAddress(walletAddress)}</p>
            ) : (
              <div className="mt-3 flex space-x-3">
                <button
                  onClick={onCreateWallet}
                  disabled={!!busy}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  Create Wallet
                </button>
                <button
                  onClick={onLoginWallet}
                  disabled={!!busy}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                  Login Passkey
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Agents */}
        <div className="flex items-start space-x-4" role="listitem">
          <div className="flex-shrink-0 text-2xl">
            {agentsReady ? '✅' : '2️⃣'}
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">Connect Agents</h3>
            {agentsReady ? (
              <p className="text-sm text-gray-300 mt-1">{agentCount} agent(s) connected</p>
            ) : null}
            <div className="mt-3">
              <button
                onClick={onScrollToAgents}
                disabled={!!busy}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                Open Agent List
              </button>
            </div>
          </div>
        </div>

        {/* Step 3: MCP */}
        <div className="flex items-start space-x-4" role="listitem">
          <div className="flex-shrink-0 text-2xl">
            3️⃣
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">Activate MCP</h3>
            <p className="text-sm text-gray-300 mt-1">
              Activate your MCP connection to enable advanced features and allow agents to securely interact with external systems.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};

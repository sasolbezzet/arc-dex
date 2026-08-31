import { useState } from 'react';
import { getPasskeyOptions, verifyPasskey } from '../api/authApi';
import { generateSessionKey, setupSession, recordAuthorizationAttempt, reconcileSession, authorizeChain, getDestinationStatus } from '../api/sessionApi';
import { useAgentStore } from '../stores/agentStore';
import { useAuthStore } from '../stores/authStore';
import { AgentType, AgentState, SUPPORTED_CHAINS } from '../types/agent';

// Helper to convert ArrayBuffer to base64url string
function bufferToBase64url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (const charCode of bytes) {
        str += String.fromCharCode(charCode);
    }
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Helper to convert base64url string to Uint8Array
function base64urlToBuffer(base64url: string): Uint8Array {
    const padding = '='.repeat((4 - base64url.length % 4) % 4);
    const base64 = (base64url + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export function useModularWallet() {
    const setAgentState = useAgentStore(state => state.setAgentState);
    const updateDeploymentStatus = useAgentStore(state => state.updateDeploymentStatus);
    const setAuth = useAuthStore(state => state.setAuth);

    const registerPasskey = async (agentKey: string, username?: string) => {
        const options = await getPasskeyOptions('Register', agentKey, username);
        
        const publicKey = {
            ...options.options,
            challenge: base64urlToBuffer(options.options.challenge),
            user: {
                ...options.options.user,
                id: base64urlToBuffer(options.options.user.id)
            }
        };

        const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential;
        if (!credential) {
            throw new Error("Failed to create credential");
        }

        const response = credential.response as AuthenticatorAttestationResponse;

        const serializedCred = {
            id: credential.id,
            rawId: bufferToBase64url(credential.rawId),
            type: credential.type,
            response: {
                clientDataJSON: bufferToBase64url(response.clientDataJSON),
                attestationObject: bufferToBase64url(response.attestationObject),
            }
        };

        const verifyResult = await verifyPasskey(serializedCred, 'Register', options.flowId, agentKey);
        
        setAgentState(agentKey, 'deploying');
        setAuth(verifyResult.token, verifyResult.walletAddress);

        return {
            walletAddress: verifyResult.walletAddress,
            token: verifyResult.token,
            credential
        };
    };

    const loginPasskey = async (agentKey: string) => {
        try {
            const reactivateRes = await fetch('/api/session/reactivate', { method: 'POST' });
            if (reactivateRes.ok) {
                const data = await reactivateRes.json();
                setAuth(data.token, data.walletAddress);
                return { walletAddress: data.walletAddress, token: data.token };
            }
        } catch (e) {
            console.warn("Reactivate failed", e);
        }

        const options = await getPasskeyOptions('Login', agentKey);
        const publicKey = {
            ...options.options,
            challenge: base64urlToBuffer(options.options.challenge),
            allowCredentials: options.options.allowCredentials?.map((cred: any) => ({
                ...cred,
                id: base64urlToBuffer(cred.id)
            }))
        };

        const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential;
        if (!credential) {
            throw new Error("Failed to get credential");
        }

        const response = credential.response as AuthenticatorAssertionResponse;

        const serializedCred = {
            id: credential.id,
            rawId: bufferToBase64url(credential.rawId),
            type: credential.type,
            response: {
                clientDataJSON: bufferToBase64url(response.clientDataJSON),
                authenticatorData: bufferToBase64url(response.authenticatorData),
                signature: bufferToBase64url(response.signature),
                userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : undefined,
            }
        };

        const verifyResult = await verifyPasskey(serializedCred, 'Login', options.flowId, agentKey);
        setAuth(verifyResult.token, verifyResult.walletAddress);

        return {
            walletAddress: verifyResult.walletAddress,
            token: verifyResult.token,
        };
    };

    const deployToChains = async (walletAddress: string, sessionToken: string, agentKey: string) => {
        try {
            updateDeploymentStatus(agentKey, 'arc-testnet', 'deploying');
            
            // Phase 1: Deploy on Arc Testnet (blocking, setup session key)
            const sessionKeyInfo = await generateSessionKey();
            await setupSession(walletAddress, sessionToken, sessionKeyInfo.publicKey);
            await authorizeChain(walletAddress, sessionToken, 'arc-testnet');
            
            updateDeploymentStatus(agentKey, 'arc-testnet', 'deployed');
            
            // Phase 2: Deploy on destination chains in PARALLEL
            const destChains = SUPPORTED_CHAINS.filter(c => c !== 'arc-testnet');
            
            destChains.forEach(chain => {
                updateDeploymentStatus(agentKey, chain, 'deploying');
            });

            await Promise.allSettled(
                destChains.map(async (chain) => {
                    try {
                        await recordAuthorizationAttempt(walletAddress, chain);
                        try {
                            await authorizeChain(walletAddress, sessionToken, chain);
                        } catch (err) {
                            console.warn(`Authorization failed for ${chain}, attempting reconcile...`, err);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            await reconcileSession(walletAddress, chain);
                            await authorizeChain(walletAddress, sessionToken, chain);
                        }
                        
                        const destStatus = await getDestinationStatus(walletAddress, chain);
                        if (destStatus.status === 'success') {
                            updateDeploymentStatus(agentKey, chain, 'deployed');
                        } else {
                            updateDeploymentStatus(agentKey, chain, 'failed');
                        }
                    } catch (e) {
                        console.error(`Failed to deploy to ${chain}:`, e);
                        updateDeploymentStatus(agentKey, chain, 'failed');
                    }
                })
            );

            setAgentState(agentKey, 'active');

        } catch (error) {
            console.error("Deployment failed:", error);
            setAgentState(agentKey, 'error');
            throw error;
        }
    };

    return {
        registerPasskey,
        loginPasskey,
        deployToChains
    };
}

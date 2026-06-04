use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("C7XUB3Ep67seiJAzz4Apeeus2AbxbnuqFzvodDWxqoTH");

#[program]
pub mod arcox_solana_router {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= 1_000, ArcoxRouterError::FeeTooHigh);
        let config = &mut ctx.accounts.config;
        config.owner = ctx.accounts.owner.key();
        config.treasury_token_account = ctx.accounts.treasury_token_account.key();
        config.fee_bps = fee_bps;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_fee_bps(ctx: Context<UpdateConfig>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= 1_000, ArcoxRouterError::FeeTooHigh);
        ctx.accounts.config.fee_bps = fee_bps;
        Ok(())
    }

    pub fn set_treasury_token_account(ctx: Context<UpdateConfig>, treasury_token_account: Pubkey) -> Result<()> {
        ctx.accounts.config.treasury_token_account = treasury_token_account;
        Ok(())
    }

    pub fn transfer_with_fee(ctx: Context<TransferWithFee>, amount: u64) -> Result<()> {
        require!(amount > 0, ArcoxRouterError::BadAmount);
        require_keys_eq!(
            ctx.accounts.treasury_token_account.key(),
            ctx.accounts.config.treasury_token_account,
            ArcoxRouterError::BadTreasury
        );
        let fee = amount
            .checked_mul(ctx.accounts.config.fee_bps as u64)
            .ok_or(ArcoxRouterError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(ArcoxRouterError::MathOverflow)?;
        let net_amount = amount.checked_sub(fee).ok_or(ArcoxRouterError::MathOverflow)?;
        require!(net_amount > 0, ArcoxRouterError::NetZero);

        if fee > 0 {
            token::transfer(ctx.accounts.fee_transfer_ctx(), fee)?;
        }
        token::transfer(ctx.accounts.net_transfer_ctx(), net_amount)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + RouterConfig::SPACE,
        seeds = [b"router_config"],
        bump
    )]
    pub config: Account<'info, RouterConfig>,
    pub treasury_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"router_config"], bump = config.bump, has_one = owner)]
    pub config: Account<'info, RouterConfig>,
}

#[derive(Accounts)]
pub struct TransferWithFee<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"router_config"], bump = config.bump)]
    pub config: Account<'info, RouterConfig>,
    #[account(mut)]
    pub source_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub destination_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

impl<'info> TransferWithFee<'info> {
    fn fee_transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.source_token_account.to_account_info(),
                to: self.treasury_token_account.to_account_info(),
                authority: self.owner.to_account_info(),
            },
        )
    }

    fn net_transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.source_token_account.to_account_info(),
                to: self.destination_token_account.to_account_info(),
                authority: self.owner.to_account_info(),
            },
        )
    }
}

#[account]
pub struct RouterConfig {
    pub owner: Pubkey,
    pub treasury_token_account: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

impl RouterConfig {
    pub const SPACE: usize = 32 + 32 + 2 + 1;
}

#[error_code]
pub enum ArcoxRouterError {
    #[msg("Fee too high")]
    FeeTooHigh,
    #[msg("Bad amount")]
    BadAmount,
    #[msg("Bad treasury token account")]
    BadTreasury,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Net amount is zero")]
    NetZero,
}

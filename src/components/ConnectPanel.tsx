import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { loginPasskey } from '../services/modularWallet'
import {
  getConnectConfig,
  getConnectAccess,
  getConnectAccount,
  onboardConnect,
  createConnectProduct,
  getConnectProducts,
  getStorefrontProducts,
  checkoutStoreProduct,
  subscribeConnect,
  openConnectPortal,
} from '../connectApi'
import type { ConnectConfig, ConnectAccess, ConnectAccount, ConnectProduct } from '../connectApi'

type Mode = 'dashboard' | 'storefront'

export function ConnectPanel() {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('dashboard')
  const [config, setConfig] = useState<ConnectConfig | null>(null)
  const [access, setAccess] = useState<ConnectAccess | null>(null)
  const [account, setAccount] = useState<ConnectAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [productName, setProductName] = useState('')
  const [productDesc, setProductDesc] = useState('')
  const [productPrice, setProductPrice] = useState('')
  const [products, setProducts] = useState<ConnectProduct[]>([])
  // storefront state
  const [storeAccountId, setStoreAccountId] = useState('')
  const [storeProducts, setStoreProducts] = useState<ConnectProduct[]>([])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const cfg = await getConnectConfig()
      setConfig(cfg)
      const [accessResult, accountResult] = await Promise.all([
        getConnectAccess().catch(() => null),
        getConnectAccount().catch(() => null),
      ])
      setAccess(accessResult)
      setAccount(accountResult?.account || null)
    } catch (e: any) {
      setError(e?.message || 'load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function authenticateMerchant() {
    const fresh = await loginPasskey()
    localStorage.setItem('arx_vault_token', fresh.sessionToken)
    localStorage.setItem('arx_passkey_vault_token', fresh.sessionToken)
    const current = await getConnectAccess()
    if (!current.active) throw new Error('Active authenticated MSCA session required')
    setAccess(current)
    return fresh.sessionToken
  }

  async function handleOnboard() {
    setBusy(true)
    setError('')
    try {
      const token = await authenticateMerchant()
      const res = await onboardConnect({ displayName, contactEmail }, token)
      // Open the Stripe-hosted onboarding link in a new tab.
      window.open(res.url, '_blank', 'noopener,noreferrer')
      await load()
    } catch (e: any) {
      setError(e?.message || 'onboard failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateProduct() {
    setBusy(true)
    setError('')
    try {
      const priceCents = Math.round(Number(productPrice) * 100)
      if (!productName || !priceCents) throw new Error('name and price required')
      const token = await authenticateMerchant()
      await createConnectProduct({ name: productName, description: productDesc, priceCents }, token)
      setProductName(''); setProductDesc(''); setProductPrice('')
      await refreshProducts()
    } catch (e: any) {
      setError(e?.message || 'create product failed')
    } finally {
      setBusy(false)
    }
  }

  async function refreshProducts() {
    try {
      const res = await getConnectProducts()
      setProducts(res.products || [])
    } catch { /* ignore */ }
  }

  async function handleSubscribe() {
    setBusy(true)
    setError('')
    try {
      const token = await authenticateMerchant()
      const res = await subscribeConnect(token)
      if (res.url) window.open(res.url, '_blank', 'noopener,noreferrer')
    } catch (e: any) {
      setError(e?.message || 'subscribe failed')
    } finally {
      setBusy(false)
    }
  }

  async function handlePortal() {
    setBusy(true)
    setError('')
    try {
      const token = await authenticateMerchant()
      const res = await openConnectPortal(token)
      if (res.url) window.open(res.url, '_blank', 'noopener,noreferrer')
    } catch (e: any) {
      setError(e?.message || 'portal failed')
    } finally {
      setBusy(false)
    }
  }

  async function loadStorefront() {
    if (!storeAccountId) return
    setBusy(true)
    setError('')
    try {
      const res = await getStorefrontProducts(storeAccountId)
      setStoreProducts(res.products || [])
    } catch (e: any) {
      setError(e?.message || 'storefront failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleBuy(product: ConnectProduct) {
    setBusy(true)
    setError('')
    try {
      const res = await checkoutStoreProduct(storeAccountId, product.id, 1)
      if (res.url) window.open(res.url, '_blank', 'noopener,noreferrer')
    } catch (e: any) {
      setError(e?.message || 'checkout failed')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (account && !products.length) refreshProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  if (loading) return <div className="panel-card">{t('plugin.loading')}</div>

  const feePct = config ? (config.appFeeBasisPoints / 100).toFixed(1) : '0'
  const mscaActive = access?.active === true

  return (
    <div className="panel-card connect-panel">
      <div className="panel-header-row">
        <h2>Stripe Connect</h2>
        <div className="tab-row">
          <button className={`tab-button ${mode === 'dashboard' ? 'active' : ''}`} onClick={() => setMode('dashboard')}>
            {t('connect.tabDashboard')}
          </button>
          <button className={`tab-button ${mode === 'storefront' ? 'active' : ''}`} onClick={() => setMode('storefront')}>
            {t('connect.tabStorefront')}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {access && !access.active && (
        <section className="connect-access-gate">
          <div className="connect-access-icon">!</div>
          <div>
            <strong>{t('connect.sessionTitle')}</strong>
            <p>{t('connect.sessionCopy')}</p>
            <small>{t('connect.sessionStatus')}: {access.statusReason || 'inactive'}</small>
          </div>
          <button className="action-button" type="button" onClick={() => window.location.assign('/arc-dex/plugin')}>
            {t('connect.activateSession')}
          </button>
        </section>
      )}

      {config && (
        <div className="connect-config-bar">
          <span className={`badge ${config.testMode ? 'badge-test' : 'badge-live'}`}>
            {config.testMode ? 'TEST MODE' : 'LIVE'}
          </span>
          <span className="muted">fee: {feePct}% · currency: {config.currency}</span>
        </div>
      )}

      {mode === 'dashboard' && (
        <div className="connect-dashboard">
          {!account ? (
            <div className="onboard-box">
              <h3>{t('connect.onboardTitle')}</h3>
              <p className="muted">{t('connect.onboardDesc')}</p>
              <input
                placeholder={t('connect.displayName')}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <input
                placeholder={t('connect.contactEmail')}
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
              <button className="action-button" disabled={busy || !mscaActive} onClick={handleOnboard}>
                {t('connect.onboardButton')}
              </button>
            </div>
          ) : (
            <>
              <div className="account-status">
                <h3>{account.displayName || account.accountId}</h3>
                <div className="status-grid">
                  <div>
                    <span className="muted">{t('connect.cardPayments')}</span>
                    <span className={`badge ${account.readyToProcessPayments ? 'badge-ok' : 'badge-warn'}`}>
                      {account.cardPayments}
                    </span>
                  </div>
                  <div>
                    <span className="muted">{t('connect.onboardingStatus')}</span>
                    <span className={`badge ${account.onboardingComplete ? 'badge-ok' : 'badge-warn'}`}>
                      {account.onboardingComplete ? 'complete' : account.requirementsStatus}
                    </span>
                  </div>
                  <div>
                    <span className="muted">account</span>
                    <code className="mono">{account.accountId}</code>
                  </div>
                </div>
                <div className="row-actions">
                  <button className="action-button" disabled={busy || !mscaActive} onClick={handleOnboard}>
                    {t('connect.reOnboard')}
                  </button>
                  <button className="action-button secondary" disabled={busy || !mscaActive} onClick={handleSubscribe}>
                    {t('connect.subscribe')}
                  </button>
                  <button className="action-button secondary" disabled={busy || !mscaActive} onClick={handlePortal}>
                    {t('connect.portal')}
                  </button>
                </div>
              </div>

              <div className="product-form">
                <h3>{t('connect.createProduct')}</h3>
                <div className="form-row">
                  <input placeholder={t('connect.productName')} value={productName} onChange={(e) => setProductName(e.target.value)} />
                  <input placeholder={t('connect.productDesc')} value={productDesc} onChange={(e) => setProductDesc(e.target.value)} />
                  <input placeholder={t('connect.productPrice')} type="number" value={productPrice} onChange={(e) => setProductPrice(e.target.value)} />
                  <button className="action-button" disabled={busy || !mscaActive} onClick={handleCreateProduct}>
                    {t('connect.createButton')}
                  </button>
                </div>
              </div>

              <div className="product-list">
                <h3>{t('connect.myProducts')}</h3>
                {products.length === 0 ? (
                  <p className="muted">{t('connect.noProducts')}</p>
                ) : (
                  products.map((p) => (
                    <div key={p.id} className="product-row">
                      <div>
                        <strong>{p.name}</strong>
                        <div className="muted">{p.description || ''}</div>
                      </div>
                      <div className="mono">
                        {p.default_price ? `$${(p.default_price.unit_amount / 100).toFixed(2)}` : ''}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'storefront' && (
        <div className="storefront">
          <h3>{t('connect.storefrontTitle')}</h3>
          <p className="muted">
            {t('connect.storefrontDesc')}{' '}
            <code className="mono">acct_...</code>
          </p>
          <div className="form-row">
            <input
              placeholder="acct_..."
              value={storeAccountId}
              onChange={(e) => setStoreAccountId(e.target.value)}
            />
            <button className="action-button" disabled={busy || !storeAccountId} onClick={loadStorefront}>
              {t('connect.loadStore')}
            </button>
          </div>
          {storeProducts.length > 0 && (
            <div className="store-grid">
              {storeProducts.map((p) => (
                <div key={p.id} className="store-card">
                  <h4>{p.name}</h4>
                  <p className="muted">{p.description || ''}</p>
                  <div className="store-footer">
                    <span className="mono">
                      {p.default_price ? `$${(p.default_price.unit_amount / 100).toFixed(2)}` : ''}
                    </span>
                    <button className="action-button" disabled={busy} onClick={() => handleBuy(p)}>
                      {t('connect.buy')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

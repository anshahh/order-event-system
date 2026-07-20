import { useState, useEffect } from 'react';
import './App.css';

const AUTH_API = 'http://localhost:8004';
const ORDER_API = 'http://localhost:8010';
const PROJECTION_API = 'http://localhost:8003';

const STATUS_STEPS = [
  { key: 'PENDING_PAYMENT', label: 'Order Placed' },
  { key: 'PAYMENT_CONFIRMED', label: 'Payment Confirmed' },
  { key: 'SHIPPED', label: 'Shipped' },
  { key: 'DELIVERED', label: 'Delivered' },
];

const STATUS_COLORS = {
  PENDING_PAYMENT: '#f59e0b',
  PAYMENT_CONFIRMED: '#3b82f6',
  PAYMENT_FAILED: '#f87171',
  SHIPPED: '#8b5cf6',
  DELIVERED: '#22c55e',
  CANCELLED: '#6b7280',
  REFUNDED: '#06b6d4',
};

function spaceWords(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function StatusPill({ status }) {
  const color = STATUS_COLORS[status] || '#6b7280';
  const label = status ? status.replaceAll('_', ' ') : 'PENDING';
  return (
    <span className="pill" style={{ background: `${color}22`, color }}>
      <span className="pill-dot" style={{ background: color }} />
      {label}
    </span>
  );
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${AUTH_API}/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      localStorage.setItem('token', data.token);
      onAuthed(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <h1>Order Pipeline</h1>
            <p>Event-sourced order pipeline</p>
          </div>
        </div>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Sign up</button>
        </div>
        <form onSubmit={handleSubmit} className="order-form">
          <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function ProductDetailModal({ product, token, onClose, onOrderPlaced }) {
  const [quantity, setQuantity] = useState(1);
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState(null);
  const [recs, setRecs] = useState([]);
  const [recsLoaded, setRecsLoaded] = useState(false);

  useEffect(() => {
    fetch(`${ORDER_API}/products/${product.id}/recommendations`)
      .then((res) => res.json())
      .then((data) => { setRecs(data); setRecsLoaded(true); });
  }, [product.id]);

  const outOfStock = product.stock <= 0;

  function changeQty(delta) {
    setQuantity((q) => Math.min(product.stock, Math.max(1, q + delta)));
  }

  async function placeOrder() {
    setPlacing(true);
    setMsg(null);
    try {
      const res = await fetch(`${ORDER_API}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productId: product.id, quantity }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: 'error', text: data.message || data.error });
      } else {
        setMsg({ type: 'success', text: `Order placed! ${data.remainingStock} left in stock.` });
        onOrderPlaced({ orderId: data.orderId, productName: product.name, quantity });
      }
    } catch (err) {
      setMsg({ type: 'error', text: 'Failed to place order' });
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>

        <div className="modal-hero">
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} className="modal-image" />
          ) : (
            <div className="modal-image-placeholder">{product.name[0]}</div>
          )}
        </div>

        <h2>{product.name}</h2>
        <p className="price" style={{ fontSize: 18 }}>${Number(product.price).toFixed(2)}</p>
        <p className={`stock ${outOfStock ? 'out' : ''}`}>
          {outOfStock ? 'Out of stock' : `${product.stock} in stock`}
        </p>

        {!outOfStock && (
          <>
            <div className="qty-row">
              <button onClick={() => changeQty(-1)}>-</button>
              <span>{quantity}</span>
              <button onClick={() => changeQty(1)} disabled={quantity >= product.stock}>+</button>
              <button className="buy-btn" onClick={placeOrder} disabled={placing}>
                {placing ? 'Placing...' : 'Buy'}
              </button>
            </div>
            {quantity >= product.stock && (
              <p className="panel-subtitle" style={{ fontSize: 11 }}>Max available quantity reached</p>
            )}
          </>
        )}

        {msg && <p className={msg.type === 'error' ? 'error' : 'success-msg'}>{msg.text}</p>}

        <div className="modal-recs">
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Frequently bought together</h3>
          {recsLoaded && recs.length === 0 && <p className="empty-state" style={{ padding: 0 }}>No data yet</p>}
          <ul className="recs-list">
            {recs.map((r) => (
              <li key={r.id}>{r.name} <span className="timestamp">bought together {r.times_bought}x</span></li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ProductCard({ product, onClick }) {
  const outOfStock = product.stock <= 0;
  return (
    <div className="product-card-wide" onClick={onClick}>
      <div className="product-thumb">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} />
        ) : (
          <span>{product.name[0]}</span>
        )}
      </div>
      <div className="product-info">
        <h3>{product.name}</h3>
        <p className={`stock ${outOfStock ? 'out' : ''}`}>
          {outOfStock ? 'Out of stock' : `${product.stock} in stock`}
        </p>
      </div>
      <span className="price">${Number(product.price).toFixed(2)}</span>
    </div>
  );
}

function CatalogTab({ token, onOrderPlaced }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);

  async function loadProducts() {
    const res = await fetch(`${ORDER_API}/products`);
    setProducts(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadProducts(); }, []);

  function handleOrderPlaced(order) {
    onOrderPlaced(order);
    loadProducts();
  }

  if (loading) return <div className="panel"><p className="empty-state">Loading catalog...</p></div>;

  return (
    <>
      <div className="catalog-list">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} onClick={() => setSelectedProduct(p)} />
        ))}
      </div>
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          token={token}
          onClose={() => setSelectedProduct(null)}
          onOrderPlaced={handleOrderPlaced}
        />
      )}
    </>
  );
}

function OrderCard({ order, token }) {
  const [orderState, setOrderState] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const source = new EventSource(`${PROJECTION_API}/orders/${order.orderId}/stream`);
    source.onmessage = (event) => setOrderState(JSON.parse(event.data));
    source.onerror = () => source.close();
    return () => source.close();
  }, [order.orderId]);

  async function toggleHistory() {
    if (!showHistory) {
      const res = await fetch(`${ORDER_API}/orders/${order.orderId}/history`);
      setHistory(await res.json());
    }
    setShowHistory(!showHistory);
  }

  async function cancelOrder() {
    setCancelling(true);
    try {
      await fetch(`${ORDER_API}/orders/${order.orderId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error(err);
    } finally {
      setCancelling(false);
    }
  }

  const currentStepIndex = orderState ? STATUS_STEPS.findIndex((s) => s.key === orderState.status) : -1;
  const canCancel = orderState && ['PENDING_PAYMENT', 'PAYMENT_CONFIRMED'].includes(orderState.status);

  return (
    <div className="order-card">
      <div className="order-card-header">
        <div>
          <p className="order-items">{order.quantity}x {order.productName}</p>
          <p className="order-id">{order.orderId}</p>
        </div>
        <StatusPill status={orderState?.status} />
      </div>

      <div className="timeline">
        {STATUS_STEPS.map((step, index) => {
          const isFailed = orderState?.status === 'PAYMENT_FAILED' && index === 1;
          const isCancelled = ['CANCELLED', 'REFUNDED'].includes(orderState?.status);
          const isActive = index <= currentStepIndex && !isCancelled;
          return (
            <div key={step.key} className={`timeline-step ${isActive ? 'active' : ''} ${isFailed ? 'failed' : ''}`}>
              <div className="dot" />
              <span>{isFailed ? 'Payment Failed' : step.label}</span>
            </div>
          );
        })}
      </div>

      {orderState?.tracking_number && (
        <p className="tracking">Tracking: <strong>{orderState.tracking_number}</strong></p>
      )}

      <div className="order-actions">
        {canCancel && (
          <button className="cancel-btn" onClick={cancelOrder} disabled={cancelling}>
            {cancelling ? 'Cancelling...' : 'Cancel order'}
          </button>
        )}
        <button className="link-button" onClick={toggleHistory}>
          {showHistory ? 'Hide' : 'View'} event history
        </button>
      </div>

      {showHistory && (
        <ul className="history-list">
          {history.map((event, i) => (
            <li key={i}>
              <strong>{spaceWords(event.event_type)}</strong>
              <span className="timestamp">{new Date(event.created_at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MyOrdersTab({ orders, token }) {
  if (orders.length === 0) {
    return <div className="panel"><p className="empty-state">No orders placed yet this session.</p></div>;
  }
  return (
    <div className="order-list">
      {orders.slice().reverse().map((order) => (
        <OrderCard key={order.orderId} order={order} token={token} />
      ))}
    </div>
  );
}

function ProfileTab({ user, token, onPhotoUpdated }) {
  const [photoPreview, setPhotoPreview] = useState(user.photoUrl || null);
  const [saving, setSaving] = useState(false);

  async function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setPhotoPreview(dataUrl);
      setSaving(true);
      try {
        await fetch(`${AUTH_API}/auth/photo`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ photoUrl: dataUrl }),
        });
        onPhotoUpdated(dataUrl);
      } catch (err) {
        console.error(err);
      } finally {
        setSaving(false);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="panel">
      <h2>Profile</h2>
      <div className="profile-row">
        <div className="avatar-wrap">
          {photoPreview ? (
            <img src={photoPreview} alt="avatar" className="avatar" />
          ) : (
            <div className="avatar-placeholder">{user.username[0].toUpperCase()}</div>
          )}
          <label className="upload-label">
            {saving ? 'Saving...' : 'Change photo'}
            <input type="file" accept="image/*" onChange={handlePhotoChange} hidden />
          </label>
        </div>
        <div>
          <p className="profile-username">{user.username}</p>
          <p className="panel-subtitle">Registered user</p>
        </div>
      </div>
    </div>
  );
}

function AdminDashboardTab() {
  const [summary, setSummary] = useState([]);

  async function fetchSummary() {
    try {
      const res = await fetch(`${PROJECTION_API}/orders-summary`);
      setSummary(await res.json());
    } catch (err) { console.error(err); }
  }

  useEffect(() => {
    fetchSummary();
    const interval = setInterval(fetchSummary, 3000);
    return () => clearInterval(interval);
  }, []);

  const countFor = (status) => {
    const row = summary.find((s) => s.status === status);
    return row ? Number(row.count) : 0;
  };
  const total = summary.reduce((sum, row) => sum + Number(row.count), 0);

  return (
    <div className="panel">
      <h2>Live order funnel</h2>
      <div className="funnel-grid">
        {STATUS_STEPS.map((step) => (
          <div key={step.key} className="funnel-card">
            <span className="funnel-count" style={{ color: STATUS_COLORS[step.key] }}>{countFor(step.key)}</span>
            <span className="funnel-label">{step.label}</span>
          </div>
        ))}
      </div>
      <p className="total-orders">Total orders tracked: <strong>{total}</strong></p>
    </div>
  );
}

function MainApp({ token, user, onLogout }) {
  const [tab, setTab] = useState('catalog');
  const [orders, setOrders] = useState([]);
  const [currentUser, setCurrentUser] = useState(user);

  function handleOrderPlaced(order) {
    setOrders((prev) => [...prev, order]);
  }

  function handlePhotoUpdated(photoUrl) {
    setCurrentUser((prev) => ({ ...prev, photoUrl }));
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <h1>Order Pipeline</h1>
            <p>Event-sourced order pipeline</p>
          </div>
        </div>
        <button className="logout-btn" onClick={onLogout}>Log out</button>
      </header>

      <nav className="tabs">
        <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>Catalog</button>
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
          My Orders {orders.length > 0 && <span className="badge">{orders.length}</span>}
        </button>
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>Profile</button>
      </nav>

      <main className="content">
        {tab === 'catalog' && <CatalogTab token={token} onOrderPlaced={handleOrderPlaced} />}
        {tab === 'orders' && <MyOrdersTab orders={orders} token={token} />}
        {tab === 'profile' && <ProfileTab user={currentUser} token={token} onPhotoUpdated={handlePhotoUpdated} />}
      </main>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) { setChecking(false); return; }
    fetch(`${AUTH_API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data) => setUser({ id: data.id, username: data.username, photoUrl: data.photo_url }))
      .catch(() => { localStorage.removeItem('token'); setToken(null); })
      .finally(() => setChecking(false));
  }, [token]);

  function handleAuthed(newToken, newUser) {
    setToken(newToken);
    setUser(newUser);
  }

  function handleLogout() {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }

  if (checking) return null;
  if (!token || !user) return <AuthScreen onAuthed={handleAuthed} />;
  return <MainApp token={token} user={user} onLogout={handleLogout} />;
}

export default App;

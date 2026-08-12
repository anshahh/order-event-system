import './App.css';
import { useState, useEffect } from 'react';

const AUTH_API = import.meta.env.VITE_AUTH_API || 'http://localhost:8004';
const ORDER_API = import.meta.env.VITE_ORDER_API || 'http://localhost:8000';
const SUPPORT_API = import.meta.env.VITE_SUPPORT_API || 'http://localhost:8007';

function AdminLogin({ onAuthed }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${AUTH_API}/auth/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      localStorage.setItem('adminToken', data.token);
      onAuthed(data.token);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <h1>Admin Console</h1>
            <p>Operations & analytics</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="order-form">
          <input placeholder="Admin username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit">Log in</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function BarRow({ label, value, max, color, prefix = '' }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="bar-value">{prefix}{value}</span>
    </div>
  );
}

function EditProductModal({ product, token, onClose, onSaved }) {
  const [price, setPrice] = useState(product.price);
  const [imagePreview, setImagePreview] = useState(product.image_url || null);
  const [saving, setSaving] = useState(false);

  function handleImageChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    try {
      await fetch(`${ORDER_API}/admin/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ price: Number(price), imageUrl: imagePreview }),
      });
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>{product.name}</h2>
        <div className="profile-row" style={{ marginTop: 12 }}>
          {imagePreview ? (
            <img src={imagePreview} alt={product.name} className="avatar" style={{ borderRadius: 8 }} />
          ) : (
            <div className="avatar-placeholder" style={{ borderRadius: 8 }}>{product.name[0]}</div>
          )}
          <label className="upload-label">
            Change photo
            <input type="file" accept="image/*" onChange={handleImageChange} hidden />
          </label>
        </div>
        <div className="order-form" style={{ marginTop: 16 }}>
          <label className="panel-subtitle">Price ($)</label>
          <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="order-actions" style={{ marginTop: 16 }}>
          <button className="link-button" onClick={onClose}>Cancel</button>
          <button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const CHART_COLORS = ['#7A2E22', '#A8503D', '#C97B63', '#E3A896', '#F4E9E6'];

function AdminChat({ token }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setLoading(true);
    try {
      const res = await fetch(`${SUPPORT_API}/api/admin/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Something went wrong');
      setMessages((m) => [...m, { role: 'assistant', text: data.answer }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: 'Sorry, analytics assistant is unavailable right now.', error: true }]);
    }
    setLoading(false);
  }

  return (
    <>
      <button className="support-fab" onClick={() => setOpen(!open)} aria-label="Analytics assistant">
        {open ? 'Close' : 'Ask Analytics'}
      </button>
      {open && (
        <div className="support-panel">
          <div className="support-header">Analytics Assistant</div>
          <div className="support-messages">
            {messages.length === 0 && (
              <div className="support-empty">Ask about revenue, top products, stock, or which products are commonly co-purchased.</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`support-msg ${m.role}${m.error ? ' error' : ''}`}>{m.text}</div>
            ))}
            {loading && <div className="support-msg assistant">...</div>}
          </div>
          <div className="support-input-row">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="e.g. what are our top products?"
            />
            <button onClick={send} disabled={loading}>Send</button>
          </div>
        </div>
      )}
    </>
  );
}

function AdminDashboard({ token, onLogout }) {
  const [data, setData] = useState(null);
  const [products, setProducts] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);

  async function loadAnalytics() {
    const res = await fetch(`${ORDER_API}/admin/analytics`, { headers: { Authorization: `Bearer ${token}` } });
    setData(await res.json());
  }

  async function loadProducts() {
    const res = await fetch(`${ORDER_API}/products`);
    setProducts(await res.json());
  }

  useEffect(() => {
    loadAnalytics();
    loadProducts();
    const interval = setInterval(loadAnalytics, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return <div className="panel"><p className="empty-state">Loading analytics...</p></div>;

  const maxDailyRevenue = Math.max(...data.dailySales.map((d) => Number(d.revenue)), 1);
  const maxUnitsSold = Math.max(...data.topProducts.map((p) => Number(p.units_sold)), 1);
  const maxStock = Math.max(...data.stockLevels.map((s) => Number(s.stock)), 1);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <h1>Admin Console</h1>
            <p>Live operations & analytics</p>
          </div>
        </div>
        <button className="logout-btn" onClick={onLogout}>Log out</button>
      </header>

      <main className="content">
        <div className="funnel-grid" style={{ marginBottom: 20 }}>
          <div className="funnel-card">
            <span className="funnel-count" style={{ color: '#2E9E6B' }}>${Number(data.totalRevenue).toFixed(0)}</span>
            <span className="funnel-label">Total revenue</span>
          </div>
          <div className="funnel-card">
            <span className="funnel-count" style={{ color: '#7A2E22' }}>{data.totalOrders}</span>
            <span className="funnel-label">Total orders</span>
          </div>
          {data.statusBreakdown.filter((s) => s.status !== 'PAYMENT_FAILED').map((s) => (
            <div className="funnel-card" key={s.status}>
              <span className="funnel-count" style={{ color: '#A8503D' }}>{s.count}</span>
              <span className="funnel-label">{s.status.replaceAll('_', ' ')}</span>
            </div>
          ))}
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <h2>Revenue trend (last 14 days)</h2>
          <div style={{ marginTop: 14, height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[...data.dailySales].reverse()}>
                <XAxis
                  dataKey="day"
                  tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  tick={{ fontSize: 11, fill: '#746E68' }}
                  axisLine={{ stroke: '#E3E1DE' }}
                />
                <YAxis tick={{ fontSize: 11, fill: '#746E68' }} axisLine={{ stroke: '#E3E1DE' }} />
                <Tooltip
                  formatter={(value) => [`${Number(value).toFixed(0)}`, 'Revenue']}
                  labelFormatter={(d) => new Date(d).toLocaleDateString()}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E3E1DE' }}
                />
                <Line type="monotone" dataKey="revenue" stroke="#7A2E22" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <h2>Daily sales (last 14 days)</h2>
          <div style={{ marginTop: 14 }}>
            {data.dailySales.map((d) => (
              <BarRow key={d.day} label={new Date(d.day).toLocaleDateString()} value={Number(d.revenue).toFixed(0)} max={maxDailyRevenue} color="#7A2E22" prefix="$" />
            ))}
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <h2>Top products</h2>
          <div style={{ marginTop: 14 }}>
            {data.topProducts.filter((p) => p.product_name).map((p) => (
              <BarRow key={p.product_name} label={p.product_name} value={p.units_sold} max={maxUnitsSold} color="#22c55e" />
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Inventory management</h2>
          <div style={{ marginTop: 14 }}>
            {products.map((p) => (
              <div key={p.id} className="admin-product-row">
                <BarRow label={p.name} value={p.stock} max={maxStock} color={p.stock < 5 ? '#C0392B' : '#7A2E22'} />
                <button className="link-button" onClick={() => setEditingProduct(p)}>Edit</button>
              </div>
            ))}
          </div>
        </div>
      </main>

      {editingProduct && (
        <EditProductModal
          product={editingProduct}
          token={token}
          onClose={() => setEditingProduct(null)}
          onSaved={loadProducts}
        />
      )}
      <AdminChat token={token} />
    </div>
  );
}

function AdminApp() {
  const [token, setToken] = useState(localStorage.getItem('adminToken'));

  function handleLogout() {
    localStorage.removeItem('adminToken');
    setToken(null);
  }

  if (!token) return <AdminLogin onAuthed={setToken} />;
  return <AdminDashboard token={token} onLogout={handleLogout} />;
}

export default AdminApp;

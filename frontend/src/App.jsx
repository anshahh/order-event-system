import { useState, useEffect, useRef } from 'react';
import './App.css';

// const ORDER_API = 'http://localhost:8000';
// const PROJECTION_API = 'http://localhost:8003';
const ORDER_API = 'http://15.134.80.73:30000';
const PROJECTION_API = 'http://15.134.80.73:30003';

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
};

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

function OrderTimeline({ orderState }) {
  const currentStepIndex = orderState
    ? STATUS_STEPS.findIndex((s) => s.key === orderState.status)
    : -1;

  return (
    <div className="timeline">
      {STATUS_STEPS.map((step, index) => {
        const isFailed = orderState?.status === 'PAYMENT_FAILED' && index === 1;
        const isActive = index <= currentStepIndex;

        return (
          <div key={step.key} className={`timeline-step ${isActive ? 'active' : ''} ${isFailed ? 'failed' : ''}`}>
            <div className="dot" />
            <span>{isFailed ? 'Payment Failed' : step.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function OrderCard({ order }) {
  const [orderState, setOrderState] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

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

  return (
    <div className="order-card">
      <div className="order-card-header">
        <div>
          <p className="order-items">{order.items.join(', ')}</p>
          <p className="order-id">{order.orderId}</p>
        </div>
        <StatusPill status={orderState?.status} />
      </div>

      <OrderTimeline orderState={orderState} />

      {orderState?.tracking_number && (
        <p className="tracking">
          Tracking: <strong>{orderState.tracking_number}</strong>
        </p>
      )}

      <button className="link-button" onClick={toggleHistory}>
        {showHistory ? 'Hide' : 'View'} event history
      </button>

      {showHistory && (
        <ul className="history-list">
          {history.map((event, i) => (
            <li key={i}>
              <strong>{event.event_type}</strong>
              <span className="timestamp">{new Date(event.created_at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlaceOrderTab({ onOrderPlaced }) {
  const [items, setItems] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!items.trim() || !totalAmount) {
      setError('Please enter items and a total amount.');
      return;
    }

    setSubmitting(true);
    try {
      const parsedItems = items.split(',').map((i) => i.trim()).filter(Boolean);
      const res = await fetch(`${ORDER_API}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'demo-user',
          items: parsedItems,
          totalAmount: Number(totalAmount),
        }),
      });

      if (!res.ok) throw new Error('Failed to create order');

      const data = await res.json();
      onOrderPlaced({ orderId: data.orderId, items: parsedItems, totalAmount: Number(totalAmount) });
      setItems('');
      setTotalAmount('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="panel">
      <h2>Place a New Order</h2>
      <p className="panel-subtitle">Submits an OrderCreated event into the pipeline.</p>
      <form onSubmit={handleSubmit} className="order-form">
        <input
          type="text"
          placeholder="Items (comma separated, e.g. laptop, mouse)"
          value={items}
          onChange={(e) => setItems(e.target.value)}
        />
        <input
          type="number"
          placeholder="Total amount ($)"
          value={totalAmount}
          onChange={(e) => setTotalAmount(e.target.value)}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Placing order...' : 'Place Order'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function MyOrdersTab({ orders }) {
  if (orders.length === 0) {
    return (
      <div className="panel">
        <p className="empty-state">No orders placed yet this session. Head to "Place Order" to create one.</p>
      </div>
    );
  }

  return (
    <div className="order-list">
      {orders.slice().reverse().map((order) => (
        <OrderCard key={order.orderId} order={order} />
      ))}
    </div>
  );
}

function AdminDashboardTab() {
  const [summary, setSummary] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  async function fetchSummary() {
    try {
      const res = await fetch(`${PROJECTION_API}/orders-summary`);
      const data = await res.json();
      setSummary(data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
    }
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
      <div className="dashboard-header">
        <h2>Operations Dashboard</h2>
        {lastUpdated && (
          <span className="live-indicator">
            <span className="pulse-dot" /> Live · updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>
      <p className="panel-subtitle">Derived from the projection service's read model. Refreshes every 3s.</p>

      <div className="funnel-grid">
        {STATUS_STEPS.map((step) => (
          <div key={step.key} className="funnel-card">
            <span className="funnel-count" style={{ color: STATUS_COLORS[step.key] }}>
              {countFor(step.key)}
            </span>
            <span className="funnel-label">{step.label}</span>
          </div>
        ))}
        <div className="funnel-card">
          <span className="funnel-count" style={{ color: STATUS_COLORS.PAYMENT_FAILED }}>
            {countFor('PAYMENT_FAILED')}
          </span>
          <span className="funnel-label">Payment Failed</span>
        </div>
      </div>

      <p className="total-orders">Total orders tracked: <strong>{total}</strong></p>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState('place');
  const [orders, setOrders] = useState([]);

  function handleOrderPlaced(order) {
    setOrders((prev) => [...prev, order]);
    setTab('orders');
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <h1>Order Pipeline</h1>
            <p>Event-sourced microservices demo · RabbitMQ · CQRS</p>
          </div>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'place' ? 'active' : ''} onClick={() => setTab('place')}>
          Place Order
        </button>
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
          My Orders {orders.length > 0 && <span className="badge">{orders.length}</span>}
        </button>
        <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>
          Admin Dashboard
        </button>
      </nav>

      <main className="content">
        {tab === 'place' && <PlaceOrderTab onOrderPlaced={handleOrderPlaced} />}
        {tab === 'orders' && <MyOrdersTab orders={orders} />}
        {tab === 'admin' && <AdminDashboardTab />}
      </main>
    </div>
  );
}

export default App;

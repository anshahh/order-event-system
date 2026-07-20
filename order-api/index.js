require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
const amqp = require('amqplib');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

let channel;

async function connectQueue() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  channel = await connection.createChannel();
  await channel.assertExchange('order_events', 'topic', { durable: true });
  console.log('Connected to RabbitMQ');
}

async function publishEvent(eventType, orderId, payload) {
  const message = { orderId, eventType, payload, timestamp: new Date().toISOString() };
  channel.publish(
    'order_events',
    eventType,
    Buffer.from(JSON.stringify(message)),
    { persistent: true }
  );
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/orders', requireAuth, async (req, res) => {
  const { productId, quantity } = req.body;
  const userId = req.userId;

  if (!productId || !quantity) {
    return res.status(400).json({ error: 'productId and quantity are required' });
  }

  const client = await pool.connect();

  try {
    const productResult = await client.query('SELECT * FROM products WHERE id = $1', [productId]);
    if (productResult.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Product not found' });
    }
    const product = productResult.rows[0];

    // Atomic, race-condition-safe stock reservation.
    // The WHERE clause and the decrement happen as ONE indivisible operation in Postgres -
    // if two requests hit this at the same instant for the last item, only one will
    // match the WHERE condition and return a row. The other gets 0 rows back.
    const reserveResult = await client.query(
      `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING stock`,
      [quantity, productId]
    );

    if (reserveResult.rows.length === 0) {
      client.release();
      return res.status(409).json({ error: 'OutOfStock', message: `Not enough stock for ${product.name}` });
    }

    const totalAmount = product.price * quantity;
    const orderId = crypto.randomUUID();
    const payload = { userId, productId, productName: product.name, quantity, totalAmount };

    await client.query(
      `INSERT INTO events (order_id, event_type, payload) VALUES ($1, $2, $3)`,
      [orderId, 'OrderCreated', payload]
    );

    client.release();

    await publishEvent('OrderCreated', orderId, payload);

    res.status(201).json({ orderId, status: 'OrderCreated', remainingStock: reserveResult.rows[0].stock });
  } catch (err) {
    client.release();
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.get('/my-orders', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (order_id) order_id, payload, created_at
       FROM events
       WHERE event_type = 'OrderCreated' AND payload->>'userId' = $1
       ORDER BY order_id, created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch order history' });
  }
});

app.get('/orders/:id/history', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT event_type, payload, created_at FROM events WHERE order_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});


app.post('/orders/:id/cancel', requireAuth, async (req, res) => {
  const orderId = req.params.id;

  try {
    const stateResult = await pool.query('SELECT * FROM order_state WHERE order_id = $1', [orderId]);
    if (stateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = stateResult.rows[0];

    if (order.user_id && order.user_id !== req.userId) {
      return res.status(403).json({ error: 'Not your order' });
    }

    if (['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(order.status)) {
      return res.status(409).json({ error: `Cannot cancel an order that is already ${order.status.toLowerCase()}` });
    }

    const historyResult = await pool.query(
      `SELECT payload FROM events WHERE order_id = $1 AND event_type = 'OrderCreated'`,
      [orderId]
    );
    const originalPayload = historyResult.rows[0]?.payload;
    const wasPaid = order.status === 'PAYMENT_CONFIRMED';

    await pool.query(
      `INSERT INTO events (order_id, event_type, payload) VALUES ($1, $2, $3)`,
      [orderId, 'OrderCancelled', { reason: 'User requested cancellation' }]
    );
    await publishEvent('OrderCancelled', orderId, { reason: 'User requested cancellation' });

    if (originalPayload?.productId && originalPayload?.quantity) {
      await pool.query(
        'UPDATE products SET stock = stock + $1 WHERE id = $2',
        [originalPayload.quantity, originalPayload.productId]
      );
    }

    if (wasPaid) {
      const refundPayload = { amount: originalPayload?.totalAmount || 0 };
      await pool.query(
        `INSERT INTO events (order_id, event_type, payload) VALUES ($1, $2, $3)`,
        [orderId, 'RefundIssued', refundPayload]
      );
      await publishEvent('RefundIssued', orderId, refundPayload);
    }

    res.json({ orderId, status: 'OrderCancelled', refunded: wasPaid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});


// Lightweight recommendation: products frequently bought alongside this one.
// This is a co-occurrence query over order history, not a trained ML model -
// it counts how often each other product appears in orders from users who
// also bought the given product, ranked by frequency.
app.get('/products/:id/recommendations', async (req, res) => {
  const productId = parseInt(req.params.id);

  try {
    const result = await pool.query(
      `
      WITH buyers AS (
        SELECT DISTINCT (payload->>'userId')::text AS user_id
        FROM events
        WHERE event_type = 'OrderCreated' AND (payload->>'productId')::int = $1
      ),
      co_purchases AS (
        SELECT (e.payload->>'productId')::int AS product_id, COUNT(*) AS times_bought
        FROM events e
        JOIN buyers b ON (e.payload->>'userId')::text = b.user_id
        WHERE e.event_type = 'OrderCreated'
          AND (e.payload->>'productId')::int != $1
        GROUP BY (e.payload->>'productId')::int
        ORDER BY times_bought DESC
        LIMIT 3
      )
      SELECT p.id, p.name, p.price, p.stock, c.times_bought
      FROM co_purchases c
      JOIN products p ON p.id = c.product_id
      ORDER BY c.times_bought DESC
      `,
      [productId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});


function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Admin: update a product's price and/or image
app.patch('/admin/products/:id', requireAdmin, async (req, res) => {
  const { price, imageUrl } = req.body;
  try {
    const result = await pool.query(
      `UPDATE products SET price = COALESCE($1, price), image_url = COALESCE($2, image_url) WHERE id = $3 RETURNING *`,
      [price, imageUrl, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Admin: analytics dashboard data
app.get('/admin/analytics', requireAdmin, async (req, res) => {
  try {
    const revenueResult = await pool.query(
      `SELECT COALESCE(SUM((payload->>'totalAmount')::numeric), 0) AS total_revenue,
              COUNT(*) AS total_orders
       FROM events WHERE event_type = 'OrderCreated'`
    );

    const dailySalesResult = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS orders, SUM((payload->>'totalAmount')::numeric) AS revenue
       FROM events WHERE event_type = 'OrderCreated'
       GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 14`
    );

    const topProductsResult = await pool.query(
      `SELECT payload->>'productName' AS product_name, COUNT(*) AS units_sold,
              SUM((payload->>'totalAmount')::numeric) AS revenue
       FROM events WHERE event_type = 'OrderCreated'
       GROUP BY payload->>'productName' ORDER BY units_sold DESC LIMIT 5`
    );

    const stockResult = await pool.query('SELECT id, name, stock, price FROM products ORDER BY stock ASC');

    const statusBreakdownResult = await pool.query(
      `SELECT status, COUNT(*) as count FROM order_state GROUP BY status`
    );

    res.json({
      totalRevenue: revenueResult.rows[0].total_revenue,
      totalOrders: revenueResult.rows[0].total_orders,
      dailySales: dailySalesResult.rows,
      topProducts: topProductsResult.rows,
      stockLevels: stockResult.rows,
      statusBreakdown: statusBreakdownResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

const PORT = process.env.PORT || 8000;

connectQueue().then(() => {
  app.listen(PORT, () => console.log(`Order API running on port ${PORT}`));
});

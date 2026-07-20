require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const amqp = require('amqplib');

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
// Track active SSE connections per orderId
const sseClients = new Map(); // orderId -> [res, res, ...]
async function connectQueue() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange('order_events', 'topic', { durable: true });

  const q = await channel.assertQueue('projection_service_queue', { durable: true });

  // '#' = wildcard, matches ALL event types on this exchange
  await channel.bindQueue(q.queue, 'order_events', '#');

  console.log('Connected to RabbitMQ, listening for ALL events');

  channel.consume(q.queue, async (msg) => {
    if (msg !== null) {
      const event = JSON.parse(msg.content.toString());
      await applyEvent(event);
      channel.ack(msg);
    }
  });
}

async function applyEvent(event) {
  const { orderId, eventType, payload } = event;
  console.log(`Projecting ${eventType} for order ${orderId}`);

  switch (eventType) {
    case 'OrderCreated':
      await pool.query(
        `INSERT INTO order_state (order_id, status, user_id, items, total_amount)
         VALUES ($1, 'PENDING_PAYMENT', $2, $3, $4)
         ON CONFLICT (order_id) DO NOTHING`,
        [orderId, payload.userId, JSON.stringify(payload.items), payload.totalAmount]
      );
      break;

    case 'PaymentConfirmed':
      await pool.query(
        `UPDATE order_state SET status = 'PAYMENT_CONFIRMED', updated_at = NOW() WHERE order_id = $1`,
        [orderId]
      );
      break;

    case 'PaymentFailed':
      await pool.query(
        `UPDATE order_state SET status = 'PAYMENT_FAILED', updated_at = NOW() WHERE order_id = $1`,
        [orderId]
      );
      break;

    case 'OrderShipped':
      await pool.query(
        `UPDATE order_state SET status = 'SHIPPED', tracking_number = $2, updated_at = NOW() WHERE order_id = $1`,
        [orderId, payload.trackingNumber]
      );
      break;

    case 'OrderDelivered':
      await pool.query(
        `UPDATE order_state SET status = 'DELIVERED', updated_at = NOW() WHERE order_id = $1`,
        [orderId]
      );
      break;

    case 'OrderCancelled':
      await pool.query(
        `UPDATE order_state SET status = 'CANCELLED', updated_at = NOW() WHERE order_id = $1`,
        [orderId]
      );
      break;

    case 'RefundIssued':
      await pool.query(
        `UPDATE order_state SET status = 'REFUNDED', updated_at = NOW() WHERE order_id = $1`,
        [orderId]
      );
      break;

    default:
      console.log(`Unhandled event type: ${eventType}`);
  }
  const result = await pool.query(`SELECT * FROM order_state WHERE order_id = $1`, [orderId]);
  if (result.rows.length > 0) {
    const clients = sseClients.get(orderId) || [];
    clients.forEach((res) => {
      res.write(`data: ${JSON.stringify(result.rows[0])}\n\n`);
    });
  }

}
app.get('/orders/:id/stream', (req, res) => {
  const orderId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current state immediately on connect
  pool.query(`SELECT * FROM order_state WHERE order_id = $1`, [orderId])
    .then((result) => {
      if (result.rows.length > 0) {
        res.write(`data: ${JSON.stringify(result.rows[0])}\n\n`);
      }
    });

  // Register this client to receive future updates
  if (!sseClients.has(orderId)) {
    sseClients.set(orderId, []);
  }
  sseClients.get(orderId).push(res);

  // Clean up when the client disconnects
  req.on('close', () => {
    const clients = sseClients.get(orderId) || [];
    sseClients.set(orderId, clients.filter((c) => c !== res));
  });
});
// Current state of one order - instant lookup, no replaying needed
app.get('/orders/:id', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM order_state WHERE order_id = $1`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch order state' });
  }
});

// Bonus: funnel view - count of orders per status (nice for a dashboard later)
app.get('/orders-summary', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT status, COUNT(*) as count FROM order_state GROUP BY status`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 8003;

connectQueue().then(() => {
  app.listen(PORT, () => console.log(`Projection Service running on port ${PORT}`));
});

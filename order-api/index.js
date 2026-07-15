require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
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
    eventType,               // routing key e.g. "OrderCreated"
    Buffer.from(JSON.stringify(message)),
    { persistent: true }
  );
}
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/orders', async (req, res) => {
  const { userId, items, totalAmount } = req.body;

  if (!userId || !items || !totalAmount) {
    return res.status(400).json({ error: 'userId, items, and totalAmount are required' });
  }

  const orderId = crypto.randomUUID();
  const payload = { userId, items, totalAmount };

  try {
    await pool.query(
      `INSERT INTO events (order_id, event_type, payload) VALUES ($1, $2, $3)`,
      [orderId, 'OrderCreated', payload]
    );

    await publishEvent('OrderCreated', orderId, payload);

    res.status(201).json({ orderId, status: 'OrderCreated' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
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

const PORT = process.env.PORT || 8000;


connectQueue().then(() => {
  app.listen(PORT, () => console.log(`Order API running on port ${PORT}`));
});

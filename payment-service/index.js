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

let channel;

async function connectQueue() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  channel = await connection.createChannel();

  await channel.assertExchange('order_events', 'topic', { durable: true });

  // This service's own queue - only it consumes from here
  const q = await channel.assertQueue('payment_service_queue', { durable: true });

  // Bind the queue to the exchange, only interested in OrderCreated events
  await channel.bindQueue(q.queue, 'order_events', 'OrderCreated');

  console.log('Connected to RabbitMQ, listening for OrderCreated events');

  channel.consume(q.queue, async (msg) => {
    if (msg !== null) {
      const event = JSON.parse(msg.content.toString());
      await handleOrderCreated(event);
      channel.ack(msg); // confirm message was processed successfully
    }
  });
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

async function handleOrderCreated(event) {
  const { orderId, payload } = event;
  console.log(`Processing payment for order ${orderId}...`);

  // Simulate a payment gateway - 80% success rate
  const isSuccess = Math.random() < 0.8;

  // Simulate network/processing delay
  await new Promise((resolve) => setTimeout(resolve, 1500));

  if (isSuccess) {
    const transactionId = 'txn_' + Math.random().toString(36).substring(2, 12);
    const eventPayload = { transactionId, amount: payload.totalAmount };

    await pool.query(
      `INSERT INTO events (order_id, event_type, payload) VALUES ($1, $2, $3)`,
      [orderId, 'PaymentConfirmed', eventPayload]
    );
    await publishEvent('PaymentConfirmed', orderId, eventPayload);
    console.log(`Payment confirmed for order ${orderId}`);
  } else {
    const eventPayload = { reason: 'Card declined' };

    await pool.query(
      `INSERT INTO events (order_id, event_type, payload) VALUES ($1, $2, $3)`,
      [orderId, 'PaymentFailed', eventPayload]
    );
    await publishEvent('PaymentFailed', orderId, eventPayload);
    console.log(`Payment failed for order ${orderId}`);
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 8001;

connectQueue().then(() => {
  app.listen(PORT, () => console.log(`Payment Service running on port ${PORT}`));
});

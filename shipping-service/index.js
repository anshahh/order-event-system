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

  const q = await channel.assertQueue('shipping_service_queue', { durable: true });
  await channel.bindQueue(q.queue, 'order_events', 'PaymentConfirmed');

  console.log('Connected to RabbitMQ, listening for PaymentConfirmed events');

  channel.consume(q.queue, async (msg) => {
    if (msg !== null) {
      const event = JSON.parse(msg.content.toString());
      await handlePaymentConfirmed(event);
      channel.ack(msg);
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

async function handlePaymentConfirmed(event) {
  const { orderId } = event;
  console.log(`Preparing shipment for order ${orderId}...`);

  // Simulate warehouse/dispatch delay
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const trackingNumber = 'TRK' + Math.random().toString(36).substring(2, 10).toUpperCase();
  const shippedPayload = { trackingNumber };

  await pool.query(
    `INSERT INTO events (order_id, event_type, payload) VALUES ($1, $2, $3)`,
    [orderId, 'OrderShipped', shippedPayload]
  );
  await publishEvent('OrderShipped', orderId, shippedPayload);
  console.log(`Order ${orderId} shipped - tracking: ${trackingNumber}`);

  // Simulate transit time before delivery
  await new Promise((resolve) => setTimeout(resolve, 3000));

  await pool.query(
    `INSERT INTO events (order_id, event_type, payload) VALUES ($1, $2, $3)`,
    [orderId, 'OrderDelivered', {}]
  );
  await publishEvent('OrderDelivered', orderId, {});
  console.log(`Order ${orderId} delivered`);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 8002;

connectQueue().then(() => {
  app.listen(PORT, () => console.log(`Shipping Service running on port ${PORT}`));
});

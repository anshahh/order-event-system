# Event-Sourced Order Processing System

A cloud-native e-commerce order platform built around event sourcing and CQRS, deployed as a set of independently running microservices on a self-managed Kubernetes cluster (AWS EC2 + k3s), with full CI/CD, GitOps deployment, and live observability.

Live demo: http://15.134.80.73:30080 (user app) and http://15.134.80.73:30080/admin (admin console)

## Why this project

Most portfolio projects deploy a CRUD app to a container and call it done. This one is built around a genuinely harder problem: instead of storing current state and overwriting it, every action in the system (order placed, payment processed, shipped, delivered, cancelled) is recorded as an immutable event. The current state of any order is derived by replaying its events, the same pattern used in banking and real e-commerce platforms at scale. On top of that, the whole system is containerized, deployed to a real Kubernetes cluster, automatically built and scanned via CI/CD, deployed via GitOps with ArgoCD, and monitored with Prometheus and Grafana, covering the full lifecycle of a production service rather than just a script that happens to run in a container.

## Architecture

The frontend (React) talks to an Auth Service for JWT-based signup and login, and to an Order API for placing orders. The Order API writes an OrderCreated event into an append-only events table in Postgres and publishes that event to RabbitMQ. A Payment Service consumes OrderCreated and emits PaymentConfirmed or PaymentFailed. A Shipping Service consumes PaymentConfirmed and emits OrderShipped followed by OrderDelivered. A Projection Service consumes every event type, maintains a derived read-model table for fast queries, and pushes live status updates to the frontend over Server-Sent Events.

The event flow for a single order is: OrderCreated, then PaymentConfirmed or PaymentFailed, then OrderShipped, then OrderDelivered. If an order is cancelled, the flow instead becomes OrderCreated, then OrderCancelled, plus a RefundIssued event if payment had already succeeded.

## Core architectural concepts

Event sourcing: the events table is the single source of truth. Nothing is ever updated or deleted; every state change is a new, permanent row. This gives a full audit trail, and any read model can be rebuilt from scratch by replaying history.

CQRS: writes go through the event log, while reads go through a separately maintained order_state table kept up to date by the Projection Service as it consumes every event. Each side is optimized independently for its very different job.

Async pub/sub messaging: services never call each other directly. The Order API publishes an event and moves on; the Payment, Shipping, and Projection services independently subscribe to just the events relevant to them via RabbitMQ topic routing keys. No service needs to know any other service exists.

Compensating transactions: cancellations do not delete history. They append an OrderCancelled event, and a RefundIssued event if payment had already succeeded, plus atomically restock inventory. You cannot undo an event in this architecture, only record a reversal.

Race-condition-safe inventory: stock reservation uses a single atomic SQL statement, UPDATE products SET stock = stock - N WHERE stock >= N, guaranteeing that two simultaneous requests for the last unit of stock cannot both succeed. This was verified directly under real concurrent load, not just assumed.

## Features

Customer-facing features include signup and login with JWT-based auth, a product catalog with live stock levels, a product detail view with quantity capped at available stock, live order tracking via Server-Sent Events with no polling, order cancellation with automatic refund handling where applicable, frequently-bought-together recommendations built from a co-occurrence SQL query over order history rather than a trained model, and a profile page with persistent photo upload.

The admin console, reachable through a separate login at /admin, shows total revenue, order volume, and a daily sales trend, top-selling products, live inventory levels with in-place price and photo editing, and an order status funnel.

## Infrastructure and DevOps

Containerization is handled with Docker using multi-stage builds and explicit linux/amd64 cross-platform builds. Orchestration runs on Kubernetes (k3s) on a self-managed AWS EC2 instance. Continuous integration is handled by GitHub Actions, which builds each service, scans it with Trivy for vulnerabilities, and pushes the image to Docker Hub on every commit. Continuous deployment is handled by ArgoCD, which keeps the live cluster state automatically synced to what is committed in Git. Monitoring is provided by Prometheus and Grafana with live per-service CPU and memory dashboards. Networking uses Kubernetes NodePort services behind an AWS Elastic IP for a stable public address. Data is stored in PostgreSQL, backed by a PersistentVolumeClaim so it survives pod restarts, and messaging runs through RabbitMQ using a durable topic exchange with persistent messages.

Resilience was demonstrated directly rather than just claimed: killing the Shipping Service pod mid-transaction was tested live. Kubernetes recreated the pod automatically, RabbitMQ held the in-flight message safely in its queue, and the affected order completed correctly with zero data loss once the new pod came back online.

## Tech stack

The backend is Node.js with Express, split across five services: order-api, auth-service, payment-service, shipping-service, and projection-service. The frontend is React built with Vite, using plain CSS and Server-Sent Events for live updates. The database is PostgreSQL, and the message broker is RabbitMQ. The infrastructure layer includes Docker, Kubernetes via k3s, AWS EC2, GitHub Actions, ArgoCD, Prometheus, and Grafana.

## Repository structure

The auth-service folder contains signup, login, JWT handling, and profile photo storage. The order-api folder contains order creation, the product catalog, inventory reservation, and cancellation logic. The payment-service folder consumes OrderCreated events and emits PaymentConfirmed. The shipping-service folder consumes PaymentConfirmed events and emits OrderShipped and OrderDelivered. The projection-service folder maintains the read model, serves Server-Sent Events, and powers the analytics queries. The frontend folder contains the customer-facing React app and the separate admin console. The k8s folder contains all Kubernetes manifests, and docker-compose.yml defines the local development environment. The .github/workflows folder contains the CI pipeline definition.

## Running locally

Start Postgres and RabbitMQ with docker compose up -d, then in separate terminals run npm install and npm run dev inside auth-service, order-api, payment-service, shipping-service, projection-service, and finally frontend.

## Known simplifications

These were deliberate choices given the scope of the project rather than oversights. The JWT secret is a static string rather than something pulled from a secrets manager like Vault, which would be the natural next step for a real production system. The frequently-bought-together feature is an honest SQL co-occurrence query rather than a trained recommendation model, chosen specifically to keep the project's depth focused on distributed systems and infrastructure rather than an unrelated machine learning detour. Profile photos are stored as base64 text directly in Postgres for simplicity rather than in an object store such as S3 or MinIO.

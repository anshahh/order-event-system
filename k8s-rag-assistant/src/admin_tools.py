"""
admin_tools.py — Tools for the admin-facing analytics assistant.

Unlike the buyer assistant, this has no per-user scoping — admins can see
store-wide data. Two tools:
  1. get_sales_analytics — revenue, daily sales, top products, stock levels
  2. get_co_purchased_products — which products tend to be bought by the
     same customers across their separate orders (real co-purchase signal,
     NOT same-cart "bought together", since this schema is one product per order)
"""

from order_data import get_connection


def get_sales_analytics() -> dict:
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT COALESCE(SUM((payload->>'totalAmount')::numeric), 0) AS total_revenue,
               COUNT(*) AS total_orders
        FROM events WHERE event_type = 'OrderCreated'
    """)
    revenue_row = cur.fetchone()

    cur.execute("""
        SELECT payload->>'productName' AS product_name, COUNT(*) AS units_sold,
               SUM((payload->>'totalAmount')::numeric) AS revenue
        FROM events WHERE event_type = 'OrderCreated'
        GROUP BY payload->>'productName' ORDER BY units_sold DESC LIMIT 5
    """)
    top_products = cur.fetchall()

    cur.execute("SELECT name, stock FROM products ORDER BY stock ASC")
    stock_levels = cur.fetchall()

    cur.execute("SELECT status, COUNT(*) as count FROM order_state GROUP BY status")
    status_breakdown = cur.fetchall()

    conn.close()

    return {
        "total_revenue": float(revenue_row[0]),
        "total_orders": revenue_row[1],
        "top_products": [{"name": r[0], "units_sold": r[1], "revenue": float(r[2])} for r in top_products],
        "stock_levels": [{"name": r[0], "stock": r[1]} for r in stock_levels],
        "status_breakdown": [{"status": r[0], "count": r[1]} for r in status_breakdown],
    }


def get_co_purchased_products(product_name: str) -> dict:
    """
    Finds products that customers who bought `product_name` ALSO bought in a
    separate order. This is cross-order co-purchase, not same-cart bundling
    (the schema doesn't support multi-item carts).
    """
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        WITH buyers AS (
            SELECT DISTINCT payload->>'userId' AS user_id
            FROM events
            WHERE event_type = 'OrderCreated' AND payload->>'productName' ILIKE %s
        )
        SELECT e.payload->>'productName' AS product_name, COUNT(DISTINCT e.payload->>'userId') AS co_buyers
        FROM events e
        JOIN buyers b ON e.payload->>'userId' = b.user_id
        WHERE e.event_type = 'OrderCreated'
          AND e.payload->>'productName' NOT ILIKE %s
        GROUP BY e.payload->>'productName'
        ORDER BY co_buyers DESC
        LIMIT 5
    """, (f"%{product_name}%", f"%{product_name}%"))

    rows = cur.fetchall()
    conn.close()

    if not rows:
        return {"found": False, "message": f"No co-purchase data found for '{product_name}'."}

    return {
        "found": True,
        "base_product": product_name,
        "note": "Based on customers who bought this in one order and something else in a separate order (not same-cart bundling).",
        "co_purchased": [{"product_name": r[0], "customers_who_also_bought": r[1]} for r in rows],
    }


ADMIN_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_sales_analytics",
            "description": "Get store-wide sales analytics: total revenue, total orders, top 5 products, stock levels, and order status breakdown.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_co_purchased_products",
            "description": "Find which products customers who bought a given product also purchased in separate orders — useful for cross-sell insights.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_name": {"type": "string", "description": "The product to find co-purchase patterns for"},
                },
                "required": ["product_name"],
            },
        },
    },
]

ADMIN_TOOL_FUNCTIONS = {
    "get_sales_analytics": get_sales_analytics,
    "get_co_purchased_products": get_co_purchased_products,
}

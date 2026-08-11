import json
from order_data import get_connection


def get_order_status(order_id: str, require_username: str = None) -> dict:
    """Look up a single order by its ID (full UUID or a distinctive substring of it).

    If require_username is provided, the order is only returned if it actually
    belongs to that username — otherwise a generic 'not found' is returned,
    so this never leaks whether an order exists for someone else's account.
    """
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT o.order_id, o.status, o.items, o.total_amount, o.tracking_number,
               o.updated_at, o.product_id, u.username
        FROM order_state o
        LEFT JOIN users u ON u.id::text = o.user_id
        WHERE o.order_id::text ILIKE %s
        LIMIT 1
        """,
        (f"%{order_id.strip()}%",),
    )
    row = cur.fetchone()
    conn.close()

    if row is None:
        return {"found": False, "message": f"No order found matching '{order_id}'."}

    if require_username is not None and row[7] != require_username:
        return {"found": False, "message": f"No order found matching '{order_id}'."}

    return {
        "found": True,
        "order_id": str(row[0]),
        "status": row[1],
        "items": row[2],
        "total_amount": float(row[3]) if row[3] is not None else None,
        "tracking_number": row[4],
        "updated_at": str(row[5]),
        "product_id": row[6],
        "customer_username": row[7],
    }


def get_customer_order_history(username: str) -> dict:
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT o.order_id, o.status, o.items, o.total_amount, o.tracking_number, o.updated_at
        FROM order_state o
        JOIN users u ON u.id::text = o.user_id
        WHERE u.username = %s
        ORDER BY o.updated_at DESC
        """,
        (username.strip(),),
    )
    rows = cur.fetchall()
    conn.close()

    if not rows:
        return {"found": False, "message": f"No orders found for username '{username}'."}

    orders = [
        {
            "order_id": str(r[0]), "status": r[1], "items": r[2],
            "total_amount": float(r[3]) if r[3] is not None else None,
            "tracking_number": r[4], "updated_at": str(r[5]),
        }
        for r in rows
    ]
    return {"found": True, "username": username, "order_count": len(orders), "orders": orders}

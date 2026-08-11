import os
import json
from order_tools import get_order_status as _get_order_status
from order_tools import get_customer_order_history as _get_customer_order_history
from policy_search import search_store_policies

SYSTEM_PROMPT_TEMPLATE = """You are a friendly customer support assistant for an online store. \
You are currently helping the logged-in customer "{username}". You can only see and discuss \
this customer's own orders — you have no ability to look up any other customer's data.

You can help with two kinds of questions:
1. ORDER-SPECIFIC questions (status, tracking, order history) — use the order lookup tools. \
These automatically only return this customer's own orders. Never guess order details.
2. GENERAL POLICY questions (shipping, returns, warranty, payment, cancellation) — use the \
search_store_policies tool, and answer only from what it returns.

Rules:
- Order IDs are UUIDs — partial fragments are fine, the lookup tool supports partial matches.
- If a policy search returns nothing relevant, say you don't have that information.
- Keep responses warm, concise, and easy to read.
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_order_status",
            "description": (
                "Look up the status, items, and tracking details of one of the current "
                "customer's own orders. Accepts a full order UUID or a distinctive "
                "substring/fragment of it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string", "description": "Full or partial order UUID"},
                },
                "required": ["order_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_order_history",
            "description": "Look up all orders placed by the current logged-in customer.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_store_policies",
            "description": (
                "Search store policies and FAQ for questions about shipping times, returns, "
                "refunds, cancellations, payment methods, warranty, or account/privacy topics."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The customer's question or topic to search for"},
                },
                "required": ["query"],
            },
        },
    },
]


def _build_tool_functions(username: str):
    def get_order_status(order_id: str) -> dict:
        return _get_order_status(order_id, require_username=username)

    def get_my_order_history() -> dict:
        return _get_customer_order_history(username)

    return {
        "get_order_status": get_order_status,
        "get_my_order_history": get_my_order_history,
        "search_store_policies": search_store_policies,
    }


def ask_buyer(question: str, username: str, model: str = "gpt-4.1-mini", max_tool_hops: int = 3) -> dict:
    if not username:
        raise ValueError("username is required — buyer assistant must be scoped to an authenticated user.")

    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not set.")
    client = OpenAI(api_key=api_key)

    tool_functions = _build_tool_functions(username)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_TEMPLATE.format(username=username)},
        {"role": "user", "content": question},
    ]

    tool_trace = []

    for _ in range(max_tool_hops):
        response = client.chat.completions.create(
            model=model, messages=messages, tools=TOOLS, temperature=0.2,
        )
        msg = response.choices[0].message

        if not msg.tool_calls:
            return {"question": question, "answer": msg.content, "tool_trace": tool_trace}

        messages.append({
            "role": "assistant",
            "content": msg.content,
            "tool_calls": [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in msg.tool_calls
            ],
        })

        for tc in msg.tool_calls:
            args = json.loads(tc.function.arguments) if tc.function.arguments else {}
            fn = tool_functions.get(tc.function.name)
            if fn is None:
                result = {"error": f"Unknown tool: {tc.function.name}"}
            else:
                result = fn(**args)
            tool_trace.append({"tool": tc.function.name, "arguments": args, "result": result})
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, default=str)})

    return {
        "question": question,
        "answer": "Sorry, I had trouble completing that request. Please try rephrasing.",
        "tool_trace": tool_trace,
    }

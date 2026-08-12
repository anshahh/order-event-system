"""
admin_agent.py — Admin-facing analytics assistant. No per-user scoping
(admins see store-wide data), but requires admin auth at the API layer,
not inside this module — this module trusts that whoever calls it has
already been verified as an admin.
"""

import os
import json
from admin_tools import ADMIN_TOOLS, ADMIN_TOOL_FUNCTIONS

SYSTEM_PROMPT = """You are an analytics assistant for a store's admin team. \
You answer questions about sales, revenue, top products, stock levels, order \
status, and cross-sell patterns (which products tend to be bought by the same \
customers across separate orders).

Rules:
- Always use the tools to get real data — never estimate or guess numbers.
- When discussing co-purchase patterns, be precise: this reflects customers who \
bought two products in SEPARATE orders, not items bundled in a single cart \
(the current system doesn't support multi-item carts).
- Keep answers concise, and use real numbers from the tools in your answer.
"""


def ask_admin(question: str, model: str = "gpt-4.1-mini", max_tool_hops: int = 3) -> dict:
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY not set.")
    client = OpenAI(api_key=api_key)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]

    tool_trace = []

    for _ in range(max_tool_hops):
        response = client.chat.completions.create(
            model=model, messages=messages, tools=ADMIN_TOOLS, temperature=0.2,
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
            fn = ADMIN_TOOL_FUNCTIONS.get(tc.function.name)
            result = fn(**args) if fn else {"error": f"Unknown tool: {tc.function.name}"}
            tool_trace.append({"tool": tc.function.name, "arguments": args, "result": result})
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, default=str)})

    return {
        "question": question,
        "answer": "Sorry, I had trouble completing that request. Please try rephrasing.",
        "tool_trace": tool_trace,
    }

"""Terminal chatbot: checks the LLM key/model and shows how a multi-turn chat works (any OpenAI-compatible provider).
Run from the project root:  python scripts/space_chat_cli.py   (reads LLM_BASE_URL, LLM_API_KEY, LLM_MODEL from .env)"""
# 1. Imports
import os

import openai
from dotenv import load_dotenv
from openai import OpenAI

MAX_TOKENS = 300  # longest reply, in tokens: limits reply length and therefore cost/quota
TEMPERATURE = 0.7  # randomness: lower = focused and consistent, higher = more varied
RECENT = 10  # send the system message + only the last 10 messages (free tiers cap tokens per minute)

# 2. Load the provider settings from .env (the key's value is never printed)
load_dotenv()
LLM_BASE_URL = os.getenv("LLM_BASE_URL") or "https://api.groq.com/openai/v1"
LLM_API_KEY = os.getenv("LLM_API_KEY")
LLM_MODEL = os.getenv("LLM_MODEL") or "openai/gpt-oss-120b"
if not LLM_API_KEY:
    raise SystemExit("LLM_API_KEY is missing: add it to the .env file in the project root, then run this again.")

# 3. Create the client (max_retries=0: report a rate limit instead of retrying automatically)
client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY, max_retries=0)

# 4. Chat history: the system message, then every turn (all kept; only the recent ones are sent)
system = {"role": "system", "content": (
    "You are the space assistant for Penumbra. Be friendly and concise, and keep replies short and clear. "
    "Help with questions about space, astronomy and NASA missions. If you're not sure of a fact, say so.")}
messages = []

# 5. Start banner
print("Space Assistant started. Type 'exit' or 'quit' to leave.")

# 6. Chat loop: read, send the system message + recent history, print the reply, remember it
try:
    while True:
        user_text = input("You: ").strip()
        if not user_text:
            continue
        if user_text.lower() in ("exit", "quit"):
            print("Bot: Goodbye!")
            break
        messages.append({"role": "user", "content": user_text})
        try:
            response = client.chat.completions.create(model=LLM_MODEL, messages=[system, *messages[-RECENT:]],
                                                      max_tokens=MAX_TOKENS, temperature=TEMPERATURE)
        except Exception as e:  # each failure gets a short, readable message; the failed turn is dropped
            messages.pop()
            if isinstance(e, openai.AuthenticationError):
                print("Bot: [error] The API key is invalid: check LLM_API_KEY in .env.")
            elif isinstance(e, openai.RateLimitError):
                print("Bot: [error] Rate limit hit: wait a minute, then try again.")
            elif isinstance(e, openai.NotFoundError) or "model" in str(e).lower() and "not found" in str(e).lower():
                print(f"Bot: [error] Model '{LLM_MODEL}' wasn't found: check LLM_MODEL in .env.")
            else:
                print(f"Bot: [error] The request failed ({type(e).__name__}). Please try again.")
            continue
        reply = (response.choices[0].message.content or "").strip()
        if not reply:  # e.g. a reasoning model used all MAX_TOKENS thinking: drop the turn like an error
            messages.pop()
            print("Bot: [error] I didn't get an answer that time. Please ask again.")
            continue
        print(f"Bot: {reply}")
        messages.append({"role": "assistant", "content": reply})
# 7. Clean exit on Ctrl+C or end of input
except (KeyboardInterrupt, EOFError):
    print("\nBot: Goodbye!")

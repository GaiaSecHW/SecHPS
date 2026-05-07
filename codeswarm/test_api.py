"""Verify if the custom-gpt5 API endpoint is still alive."""
import urllib.request
import json
import sys

API_KEY = "sk-493c13eb573e241fe216b45dc4ca4cefa042c98ccde8654aade42d8c4c8760f2"
BASE_URL = "https://ai.gs88.shop/v1"

def test_models():
    """List available models from the API."""
    url = f"{BASE_URL}/models"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {API_KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            print(f"[OK] {url} -> status {resp.status}")
            models = [m.get("id", "?") for m in data.get("data", [])]
            print(f"  Available models ({len(models)}): {models[:10]}")
            has_gpt5 = any("gpt-5" in m.lower() for m in models)
            print(f"  Has gpt-5-* model: {has_gpt5}")
            return True
    except Exception as e:
        print(f"[FAIL] {url} -> {e}")
        return False

def test_chat():
    """Send a simple chat completion request."""
    url = f"{BASE_URL}/chat/completions"
    payload = json.dumps({
        "model": "gpt-5-codex",
        "messages": [{"role": "user", "content": "Say hi in one word"}],
        "max_tokens": 10,
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            print(f"[OK] {url} -> status {resp.status}")
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            print(f"  Response: {content}")
            print(f"  Model used: {data.get('model', '?')}")
            return True
    except Exception as e:
        print(f"[FAIL] {url} -> {e}")
        return False

if __name__ == "__main__":
    print("=== Testing custom-gpt5 provider ===\n")
    ok1 = test_models()
    print()
    ok2 = test_chat()
    print(f"\n{'All tests passed' if ok1 and ok2 else 'Some tests FAILED'}")

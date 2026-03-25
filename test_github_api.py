#!/usr/bin/env python3
"""
Test script to debug the GitHub API issue in the backend
"""
import asyncio
import httpx

# Same configuration as in routes/client.py
GITHUB_OWNER = "Abhinay9763"
GITHUB_REPO = "Waffle"
GITHUB_API_BASE = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}"
GITHUB_TOKEN = "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"

async def test_github_release():
    """Test the same logic as get_latest_github_release()"""
    try:
        print(f"Testing GitHub API: {GITHUB_API_BASE}/releases/latest")

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "QuizForge-Backend/1.0",
            "Authorization": f"token {GITHUB_TOKEN}"
        }

        print("Headers:", headers)

        async with httpx.AsyncClient() as client:
            response = await client.get(f"{GITHUB_API_BASE}/releases/latest", headers=headers)

            print(f"Status Code: {response.status_code}")
            print(f"Response Headers: {dict(response.headers)}")

            response.raise_for_status()
            release_data = response.json()

            print(f"Success! Release found: {release_data['tag_name']}")
            print(f"Assets: {len(release_data.get('assets', []))}")

            return release_data

    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")
        return None

if __name__ == "__main__":
    result = asyncio.run(test_github_release())
    if result:
        print("✅ GitHub API test successful")
    else:
        print("❌ GitHub API test failed")
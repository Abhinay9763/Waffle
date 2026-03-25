import os
import json
import httpx
from datetime import datetime
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from starlette.status import HTTP_200_OK, HTTP_404_NOT_FOUND, HTTP_500_INTERNAL_SERVER_ERROR

router = APIRouter(prefix="/client", tags=["client"])

# GitHub configuration
GITHUB_OWNER = "Abhinay9763"
GITHUB_REPO = "Waffle"
GITHUB_API_BASE = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}"
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")

async def get_latest_github_release() -> Optional[Dict[str, Any]]:
    """Get the latest GitHub release information"""
    try:
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "QuizForge-Backend/1.0",
            "Authorization": f"token {GITHUB_TOKEN}"
        }
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{GITHUB_API_BASE}/releases/latest", headers=headers)
            response.raise_for_status()
            return response.json()
    except Exception as e:
        print(f"Failed to fetch GitHub release: {e}")
        return None

def parse_release_metadata(release: Dict[str, Any]) -> Dict[str, Any]:
    """Parse GitHub release data into our version format"""
    # Extract version from tag (remove 'v' prefix if present)
    version = release["tag_name"].lstrip('v')

    # Look for installer and app ZIP in assets
    installer_url = None
    app_url = None

    for asset in release.get("assets", []):
        name = asset["name"].lower()
        if "setup" in name and name.endswith(".exe"):
            installer_url = asset["browser_download_url"]
        elif "app" in name and name.endswith(".zip"):
            app_url = asset["browser_download_url"]

    # Parse required flag from release title or body (default: false)
    required = "[REQUIRED]" in release.get("name", "") or "REQUIRED" in release.get("body", "")

    return {
        "version": version,
        "required": required,
        "installer_url": installer_url,
        "app_url": app_url,
        "release_notes": release.get("body"),
        "created_at": release.get("published_at")
    }

@router.get("/version", status_code=HTTP_200_OK)
async def get_client_version():
    """Get the current active client version info from GitHub releases"""
    try:
        release = await get_latest_github_release()

        if not release:
            raise HTTPException(
                status_code=HTTP_404_NOT_FOUND,
                detail="No client releases found"
            )

        version_data = parse_release_metadata(release)

        # Validate that we have required URLs
        if not version_data["installer_url"]:
            raise HTTPException(
                status_code=HTTP_500_INTERNAL_SERVER_ERROR,
                detail="No installer found in latest release"
            )

        return version_data

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get version info: {str(e)}"
        )

@router.get("/download")
async def download_client():
    """Redirect to the latest client installer download from GitHub"""
    try:
        release = await get_latest_github_release()

        if not release:
            raise HTTPException(
                status_code=HTTP_404_NOT_FOUND,
                detail="No client download available"
            )

        version_data = parse_release_metadata(release)
        installer_url = version_data["installer_url"]

        if not installer_url:
            raise HTTPException(
                status_code=HTTP_404_NOT_FOUND,
                detail="No installer found in latest release"
            )

        # Redirect to GitHub download URL
        return RedirectResponse(url=installer_url)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get download URL: {str(e)}"
        )

@router.get("/app/{version}")
async def download_app_files(version: str):
    """Download app files for a specific version from GitHub releases"""
    try:
        # Get specific release by tag
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "QuizForge-Backend/1.0",
            "Authorization": f"token {GITHUB_TOKEN}"
        }
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{GITHUB_API_BASE}/releases/tags/v{version}", headers=headers)

            if response.status_code == 404:
                raise HTTPException(
                    status_code=HTTP_404_NOT_FOUND,
                    detail=f"Version {version} not found"
                )

            response.raise_for_status()
            release = response.json()

        version_data = parse_release_metadata(release)
        app_url = version_data["app_url"]

        if not app_url:
            raise HTTPException(
                status_code=HTTP_404_NOT_FOUND,
                detail=f"No app package found for version {version}"
            )

        return RedirectResponse(url=app_url)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get app files: {str(e)}"
        )

@router.get("/releases")
async def list_releases():
    """List all available releases from GitHub"""
    try:
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "QuizForge-Backend/1.0",
            "Authorization": f"token {GITHUB_TOKEN}"
        }
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{GITHUB_API_BASE}/releases?per_page=10", headers=headers)
            response.raise_for_status()
            releases = response.json()

        parsed_releases = []
        for release in releases:
            parsed_releases.append(parse_release_metadata(release))

        return {"releases": parsed_releases}

    except Exception as e:
        raise HTTPException(
            status_code=HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get releases: {str(e)}"
        )
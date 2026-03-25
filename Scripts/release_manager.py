"""
QuizForge Client Release Manager - GitHub Only Edition
Uploads files to GitHub Releases (no database needed)
Uses the APP_NAME from Client/config.py for dynamic naming
"""

import os
import sys
import json
import zipfile
from pathlib import Path
from datetime import datetime
from typing import Optional
import importlib.util

# Helper function to get APP_NAME from Client/config.py
def get_app_name():
    """Read APP_NAME from Client/config.py"""
    config_path = Path(__file__).parent.parent / "Client" / "config.py"
    try:
        spec = importlib.util.spec_from_file_location("config", config_path)
        config = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(config)
        return config.APP_NAME
    except Exception as e:
        return "Client"  # Fallback

# Required dependencies: pip install requests python-dotenv
try:
    import requests
    from dotenv import load_dotenv
except ImportError:
    print("Error: Missing dependencies. Install with:")
    print("pip install requests python-dotenv")
    sys.exit(1)

class GitHubReleaseManager:
    def __init__(self, github_token: str, repo_owner: str, repo_name: str):
        self.github_token = github_token
        self.repo_owner = repo_owner
        self.repo_name = repo_name
        self.github_api_base = f"https://api.github.com/repos/{repo_owner}/{repo_name}"

        # Headers for GitHub API
        self.headers = {
            "Authorization": f"token {github_token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        }

    def create_github_release(self, version: str, release_notes: Optional[str] = None, required: bool = True) -> dict:
        """Create a new GitHub release"""
        try:
            print(f"🚀 Creating GitHub release: v{version}")

            # Add [REQUIRED] tag to release name if needed
            release_name = f"{get_app_name()} v{version}"
            if required:
                release_name += " [REQUIRED]"

            release_data = {
                "tag_name": f"v{version}",
                "target_commitish": "master",
                "name": release_name,
                "body": release_notes or f"Release {version} of {get_app_name()}",
                "draft": False,
                "prerelease": False
            }

            response = requests.post(
                f"{self.github_api_base}/releases",
                headers=self.headers,
                json=release_data
            )

            if response.status_code == 201:
                release = response.json()
                print(f"✅ GitHub release created successfully")
                print(f"   Release ID: {release['id']}")
                print(f"   URL: {release['html_url']}")
                return release
            else:
                print(f"❌ Failed to create release: {response.status_code}")
                print(f"   Response: {response.text}")
                raise Exception(f"GitHub API error: {response.status_code}")

        except Exception as e:
            print(f"❌ Failed to create GitHub release: {e}")
            raise

    def upload_asset_to_release(self, release_id: int, file_path: Path, asset_name: str) -> dict:
        """Upload a file as an asset to a GitHub release"""
        try:
            print(f"📤 Uploading {asset_name} to release...")
            file_size_mb = file_path.stat().st_size / (1024*1024)
            print(f"   Size: {file_size_mb:.1f} MB")

            # GitHub upload URL
            upload_url = f"https://uploads.github.com/repos/{self.repo_owner}/{self.repo_name}/releases/{release_id}/assets?name={asset_name}"

            with open(file_path, 'rb') as f:
                file_data = f.read()

            # Determine content type
            content_type = "application/octet-stream"
            if asset_name.endswith(".exe"):
                content_type = "application/vnd.microsoft.portable-executable"
            elif asset_name.endswith(".zip"):
                content_type = "application/zip"

            upload_headers = {
                "Authorization": f"token {self.github_token}",
                "Content-Type": content_type
            }

            response = requests.post(
                upload_url,
                headers=upload_headers,
                data=file_data
            )

            if response.status_code == 201:
                asset = response.json()
                print(f"✅ {asset_name} uploaded successfully")
                print(f"   Download URL: {asset['browser_download_url']}")
                return asset
            else:
                print(f"❌ Failed to upload {asset_name}: {response.status_code}")
                print(f"   Response: {response.text}")
                raise Exception(f"Failed to upload asset: {response.status_code}")

        except Exception as e:
            print(f"❌ Failed to upload {asset_name}: {e}")
            raise

    def create_app_zip(self, app_dir: Path, version: str) -> Path:
        """Create ZIP file from app directory for updates"""
        if not app_dir.exists():
            raise FileNotFoundError(f"App directory not found: {app_dir}")

        zip_name = f"{get_app_name()}-App-v{version}.zip"
        temp_zip = Path(zip_name)

        try:
            print(f"📦 Creating app package: {zip_name}")

            # Create ZIP file
            with zipfile.ZipFile(temp_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for file_path in app_dir.rglob('*'):
                    if file_path.is_file():
                        # Skip certain files
                        if file_path.name in ['updater.exe'] or file_path.suffix in ['.log', '.tmp']:
                            continue

                        arc_path = file_path.relative_to(app_dir)
                        zipf.write(file_path, arc_path)

            print(f"   Package size: {temp_zip.stat().st_size / (1024*1024):.1f} MB")
            return temp_zip

        except Exception as e:
            # Cleanup temp file on error
            if temp_zip.exists():
                temp_zip.unlink()
            print(f"❌ Failed to create app package: {e}")
            raise

    def release_new_version(self, version: str, installer_path: str, app_dir: str,
                          release_notes: Optional[str] = None, required: bool = True) -> dict:
        """Complete release workflow: create GitHub release and upload files"""
        installer_path = Path(installer_path)
        app_dir = Path(app_dir)

        if not installer_path.exists():
            raise FileNotFoundError(f"Installer not found: {installer_path}")
        if not app_dir.exists():
            raise FileNotFoundError(f"App directory not found: {app_dir}")

        try:
            print(f"🚀 Starting release process for v{version}")
            print("=" * 60)

            # Step 1: Create GitHub release
            release = self.create_github_release(version, release_notes, required)
            release_id = release['id']

            # Step 2: Upload installer
            installer_asset_name = f"{get_app_name()}-Setup-v{version}.exe"
            installer_asset = self.upload_asset_to_release(release_id, installer_path, installer_asset_name)
            installer_url = installer_asset['browser_download_url']

            # Step 3: Create and upload app ZIP
            app_zip = self.create_app_zip(app_dir, version)
            app_asset_name = f"{get_app_name()}-App-v{version}.zip"
            app_asset = self.upload_asset_to_release(release_id, app_zip, app_asset_name)
            app_url = app_asset['browser_download_url']

            # Cleanup temp ZIP
            app_zip.unlink()

            print("=" * 60)
            print(f"🎉 Release v{version} completed successfully!")
            print(f"")
            print(f"📊 Release Summary:")
            print(f"   Version: {version}")
            print(f"   GitHub Release: {release['html_url']}")
            print(f"   Installer: {installer_url}")
            print(f"   App Package: {app_url}")
            print(f"   Required Update: {'Yes' if required else 'No'}")
            print(f"")
            print(f"✅ Users can now download from your website!")
            print(f"   Your backend will automatically detect this release via GitHub API.")

            return {
                "version": version,
                "github_release": release,
                "installer_url": installer_url,
                "app_url": app_url
            }

        except Exception as e:
            print(f"💥 Release failed: {e}")
            print(f"   You may need to clean up the GitHub release manually")
            raise

def load_environment():
    """Load environment variables from .env file"""
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        return {
            "GITHUB_TOKEN": os.getenv("GITHUB_TOKEN"),
            "GITHUB_OWNER": os.getenv("GITHUB_OWNER", "Abhinay9763"),
            "GITHUB_REPO": os.getenv("GITHUB_REPO", "Waffle")
        }
    else:
        print("❌ .env file not found!")
        print(f"Create {env_path} with:")
        print("GITHUB_TOKEN=your_github_token_here")
        print("GITHUB_OWNER=Abhinay9763")
        print("GITHUB_REPO=Waffle")
        sys.exit(1)

def main():
    """Interactive CLI for managing releases"""
    print(f"QuizForge GitHub Release Manager")
    print(f"Pure GitHub Storage - No Database Needed")
    print(f"App: {get_app_name()}")
    print("=" * 50)

    # Load environment
    env = load_environment()
    required_vars = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"]
    missing = [k for k in required_vars if not env.get(k)]
    if missing:
        print(f"❌ Missing required environment variables: {', '.join(missing)}")
        sys.exit(1)

    print("🚀 GitHub-only mode - no database dependency!")
    print("   Your backend reads version info directly from GitHub releases API")

    # Create manager
    manager = GitHubReleaseManager(
        github_token=env["GITHUB_TOKEN"],
        repo_owner=env["GITHUB_OWNER"],
        repo_name=env["GITHUB_REPO"]
    )

    while True:
        print("\nOptions:")
        print("[1] Release new version")
        print("[2] List recent releases")
        print("[3] Exit")

        choice = input("\nEnter your choice: ").strip()

        if choice == "1":
            try:
                version = input("Enter version number (e.g., 1.0.0): ").strip()
                installer_path = input("Enter path to installer .exe: ").strip()
                app_dir = input("Enter path to app directory: ").strip()
                release_notes = input("Enter release notes (optional): ").strip() or None

                required_input = input("Is this a required update? (Y/n): ").strip().lower()
                required = required_input != 'n'

                result = manager.release_new_version(
                    version=version,
                    installer_path=installer_path,
                    app_dir=app_dir,
                    release_notes=release_notes,
                    required=required
                )

            except KeyboardInterrupt:
                print("\n\n⏹️ Release cancelled by user")
            except Exception as e:
                print(f"\n💥 Error: {e}")

        elif choice == "2":
            try:
                print("📋 Recent GitHub releases:")
                response = requests.get(
                    f"{manager.github_api_base}/releases?per_page=5",
                    headers=manager.headers
                )
                if response.status_code == 200:
                    releases = response.json()
                    for release in releases:
                        required = "[REQUIRED]" if "[REQUIRED]" in release['name'] else "[OPTIONAL]"
                        print(f"  • {release['tag_name']} - {required} ({release['created_at'][:10]})")
                        print(f"    {release['html_url']}")
                else:
                    print(f"❌ Failed to fetch GitHub releases: {response.status_code}")
            except Exception as e:
                print(f"❌ Error: {e}")

        elif choice == "3":
            print("👋 Goodbye!")
            break

        else:
            print("❌ Invalid choice")

if __name__ == "__main__":
    main()
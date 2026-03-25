"""
Client Version Manager
Handles version checking and automatic updates
"""
import json
import os
import sys
import requests
import subprocess
import shutil
from pathlib import Path
from typing import Optional, Dict, Any
import tempfile
from datetime import datetime

class VersionManager:
    def __init__(self, api_base_url: str = "http://localhost:8000"):
        self.api_base_url = api_base_url.rstrip('/')
        self.current_dir = Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).parent
        self.config_file = self.current_dir / "config.json"
        self.updater_exe = self.current_dir / "updater.exe"

    def get_current_version(self) -> str:
        """Get the current client version from config file"""
        try:
            if self.config_file.exists():
                with open(self.config_file, 'r') as f:
                    config = json.load(f)
                    return config.get('version', '0.0.0')
            return '0.0.0'
        except Exception:
            return '0.0.0'

    def save_current_version(self, version: str):
        """Save the current version to config file"""
        try:
            config = {}
            if self.config_file.exists():
                with open(self.config_file, 'r') as f:
                    config = json.load(f)

            config['version'] = version
            config['last_update_check'] = str(datetime.now())

            with open(self.config_file, 'w') as f:
                json.dump(config, f, indent=2)
        except Exception as e:
            print(f"Failed to save version: {e}")

    def check_for_updates(self) -> Optional[Dict[str, Any]]:
        """Check if a new version is available"""
        try:
            response = requests.get(f"{self.api_base_url}/client/version", timeout=10)
            response.raise_for_status()

            server_info = response.json()
            current_version = self.get_current_version()

            print(f"Current version: {current_version}")
            print(f"Server version: {server_info['version']}")

            # Simple version comparison (assumes semantic versioning)
            if self._is_newer_version(server_info['version'], current_version):
                return {
                    'update_available': True,
                    'new_version': server_info['version'],
                    'required': server_info['required'],
                    'installer_url': server_info['installer_url'],  # GitHub installer URL
                    'app_url': server_info['app_url'],              # GitHub app ZIP URL
                    'release_notes': server_info.get('release_notes')
                }

            return {'update_available': False}

        except Exception as e:
            print(f"Failed to check for updates: {e}")
            return {'update_available': False, 'error': str(e)}

    def _is_newer_version(self, new_version: str, current_version: str) -> bool:
        """Compare version strings (simple semantic versioning)"""
        try:
            def version_tuple(v):
                return tuple(map(int, v.split('.')))

            return version_tuple(new_version) > version_tuple(current_version)
        except Exception:
            return False

    def download_and_update(self, update_info: Dict[str, Any]) -> bool:
        """Download and apply update"""
        try:
            print("Starting update process...")

            # Download app files
            app_url = update_info['app_url']
            temp_dir = Path(tempfile.mkdtemp())
            app_zip_path = temp_dir / "app_update.zip"

            print(f"Downloading update from {app_url}")
            response = requests.get(app_url, stream=True)
            response.raise_for_status()

            with open(app_zip_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            print("Download completed. Extracting...")

            # Extract to temp directory
            import zipfile
            extract_dir = temp_dir / "extracted"
            extract_dir.mkdir()

            with zipfile.ZipFile(app_zip_path, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)

            # Launch updater if it exists, otherwise do direct update
            if self.updater_exe.exists():
                self._launch_updater(extract_dir, update_info['new_version'])
            else:
                self._direct_update(extract_dir, update_info['new_version'])

            return True

        except Exception as e:
            print(f"Update failed: {e}")
            return False

    def _launch_updater(self, source_dir: Path, new_version: str):
        """Launch the external updater process"""
        try:
            # Launch updater with arguments
            subprocess.Popen([
                str(self.updater_exe),
                str(source_dir),
                str(self.current_dir),
                new_version,
                str(sys.executable)  # Path to current executable to restart
            ])
            print("Updater launched. Exiting main application...")
            sys.exit(0)
        except Exception as e:
            print(f"Failed to launch updater: {e}")
            # Fall back to direct update
            self._direct_update(source_dir, new_version)

    def _direct_update(self, source_dir: Path, new_version: str):
        """Perform direct update (backup method)"""
        try:
            print("Performing direct update...")

            # Backup current files
            backup_dir = self.current_dir / f"backup_{self.get_current_version()}"
            if backup_dir.exists():
                shutil.rmtree(backup_dir)

            shutil.copytree(self.current_dir, backup_dir, ignore=shutil.ignore_patterns('backup_*', '__pycache__', '*.tmp'))

            # Copy new files (excluding executable)
            for item in source_dir.rglob('*'):
                if item.is_file() and not item.name.endswith('.exe'):
                    relative_path = item.relative_to(source_dir)
                    destination = self.current_dir / relative_path

                    # Create directory if it doesn't exist
                    destination.parent.mkdir(parents=True, exist_ok=True)

                    # Copy file
                    shutil.copy2(item, destination)

            # Update version
            self.save_current_version(new_version)
            print(f"Update completed to version {new_version}")

            # Clean up temp files
            shutil.rmtree(source_dir.parent)

            return True

        except Exception as e:
            print(f"Direct update failed: {e}")
            # Restore backup if possible
            try:
                if 'backup_dir' in locals() and backup_dir.exists():
                    shutil.rmtree(self.current_dir)
                    shutil.copytree(backup_dir, self.current_dir)
                    print("Backup restored")
            except Exception:
                pass
            return False


# For backward compatibility
def check_for_updates() -> Optional[Dict[str, Any]]:
    """Simple function to check for updates"""
    manager = VersionManager()
    return manager.check_for_updates()

def get_current_version() -> str:
    """Simple function to get current version"""
    manager = VersionManager()
    return manager.get_current_version()


if __name__ == "__main__":
    # Test version checking
    from datetime import datetime

    manager = VersionManager()
    print(f"Current version: {manager.get_current_version()}")

    update_info = manager.check_for_updates()
    print(f"Update check result: {update_info}")

    if update_info.get('update_available'):
        print(f"New version available: {update_info['new_version']}")
        if update_info['required']:
            print("Update is required!")
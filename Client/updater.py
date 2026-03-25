"""
Client Updater
Separate process that handles updating the main application
Reads APP_NAME from config.py for dynamic naming
"""
import sys
import time
import shutil
import json
from pathlib import Path
import subprocess
import os
from config import APP_NAME

class ClientUpdater:
    def __init__(self, source_dir: str, target_dir: str, new_version: str, main_exe: str):
        self.source_dir = Path(source_dir)
        self.target_dir = Path(target_dir)
        self.new_version = new_version
        self.main_exe = Path(main_exe)

    def update(self):
        """Perform the update process"""
        try:
            print(f"{APP_NAME} Updater - Starting update process...")
            print(f"Updating to version {self.new_version}")

            # Wait a moment for main application to close
            time.sleep(2)

            # Verify main application is closed
            self._wait_for_main_app_close()

            # Create backup
            backup_success = self._create_backup()
            if not backup_success:
                print("Warning: Failed to create backup, continuing anyway...")

            # Copy new files
            copy_success = self._copy_new_files()
            if not copy_success:
                print("Error: Failed to copy new files")
                if backup_success:
                    self._restore_backup()
                return False

            # Update version info
            self._update_version_info()

            # Clean up
            self._cleanup()

            print("Update completed successfully!")

            # Restart main application
            self._restart_main_app()

            return True

        except Exception as e:
            print(f"Update failed: {e}")
            return False

    def _wait_for_main_app_close(self, timeout=30):
        """Wait for main application to close"""
        print("Waiting for main application to close...")

        # Simple approach: wait for the executable to be available for writing
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                # Try to open the executable for writing
                if self.main_exe.exists():
                    with open(self.main_exe, 'r+b'):
                        pass
                print("Main application closed.")
                return True
            except (PermissionError, IOError):
                time.sleep(1)
                continue

        print("Warning: Timeout waiting for main application to close")
        return False

    def _create_backup(self):
        """Create backup of current installation"""
        try:
            backup_dir = self.target_dir / f"backup_{int(time.time())}"
            print(f"Creating backup at {backup_dir}")

            # Copy current files to backup (exclude backups and temp files)
            shutil.copytree(
                self.target_dir,
                backup_dir,
                ignore=shutil.ignore_patterns('backup_*', '__pycache__', '*.tmp', '*.log')
            )

            # Store backup path for potential restore
            self.backup_dir = backup_dir
            print("Backup created successfully")
            return True

        except Exception as e:
            print(f"Failed to create backup: {e}")
            return False

    def _copy_new_files(self):
        """Copy new files to target directory"""
        try:
            print("Copying new files...")

            copied_count = 0
            for item in self.source_dir.rglob('*'):
                if item.is_file():
                    relative_path = item.relative_to(self.source_dir)
                    destination = self.target_dir / relative_path

                    # Skip copying over the updater itself and main exe
                    if destination.name in ['updater.exe', f'{APP_NAME}.exe']:
                        continue

                    # Create directory if needed
                    destination.parent.mkdir(parents=True, exist_ok=True)

                    # Copy file
                    shutil.copy2(item, destination)
                    copied_count += 1

            print(f"Copied {copied_count} files successfully")
            return True

        except Exception as e:
            print(f"Failed to copy files: {e}")
            return False

    def _update_version_info(self):
        """Update the version information in config file"""
        try:
            config_file = self.target_dir / "config.json"
            config = {}

            if config_file.exists():
                with open(config_file, 'r') as f:
                    config = json.load(f)

            config['version'] = self.new_version
            config['updated_at'] = str(time.time())

            with open(config_file, 'w') as f:
                json.dump(config, f, indent=2)

            print(f"Version updated to {self.new_version}")

        except Exception as e:
            print(f"Failed to update version info: {e}")

    def _cleanup(self):
        """Clean up temporary files"""
        try:
            # Clean up source directory
            if self.source_dir.exists() and self.source_dir.parent.name.startswith('tmp'):
                shutil.rmtree(self.source_dir.parent)

            # Clean up old backups (keep only last 3)
            backup_dirs = [d for d in self.target_dir.iterdir() if d.is_dir() and d.name.startswith('backup_')]
            backup_dirs.sort(key=lambda x: x.stat().st_mtime, reverse=True)

            for old_backup in backup_dirs[3:]:  # Keep only 3 most recent
                shutil.rmtree(old_backup)

        except Exception as e:
            print(f"Cleanup warning: {e}")

    def _restore_backup(self):
        """Restore from backup if update failed"""
        try:
            if hasattr(self, 'backup_dir') and self.backup_dir.exists():
                print("Restoring from backup...")

                # Remove current files
                for item in self.target_dir.iterdir():
                    if item.name.startswith('backup_'):
                        continue
                    if item.is_file():
                        item.unlink()
                    elif item.is_dir():
                        shutil.rmtree(item)

                # Restore from backup
                for item in self.backup_dir.iterdir():
                    if item.is_file():
                        shutil.copy2(item, self.target_dir)
                    elif item.is_dir():
                        shutil.copytree(item, self.target_dir / item.name)

                print("Backup restored successfully")
                return True

        except Exception as e:
            print(f"Failed to restore backup: {e}")
            return False

    def _restart_main_app(self):
        """Restart the main application"""
        try:
            print("Restarting main application...")
            time.sleep(1)  # Brief pause

            # Launch main application
            subprocess.Popen([str(self.main_exe)])
            print("Main application restarted")

        except Exception as e:
            print(f"Failed to restart main application: {e}")
            print(f"Please manually start {APP_NAME}")


def main():
    """Main updater entry point"""
    if len(sys.argv) != 5:
        print("Usage: updater.exe <source_dir> <target_dir> <version> <main_exe>")
        input("Press Enter to exit...")
        sys.exit(1)

    source_dir = sys.argv[1]
    target_dir = sys.argv[2]
    new_version = sys.argv[3]
    main_exe = sys.argv[4]

    print(f"{APP_NAME} Updater v1.0")
    print(f"Updating from {source_dir} to {target_dir}")
    print(f"New version: {new_version}")

    updater = ClientUpdater(source_dir, target_dir, new_version, main_exe)
    success = updater.update()

    if success:
        print("\nUpdate completed successfully!")
    else:
        print("\nUpdate failed! Please check the logs above.")
        print(f"You may need to reinstall {APP_NAME} manually.")

    print("\nPress Enter to close this window...")
    input()


if __name__ == "__main__":
    main()
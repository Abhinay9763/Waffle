#!/usr/bin/env python3
"""
Script to create HOD account directly in database
Run this once to set up the initial HOD account
"""

import asyncio
from utils import hashPassword
from supa import db

async def create_hod():
    # HOD account details
    hod_data = {
        "name": "Head",      # Change this
        "email": "psrekha1976@gmail.com",     # Change this
        "password": hashPassword("hod123"),  # Change this password
        "roll": "HOD001",              # Change this
        "role": "HOD",
        "approval_status": "approved"
    }

    # Check if HOD already exists
    existing = await db.client.table("Users").select("id").eq("email", hod_data["email"]).execute()
    if existing.data:
        print("❌ HOD account already exists with this email")
        return

    # Insert HOD account
    result = await db.client.table("Users").insert(hod_data).execute()
    if result.data:
        print("✅ HOD account created successfully!")
        print(f"   Email: {hod_data['email']}")
        print(f"   Password: hod123")  # Show the password you set
        print(f"   Role: {hod_data['role']}")
    else:
        print("❌ Failed to create HOD account")

if __name__ == "__main__":
    asyncio.run(create_hod())